/* =============================================================================
 * ui-modals.js — 設定 / 搜尋 / 本對話設定 / 匯出 / 模型選擇 / AI 標題
 * ============================================================================= */

window.UIModals = (() => {

  /* --------------------------- 設定 Modal --------------------------- */

  function openSettings(tab) {
    Modal.open('modal-settings');
    if (tab) switchSettingsTab(tab);
    applyProviderUI();
    refreshSettingsLabels();
    UIHeader.updateStorageBadge(true);
  }

  function switchSettingsTab(tab) {
    U.$$('#settings-nav .tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    U.$$('.settings__panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === tab));
  }

  function applyProviderUI() {
    const poe = (Settings.get('provider') || 'openrouter') === 'poe';
    U.$('#api-openrouter')?.classList.toggle('hidden', poe);
    U.$('#api-poe')?.classList.toggle('hidden', !poe);
  }

  async function onProviderChanged() {
    applyProviderUI();
    refreshSettingsLabels();
    UIState.bumpRenderEpoch();
    UIHeader.renderHeader();
    UISidebar.renderSidebar(true);
  }

  function refreshSettingsLabels() {
    const dm = Models.defaultModel();
    const dl = U.$('#default-model-label');
    if (dl) dl.value = dm ? `${Models.nameOf(dm)}（${dm}）` : '（未選擇）';

    const cmp = (Settings.get('compareModels') || []);
    const cl = U.$('#compare-models-label');
    if (cl) cl.value = cmp.length ? cmp.map(Models.nameOf).join('、') : '（未選擇）';

    const tm = Models.titleModel();
    const tl = U.$('#title-model-label');
    if (tl) tl.value = tm ? `${Models.nameOf(tm)}（${tm}）` : '（跟隨對話模型）';
  }

  async function verifyCurrentKey() {
    const t = Toast.loading('驗證中…');
    try {
      const d = await API.verifyKey();
      t.update(`金鑰有效${d?.label ? `（${d.label}）` : ''}`, 'ok');
    } catch (e) { t.update('驗證失敗：' + e.message, 'error', 6000); }
  }

  /* --------------------------- 模型選擇器 --------------------------- */

  function openModelPicker() {
    Models.openPicker({
      mode: 'single',
      selected: Models.resolve(Chats.current()?.model),
      onPick: id => {
        const chat = Chats.current();
        chat?.model ? Chats.update(chat.id, { model: id }) : Models.setDefaultModel(id);
        refreshSettingsLabels(); UIHeader.renderHeader();
        Toast.ok(`已切換到 ${Models.nameOf(id)}`);
      },
    });
  }

  /* ------------------------------ 搜尋 ------------------------------ */

  function openSearch() {
    Modal.open('modal-search');
    U.$('#search-input').value = '';
    U.$('#search-results').innerHTML = '<p class="muted">輸入關鍵字搜尋所有對話…</p>';
  }

  function renderSearch() {
    const q = U.$('#search-input').value.trim();
    const box = U.$('#search-results');
    box.innerHTML = '';
    if (!q) { box.innerHTML = '<p class="muted">輸入關鍵字搜尋所有對話…</p>'; return; }

    const results = Chats.search(q);
    if (!results.length) { box.innerHTML = '<p class="muted">找不到符合的內容。</p>'; return; }

    box.appendChild(U.el('p.muted', { text: `找到 ${results.length} 筆結果` }));
    results.forEach(r => {
      const card = U.el('div.result-card');
      card.appendChild(U.el('div.result-card__head', {
        html: `<b>${U.escapeHtml(r.chat.title)}</b>` +
              `<span class="badge">${r.message ? (r.message.role === 'user' ? '你' : '助理') : '標題'}</span>` +
              (r.chat.temporary ? '<span class="badge badge--temp">暫時</span>' : '') +
              `<span class="muted" style="margin-left:auto">${U.timeAgo(r.chat.updatedAt)}</span>`,
      }));
      card.appendChild(U.el('div.result-card__body', { html: U.highlight(r.snippet, q) }));
      card.onclick = () => {
        Modal.close('modal-search');
        UISidebar.selectChat(r.chat.id);
        if (r.message) setTimeout(() => {
          const el = UIState.R.history.querySelector(`.msg[data-id="${r.message.id}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el?.animate?.([{ background: 'rgba(255,215,0,.25)' }, { background: 'transparent' }], { duration: 1600 });
        }, 250);
      };
      box.appendChild(card);
    });
  }

  /* --------------------------- AI 產生標題 -------------------------- */

  async function aiTitleInto(chat, inputEl, btnEl, hintEl) {
    if (!API.hasKey()) { Toast.warn(API.keyHint()); openSettings('api'); return; }

    const old = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner"></span> 產生中…';
    if (hintEl) { hintEl.className = 'hint'; hintEl.textContent = ''; }

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, 45000);

    try {
      const model = Models.titleModel() || Models.resolve(chat.model);
      const title = await API.generateTitle(model, Chats.visible(chat), { signal: ctrl.signal });
      if (!title) throw new Error('模型沒有回傳可用標題');
      inputEl.value = title;
      inputEl.focus(); inputEl.select();
      if (hintEl) hintEl.textContent = `已用 ${Models.nameOf(model)} 產生，可再手動修改後儲存`;
    } catch (e) {
      const msg = timedOut ? '產生逾時（45 秒），請重試或換一個較快的標題模型' : e.message;
      if (hintEl) { hintEl.className = 'hint err'; hintEl.textContent = '產生失敗：' + msg; }
      else Toast.error('產生標題失敗：' + msg);
    } finally {
      clearTimeout(timer);
      btnEl.disabled = false;
      btnEl.textContent = old;
    }
  }

  /* --------------------------- 本對話設定 --------------------------- */

  function openChatConfig() {
    const chat = Chats.current();
    if (!chat) return;
    U.$('#chat-config-title').value = chat.title;
    U.$('#chat-config-system').value = chat.systemPrompt || '';
    U.$('#chat-config-model').value = chat.model || '';
    U.$('#chat-config-title-hint').textContent = chat.temporary
      ? '🕶️ 這是暫時對話：設定同樣不會被儲存。'
      : '';
    U.$('#chat-config-title-hint').className = 'hint';
    U.$('#chat-config-override').textContent = chat.overrides
      ? `本對話專用參數：${JSON.stringify(chat.overrides)}`
      : '本對話使用全域參數設定。';

    const sel = U.$('#chat-config-folder');
    sel.innerHTML = '<option value="">（不分類）</option>';
    Chats.foldersList().forEach(f => {
      const o = U.el('option', { value: f.id, text: f.name });
      if (chat.folderId === f.id) o.selected = true;
      sel.appendChild(o);
    });

    const out = chat.out || {};
    U.$('#cc-out-mode').value = out.mode === 'custom' ? 'custom' : 'global';
    U.$('#cc-out-custom').classList.toggle('hidden', out.mode !== 'custom');
    U.$('#cc-out-owner').value  = out.owner  || '';
    U.$('#cc-out-repo').value   = out.repo   || '';
    U.$('#cc-out-branch').value = out.branch || '';
    U.$('#cc-out-dir').value    = out.dir    || '';
    U.$('#cc-out-auto').checked = !!out.auto;

    /* ---- 📝 自動摘要：低調監看／編輯（從未產生過摘要時整塊隱藏） ---- */
    const sumBox  = U.$('#chat-config-summary-box');
    const upto    = chat.summarizedUpTo || 0;
    const hasSum  = !!chat.summary || upto > 0;
    sumBox.classList.toggle('hidden', !hasSum);
    U.$('#chat-config-summary').value = chat.summary || '';
    U.$('#chat-config-summary-meta').textContent = !hasSum ? ''
      : `前 ${upto} 則訊息已壓縮為下方摘要；每次請求都會以「【先前對話摘要】」系統訊息插在歷史訊息之前。可直接修改文字，按「儲存」生效。`;

    Modal.open('modal-chat-config');
  }

  function saveChatConfig() {
    const chat = Chats.current();
    if (!chat) return;
    const sumText = U.$('#chat-config-summary').value.trim();
    const outCustom = U.$('#cc-out-mode').value === 'custom' ? {
      mode: 'custom',
      owner:  U.$('#cc-out-owner').value.trim(),
      repo:   U.$('#cc-out-repo').value.trim().replace(/^.*\//, ''),
      branch: U.$('#cc-out-branch').value.trim(),
      dir:    U.$('#cc-out-dir').value.trim().replace(/^\/+|\/+$/g, ''),
      auto:   U.$('#cc-out-auto').checked,
    } : null;    
    Chats.update(chat.id, {
      title: U.$('#chat-config-title').value.trim() || (chat.temporary ? '暫時對話' : '新對話'),
      titleLocked: true,
      systemPrompt: U.$('#chat-config-system').value,
      model: U.$('#chat-config-model').value || null,
      folderId: U.$('#chat-config-folder').value || null,
      summary: sumText,
      /* 文字被清空 ⇒ 連「已跳過前 N 則」的紀錄一起放棄。
         否則那些訊息既不在摘要裡、又不會再被送出，上下文會憑空缺一段 */
      summarizedUpTo: sumText ? (chat.summarizedUpTo || 0) : 0,
      out: outCustom,
    });
    Modal.close('modal-chat-config');
    UI.renderAll(true);
    Toast.ok('已儲存本對話設定');
  }

  /* ------------------------------ 匯出 ------------------------------ */

  async function exportMenu() {
    const chat = Chats.current();
    if (!chat) { Toast.warn('沒有可匯出的對話'); return; }
    const fmt = await Modal.ask({
      title: '匯出目前對話',
      message: `「${chat.title}」共 ${Chats.stats(chat).count} 則訊息。` +
               (chat.temporary ? '（暫時對話：匯出是唯一的保存方式）' : '') + '請選擇匯出格式：',
      select: { options: EXPORT_FORMATS, value: 'md' },
      okText: '匯出',
    });
    if (fmt) Exporter.exportChat(chat, fmt);
  }

  /* --------------------------- Poe 模型清單 --------------------------- */

  /** 測試結果只留在這一頁（重新整理就清掉），鍵是 bot 名稱。 */
  const poeTests = new Map();
  const poeInflight = new Map();

  function poeNames() {
    const list = Settings.get('poeModels');
    return Array.isArray(list) ? list.filter(id => typeof id === 'string' && id.trim()) : [];
  }

  function savePoeNames(next) {
    Settings.set('poeModels', next);
  }

  /** 改名或刪除時，跟著改預設模型／標題模型／比較清單／收藏。to 為空字串代表刪除。 */
  function retargetPoeName(from, to, fallbackDefault) {
    if (Settings.get('poeModel') === from) Settings.set('poeModel', to || fallbackDefault || '');
    if (Settings.get('poeTitleModel') === from) Settings.set('poeTitleModel', to || '');

    const remap = (ids) => {
      const out = [];
      (ids || []).forEach(id => {
        const n = id === from ? to : id;
        if (n && !out.includes(n)) out.push(n);
      });
      return out;
    };
    const cmp = Settings.get('compareModels') || [];
    if (cmp.includes(from)) Settings.set('compareModels', remap(cmp));
    const favs = Settings.get('favoriteModels') || [];
    if (favs.includes(from)) Settings.set('favoriteModels', remap(favs));
  }

  function movePoeTest(from, to) {
    if (poeTests.has(from)) {
      const status = poeTests.get(from);
      poeTests.delete(from);
      if (to) poeTests.set(to, status);
    }
    if (poeInflight.has(from)) {
      const job = poeInflight.get(from);
      poeInflight.delete(from);
      if (to) poeInflight.set(to, job);
      else job.ctrl.abort();
    }
  }

  function commitPoeRename(from, raw) {
    const to = String(raw || '').trim();
    if (!from || to === from) return false;
    const cur = poeNames();
    if (!cur.includes(from)) return false;
    if (!to) { Toast.warn('模型名稱不能是空白'); renderPoeModelList(); return false; }
    if (cur.includes(to)) { Toast.warn(`「${to}」已在清單中`); renderPoeModelList(); return false; }
    movePoeTest(from, to);
    retargetPoeName(from, to, '');
    savePoeNames(cur.map(n => (n === from ? to : n)));
    return true;
  }

  function removePoeModel(name) {
    const next = poeNames().filter(n => n !== name);
    movePoeTest(name, '');
    retargetPoeName(name, '', next[0] || '');
    savePoeNames(next);
    Toast.info(`已移除「${name}」`);
  }

  function addPoeModelsFromInput() {
    const input = U.$('#poe-model-input');
    if (!input) return;
    const parts = input.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) { Toast.warn('請輸入模型名稱'); input.focus(); return; }

    const cur = poeNames();
    const seen = new Set(cur);
    const added = [];
    let skipped = 0;
    parts.forEach(n => {
      if (seen.has(n)) { skipped += 1; return; }
      seen.add(n);
      added.push(n);
    });
    if (!added.length) {
      Toast.warn(parts.length > 1 ? '這些模型都已在清單中' : `「${parts[0]}」已在清單中`);
      input.focus();
      return;
    }
    savePoeNames([...cur, ...added]);
    input.value = '';
    input.focus();
    if (skipped) Toast.info(`已加入 ${added.length} 個，略過 ${skipped} 個重複`);
    else if (added.length === 1) Toast.ok(`已加入「${added[0]}」`);
    else Toast.ok(`已加入 ${added.length} 個模型`);
  }

  function formatTestElapsed(ms) {
    if (ms < 1000) return `${ms} 毫秒`;
    return `${(ms / 1000).toFixed(1)} 秒`;
  }

  function clipReply(text, max = 240) {
    const arr = [...String(text || '')];
    return arr.length <= max ? arr.join('') : arr.slice(0, max).join('') + '…';
  }

  function paintPoeStatus(el, status) {
    el.className = 'poe-model__status';
    el.replaceChildren();
    if (!status || (status.state === 'idle' && !status.note)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (status.state === 'pending') {
      el.classList.add('is-pending');
      el.textContent = '測試中…正在向此模型索取簡短回覆';
      return;
    }
    if (status.state === 'ok') {
      el.classList.add('is-ok');
      const via = status.model && status.model !== status.requested ? ` · ${status.model}` : '';
      el.append(
        U.el('div', { text: `可用 · ${formatTestElapsed(status.elapsedMs)}${via}` }),
        U.el('div.poe-model__reply', {
          text: `${status.fromReasoning ? '（回覆在思考內容裡）' : '回覆：'}${clipReply(status.reply)}`,
        }),
      );
      return;
    }
    if (status.state === 'err') {
      el.classList.add('is-err');
      el.textContent = `無法使用：${status.message || '未知錯誤'}`;
      return;
    }
    el.textContent = status.note || '';
  }

  function poeRow(name) {
    const pending = poeInflight.has(name);
    const li = U.el('li.poe-model', { dataset: { model: name } });
    const input = U.el('input.input.poe-model__name', {
      type: 'text',
      value: name,
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': `模型名稱 ${name}`,
    });
    input.disabled = pending;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { input.value = name; input.blur(); }
    });
    input.addEventListener('blur', () => {
      /* 整列被重繪換掉時也會冒出 blur；此時名稱已由別的動作處理，不要再寫一次 */
      if (!input.isConnected) return;
      commitPoeRename(name, input.value);
    });

    const testBtn = U.el('button.btn.btn--outline.btn--sm', {
      type: 'button',
      text: pending ? '停止' : '測試',
      'aria-label': pending ? `停止測試 ${name}` : `測試模型 ${name}`,
    });
    testBtn.addEventListener('mousedown', e => e.preventDefault());
    testBtn.addEventListener('click', () => {
      const typed = input.value.trim();
      if (typed && typed !== name) {
        if (!commitPoeRename(name, typed)) return;
        testPoeModelRow(typed);
        return;
      }
      testPoeModelRow(name);
    });

    const delBtn = U.el('button.btn.btn--ghost.btn--sm', {
      type: 'button',
      text: '刪除',
      'aria-label': `刪除模型 ${name}`,
    });
    delBtn.disabled = pending;
    delBtn.addEventListener('mousedown', e => e.preventDefault());
    delBtn.addEventListener('click', () => removePoeModel(name));

    const status = U.el('div.poe-model__status');
    paintPoeStatus(status, poeTests.get(name));
    li.append(
      U.el('div.poe-model__row', {}, [input, U.el('div.poe-model__actions', {}, [testBtn, delBtn])]),
      status,
    );
    return li;
  }

  function renderPoeModelList() {
    const list = U.$('#poe-model-list');
    const empty = U.$('#poe-model-empty');
    if (!list) return;
    const items = poeNames();
    if (empty) empty.classList.toggle('hidden', items.length > 0);
    list.replaceChildren(...items.map(poeRow));
  }

  function refreshPoeRow(name) {
    const list = U.$('#poe-model-list');
    if (!list) return;
    const li = U.$$('.poe-model', list).find(n => n.dataset.model === name);
    if (!li) { renderPoeModelList(); return; }
    li.replaceWith(poeRow(name));
  }

  async function testPoeModelRow(name) {
    if (!poeNames().includes(name)) return;
    const existing = poeInflight.get(name);
    if (existing) { existing.ctrl.abort(); return; }

    if (!String(Settings.get('poeApiKey') || '').trim()) {
      poeTests.set(name, { state: 'err', message: '請先填入 Poe API Key' });
      refreshPoeRow(name);
      Toast.error('請先填入 Poe API Key');
      return;
    }

    const ctrl = new AbortController();
    poeInflight.set(name, { ctrl });
    poeTests.set(name, { state: 'pending' });
    refreshPoeRow(name);

    try {
      const r = await API.testPoeModel(name, { signal: ctrl.signal });
      if (!poeNames().includes(name)) return;
      poeTests.set(name, {
        state: 'ok',
        reply: r.reply,
        fromReasoning: r.fromReasoning,
        model: r.model,
        requested: name,
        elapsedMs: r.elapsedMs,
      });
      Toast.ok(`「${name}」可用`);
    } catch (e) {
      if (!poeNames().includes(name)) return;
      if (e?.aborted) poeTests.set(name, { state: 'idle', note: '已取消測試' });
      else {
        poeTests.set(name, { state: 'err', message: e.message || '測試失敗' });
        Toast.error(`「${name}」無法使用：${e.message || '測試失敗'}`);
      }
    } finally {
      poeInflight.delete(name);
      if (poeNames().includes(name)) refreshPoeRow(name);
    }
  }

  function initPoeModelList() {
    const input = U.$('#poe-model-input');
    const btn = U.$('#btn-add-poe-model');
    if (!input || !btn || input.dataset.bound) return;
    input.dataset.bound = '1';
    btn.addEventListener('click', addPoeModelsFromInput);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addPoeModelsFromInput(); }
    });
    Settings.on('*', (_value, key) => {
      if (key === 'poeModels' || key === '*') renderPoeModelList();
    });
    /* 舊版逗號文字框可能存進空白或重複名稱，打開新介面時清一次 */
    const raw = Settings.get('poeModels');
    if (Array.isArray(raw)) {
      const next = [];
      raw.forEach(id => {
        const n = typeof id === 'string' ? id.trim() : '';
        if (n && !next.includes(n)) next.push(n);
      });
      const changed = next.length !== raw.length || raw.some((id, i) => id !== next[i]);
      if (changed) { Settings.set('poeModels', next); return; }
    }
    renderPoeModelList();
  }

  return {
    openSettings, switchSettingsTab, applyProviderUI, onProviderChanged, refreshSettingsLabels,
    verifyCurrentKey, openModelPicker, openSearch, renderSearch,
    aiTitleInto, openChatConfig, saveChatConfig, exportMenu, initPoeModelList,
  };
})();