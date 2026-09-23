/* =============================================================================
 * modal.js — Modal 管理（開關、堆疊、Esc、confirm / prompt / select）
 * -----------------------------------------------------------------------------
 * 堆疊 z-index：CSS 給所有 .modal 相同的 z-index(1000)，若在 A modal 內再開 B modal，
 * B 會不會蓋在 A 上面純粹取決於它在 index.html 的先後順序 —— 這會造成
 * 「從『本對話設定』點開模型選擇器，卻出現在後面」的問題。
 * 因此開啟時依 stack 深度動態指派 z-index，關閉時還原。
 *
 * 無障礙（v2.4.1）：
 *   • 開啟時自動加上 role="dialog"、aria-modal="true"、aria-label（取自標題）。
 *   • Tab 鍵焦點陷阱：焦點只在最上層 Modal 內循環，不會跑到背景。
 *   • 自動為 [data-close] 按鈕補 aria-label="關閉"。
 * ============================================================================= */
 
window.Modal = (() => {
  const stack = [];                      // 已開啟的 modal id（後面 = 上層）
  let askResolve = null;                 // 讓 Esc / backdrop 也能 resolve
 
  const Z_BASE = 1000;
  const Z_STEP = 10;
 
  const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]):not(.hidden),' +
    'select:not([disabled]):not(.hidden),textarea:not([disabled]):not(.hidden),' +
    '[tabindex]:not([tabindex="-1"])';
 
  /** 依 stack 順序重新指派 z-index */
  function applyZ() {
    stack.forEach((id, i) => {
      const m = document.getElementById(id);
      if (m) m.style.zIndex = String(Z_BASE + (i + 1) * Z_STEP);
    });
  }
 
  function open(id) {
    const m = document.getElementById(id);
    if (!m) return;
 
    /* ---- 無障礙屬性 ---- */
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    const h = m.querySelector('.modal__head h2, h2');
    if (h) m.setAttribute('aria-label', h.textContent.trim() || id);
    m.querySelectorAll('[data-close]').forEach(b => b.setAttribute('aria-label', '關閉'));
 
    m.classList.remove('hidden');
 
    const i = stack.indexOf(id);
    if (i > -1) stack.splice(i, 1);      // 已在堆疊中 → 移到最上層
    stack.push(id);
    applyZ();
 
    setTimeout(() => {
      m.querySelector('input:not(.hidden):not([type=hidden]),textarea:not(.hidden),select:not(.hidden)')?.focus();
    }, 60);
  }
 
  function close(id) {
    const m = document.getElementById(id);
    if (!m) return;
 
    m.classList.add('hidden');
    m.style.zIndex = '';                 // 還原給 CSS
 
    const i = stack.indexOf(id);
    if (i > -1) stack.splice(i, 1);
    applyZ();
 
    if (id === 'modal-ask' && askResolve) {           // 被 Esc / backdrop 關掉
      const r = askResolve; askResolve = null; r(null);
    }
 
    /* 焦點回到仍開著的最上層 modal，鍵盤操作才連貫 */
    const top = stack[stack.length - 1];
    if (top) {
      const t = document.getElementById(top);
      setTimeout(() => {
        t?.querySelector('input:not(.hidden):not([type=hidden]),textarea:not(.hidden),select:not(.hidden)')?.focus();
      }, 60);
    }
  }
 
  function closeTop() {
    const id = stack[stack.length - 1];
    if (!id) return false;
    close(id);
    return true;
  }
 
  const isOpen = id => !document.getElementById(id)?.classList.contains('hidden');
  const anyOpen = () => stack.length > 0;
  const topOf = () => stack[stack.length - 1] || null;
 
  /* ------------------- 焦點陷阱（Tab 循環在最上層 Modal 內） ------------- */
 
  function trapTab(e) {
    if (e.key !== 'Tab' || !stack.length) return;
    const top = document.getElementById(stack[stack.length - 1]);
    if (!top) return;
 
    const items = [...top.querySelectorAll(FOCUSABLE)]
      .filter(el => el.offsetParent !== null || el === document.activeElement);  // 過濾 display:none
    if (!items.length) { e.preventDefault(); return; }
 
    const first = items[0];
    const last = items[items.length - 1];
 
    if (!top.contains(document.activeElement)) {
      e.preventDefault(); first.focus(); return;
    }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return; }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
 
  /* ------------------- 自訂 confirm / prompt / select ------------------- */
 
  /**
   * @param {object} o {
   *   title, message, okText, cancelText, danger,
   *   input, value, placeholder,
   *   select: { options:[{value,label}], value },
   *   extra:  { text, onClick(inputEl, btnEl) }
   * }
   * @returns {Promise<string|boolean|null>}
   */
  function ask(o = {}) {
    return new Promise(resolve => {
      askResolve = resolve;
 
      U.$('#ask-title').textContent = o.title || '確認';
      U.$('#ask-message').textContent = o.message || '';
 
      const input = U.$('#ask-input');
      const select = U.$('#ask-select');
      const okBtn = U.$('#ask-ok');
      const cancelBtn = U.$('#ask-cancel');
      const extraBtn = U.$('#ask-extra');
 
      input.classList.toggle('hidden', !o.input);
      if (o.input) { input.value = o.value || ''; input.placeholder = o.placeholder || ''; }
 
      if (select) {
        select.classList.toggle('hidden', !o.select);
        if (o.select) {
          select.innerHTML = '';
          (o.select.options || []).forEach(op => {
            const el = document.createElement('option');
            el.value = op.value; el.textContent = op.label ?? op.value;
            if (op.value === o.select.value) el.selected = true;
            select.appendChild(el);
          });
        }
      }
 
      okBtn.textContent = o.okText || '確定';
      cancelBtn.textContent = o.cancelText || '取消';
      okBtn.className = 'btn ' + (o.danger ? 'btn--danger' : 'btn--primary');
 
      if (extraBtn) {
        extraBtn.classList.toggle('hidden', !o.extra);
        extraBtn.disabled = false;
        extraBtn.onclick = o.extra ? (() => o.extra.onClick?.(input, extraBtn)) : null;
        if (o.extra) extraBtn.textContent = o.extra.text || '…';
      }
 
      const done = val => {
        askResolve = null;
        okBtn.onclick = cancelBtn.onclick = input.onkeydown = null;
        if (extraBtn) { extraBtn.onclick = null; extraBtn.classList.add('hidden'); }
        if (select) select.classList.add('hidden');
        close('modal-ask');
        resolve(val);
      };
 
      okBtn.onclick = () => {
        if (o.select) return done(select.value);
        return done(o.input ? input.value.trim() : true);
      };
      cancelBtn.onclick = () => done(o.input || o.select ? null : false);
      input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } };
 
      open('modal-ask');
      if (o.input) setTimeout(() => { input.focus(); input.select(); }, 60);
      else if (o.select) setTimeout(() => select.focus(), 60);
    });
  }
 
  async function confirmDelete(message, title = '刪除確認') {
    if (!Settings.get('confirmDelete')) return true;
    return ask({ title, message, okText: '刪除', danger: true });
  }
 
  function init() {
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.matches('.modal__backdrop') || t.closest('[data-close]')) {
        const modal = t.closest('.modal');
        if (modal) close(modal.id);
      }
    });
    document.addEventListener('keydown', trapTab);
  }
 
  return { open, close, closeTop, isOpen, anyOpen, topOf, ask, confirmDelete, init };
})();