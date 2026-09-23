/* =============================================================================
 * ui.js — 視圖層門面（Facade）
 * -----------------------------------------------------------------------------
 * v2.4.3：
 *   • 「清除全部資料」「匯入→覆蓋」升級為打字確認（DELETE / OVERWRITE），
 *     與 GitHub 同步的危險操作保持一致的確認強度。
 * v2.4.5：
 *   • 綁定全域「回頂」浮動鈕（與既有「回底」鈕成對）。
 * ============================================================================= */
 
window.UI = (() => {
 
  const R  = UIState.R;
  const St = UIState;
  const H  = UIHeader;
  const M  = UIMessages;
  const C  = UIComposer;
  const S  = UISidebar;
  const D  = UIModals;
 
  function renderAll(force = false) {
    S.renderSidebar(force);
    H.renderHeader();
    M.renderMessages(force);
    C.updateTokenCounter();
  }
 
  function newChat(opts = {}) {
    C.saveDraft();
    Chats.create({ model: null, temporary: !!opts.temporary });
    renderAll(true);
    C.syncComposerState();
    C.focusInput();
    if (opts.temporary) Toast.info('已開啟暫時對話：內容不會儲存，也不會同步', 5000);
  }
 
  function toggleFocusMode(force) {
    const on = typeof force === 'boolean' ? force : !R.app.classList.contains('focus-mode');
    R.app.classList.toggle('focus-mode', on);
    if (on) Toast.info('專注模式：側邊欄與頂列已隱藏，按 Esc 或 Ctrl+Shift+F 退出', 4500);
  }
 
  function exitFocusMode() {
    if (!R.app.classList.contains('focus-mode')) return false;
    toggleFocusMode(false);
    return true;
  }
 
  function bindEvents() {
 
    /* ---- 側邊欄 ---- */
    U.$('#btn-new-chat').onclick = () => newChat();
    U.$('#btn-new-folder').onclick = async () => {
      const name = await Modal.ask({ title: '新資料夾名稱', input: true, value: '新資料夾' });
      if (name) { Chats.createFolder(name); S.renderSidebar(true); }
    };
    U.$('#input-chat-search').addEventListener('input', U.debounce(e => {
      St.state.sidebarQuery = e.target.value; S.renderSidebar();
    }, 150));
    U.$$('#chat-filter .tab').forEach(b => b.onclick = () => {
      U.$$('#chat-filter .tab').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      St.state.filter = b.dataset.filter;
      S.renderSidebar();
    });
    U.$('#btn-toggle-sidebar').onclick = S.toggleSidebar;
    U.$('#sidebar-overlay').onclick = () => R.app.classList.remove('sidebar-open');
 
    /* ---- 頂列 ---- */
    U.$('#btn-model').onclick = D.openModelPicker;
    U.$('#btn-chat-config').onclick = D.openChatConfig;
    U.$('#btn-toggle-temp').onclick = async () => {
      const chat = Chats.current();
      if (!chat) return;
      await S.toggleTemporary(chat);
    };
    U.$('#btn-export').onclick = D.exportMenu;
    U.$('#provider-badge').onclick = () => D.openSettings('api');
    U.$('#btn-clear-chat').onclick = async () => {
      if (await Modal.confirmDelete('清空這個對話的所有訊息？', '清空訊息')) {
        Chats.clearMessages(Chats.currentIdOf()); renderAll(true);
      }
    };
    U.$('#btn-tts-toggle').onclick = () => {
      const on = !Settings.get('ttsAutoPlay');
      Settings.set('ttsAutoPlay', on);
      if (on) Settings.set('ttsEnabled', true); else Voice.stopSpeaking();
      Settings.syncDom(); H.renderHeader();
      Toast.info(on ? '已開啟自動朗讀' : '已關閉自動朗讀');
    };
    U.$('#btn-help').onclick = () => Modal.open('modal-shortcuts');
    R.title.ondblclick = D.openChatConfig;
 
    /* ---- 訊息區 ---- */
    R.scroll.addEventListener('scroll', U.throttle(M.onScroll, 120));
    R.scrollBtn.onclick = () => { St.state.autoScrollPinned = true; M.scrollToBottom(true); };
    if (R.scrollTopBtn) R.scrollTopBtn.onclick = () => M.scrollToTop();
 
    /* ---- 輸入區 ---- */
    R.sendBtn.onclick = C.handleSend;
    R.stopBtn.onclick = () => C.stopGeneration();
    R.input.addEventListener('input', () => { C.autoGrow(); C.updateTokenCounter(); C.saveDraft(); });
    R.input.addEventListener('keydown', e => {
      const enterSends = Settings.get('sendOnEnter');
      if (e.key === 'Enter' && !e.shiftKey && (enterSends || e.ctrlKey || e.metaKey)) {
        e.preventDefault(); C.handleSend();
      }
    });
 
    /* ---- 語音輸入 ---- */
    U.$('#btn-mic').onclick = () => {
      const btn = U.$('#btn-mic');
      if (Voice.isListening()) { Voice.stopListening(); btn.classList.remove('is-active'); return; }
      const base = R.input.value;
      const ok = Voice.startListening(
        (finalText, interim) => {
          R.input.value = (base ? base + ' ' : '') + finalText + interim;
          C.autoGrow(); C.updateTokenCounter();
        },
        () => {
          btn.classList.remove('is-active');
          if (Settings.get('sttAutoSend') && R.input.value.trim()) C.handleSend();
        }
      );
      if (ok) { btn.classList.add('is-active'); Toast.info('開始聽取\u2026再按一次結束'); }
    };
 
    /* ---- 側邊欄底部 ---- */
    U.$('#btn-search-all').onclick = D.openSearch;
    U.$('#btn-prompts').onclick = Prompts.open;
    U.$('#btn-settings').onclick = () => D.openSettings();
 
    /* ---- 搜尋 ---- */
    U.$('#search-input').addEventListener('input', U.debounce(D.renderSearch, 200));
 
    /* ---- 設定：分頁 ---- */
    U.$$('#settings-nav .tab').forEach(b => b.onclick = () => D.switchSettingsTab(b.dataset.tab));
 
    /* ---- 設定：OpenRouter ---- */
    U.$('#btn-toggle-key').onclick = () => {
      const i = U.$('#set-api-key');
      i.type = i.type === 'password' ? 'text' : 'password';
    };
    U.$('#btn-verify-key').onclick = D.verifyCurrentKey;
    U.$('#btn-check-credits').onclick = async () => {
      const info = U.$('#credits-info');
      info.textContent = '查詢中\u2026';
      try {
        const c = await API.credits();
        info.textContent = c.total == null
          ? '已使用 $' + (c.used || 0).toFixed(4)
          : '已使用 $' + (c.used || 0).toFixed(4) + ' / 上限 $' + Number(c.total).toFixed(2) +
            '（剩餘 $' + Number(c.remaining).toFixed(4) + '）';
        const badge = U.$('#credits-badge');
        badge.classList.remove('hidden');
        badge.textContent = c.remaining == null
          ? '$' + (c.used || 0).toFixed(2) + ' 已用'
          : '餘 $' + Number(c.remaining).toFixed(2);
      } catch (e) { info.textContent = '查詢失敗：' + e.message; }
    };
 
    /* ---- 設定：Poe ---- */
    U.$('#btn-toggle-poe-key').onclick = () => {
      const i = U.$('#set-poe-key');
      i.type = i.type === 'password' ? 'text' : 'password';
    };
    U.$('#btn-verify-poe-key').onclick = D.verifyCurrentKey;
 
    /* ---- 設定：模型 ---- */
    U.$('#btn-pick-default-model').onclick = () => Models.openPicker({
      mode: 'single', selected: Models.defaultModel(),
      onPick: id => { Models.setDefaultModel(id); D.refreshSettingsLabels(); H.renderHeader(); },
    });
    U.$('#btn-pick-compare-models').onclick = () => Models.openPicker({
      mode: 'multi', selected: Settings.get('compareModels'), title: '\uD83E\uDDE0 選擇要比較的模型（可多選）',
      onPick: ids => { Settings.set('compareModels', ids); D.refreshSettingsLabels(); H.renderHeader(); },
    });
    U.$('#btn-pick-title-model').onclick = () => Models.openPicker({
      mode: 'single', selected: Models.titleModel() || Models.defaultModel(),
      title: '\u2728 選擇標題產生模型（建議便宜／免費模型）',
      onPick: id => { Models.setTitleModel(id); D.refreshSettingsLabels(); },
    });
    U.$('#btn-clear-title-model').onclick = () => { Models.setTitleModel(''); D.refreshSettingsLabels(); };
 
    U.$('#btn-save-chat-params').onclick = () => {
      const s = Settings.all();
      const keys = ['temperature', 'topP', 'topK', 'maxTokens', 'frequencyPenalty',
        'presencePenalty', 'repetitionPenalty', 'seed', 'stopSequences', 'reasoningEffort'];
      const ov = {};
      keys.forEach(k => (ov[k] = s[k]));
      Chats.update(Chats.currentIdOf(), { overrides: ov });
      Toast.ok('已存為本對話專用參數');
      H.renderHeader();
    };
    U.$('#btn-clear-chat-params').onclick = () => {
      Chats.update(Chats.currentIdOf(), { overrides: null });
      Toast.ok('已清除本對話專用參數');
      H.renderHeader();
    };
 
    /* ---- 資料頁 ---- */
    U.$$('[data-export]').forEach(b => b.onclick = () => Exporter.exportChat(Chats.current(), b.dataset.export));
    U.$('#btn-export-all').onclick = Exporter.exportAll;
    U.$('#btn-import-all').onclick = () => U.$('#input-import-all').click();
    U.$('#input-import-all').onchange = e => { if (e.target.files[0]) Exporter.importAll(e.target.files[0]); e.target.value = ''; };
 
    /* 「重設所有設定」也升級為打字確認 RESET（不可逆但影響較小） */
    U.$('#btn-reset-settings').onclick = async () => {
      const v = await Modal.ask({
        title: '重設所有設定',
        input: true, value: '',
        okText: '重設', danger: true,
        message: '所有設定將回到預設值（對話與金鑰不會被刪除）。\n請輸入 RESET 確認：',
      });
      if (v !== 'RESET') return;
      Settings.reset(); Theme.apply(); Theme.buildSwatches();
      await Models.load(); D.applyProviderUI(); D.refreshSettingsLabels();
      St.bumpRenderEpoch(); renderAll(true);
      Toast.ok('已重設設定');
    };
 
    U.$('#btn-clear-archived').onclick = async () => {
      const arch = Chats.list().filter(c => c.archived);
      if (!arch.length) { Toast.info('沒有已封存的對話'); return; }
      const v = await Modal.ask({
        title: '刪除所有已封存對話',
        input: true, value: '',
        okText: '刪除', danger: true,
        message: '將刪除 ' + arch.length + ' 個已封存對話，無法復原。\n請輸入 DELETE 確認：',
      });
      if (v !== 'DELETE') return;
      arch.forEach(c => Chats.remove(c.id)); renderAll(true); Toast.ok('已刪除');
    };
 
    /* 「清除全部資料」升級為打字確認 DELETE ALL（最危險的操作） */
    U.$('#btn-clear-all').onclick = async () => {
      const v = await Modal.ask({
        title: '清除全部資料',
        input: true, value: '',
        okText: '全部清除', danger: true,
        message: '所有對話、設定、提示詞、金鑰都會被刪除，且無法復原。\n建議先匯出備份。\n\n請輸入 DELETE ALL 確認：',
      });
      if (v !== 'DELETE ALL') return;
      await Store.clearAll();
      location.reload();
    };
 
    U.$('#btn-open-shortcuts').onclick = () => Modal.open('modal-shortcuts');
    U.$('#about-version').textContent = APP.version;
 
    /* ---- 本對話設定 Modal ---- */
    U.$('#btn-chat-config-save').onclick = D.saveChatConfig;
    U.$('#btn-gen-title').onclick = () => {
      const chat = Chats.current();
      if (!chat) return;
      D.aiTitleInto(chat, U.$('#chat-config-title'), U.$('#btn-gen-title'), U.$('#chat-config-title-hint'));
    };
    U.$('#btn-chat-config-model').onclick = () => Models.openPicker({
      mode: 'single', selected: U.$('#chat-config-model').value || Models.defaultModel(),
      onPick: id => { U.$('#chat-config-model').value = id; },
    });
     /* ---- 本對話設定 Modal：摘要維護 ---- */
    U.$('#btn-clear-summary').onclick = () => {
      const chat = Chats.current();
      if (!chat) return;
      Chats.update(chat.id, { summary: '', summarizedUpTo: 0 });
      U.$('#chat-config-summary').value = '';
      U.$('#chat-config-summary-meta').textContent = '';
      U.$('#chat-config-summary-box').classList.add('hidden');
      H.renderHeader();
      Toast.ok('已清除摘要；之後會從頭重新累積');
    };
    U.$('#btn-reset-summary-ptr').onclick = () => {
      const chat = Chats.current();
      if (!chat) return;
      Chats.update(chat.id, { summarizedUpTo: 0 });
      U.$('#chat-config-summary-meta').textContent =
        '進度已歸零：下次達到門檻（或按「立即重新摘要」）時，會把同一批舊訊息再摘要一次、接在現有文字後面。';
      H.renderHeader();
      Toast.ok('已重設摘要進度');
    };
    U.$('#btn-resummarize').onclick = () => {
      const chat = Chats.current();
      if (chat) UI.maybeAutoSummarize(chat, { force: true });
    };
    U.$('#btn-chat-config-model-clear').onclick = () => { U.$('#chat-config-model').value = ''; };
 
    /* ---- 本對話設定：輸出目的地 ---- */
    U.$('#cc-out-mode').onchange = e =>
      U.$('#cc-out-custom').classList.toggle('hidden', e.target.value !== 'custom');

    /* ---- 設定變更 → 即時反映 ---- */
    ['renderMarkdown', 'showTimestamps', 'showModelBadge', 'showTokenUsage', 'showReasoning', 'codeWrap']
      .forEach(k => Settings.on(k, () => { St.bumpRenderEpoch(); M.renderMessages(true); }));
    ['model', 'poeModel', 'titleModel', 'poeTitleModel', 'compareEnabled', 'compareModels']
      .forEach(k => Settings.on(k, () => { H.renderHeader(); D.refreshSettingsLabels(); }));
    Settings.on('provider', () => D.applyProviderUI());
 
    window.addEventListener('beforeunload', e => {
      C.saveDraft();
      Store.flushNow();
      if (St.state.generating || Chats.hasTemporaryContent()) { e.preventDefault(); e.returnValue = ''; }
    });
  }
 
  function init() {
    St.cacheDom();
    S.ensureExtraDom();
    bindEvents();
    D.applyProviderUI();
    renderAll(true);
    C.loadDraft();
    D.refreshSettingsLabels();
    C.syncComposerState();
    C.autoGrow();
  }
 
  return {
    init, renderAll, newChat,
 
    renderSidebar: (f) => S.renderSidebar(f),
    renderHeader: () => H.renderHeader(),
    renderMessages: (f) => M.renderMessages(f),
    renderSearch: () => D.renderSearch(),
    updateStorageBadge: (f) => H.updateStorageBadge(f),
    bumpRenderEpoch: () => St.bumpRenderEpoch(),
 
    selectChat: (id) => S.selectChat(id),
    renameChat: (c) => S.renameChat(c),
    toggleTemporary: (c) => S.toggleTemporary(c),
    toggleSidebar: () => S.toggleSidebar(),
    isGenerating: (id) => St.isGenerating(id),
 
    handleSend: () => C.handleSend(),
    stopGeneration: (id) => C.stopGeneration(id),
    runCompletion: (chat, o) => C.runCompletion(chat, o),
    continueGeneration: (chat, msgId) => C.continueGeneration(chat, msgId),
    focusInput: () => C.focusInput(),
    updateTokenCounter: () => C.updateTokenCounter(),
    syncComposerState: () => C.syncComposerState(),
    maybeAutoTitle: (c) => C.maybeAutoTitle(c),
    maybeAutoSummarize: (c, o) => C.maybeAutoSummarize(c, o),
    appendSystemNote: (t) => M.appendSystemNote(t),
 
    toggleFocusMode,
    exitFocusMode,
    jumpBookmark: (dir) => M.jumpBookmark(dir),
 
    openSettings: (t) => D.openSettings(t),
    openModelPicker: () => D.openModelPicker(),
    openSearch: () => D.openSearch(),
    openChatConfig: () => D.openChatConfig(),
    exportMenu: () => D.exportMenu(),
    aiTitleInto: (...a) => D.aiTitleInto(...a),
    applyProviderUI: () => D.applyProviderUI(),
    onProviderChanged: () => D.onProviderChanged(),
 
    get state() { return St.state; },
  };
})();