/* =============================================================================
 * ui-state.js — 視圖層共享狀態
 * -----------------------------------------------------------------------------
 * • state.jobs：chatId → { aborter, status, startedAt }（可同時多個對話生成）
 * • state.bookmarkIdx：書籤導航游標（Alt+[ / Alt+] 用；切換對話時歸零）
 * • R：DOM 快取（物件identity固定，其他模組可安全持有參考）
 * • 指紋：msgSig / sideSig 決定「內容真的變了才重繪"
 * ============================================================================= */
 
window.UIState = (() => {
 
  const state = {
    jobs: new Map(),
    filter: 'all',
    sidebarQuery: '',
    autoScrollPinned: true,
    bookmarkIdx: -1,                // -1 = 尚未跳過任何書籤
  };
  /* 相容舊用法（github.js 讀 UI.state.generating 判斷是否暫停同步） */
  Object.defineProperty(state, 'generating', { get: () => state.jobs.size > 0, enumerable: true });
 
  const R = {};                       // DOM 快取
  const sig = { msg: null, side: null };
  let renderEpoch = 0;                // 影響訊息外觀的設定變更時 +1
 
  const isGenerating = id => !!id && state.jobs.has(id);
  const jobOf = id => state.jobs.get(id) || null;
  const bumpRenderEpoch = () => { renderEpoch++; };
 
  const msgSig = () => `${Chats.messagesSignature(Chats.current())}|${renderEpoch}`;
  const sideSig = () =>
    `${Chats.sidebarSignature()}|${state.filter}|${state.sidebarQuery}|${renderEpoch}` +
    `|${[...state.jobs.keys()].sort().join(',')}`;          // 生成中的對話也是側邊欄狀態
 
  const markMessagesRendered = () => { sig.msg = msgSig(); };
 
  function cacheDom() {
    Object.assign(R, {
      app: U.$('#app'),
      sidebar: U.$('.sidebar'),
      chatList: U.$('#chat-list'),
      history: U.$('#chat-history'),
      scroll: U.$('#chat-scroll'),
      input: U.$('#user-input'),
      sendBtn: U.$('#btn-send'),
      stopBtn: U.$('#btn-stop'),
      title: U.$('#chat-title'),
      meta: U.$('#chat-meta'),
      modelLabel: U.$('#model-label'),
      status: U.$('#status-text'),
      composerStatus: U.$('#composer-status'),
      tokenCounter: U.$('#token-counter'),
      scrollBtn: U.$('#btn-scroll-bottom'),
      scrollTopBtn: U.$('#btn-scroll-top'),     // v2.4.5：全域「回頂」浮動鈕
      providerBadge: U.$('#provider-badge'),
    });
    return R;
  }
 
  return { state, R, sig, cacheDom, isGenerating, jobOf, bumpRenderEpoch, msgSig, sideSig, markMessagesRendered };
})();