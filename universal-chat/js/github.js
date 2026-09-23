/* =============================================================================
 * github.js — GitHub 同步（window.GitHubSync）
 * -----------------------------------------------------------------------------
 * 核心保證：
 *   1. 一個對話 = 一個檔案 chats/<id>.json → 改不同對話時零衝突。
 *   2. 寫入一律帶 sha（樂觀鎖）。409 → 重抓、三方合併、再推。永不硬蓋。
 *   3. 訊息以 id 聯集合併 → 一則都不會少。
 *   4. 刪除採墓碑（訊息 / 對話 / 資料夾 / 提示詞）→ 會傳播，也不會復活。
 *   5. 合併可交換、可收斂（同分用 deviceId 字典序）。
 *   6. 未啟用時所有函式立刻 return，零網路請求。
 *
 * 靜默原則（避免畫面閃爍與無謂流量）：
 *   • 指紋只看「內容」，忽略 rev / draft / _ 開頭欄位 → 不會出現裝置間無限互推。
 *   • 內容真的不同才寫回本機；只有本機真的被改動才呼叫 UI.renderAll()。
 *   • 來自雲端的寫入標記 remote=true，不會回頭觸發 markDirty（無同步迴圈）。
 *   • 生成中不執行自動同步，改為稍後重試。
 *
 * 大檔與目錄上限（v2.4.1）：
 *   • 超過 GIT_DATA_THRESHOLD（~900 KB）的對話改走 Git Data API：
 *     blob → tree(base_tree) → commit → PATCH ref。ref 更新非快進失敗視為 CONFLICT。
 *   • listRemote() 改用 git trees API（recursive=1）：不受 contents API
 *     1000 檔截斷限制；trees 失敗時退回舊 contents API。
 * ============================================================================= */
 
window.GitHubSync = (() => {
 
  const GH_API = 'https://api.github.com';
  const RETRY_MAX = 3;
  const GIT_DATA_THRESHOLD = 900 * 1024;   // 超過就走 Git Data API（contents API 對 >1MB 不理想）
 
  let cfg = { ...GITHUB_DEFAULTS };
  let meta = { lastSync: null, dirEtag: null, shas: {}, fp: {}, lastError: null };
  let token = '';
  let memToken = '';
  let running = null, timer = null, debounceT = null;
  const listeners = [];
 
  class GhError extends Error {
    constructor(code, msg, status) { super(msg); this.code = code; this.status = status; }
  }
 
  /* ============================ 設定 / Token ============================ */
 
  function loadCfg() {
    cfg = { ...GITHUB_DEFAULTS, ...(Store.get(STORAGE_KEYS.github, {}) || {}) };
    meta = { lastSync: null, dirEtag: null, shas: {}, fp: {}, lastError: null,
             ...(Store.get(STORAGE_KEYS.syncMeta, {}) || {}) };
    token = readToken(cfg.tokenStore);
    return cfg;
  }
  const saveCfg = () => Store.set(STORAGE_KEYS.github, cfg);
  const saveMeta = () => Store.set(STORAGE_KEYS.syncMeta, meta);
 
  function readToken(mode) {
    if (mode === 'memory') return memToken;
    try { return (mode === 'session' ? sessionStorage : localStorage).getItem(STORAGE_KEYS.ghToken) || ''; }
    catch { return ''; }
  }
  function writeToken(tok, mode) {
    memToken = tok;
    try {
      localStorage.removeItem(STORAGE_KEYS.ghToken);
      sessionStorage.removeItem(STORAGE_KEYS.ghToken);
      if (mode === 'local' && tok) localStorage.setItem(STORAGE_KEYS.ghToken, tok);
      if (mode === 'session' && tok) sessionStorage.setItem(STORAGE_KEYS.ghToken, tok);
    } catch (e) { console.warn('[GitHubSync] token 儲存失敗', e); }
    token = tok;
  }
 
  const enabled = () => !!(cfg.enabled && token && cfg.owner && cfg.repo);
  const everConfigured = () => !!(cfg.owner && cfg.repo);
  const chatPath = id => `${cfg.dir}/${id}.json`;
  const metaPath = name => `${cfg.dir}/_${name}.json`;
 
  /* ============================ 低階 API ================================ */
 
  async function api(path, { method = 'GET', body, headers = {}, accept = 'application/vnd.github+json' } = {}) {
    let res;
    try {
      res = await fetch(GH_API + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GhError('NETWORK', '網路連線失敗，稍後會自動重試');
    }
 
    if (res.status === 304) return { notModified: true, res };
    if (res.status === 401) throw new GhError('TOKEN_INVALID', 'Token 無效或已過期', 401);
    if (res.status === 403) {
      const rl = res.headers.get('x-ratelimit-remaining');
      throw new GhError(rl === '0' ? 'RATE_LIMIT' : 'FORBIDDEN',
        rl === '0' ? 'GitHub API 額度用盡，稍後自動重試'
                   : '權限不足（Token 需要 Contents: Read and write）', 403);
    }
    if (res.status === 404) throw new GhError('NOT_FOUND', '找不到 repo 或檔案', 404);
    if (res.status === 409 || res.status === 422) throw new GhError('CONFLICT', '遠端已被更新', res.status);
    if (!res.ok) throw new GhError('HTTP_' + res.status, (await res.text().catch(() => '')) || res.statusText, res.status);
 
    const data = accept.includes('raw') ? await res.text() : await res.json();
    return { data, res };
  }
 
  /* --------- base64（UTF-8 安全，可處理大檔） --------- */
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function b64dec(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
 
  /* ============================ 指紋 / 合併 ============================= */
 
  /**
   * 穩定序列化：忽略
   *   • `_` 開頭欄位（本機專屬，如 _offloaded）
   *   • draft（草稿不同步）
   *   • rev（純粹是遞增計數，不代表內容差異）
   * 這三項若納入指紋，會讓多台裝置每次同步都互相推送同一份內容。
   */
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v)
      .filter(k => !k.startsWith('_') && k !== 'draft' && k !== 'rev' && k !== 'temporary')
      .sort()
      .map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  const fingerprint = c => Chats.hash32(stableStringify(c));
  const stableEq = (a, b) => stableStringify(a) === stableStringify(b);
 
  /** 推上雲端前移除本機專屬欄位 */
  const publicChat = chat => {
    const { draft, _offloaded, temporary, ...pub } = chat;
    return pub;
  };
 
  function mergeChat(local, remote) {
    if (!local) return U.deepClone(remote);
    if (!remote) return U.deepClone(local);
 
    const lDel = local.deleted ? (local.deletedAt || local.updatedAt) : null;
    const rDel = remote.deleted ? (remote.deletedAt || remote.updatedAt) : null;
    if (lDel && (!remote.updatedAt || lDel >= remote.updatedAt)) return U.deepClone(local);
    if (rDel && (!local.updatedAt || rDel >= local.updatedAt)) return U.deepClone(remote);
 
    const map = new Map();
    const put = m => {
      const ex = map.get(m.id);
      const t = m.editedAt || m.createdAt || '';
      const et = ex ? (ex.editedAt || ex.createdAt || '') : '';
      if (!ex || t > et || (t === et && (m.deleted ? 1 : 0) > (ex.deleted ? 1 : 0))) map.set(m.id, m);
    };
    (remote.messages || []).forEach(put);
    (local.messages || []).forEach(put);
 
    const messages = [...map.values()].sort((a, b) =>
      (a.seq ?? 0) - (b.seq ?? 0) ||
      String(a.createdAt).localeCompare(String(b.createdAt)) ||
      String(a.id).localeCompare(String(b.id)));
    messages.forEach((m, i) => (m.seq = i + 1));
 
    const pick = (a, b) => {
      const au = a.updatedAt || '', bu = b.updatedAt || '';
      if (au !== bu) return au > bu ? a : b;
      return String(a.lastEditBy || '') >= String(b.lastEditBy || '') ? a : b;
    };
    const winner = pick(local, remote);
 
    return {
      ...winner,
      id: local.id,
      schema: 2,
      deleted: false,
      deletedAt: null,
      createdAt: (local.createdAt < remote.createdAt ? local.createdAt : remote.createdAt),
      updatedAt: (local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt),
      rev: Math.max(local.rev || 0, remote.rev || 0) + 1,
      draft: local.draft || '',
      messages,
    };
  }
 
  /** 清單合併（資料夾 / 提示詞）：刪除也是一種更新 */
  function mergeList(a = [], b = []) {
    const stamp = x => x.deletedAt || x.updatedAt || '';
    const map = new Map();
    [...a, ...b].forEach(x => {
      if (!x || !x.id) return;
      const ex = map.get(x.id);
      if (!ex || stamp(x) > stamp(ex)) map.set(x.id, x);
    });
    return [...map.values()];
  }
 
  /* ============================ 遠端存取 ================================ */
 
  async function ensureBranch() {
    if (cfg.branch) return;
    const { data: repo } = await api(`/repos/${cfg.owner}/${cfg.repo}`);
    cfg.branch = repo.default_branch || 'main';
    saveCfg();
  }
 
  async function testConnection() {
    const { data: repo } = await api(`/repos/${cfg.owner}/${cfg.repo}`);
    if (!cfg.branch) { cfg.branch = repo.default_branch || 'main'; saveCfg(); }
    if (!repo.permissions?.push) throw new GhError('FORBIDDEN', 'Token 沒有寫入權限');
    return { name: repo.full_name, private: repo.private, branch: cfg.branch };
  }
 
  /**
   * 列出遠端 chats/ 下所有 json 檔（path → blob sha）。
   * 改用 git trees API（recursive）：不受 contents API 1000 檔截斷限制；
   * 支援 ETag 條件請求（304 不計額度）。trees 失敗時退回 contents API。
   */
  async function listRemote() {
    try {
      const p = `/repos/${cfg.owner}/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`;
      const r = await api(p, { headers: meta.dirEtag ? { 'If-None-Match': meta.dirEtag } : {} });
      if (r.notModified) return { changed: false, files: { ...meta.shas } };
 
      meta.dirEtag = r.res.headers.get('etag');
      if (r.data.truncated) console.warn('[GitHubSync] trees 回應被截斷（超過 10 萬個項目），清單可能不完整');
 
      const prefix = (cfg.dir || '').replace(/\/+$/, '') + '/';
      const files = {};
      for (const e of (r.data.tree || [])) {
        if (e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.json')) files[e.path] = e.sha;
      }
      return { changed: true, files };
    } catch (e) {
      if (e.code === 'NOT_FOUND') { meta.dirEtag = null; return { changed: true, files: {} }; }
      console.warn('[GitHubSync] trees API 失敗，退回 contents API：', e);
      return listRemoteByContents();
    }
  }
 
  /** 舊制備援：contents API（目錄超過 1000 檔會被截斷） */
  async function listRemoteByContents() {
    const p = `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.dir)}?ref=${encodeURIComponent(cfg.branch)}`;
    try {
      const r = await api(p);
      meta.dirEtag = r.res.headers.get('etag');
      const files = {};
      for (const f of r.data) if (f.type === 'file' && f.name.endsWith('.json')) files[f.path] = f.sha;
      return { changed: true, files };
    } catch (e) {
      if (e.code === 'NOT_FOUND') { meta.dirEtag = null; return { changed: true, files: {} }; }
      throw e;
    }
  }
 
  async function getRemoteFile(path) {
    const { data } = await api(
      `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`);
    let text;
    if (data.content && data.encoding === 'base64') text = b64dec(data.content);
    else {
      /* >1MB 的檔案 contents API 不回 content，改抓 git blob（raw）——大檔讀取本來就靠這條路 */
      const b = await api(`/repos/${cfg.owner}/${cfg.repo}/git/blobs/${data.sha}`,
        { accept: 'application/vnd.github.raw+json' });
      text = b.data;
    }
    return { json: JSON.parse(text), sha: data.sha };
  }
 
  /** 小檔推送：Contents API（一次 PUT 同時建立 commit） */
  async function putRemoteFile(path, obj, sha, message) {
    const body = {
      message: message || `sync: ${path}`,
      content: b64enc(JSON.stringify(obj, null, 2)),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    };
    const { data } = await api(`/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}`,
      { method: 'PUT', body });
    return data.content.sha;
  }
 
  /**
   * 大檔推送：Git Data API（blob → tree → commit → ref）。
   * 回傳新 blob 的 sha（= trees API 列出的 entry sha，兩邊帳目一致）。
   * ref 更新若非快進（422）→ 視為 CONFLICT，交由上層重抓合併後重試。
   */
  async function putViaGitData(path, obj, message) {
    const repo = `/repos/${cfg.owner}/${cfg.repo}`;
 
    const { data: blob } = await api(`${repo}/git/blobs`,
      { method: 'POST', body: { content: b64enc(JSON.stringify(obj, null, 2)), encoding: 'base64' } });
 
    const refPath = `/git/refs/heads/${encodeURIComponent(cfg.branch)}`;
 
    const { data: ref } = await api(`${repo}${refPath}`);
    const baseCommitSha = ref.object.sha;
 
    const { data: baseCommit } = await api(`${repo}/git/commits/${baseCommitSha}`);
 
    const { data: tree } = await api(`${repo}/git/trees`,
      { method: 'POST', body: {
          base_tree: baseCommit.tree.sha,
          tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }],
        } });
 
    const { data: commit } = await api(`${repo}/git/commits`,
      { method: 'POST', body: {
          message: message || `sync: ${path}`,
          tree: tree.sha,
          parents: [baseCommitSha],
        } });
 
    try {
      await api(`${repo}${refPath}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    } catch (e) {
      if (e.status === 422 || e.status === 409) throw new GhError('CONFLICT', '遠端分支已被更新', e.status);
      throw e;
    }
    return blob.sha;
  }
 
  /* ============================ 同步主流程 ============================== */
 
  function markDirty() {
    if (!enabled() || !cfg.autoSync) return;
    clearTimeout(debounceT);
    debounceT = setTimeout(() => sync().catch(() => {}), 5000);
  }
  const notifyLocalChange = markDirty;
 
  const busy = () => !!window.UI?.state?.generating;
 
  function sync(opts = {}) {
    if (!enabled()) return Promise.resolve({ skipped: 'disabled', pulled: 0, pushed: 0 });
    if (running) return running;
    if (busy()) {                                      // 生成中不打擾畫面，稍後再試
      clearTimeout(debounceT);
      debounceT = setTimeout(() => sync().catch(() => {}), 8000);
      return Promise.resolve({ skipped: 'busy', pulled: 0, pushed: 0 });
    }
    running = doSync(opts).finally(() => { running = null; });
    return running;
  }
 
  async function doSync({ force = false } = {}) {
    emit('syncing');
    let touched = false;                                // 本機資料是否真的被改動
 
    try {
      await ensureBranch();
 
      /* ---------- 1. PULL ---------- */
      const { files } = await listRemote();
      const remoteShas = { ...files };
      const chatFiles = Object.keys(remoteShas).filter(p => !/\/_[^/]+\.json$/.test(p));
 
      const toFetch = chatFiles.filter(p => force || meta.shas[p] !== remoteShas[p]);
      const needPush = new Set();
      let pulled = 0;
 
      for (const path of toFetch) {
        const { json, sha } = await getRemoteFile(path);
        const remoteChat = Chats.normalize(json);
        const localRaw = Chats.findRaw(remoteChat.id);
        const wasOffloaded = !!localRaw?._offloaded;
        const localChat = localRaw && !wasOffloaded ? Chats.normalize(localRaw) : null;
        const merged = mergeChat(localChat, remoteChat);
        if (wasOffloaded) merged._offloaded = false;
 
        const mergedFp = fingerprint(publicChat(merged));
        const remoteFp = fingerprint(publicChat(remoteChat));
        const localFp = localChat ? fingerprint(publicChat(localChat)) : null;
 
        if (localFp !== mergedFp || wasOffloaded) {     // 內容真的不同才寫回本機
          Chats.upsertRaw(merged, true);
          touched = true;
        }
        meta.shas[path] = sha;
        pulled++;
 
        if (mergedFp !== remoteFp) needPush.add(merged.id);
        else meta.fp[merged.id] = mergedFp;
      }
 
      /* ---------- 2. 中繼資料 ---------- */
      if (await syncMetaList('folders', () => Chats.foldersAll(),  l => Chats.setFolders(l, true),  remoteShas)) touched = true;
      if (await syncMetaList('prompts', () => Prompts.rawCustom(), l => Prompts.setCustom(l, true), remoteShas)) touched = true;
 
      /* ---------- 3. PUSH ---------- */
      for (const rawChat of Chats.raw()) {
        if (rawChat._offloaded || rawChat.temporary) continue;
        const chat = Chats.normalize(rawChat);
        const path = chatPath(chat.id);
        if (!(path in remoteShas) || meta.fp[chat.id] !== fingerprint(publicChat(chat))) needPush.add(chat.id);
      }
 
      let pushed = 0;
      for (const id of needPush) { await pushOne(id, remoteShas); pushed++; }
 
      meta.lastSync = U.nowISO();
      meta.lastError = null;
      saveMeta();
 
      if (touched) {
        Chats.ensureCurrentValid();
        window.UI?.renderAll?.();
      }
      emit('ok');
      return { pulled, pushed };
 
    } catch (e) {
      meta.lastError = { code: e.code || 'ERR', message: e.message, at: U.nowISO() };
      saveMeta();
      emit('error', e);
      if (e.code === 'RATE_LIMIT' || e.code === 'NETWORK')
        setTimeout(() => sync().catch(() => {}), 60000);
      throw e;
    }
  }
 
  /**
   * 單檔推送；依大小自動選擇 Contents API 或 Git Data API。
   * 衝突自動「重抓 → 合併 → 重推」，最多 3 次。
   */
  async function pushOne(id, remoteShas, attempt = 0) {
    const rawChat = Chats.findRaw(id);
    if (!rawChat || rawChat._offloaded || rawChat.temporary) return;
    const chat = Chats.normalize(rawChat);
    const path = chatPath(id);
    const payload = publicChat(chat);
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    const message = `chat: ${chat.deleted ? 'delete' : 'update'} ${U.truncate(chat.title || id, 40)}`;
    try {
      const sha = bytes > GIT_DATA_THRESHOLD
        ? await putViaGitData(path, payload, message)
        : await putRemoteFile(path, payload, remoteShas[path], message);
      remoteShas[path] = sha;
      meta.shas[path] = sha;
      meta.fp[id] = fingerprint(payload);
      saveMeta();
    } catch (e) {
      if (e.code === 'CONFLICT' && attempt < RETRY_MAX) {
        const { json, sha } = await getRemoteFile(path);
        const merged = mergeChat(chat, Chats.normalize(json));
        Chats.upsertRaw(merged, true);
        remoteShas[path] = sha;
        meta.dirEtag = null;
        return pushOne(id, remoteShas, attempt + 1);
      }
      throw e;
    }
  }
 
  /**
   * 同步 _folders.json / _prompts.json
   * 比較一律用 stableStringify，避免「同內容但鍵順序不同」造成每輪都重寫。
   * @returns {boolean} 本機是否被改動
   */
  async function syncMetaList(name, getLocal, setLocal, remoteShas, attempt = 0) {
    const path = metaPath(name);
    let remoteList = [], sha = remoteShas[path];
    if (sha) {
      try { const r = await getRemoteFile(path); remoteList = r.json.items || []; sha = r.sha; }
      catch (e) { if (e.code !== 'NOT_FOUND') throw e; }
    }
 
    const local = getLocal() || [];
    const merged = mergeList(local, remoteList);
 
    let changedLocal = false;
    if (!stableEq(merged, local)) { setLocal(merged); changedLocal = true; }
 
    /* setLocal 可能會正規化 → 以正規化後的版本為推送基準，兩邊才會真正一致 */
    const canonical = getLocal() || [];
 
    if (!stableEq(canonical, remoteList)) {
      try {
        remoteShas[path] = await putRemoteFile(path, { items: canonical, updatedAt: U.nowISO() }, sha, `sync: ${name}`);
        meta.shas[path] = remoteShas[path];
      } catch (e) {
        if (e.code === 'CONFLICT' && attempt < RETRY_MAX) {
          meta.dirEtag = null;
          delete remoteShas[path];
          const r2 = await getRemoteFile(path).catch(() => null);
          if (r2) remoteShas[path] = r2.sha;
          const again = await syncMetaList(name, getLocal, setLocal, remoteShas, attempt + 1);
          return changedLocal || again;
        }
        throw e;
      }
    }
    return changedLocal;
  }
 
  /* ============================ 危險操作 ================================ */
 
  async function backupToRepo(tag = 'manual') {
    await ensureBranch();
    const payload = {
      app: APP.name, version: APP.version, exportedAt: U.nowISO(),
      device: Chats.deviceId(),
      chats: Chats.raw().filter(c => !c.temporary).map(publicChat), 
      folders: Chats.foldersAll(),
      prompts: Prompts.rawCustom(),
    };
    const path = `backups/${U.nowISO().replace(/[:.]/g, '-')}-${tag}.json`;
    await putViaGitData(path, payload, `backup(${tag})`);   // 備份可能很大，一律走 Git Data API
    return path;
  }
 
  async function forcePushAll() {
    await backupToRepo('before-force-push');
    const { files } = await listRemote();
    const remoteShas = { ...files };
    for (const rawChat of Chats.raw()) await pushOne(Chats.normalize(rawChat).id, remoteShas);
    meta.lastSync = U.nowISO(); saveMeta();
  }
 
  async function forcePullAll() {
    Exporter.exportAll();
    meta = { lastSync: null, dirEtag: null, shas: {}, fp: {}, lastError: null };
    const { files } = await listRemote();
    for (const path of Object.keys(files)) {
      if (/\/_[^/]+\.json$/.test(path)) continue;
      const { json, sha } = await getRemoteFile(path);
      const chat = Chats.normalize(json);
      Chats.upsertRaw(chat, true);
      meta.shas[path] = sha;
      meta.fp[chat.id] = fingerprint(publicChat(chat));
    }
    meta.lastSync = U.nowISO();
    saveMeta();
    Chats.ensureCurrentValid();
    window.UI?.renderAll?.(true);
  }
 
  /* ---- 釋放本機空間 ---- */
  async function offloadOld() {
    if (!enabled()) throw new Error('請先啟用並完成一次同步');
    await sync({ force: true });
    const keep = Math.max(5, cfg.offloadKeep || 40);
    const list = Chats.raw()
      .filter(c => !c.deleted && !c._offloaded && !c.temporary) 
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    let n = 0;
    for (const c of list.slice(keep)) {
      const chat = Chats.normalize(c);
      if (meta.fp[chat.id] !== fingerprint(publicChat(chat))) continue;   // 尚未同步 → 不動它
      Chats.upsertRaw({
        id: chat.id, title: chat.title, folderId: chat.folderId, pinned: chat.pinned,
        archived: chat.archived, model: chat.model, rev: chat.rev, schema: 2,
        titleLocked: chat.titleLocked, deleted: false, deletedAt: null,
        systemPrompt: '', overrides: null, summary: '', summarizedUpTo: 0, draft: '',
        createdAt: chat.createdAt, updatedAt: chat.updatedAt, lastEditBy: chat.lastEditBy,
        messages: [], _offloaded: true,
      }, true);
      n++;
    }
    if (n) window.UI?.renderAll?.(true);
    return n;
  }
 
  /** 開啟被卸載的對話前呼叫 */
  async function ensureLoaded(id) {
    const rawChat = Chats.findRaw(id);
    if (!rawChat?._offloaded) return rawChat;
    if (!enabled()) throw new Error('此對話內容已卸載到 GitHub，請先啟用同步');
    const { json } = await getRemoteFile(chatPath(id));
    const chat = Chats.normalize(json);
    Chats.upsertRaw(chat, true);
    return chat;
  }
 
  /* ============================ 排程 & 事件 ============================= */
 
  function start() {
    stop();
    if (!enabled()) { emit('off'); return; }
    if (!cfg.autoSync) { emit('idle'); return; }
    sync().catch(() => {});
    timer = setInterval(() => sync().catch(() => {}), Math.max(1, cfg.intervalMin) * 60000);
  }
  function stop() { clearInterval(timer); timer = null; }
 
  const on = fn => listeners.push(fn);
  function emit(state, err) {
    listeners.forEach(f => { try { f(state, err); } catch {} });
    paintBadge(state, err);
  }
 
  function paintBadge(state, err) {
    const el = U.$('#sync-badge');
    if (!el) return;
    const map = { off: ['⛔', '未啟用同步'], idle: ['☁️', '已啟用（手動同步）'],
                  syncing: ['⟳', '同步中…'], ok: ['☁️', '已同步'], error: ['⚠️', '同步失敗'] };
    const [icon, text] = map[state] || map.off;
    const cls = 'sync-badge s-' + state;
    const title = text
      + (meta.lastSync ? `（最後：${U.formatDateTime(meta.lastSync)}）` : '')
      + (err ? '\n' + err.message : '')
      + '\n點擊立即同步';
    if (el.textContent !== icon) el.textContent = icon;
    if (el.className !== cls) el.className = cls;
    if (el.title !== title) el.title = title;
  }
 
  /* ============================ 設定 UI ================================= */
 
  function bindDom() {
    const $ = U.$;
    const panel = $('#gh-panel');
    if (!panel) return;
 
    const val = (sel, prop = 'value') => { const e = $(sel); return e ? e[prop] : undefined; };
    const put = (sel, prop, v) => { const e = $(sel); if (e) e[prop] = v; };
 
    const fill = () => {
      put('#gh-enabled', 'checked', cfg.enabled);
      put('#gh-token', 'value', token);
      put('#gh-token-store', 'value', cfg.tokenStore);
      put('#gh-owner', 'value', cfg.owner);
      put('#gh-repo', 'value', cfg.repo);
      put('#gh-branch', 'value', cfg.branch);
      put('#gh-dir', 'value', cfg.dir);
      put('#gh-auto', 'checked', cfg.autoSync);
      put('#gh-interval', 'value', cfg.intervalMin);
      put('#gh-offload-keep', 'value', cfg.offloadKeep);
      panel.classList.toggle('hidden', !cfg.enabled);
    };
 
    const save = () => {
      const newStore = val('#gh-token-store') || 'local';
      Object.assign(cfg, {
        enabled: !!val('#gh-enabled', 'checked'),
        tokenStore: newStore,
        owner: (val('#gh-owner') || '').trim(),
        repo: (val('#gh-repo') || '').trim().replace(/^.*\//, ''),
        branch: (val('#gh-branch') || '').trim(),
        dir: ((val('#gh-dir') || '').trim() || 'chats').replace(/^\/+|\/+$/g, ''),
        autoSync: !!val('#gh-auto', 'checked'),
        intervalMin: Math.max(1, +val('#gh-interval') || 5),
        offloadKeep: Math.max(5, +val('#gh-offload-keep') || 40),
      });
      writeToken((val('#gh-token') || '').trim(), newStore);
      saveCfg();
      panel.classList.toggle('hidden', !cfg.enabled);
      enabled() ? start() : (stop(), emit('off'));
    };
 
    ['#gh-enabled', '#gh-token', '#gh-token-store', '#gh-owner', '#gh-repo',
     '#gh-branch', '#gh-dir', '#gh-auto', '#gh-interval', '#gh-offload-keep']
      .forEach(s => $(s)?.addEventListener('change', save));
 
    const bind = (sel, fn) => { const e = $(sel); if (e) e.onclick = fn; };
 
    bind('#btn-gh-token-toggle', () => {
      const i = $('#gh-token');
      if (i) i.type = i.type === 'password' ? 'text' : 'password';
    });
 
    bind('#btn-gh-test', async () => {
      save();
      const info = $('#gh-status');
      if (info) info.textContent = '測試中…';
      try {
        const r = await testConnection();
        if (info) info.innerHTML =
          `✅ ${U.escapeHtml(r.name)}（${r.private ? 'private' : '<b class="danger-title">PUBLIC！強烈建議改為 private</b>'}）· 分支 ${U.escapeHtml(r.branch)}`;
        fill();
      } catch (e) { if (info) info.textContent = '❌ ' + e.message; }
    });
 
    bind('#btn-gh-sync', async () => {
      save();
      const info = $('#gh-status');
      if (info) info.textContent = '同步中…';
      try {
        const r = await sync({ force: true });
        if (info) info.textContent = r.skipped
          ? (r.skipped === 'busy' ? '生成中，稍後會自動同步' : '尚未啟用同步')
          : `✅ 完成（拉取 ${r.pulled}／推送 ${r.pushed}）`;
      } catch (e) { if (info) info.textContent = '❌ ' + e.message; }
    });
 
    bind('#btn-gh-backup', async () => {
      try { Toast.ok('已建立快照：' + await backupToRepo()); }
      catch (e) { Toast.error(e.message); }
    });
 
    bind('#btn-gh-force-push', async () => {
      const v = await Modal.ask({ title: '以本機覆蓋雲端', input: true, value: '', danger: true, okText: '執行',
        message: '這會讓雲端資料以本機為準（會先自動建立快照）。請輸入 OVERWRITE 確認：' });
      if (v !== 'OVERWRITE') return;
      const t = Toast.loading('處理中…');
      try { await forcePushAll(); t.update('完成', 'ok'); } catch (e) { t.update(e.message, 'error'); }
    });
 
    bind('#btn-gh-force-pull', async () => {
      const v = await Modal.ask({ title: '以雲端覆蓋本機', input: true, value: '', danger: true, okText: '執行',
        message: '這會讓本機資料以雲端為準（會先下載一份本機備份）。請輸入 OVERWRITE 確認：' });
      if (v !== 'OVERWRITE') return;
      const t = Toast.loading('處理中…');
      try { await forcePullAll(); t.update('完成', 'ok'); } catch (e) { t.update(e.message, 'error'); }
    });
 
    bind('#btn-gh-offload', async () => {
      const ok = await Modal.ask({ title: '釋放本機空間', okText: '執行',
        message: `會把最近 ${cfg.offloadKeep} 個以外、且「已成功同步」的對話內容從瀏覽器移除，只保留標題；點開時再從 GitHub 下載。` });
      if (!ok) return;
      const t = Toast.loading('處理中…');
      try { t.update(`已卸載 ${await offloadOld()} 個對話`, 'ok'); }
      catch (e) { t.update(e.message, 'error'); }
    });
 
    $('#sync-badge')?.addEventListener('click', () => {
      if (!enabled()) { window.UI?.openSettings?.('sync'); return; }
      sync({ force: true }).then(r => {
        if (r.skipped === 'busy') Toast.info('生成中，稍後會自動同步');
        else if (r.skipped) Toast.info('尚未啟用同步');
        else Toast.ok(`同步完成（拉取 ${r.pulled}／推送 ${r.pushed}）`);
      }).catch(e => Toast.error('同步失敗：' + e.message));
    });
 
    fill();
  }
 
  /* ============================ 初始化 ================================== */
 
  function init() {
    loadCfg();
    bindDom();
    if (enabled()) {
      start();
      window.addEventListener('online', () => sync().catch(() => {}));
      document.addEventListener('visibilitychange', () => {
        if (!cfg.autoSync) return;
        if (document.visibilityState === 'hidden') sync().catch(() => {});
        else if (Date.now() - Date.parse(meta.lastSync || 0) > 60000) sync().catch(() => {});
      });
    } else emit('off');
  }
 
  /* 模組載入時就把設定讀進來，讓 Chats.softMode() 在 Chats.load() 之前就正確 */
  try { loadCfg(); } catch (e) { console.warn('[GitHubSync] 預先載入設定失敗', e); }
 
  return {
    init, loadCfg, start, stop, sync, markDirty, notifyLocalChange, testConnection,
    backupToRepo, forcePushAll, forcePullAll, offloadOld, ensureLoaded,
    mergeChat, mergeList, fingerprint, on,
    get token() { return token; },
    get enabled() { return enabled(); },
    everConfigured,
    get config() { return cfg; },
    get meta() { return meta; },
  };
})();