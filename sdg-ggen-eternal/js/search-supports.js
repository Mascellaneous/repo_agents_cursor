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
    const fRar   = fv('fs-rarity');
    const fLtd   = fv('fs-limited');
    const fCapS  = fv('fs-cap-series');
    const fCapT  = fv('fs-cap-tag');
    const fSk    = fv('fs-supskill');
 
    const out = list.filter(s => {
        if (q) {
            const hay = [s.name, s.supportSkillName, supportCaptainLine(s), supportSkillLine(s)]
                .join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (fRar === 'none' && s.rarity) return false;
        if (fRar && fRar !== 'none' && s.rarity !== fRar) return false;
        if (fLtd && (s.limited === 'Y' ? 'Y' : 'N') !== fLtd) return false;
        if (fCapS && !abReqArr(s.captainSeries).includes(fCapS)) return false;
        if (fCapT && !abReqArr(s.captainTags).includes(fCapT)) return false;
        const hasHp = (s.supportEffects || []).some(e => e && e.stat === 'hp');
        const hasEn = (s.supportEffects || []).some(e => e && e.stat === 'en');
        if (fSk === 'hp' && !hasHp) return false;
        if (fSk === 'en' && !hasEn) return false;
        if (fSk === 'none' && (hasHp || hasEn || s.supportSkillName)) return false;
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
            case 'rarity':
                r = (RARITY_ORD[a.rarity] || 0) - (RARITY_ORD[b.rarity] || 0);
                break;
            case 'limited':
                r = (a.limited === 'Y' ? 1 : 0) - (b.limited === 'Y' ? 1 : 0);
                break;
            case 'captain':
                r = (a.captainPct || 0) - (b.captainPct || 0);
                break;
            case 'skill':
                r = String(a.supportSkillName || '').localeCompare(String(b.supportSkillName || ''), 'zh-Hant');
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