/* =====================================================================
 * autocomplete.js — 通用自動完成（token / whole 兩種模式）
 * ---------------------------------------------------------------------
 * ★ 本次改動：新增 initAutocomplete()（main.js 於載入時呼叫，
 *   綁定頁面上所有 data-ac 欄位；之前缺少此函式，自動完成未啟用）。
 * ===================================================================== */
function poolSeries() {
    const s = new Set();
    ['units', 'characters'].forEach(t => (cache[t] || []).forEach(it => (it.series || []).forEach(x => s.add(x))));
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
function poolTags(t) {
    const s = new Set();
    (cache[t] || []).forEach(it => (it.tags || []).forEach(x => s.add(x)));
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
function poolNames(t) { return (cache[t] || []).map(it => it.name).filter(Boolean); }
function poolCharField(kind) {
    const s = new Set();
    (cache.characters || []).forEach(c => {
        (kind === 'skills' ? ['sk1','sk2','sk3'] : ['ab1','ab2','ab3'])
            .forEach(k => { if (c[k]) s.add(c[k]); });
    });
    return [...s];
}
 
/* 分隔符樣式（帶 g 旗標供邊界掃描用） */
const COMMA_SEP = /[,，、]/g;        // 系列：僅逗號類
const SPACE_SEP = /[\s,，、]/g;      // 標籤：空格＋逗號類（★ 支援空格分隔）
 
const AC_SOURCES = {
    series: { mode: 'tok', sepRe: COMMA_SEP, get: () => poolSeries() },
    utags:  { mode: 'tok', sepRe: SPACE_SEP, get: () => poolTags('units') },
    ctags:  { mode: 'tok', sepRe: SPACE_SEP, get: () => poolTags('characters') },
    uname:  { mode: 'whole', get: () => poolNames('units') },
    csk:    { mode: 'whole', get: () => poolCharField('skills'),
              descOf: n => (typeof getSkillDesc === 'function' ? getSkillDesc(n) : '') },
    cab:    { mode: 'whole', get: () => poolCharField('abilities'),
              descOf: n => (typeof getAbilityDesc === 'function' ? getAbilityDesc(n) : '') }
};
const _acOpened = [];
 
function bindAC(input) {
    const src = AC_SOURCES[input.dataset.ac];
    if (!src) return;
    let box = null, hi = -1, items = [], timer = null;
    const sepRe = src.sepRe || COMMA_SEP;
 
    /* 以 sepRe 找出游標所在 token 的左／右邊界 */
    const prevSep = (s, c) => {
        sepRe.lastIndex = 0;
        let last = -1, m;
        while ((m = sepRe.exec(s)) !== null) {
            if (m.index >= c) break;
            last = m.index;
        }
        return last;
    };
    const nextSep = (s, c) => {
        sepRe.lastIndex = 0;
        const m = sepRe.exec(s.slice(c));
        return m ? c + m.index : s.length;
    };
 
    const close = () => { if (box) { box.remove(); box = null; } hi = -1; };
    const curVal = () => {
        const v = input.value, c = input.selectionStart ?? v.length;
        if (src.mode === 'whole') return v.trim();
        return v.slice(prevSep(v, c) + 1, nextSep(v, c)).trim();
    };
    const choose = val => {
        val = val.trim();
        if (src.mode === 'whole') {
            input.value = val;
            input.setSelectionRange(val.length, val.length);
        } else {
            const v = input.value, c = input.selectionStart ?? v.length;
            const b = prevSep(v, c) + 1, e = nextSep(v, c);
            input.value = v.slice(0, b) + val + v.slice(e);
            const np = b + val.length;
            input.setSelectionRange(np, np);
        }
        close(); input.focus();
    };
    const paint = () => [...box.children].forEach((el, i) => el.classList.toggle('hl', i === hi));
    const show = () => {
        close();
        const cur = curVal();
        if (!cur) return;
        const low = cur.toLowerCase();
        items = src.get().filter(x => x.toLowerCase().includes(low) && x.toLowerCase() !== low).slice(0, 8);
        if (!items.length) return;
        box = document.createElement('div');
        box.className = 'ac-box';
        items.forEach(v => {
            const d = document.createElement('div');
            d.className = 'ac-item';
            if (src.descOf) {                          // ★ 名稱＋說明雙行顯示
                d.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding:5px 10px;';
                const nm = document.createElement('div');
                nm.style.fontWeight = 'bold';
                nm.textContent = v;
                const ds = document.createElement('div');
                ds.style.cssText = 'font-size:11px;opacity:.75;white-space:normal;';
                ds.textContent = src.descOf(v) || '（無說明 — 可於「📖 角色能力一覽」補充）';
                d.append(nm, ds);
            } else {
                d.textContent = v;
            }
            d.addEventListener('mousedown', e => { e.preventDefault(); choose(v); });
            box.appendChild(d);
        });
        input.parentElement.appendChild(box);
        _acOpened.push(() => { if (box) close(); });
    };
    input.addEventListener('input',  () => { clearTimeout(timer); timer = setTimeout(show, 140); });
    input.addEventListener('focus',  () => { clearTimeout(timer); timer = setTimeout(show, 140); });
    input.addEventListener('blur',   () => setTimeout(close, 150));
    input.addEventListener('keydown', e => {
        if (!box) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, -1); paint(); }
        else if ((e.key === 'Enter' || e.key === 'Tab') && hi >= 0) { e.preventDefault(); choose(items[hi]); }
        else if (e.key === 'Escape') close();
    });
}
document.addEventListener('click', e => {
    if (!e.target.closest('.ac-box') && !e.target.matches('[data-ac]')) {
        while (_acOpened.length) _acOpened.pop()();
    }
});
function setupAC(root = document) {
    root.querySelectorAll('[data-ac]').forEach(el => {
        if (!el._acBound) { el._acBound = true; bindAC(el); }
    });
}
/* ★ main.js 於載入時呼叫：綁定頁面上所有 data-ac 欄位（只綁一次） */
function initAutocomplete() { setupAC(document); }