/* =============================================================================
 * theme.js — 外觀套用
 * 把設定（主題、強調色、字級、密度、寬度、動畫…）轉成 <html> 上的
 * data-* 屬性與 CSS 變數，CSS 端只需描述樣式。
 * ============================================================================= */

window.Theme = (() => {

  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: light)');

  /** 依 density 決定訊息間距 */
  const GAPS = { comfortable: '22px', cozy: '16px', compact: '10px' };

  /** 套用全部外觀設定 */
  function apply() {
    const s = Settings.all();

    // 主題（system 時跟隨作業系統）
    const theme = s.theme === 'system' ? (mq.matches ? 'light' : 'dark') : s.theme;
    root.dataset.theme = theme;

    // CSS 變數
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--font-size-base', `${s.fontSize}px`);
    root.style.setProperty('--chat-width', `${s.chatWidth}px`);
    root.style.setProperty('--msg-gap', GAPS[s.density] || GAPS.comfortable);
    root.style.setProperty('--sidebar-w',
      `${U.clamp(Number(s.sidebarWidth) || SIDEBAR_W.default, SIDEBAR_W.min, SIDEBAR_W.max)}px`);

    // 布林開關 → data 屬性（供 CSS 選擇器使用）
    root.dataset.animations = s.animations ? 'on' : 'off';
    root.dataset.avatars = s.showAvatars ? 'on' : 'off';
    root.dataset.linenumbers = s.showLineNumbers ? 'on' : 'off';

    // 側邊欄收合狀態
    U.$('#app')?.classList.toggle('sidebar-collapsed', !!s.sidebarCollapsed && window.innerWidth > 820);
  }

  /** 建立強調色色票按鈕 */
  function buildSwatches() {
    const box = U.$('#accent-swatches');
    if (!box) return;
    box.innerHTML = '';
    ACCENTS.forEach(c => {
      const b = U.el('button.swatch', {
        style: `background:${c}`,
        title: c,
        onclick: () => { Settings.set('accent', c); Settings.syncDom(); buildSwatches(); },
      });
      if (c.toLowerCase() === Settings.get('accent').toLowerCase()) b.classList.add('is-active');
      box.appendChild(b);
    });
  }

  function init() {
    apply();
    buildSwatches();
    // 任一外觀相關設定變更就重新套用
    ['theme', 'accent', 'fontSize', 'chatWidth', 'density', 'animations',
      'showAvatars', 'showLineNumbers', 'sidebarCollapsed', 'sidebarWidth'].forEach(k => Settings.on(k, apply));
    // 系統深淺色切換
    mq.addEventListener?.('change', () => { if (Settings.get('theme') === 'system') apply(); });
  }

  return { init, apply, buildSwatches };
})();