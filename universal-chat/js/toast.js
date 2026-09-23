/* =============================================================================
 * toast.js — 右下角通知
 * 用法：Toast.ok('已儲存')、Toast.error('失敗', 6000)、Toast.loading('生成中…')
 * ============================================================================= */

window.Toast = (() => {
  const root = () => U.$('#toast-root');

  /**
   * @param {string} msg      訊息（純文字，會被轉義）
   * @param {string} type     info | ok | warn | error | loading
   * @param {number} timeout  毫秒；0 = 不自動關閉
   * @returns {{close:Function, update:Function}}
   */
  function show(msg, type = 'info', timeout = 3200) {
    const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '⛔', loading: '<span class="spinner"></span>' };
    const node = U.el(`div.toast.toast--${type}`, {
      html: `<span class="ico">${icons[type] || ''}</span><span class="txt">${U.escapeHtml(msg)}</span>`,
    });
    const close = U.el('button.toast__close', { text: '✕', onclick: () => dismiss() });
    node.appendChild(close);
    root().appendChild(node);

    let timer = timeout ? setTimeout(dismiss, timeout) : null;

    function dismiss() {
      clearTimeout(timer);
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 220);
    }
    /** 更新既有 toast 的文字/型別（例如 loading → ok） */
    function update(newMsg, newType, newTimeout = 2500) {
      node.className = `toast toast--${newType}`;
      node.querySelector('.ico').innerHTML = icons[newType] || '';
      node.querySelector('.txt').textContent = newMsg;
      clearTimeout(timer);
      if (newTimeout) timer = setTimeout(dismiss, newTimeout);
    }
    return { close: dismiss, update };
  }

  return {
    show,
    info:  (m, t) => show(m, 'info', t),
    ok:    (m, t) => show(m, 'ok', t),
    warn:  (m, t) => show(m, 'warn', t),
    error: (m, t) => show(m, 'error', t ?? 6000),
    loading: m => show(m, 'loading', 0),
  };
})();