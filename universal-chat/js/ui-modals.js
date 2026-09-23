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

  return {
    openSettings, switchSettingsTab, applyProviderUI, onProviderChanged, refreshSettingsLabels,
    verifyCurrentKey, openModelPicker, openSearch, renderSearch,
    aiTitleInto, openChatConfig, saveChatConfig, exportMenu,
  };
})();