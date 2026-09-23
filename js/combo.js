/* =====================================================================
 * combo.js — 可搜尋下拉（combobox）通用元件
 * ---------------------------------------------------------------------
 * 結構：<select id=...>（隱藏，作為值容器）＋動態插入的搜尋文字框＋.ac-box 清單
 * API：
 *   initSearchCombo({ selId, inpId, pool, placeholder, hint, limit })
 *       pool(): 回傳 [{ v: 值, label: 顯示文字 }]
 *   refreshCombo(selId, selVal)  — 重建選項並預選（selVal 支援 'name:xxx' 舊資料暫代值）
 *   setComboDisabled(selId, b)   — 停用／啟用
 * 供「變型後機體」與「逃生後單位」共用。
 * ===================================================================== */
const _comboReg = {};
 
function initSearchCombo(cfg) {
    const sel = gi(cfg.selId);
    if (!sel || sel._comboInit) return;
    sel._comboInit = true;
    sel.style.display = 'none';
 
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.id = cfg.inpId;
    inp.placeholder = cfg.placeholder || '🔍 搜尋…';
    inp.autocomplete = 'off';
    inp.disabled = sel.disabled;
    sel.parentElement.insertBefore(inp, sel);
 
    if (cfg.hint) {
        const hint = sel.parentElement.querySelector('.hint');
        if (hint) hint.textContent = cfg.hint;
    }
 
    const st = { box: null, items: [], hi: -1, timer: null };
    _comboReg[cfg.selId] = { sel, inp, st, cfg };
 
    const close = () => { if (st.box) { st.box.remove(); st.box = null; } st.hi = -1; };
    const paint = () => {
        if (!st.box) return;
        [...st.box.querySelectorAll('.ac-item[data-idx]')]
            .forEach(el => el.classList.toggle('hl', +el.dataset.idx === st.hi));
    };
    const choose = i => {
        const o = st.items[i];
        if (!o) return;
        sel.value = o.v;
        inp.value = o.label;
        close();
    };
    const open = () => {
        if (inp.disabled) return;
        close();
        const q = inp.value.trim().toLowerCase();
        let pool = cfg.pool() || [];
        if (q) pool = pool.filter(o => String(o.label).toLowerCase().includes(q));
        pool = [...pool].sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant'));
        const limit = cfg.limit || 100;
        st.items = pool.slice(0, limit);
 
        st.box = document.createElement('div');
        st.box.className = 'ac-box';
        if (!st.items.length) {
            const d = document.createElement('div');
            d.className = 'ac-item'; d.style.cursor = 'default';
            d.textContent = q ? '沒有符合的項目' : '目前沒有任何項目';
            st.box.appendChild(d);
        } else {
            st.items.forEach((o, i) => {
                const d = document.createElement('div');
                d.className = 'ac-item';
                d.textContent = o.label;
                d.dataset.idx = i;
                d.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
                st.box.appendChild(d);
            });
            if (pool.length > limit) {
                const d = document.createElement('div');
                d.className = 'ac-item'; d.style.cursor = 'default'; d.style.opacity = '.65';
                d.textContent = `共 ${pool.length} 筆符合，僅顯示前 ${limit} 筆，請輸入更多關鍵字`;
                st.box.appendChild(d);
            }
        }
        st.box.style.top = (inp.offsetTop + inp.offsetHeight + 1) + 'px';
        inp.parentElement.appendChild(st.box);
        st.hi = -1;
    };
    /* 失焦收尾：文字恰為某唯一候選 → 自動選用；其餘還原為目前選項文字 */
    const blurFinalize = () => {
        const cur = (sel.selectedIndex >= 0) ? (sel.options[sel.selectedIndex].text || '') : '';
        const txt = inp.value.trim();
        if (txt === cur.trim()) return;
        const pool = cfg.pool() || [];
        const exact = pool.filter(o => String(o.label).trim() === txt);
        if (exact.length === 1) { sel.value = exact[0].v; inp.value = exact[0].label; return; }
        inp.value = cur;
    };
 
    inp.addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(open, 120); });
    inp.addEventListener('focus', () => { clearTimeout(st.timer); st.timer = setTimeout(open, 120); });
    inp.addEventListener('blur', () => setTimeout(() => { blurFinalize(); close(); }, 150));
    inp.addEventListener('keydown', e => {
        if (!st.box) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (st.items.length) { st.hi = Math.min(st.hi + 1, st.items.length - 1); paint(); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            st.hi = Math.max(st.hi - 1, -1); paint();
        } else if (e.key === 'Enter') {
            e.preventDefault();                        // 防止誤送表單
            if (st.hi >= 0 && st.items[st.hi]) choose(st.hi); else close();
        } else if (e.key === 'Tab') {
            if (st.hi >= 0 && st.items[st.hi]) choose(st.hi); else close();
        } else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', e => {
        if (st.box && !e.target.closest('.ac-box') && e.target !== inp) close();
    });
}
 
function comboOf(selId) { return _comboReg[selId] || null; }
 
/* 重建選項；selVal：id / 'name:名稱'（舊資料暫代）/ ''（不預選） */
function refreshCombo(selId, selVal) {
    const c = comboOf(selId);
    if (!c) return;
    const opts = (c.cfg.pool() || [])
        .map(o => ({ v: o.v, label: o.label }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label), 'zh-Hant'));
    const sel = c.sel;
    sel.innerHTML = '<option value="">（無）</option>' +
        opts.map(o => `<option value="${esc(o.v)}">${esc(o.label)}</option>`).join('');
    selVal = selVal || '';
    if (String(selVal).startsWith('name:')) {
        const nm = String(selVal).slice(5);
        sel.insertAdjacentHTML('beforeend',
            `<option value="${esc(selVal)}">${esc(nm)}（僅名稱 — 舊資料，建議重新選擇特定單位）</option>`);
    }
    sel.value = selVal;
    if (sel.value !== String(selVal)) sel.value = '';   // id 已不存在（被刪除）時歸零
    c.inp.value = (sel.selectedIndex >= 0) ? (sel.options[sel.selectedIndex].text || '') : '';
}
 
function setComboDisabled(selId, disabled) {
    const c = comboOf(selId);
    if (!c) return;
    c.sel.disabled = disabled;
    c.inp.disabled = disabled;
    if (disabled && c.st.box) { c.st.box.remove(); c.st.box = null; }
}