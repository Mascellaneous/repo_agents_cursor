/* =============================================================================
 * publisher.js — 把 AI 生成的程式碼區塊直接 commit 到 GitHub（window.Publisher）
 * -----------------------------------------------------------------------------
 * • 目的地可「全域預設」或「每個對話自訂」（chat.out），與聊天備份的
 *   repo／資料夾完全獨立。
 * • Token：預設沿用同步 Token；可另設專用 Token。永不寫進 IndexedDB／備份檔。
 * • 寫入走 Contents API（sha 樂觀鎖，衝突重抓一次再推）；大檔走 Git Data API。
 * • 未啟用時零網路請求、不出現任何按鈕。
 * ============================================================================= */
 
window.Publisher = (() => {
 
  const GH_API = 'https://api.github.com';
  const GIT_DATA_THRESHOLD = 900 * 1024;
 
  let cfg = {};
  let token = '';
  let memToken = '';
  const branchCache = new Map();          // `owner/repo` → default_branch
 
  /* ---------------------------- 設定 / Token --------------------------- */
 
  function loadCfg() {
    cfg = { ...(window.PUBLISH_DEFAULTS || {}), ...(Store.get(STORAGE_KEYS.pubCfg, {}) || {}) };
    token = readToken(cfg.tokenStore);
    return cfg;
  }
  const saveCfg = () => Store.set(STORAGE_KEYS.pubCfg, cfg);
 
  function readToken(mode) {
    if (mode === 'memory') return memToken;
    try { return (mode === 'session' ? sessionStorage : localStorage).getItem(STORAGE_KEYS.pubToken) || ''; }
    catch { return ''; }
  }
  function writeToken(tok, mode) {
    memToken = tok || '';
    try {
      localStorage.removeItem(STORAGE_KEYS.pubToken);
      sessionStorage.removeItem(STORAGE_KEYS.pubToken);
      if (mode === 'local' && tok) localStorage.setItem(STORAGE_KEYS.pubToken, tok);
      if (mode === 'session' && tok) sessionStorage.setItem(STORAGE_KEYS.pubToken, tok);
    } catch {}
    token = tok || '';
  }
 
  /* ------------------------------ 目的地解析 --------------------------- */
 
  /** 目前對話生效的目的地；null = 未啟用或目的地不完整 */
  function resolve(chat) {
    if (!cfg.enabled) return null;
    const o = chat && chat.out && chat.out.mode === 'custom' ? chat.out : null;
    const src = o || cfg;
    const owner = String(src.owner || '').trim();
    const repo  = String(src.repo  || '').trim().replace(/^.*\//, '');
    if (!owner || !repo) return null;
    return {
      owner, repo,
      branch: String(src.branch || '').trim(),
      dir:    String(src.dir || '').trim().replace(/^\/+|\/+$/g, ''),
      auto:   o ? !!o.auto : false,
      custom: !!o,
    };
  }
 
  const enabled = () => !!cfg.enabled;
 
  function tokenFor(target) {
    if (cfg.useSyncToken === false) {
      if (!token) throw new Error('尚未設定輸出專用 GitHub Token（設定 → ☁️ 同步 → 檔案輸出）');
      return token;
    }
    const t = window.GitHubSync?.token || '';
    if (!t) throw new Error('尚未啟用 GitHub 同步（需要其 Token），或改為輸出專用 Token');
    return t;
  }
 
  /* ------------------------------ 低階 API ----------------------------- */
 
  async function gh(target, path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
    let res;
    try {
      res = await fetch(GH_API + path, {
        method,
        headers: {
          Authorization: `Bearer ${tokenFor(target)}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('網路連線失敗，無法連上 GitHub');
    }
    if (res.status === 401) throw new Error('GitHub Token 無效或無權存取輸出目的地');
    if (res.status === 403) {
      const rl = res.headers.get('x-ratelimit-remaining');
      throw new Error(rl === '0' ? 'GitHub API 額度用盡，稍後再試'
                                 : '權限不足：此 Token 沒有該 repo 的 Contents 寫入權限');
    }
    if (res.status === 404) return { notFound: true };
    if (res.status === 409 || res.status === 422) return { conflict: true };
    if (!res.ok) throw new Error(`GitHub 請求失敗（HTTP ${res.status}）`);
    return { data: accept.includes('raw') ? await res.text() : await res.json() };
  }
 
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
 
  async function defaultBranch(target) {
    const key = `${target.owner}/${target.repo}`;
    if (branchCache.has(key)) return branchCache.get(key);
    const r = await gh(target, `/repos/${key}`);
    if (r.notFound) throw new Error(`找不到 repo ${key}（或 Token 無權限）`);
    const b = r.data.default_branch || 'main';
    branchCache.set(key, b);
    return b;
  }
 
  const joinPath = (dir, rel) => (dir ? `${dir}/${rel}` : rel);
 
  /** 相對路徑安全化：禁絕 ..、絕對路徑、空段 */
  function safeRel(p) {
    const parts = String(p || '').replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
    if (!parts.length || parts.some(s => s === '..')) return null;
    return parts.join('/');
  }
 
  /* ------------------------------ 推送 --------------------------------- */
 
  /** 推一個文字檔；回傳 { path, url?, sha? } */
  async function putFile(target, relPath, content, message) {
    const rel = safeRel(relPath);
    if (!rel) throw new Error(`不合法的檔案路徑：「${relPath}」`);
    const path = joinPath(target.dir, rel);
    const base = `/repos/${target.owner}/${target.repo}`;
    const branch = target.branch || await defaultBranch(target);
    const enc = b64enc(content);
    const bytes = new TextEncoder().encode(content).length;
 
    /* 大檔：blob → tree → commit → PATCH ref */
    if (bytes > GIT_DATA_THRESHOLD) {
      const { data: blob } = await gh(target, `${base}/git/blobs`,
        { method: 'POST', body: { content: enc, encoding: 'base64' } });
      const refPath = `${base}/git/refs/heads/${encodeURIComponent(branch)}`;
      const { data: ref } = await gh(target, refPath);
      if (ref.notFound) throw new Error(`找不到分支 ${branch}`);
      const { data: c0 } = await gh(target, `${base}/git/commits/${ref.object.sha}`);
      const { data: tree } = await gh(target, `${base}/git/trees`, {
        method: 'POST',
        body: { base_tree: c0.tree.sha, tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }] },
      });
      const { data: c1 } = await gh(target, `${base}/git/commits`, {
        method: 'POST',
        body: { message: message || `publish: ${path}`, tree: tree.sha, parents: [ref.object.sha] },
      });
      const upd = await gh(target, refPath, { method: 'PATCH', body: { sha: c1.sha, force: false } });
      if (upd.conflict) throw new Error('推送衝突：遠端分支剛被更新，請重試');
      return { path, url: `https://github.com/${target.owner}/${target.repo}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}` };
    }
 
    /* 小檔：Contents API（帶 sha 樂觀鎖；衝突重抓一次再推） */
    const doPut = async sha => gh(target, `${base}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: { message: message || `publish: ${path}`, content: enc, branch, ...(sha ? { sha } : {}) },
    });
 
    let cur = await gh(target, `${base}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
    let r = await doPut(cur.notFound ? null : cur.data.sha);
    if (r.conflict) {
      cur = await gh(target, `${base}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
      r = await doPut(cur.notFound ? null : cur.data.sha);
      if (r.conflict) throw new Error('推送衝突：遠端檔案持續變動，請稍後重試');
    }
    return { path, url: r.data?.content?.html_url, sha: r.data?.content?.sha };
  }
 
  async function testTarget(target) {
    const r = await gh(target, `/repos/${target.owner}/${target.repo}`);
    if (r.notFound) throw new Error(`找不到 repo ${target.owner}/${target.repo}（或 Token 無權限）`);
    if (!r.data.permissions?.push) throw new Error('Token 沒有這個 repo 的寫入權限');
    return { name: r.data.full_name, private: !!r.data.private, branch: target.branch || r.data.default_branch || 'main' };
  }
 
  /* --------------------------- 程式碼區塊萃取 -------------------------- */
 
  const blocksOf = md => (window.MD?.extractCodeBlocks ? MD.extractCodeBlocks(md) : []);
 
  /** 檔名推斷：圍欄標註 → 首行註解 → block-N.<ext> */
  function guessName(block, idx) {
    const info = (block.lang || '').trim();
    const mInfo = info.match(/([\w.\-]+\.[A-Za-z0-9]+)\s*$/);          // "python main.py"
    if (mInfo) return mInfo[1];
    const head = (block.code || '').split('\n').slice(0, 3).join('\n');
    const mHead = head.match(/^\s*(?:#|\/\/|--|<!--|\/\*)\s*(?:file|filename|檔名)?\s*[:=]?\s*([\w.\-\/]+\.[A-Za-z0-9]+)/im);
    if (mHead) return mHead[1].replace(/^\.?\//, '');
    const lang = (info.split(/[\s:]/)[0] || '').toLowerCase();
    const extMap = { javascript:'js', typescript:'ts', python:'py', shell:'sh', bash:'sh',
                     markdown:'md', yaml:'yml', cpp:'cpp', rust:'rs' };
    return `block-${idx + 1}.${extMap[lang] || 'txt'}`;
  }
 
  /* --------------------------- 對話層級操作 ---------------------------- */
 
  const msgById = (chatId, msgId) =>
    Chats.findRaw(chatId)?.messages.find(m => m.id === msgId) || null;
 
  /** 單一區塊發佈（含路徑確認對話框） */
  async function commitOne(chat, msgId, index) {
    const target = resolve(chat);
    if (!target) { Toast.warn('尚未設定輸出目的地（🎛️ 本對話設定 → ⇪ 輸出檔案）'); return; }
    const m = msgById(chat.id, msgId);
    const b = (m ? blocksOf(m.content) : [])[index];
    if (!b) { Toast.warn('找不到要發佈的程式碼區塊'); return; }
    if (!String(b.code || '').trim()) { Toast.warn('這個程式碼區塊是空的，沒有內容可發佈'); return; }
 
    const name = await Modal.ask({
      title: '⇪ 發佈到 GitHub',
      input: true, value: guessName(b, index),
      placeholder: `相對於「${target.dir || 'repo 根目錄'}」的路徑，可含子資料夾`,
      okText: '發佈',
      message: `${target.owner}/${target.repo}${target.branch ? `（${target.branch}）` : ''}` +
               `${target.dir ? ` · ${target.dir}/` : ' / '}　語言：${b.lang || '未知'}`,
    });
    if (name === null) return;                    // 取消／Esc／backdrop → 安靜離開
    if (!name) { Toast.warn('請輸入檔名'); return; } // 按了確定但沒填 → 明確提示
    const t = Toast.loading(`正在發佈 ${name} …`);
    try {
      const code = b.code.endsWith('\n') ? b.code : b.code + '\n';
      const r = await putFile(target, name, code, `publish(${APP.name}): ${name}`);
      t.update(`已發佈：${r.path}`, 'ok');
    } catch (e) { t.update('發佈失敗：' + e.message, 'error', 7000); }
  }
 
  /** 整則訊息全部區塊一次發佈 */
  async function commitAll(chat, msgId, { silent = false } = {}) {
    const target = resolve(chat);
    if (!target) { if (!silent) Toast.warn('尚未設定輸出目的地'); return 0; }
    const m = msgById(chat.id, msgId);
    const blocks = (m ? blocksOf(m.content) : []).filter(b => String(b.code || '').trim());
    if (!blocks.length) { if (!silent) Toast.info('這則回覆沒有可發佈的程式碼區塊'); return 0; }
 
    if (!silent) {
      const list = blocks.map((b, i) => `• ${guessName(b, i)}（${b.lang || '?'}）`).join('\n');
      const ok = await Modal.ask({
        title: `⇪ 發佈 ${blocks.length} 個檔案`,
        message: `目的地：${target.owner}/${target.repo}${target.dir ? ` · ${target.dir}/` : ''}\n\n${list}`,
        okText: '全部發佈',
      });
      if (!ok) return 0;
    }
 
    const seen = new Set(); let n = 0; const errs = [];
    for (let i = 0; i < blocks.length; i++) {
      const name = guessName(blocks[i], i);
      const key = `${name}|${Chats.hash32(blocks[i].code)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const code = blocks[i].code.endsWith('\n') ? blocks[i].code : blocks[i].code + '\n';
        await putFile(target, name, code, `publish(${APP.name}): ${name}`);
        n++;
      } catch (e) { errs.push(`${name}: ${e.message}`); }
    }
    const where = `${target.owner}/${target.repo}${target.dir ? '/' + target.dir : ''}`;
    if (errs.length) Toast.error(`已發佈 ${n} 個、失敗 ${errs.length} 個：\n` + errs.join('\n'), 7000);
    else if (n) Toast.ok(`已發佈 ${n} 個檔案到 ${where}`);
    return n;
  }
 
  /** 生成完成後的自動發佈（僅對話開了 auto 才作用；暫時對話跳過） */
  function maybeAutoCommit(chat, msgId) {
    const target = resolve(chat);
    if (!target || !target.auto || chat.temporary) return;
    commitAll(chat, msgId, { silent: true }).catch(e => Toast.error('自動發佈失敗：' + e.message));
  }
 
  /* ------------------------------ 設定 UI ------------------------------ */
 
  function bindDom() {
    const $ = U.$;
    if (!$('#pub-panel')) return;
    const val = (s, p = 'value') => $(s)?.[p];
    const put = (s, p, v) => { const e = $(s); if (e) e[p] = v; };
 
    const fill = () => {
      put('#pub-enabled', 'checked', !!cfg.enabled);
      put('#pub-use-sync-token', 'checked', cfg.useSyncToken !== false);
      put('#pub-token', 'value', token);
      put('#pub-token-store', 'value', cfg.tokenStore || 'local');
      put('#pub-owner', 'value', cfg.owner || '');
      put('#pub-repo', 'value', cfg.repo || '');
      put('#pub-branch', 'value', cfg.branch || '');
      put('#pub-dir', 'value', cfg.dir || '');
      $('#pub-panel').classList.toggle('hidden', !cfg.enabled);
      $('#pub-token-row')?.classList.toggle('hidden', cfg.useSyncToken !== false);
    };
 
    const save = () => {
      Object.assign(cfg, {
        enabled: !!val('#pub-enabled', 'checked'),
        useSyncToken: val('#pub-use-sync-token', 'checked') !== false,
        tokenStore: val('#pub-token-store') || 'local',
        owner: (val('#pub-owner') || '').trim(),
        repo: (val('#pub-repo') || '').trim().replace(/^.*\//, ''),
        branch: (val('#pub-branch') || '').trim(),
        dir: (val('#pub-dir') || '').trim().replace(/^\/+|\/+$/g, ''),
      });
      if (cfg.useSyncToken === false) writeToken((val('#pub-token') || '').trim(), cfg.tokenStore);
      saveCfg();
      $('#pub-panel').classList.toggle('hidden', !cfg.enabled);
      $('#pub-token-row')?.classList.toggle('hidden', cfg.useSyncToken !== false);
      window.UI?.renderMessages?.(true);   // ⇪ 按鈕即時出現／消失
    };
 
    ['#pub-enabled', '#pub-use-sync-token', '#pub-token', '#pub-token-store',
     '#pub-owner', '#pub-repo', '#pub-branch', '#pub-dir']
      .forEach(s => $(s)?.addEventListener('change', save));
 
    $('#btn-pub-token-toggle')?.addEventListener('click', () => {
      const i = $('#pub-token');
      if (i) i.type = i.type === 'password' ? 'text' : 'password';
    });
 
    $('#btn-pub-test')?.addEventListener('click', async () => {
      save();
      const info = $('#pub-status');
      if (info) info.textContent = '測試中…';
      const target = resolve(null);
      if (!target) { if (info) info.textContent = '❌ 請先填 Owner 與 Repo'; return; }
      try {
        const r = await testTarget(target);
        if (info) info.innerHTML =
          `✅ ${U.escapeHtml(r.name)}（${r.private ? 'private' : '<b class="danger-title">PUBLIC！</b>'}）· 分支 ${U.escapeHtml(r.branch)}`;
      } catch (e) { if (info) info.textContent = '❌ ' + e.message; }
    });
 
    fill();
  }
 
  function init() { loadCfg(); bindDom(); }
 
  return {
    init, loadCfg, resolve, enabled,
    putFile, testTarget, commitOne, commitAll, maybeAutoCommit, blocksOf, guessName,
    get config() { return cfg; },
  };
})();
 
/* 與 GitHubSync 同款：載入期先讀設定，讓 UI 不必等 init 就能判斷可用性 */
try { window.Publisher.loadCfg(); } catch {}