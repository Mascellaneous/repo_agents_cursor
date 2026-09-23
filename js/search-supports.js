/* js/search-supports.js */
/* =====================================================================
 * search-supports.js — 支援單位搜尋／篩選／排序
 * 規則：篩選控制項 ID 一律 fs-*；表單控制項 ID 一律 s-*。嚴禁混用。
 * 載入順序：globals.js → utils.js → search-common.js → 本檔
 * ===================================================================== */
/* ---------- 支援單位 ---------- */
function applySupFilters(list) {
    const q      = fv('s-search').trim().toLowerCase();
    const fLvlSt = fv('fs-lvlstate');
    const fImg   = fv('fs-image');
 
    const out = list.filter(s => {
        if (q && !String(s.name || '').toLowerCase().includes(q)) return false;
        if (fLvlSt === 'max'    && !isMaxLevel(s, 'supports')) return false;
        if (fLvlSt === 'notmax' &&  isMaxLevel(s, 'supports')) return false;
        if (!matchImageFilter(s, fImg)) return false;
        return true;
    });
 
    const sort = fv('fs-sort');
    const ord  = fv('fs-order') === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        let r;
        switch (sort) {
            case 'name':
                r = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
                break;
            case 'order': {
                const oOf = x => (typeof x.acqOrder === 'number' && x.acqOrder > 0)
                               ? x.acqOrder : Number.MAX_SAFE_INTEGER;
                r = oOf(a) - oOf(b);
                break;
            }
            default:
                r = String(a.date_added || '').localeCompare(String(b.date_added || ''));
        }
        if (r === 0) r = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
        return r * ord;
    });
    return out;
}