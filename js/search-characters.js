/* js/search-characters.js */
/* =====================================================================
 * search-characters.js — 角色搜尋／篩選／排序
 * 規則：篩選控制項 ID 一律 fc-*；表單控制項 ID 一律 c-*。嚴禁混用。
 * 載入順序：globals.js → utils.js → search-common.js → 本檔
 * ===================================================================== */

/* ---------- 角色 ---------- */
function applyCharFilters(list) {
    const q       = fv('c-search').trim().toLowerCase();
    const fSeries = fv('fc-series');
    const fRar    = fv('fc-rarity');
    const fTyp    = fv('fc-type');
    const fSp = fv('fc-sp');
    const fLvlSt  = fv('fc-lvlstate');
    const fAb  = fv('fc-ab');
    const fSk  = fv('fc-sk');
    const fReqS = fv('fc-abreq-series');
    const fReqT = fv('fc-abreq-tag');
    const fTbS  = fv('fc-tbseries');
    const fTbT  = fv('fc-tbtag');  
    const fImg    = fv('fc-image');
    const fTags   = [...TAG_FILTER_STATE.characters];
    const fMode   = TAG_FILTER_MODE.characters;              // AND/OR
    const fExTags = [...TAG_FILTER_EXCLUDE.characters];      // 排除標籤
 
    const out = list.filter(c => {
        if (q) {
            const hay = [c.name,
                         ...(Array.isArray(c.series) ? c.series : []),
                         ...(Array.isArray(c.tags)   ? c.tags   : []),
                         c.sk1 || '', c.sk2 || '', c.sk3 || '',
                         c.ab1 || '', c.ab2 || '', c.ab3 || '',
                         ...abReqArr(c.ab1Series), ...abReqArr(c.ab1Tag),
                         ...abReqArr(c.ab2Series), ...abReqArr(c.ab2Tag),
                         ...abReqArr(c.ab3Series), ...abReqArr(c.ab3Tag),                     
                         c.tagBonus || '', c.tagBonusEffect || '',
                         ...abReqArr(c.tagBonusSeries), ...abReqArr(c.tagBonusTag)
            ];                         
            if (!hay.includes(q)) return false;
        }
        if (fSeries && !(c.series || []).includes(fSeries)) return false;
        if (fRar    && c.rarity !== fRar)                   return false;
        if (fTyp    && c.type !== fTyp)                     return false;
        if (fSp     && c.sp !== fSp)                        return false;
        if (fLvlSt === 'max'    && !isMaxLevel(c, 'characters')) return false;
        if (fLvlSt === 'notmax' &&  isMaxLevel(c, 'characters')) return false;
 
        if (fAb && ![c.ab1, c.ab2, c.ab3].includes(fAb)) return false;
        if (fSk && ![c.sk1, c.sk2, c.sk3].includes(fSk)) return false;
        if (fReqS) {
            let hit = false;
            for (let i = 1; i <= 3; i++)
                if (abReqArr(c['ab' + i + 'Series']).includes(fReqS)) { hit = true; break; }
            if (!hit) return false;
        }
        if (fReqT) {
            let hit = false;
            for (let i = 1; i <= 3; i++)
                if (abReqArr(c['ab' + i + 'Tag']).includes(fReqT)) { hit = true; break; }
            if (!hit) return false;
        }
        if (fTbS && !abReqArr(c.tagBonusSeries).includes(fTbS)) return false;
        if (fTbT && !abReqArr(c.tagBonusTag).includes(fTbT)) return false;    
        if (!matchImageFilter(c, fImg)) return false;
 
        /* 標籤（依 TAG_FILTER_MODE 決定 AND / OR；排除標籤優先） */
        if (!matchTagCondition(c.tags, fTags, fMode, fExTags)) return false;
 
        return true;
    });
 
    const sort = fv('fc-sort');
    const ord  = fv('fc-order') === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        let r = 0;
        switch (sort) {
            case 'name':   r = String(a.name).localeCompare(String(b.name), 'zh-Hant'); break;
            case 'rarity': r = (RARITY_ORD[a.rarity] || 0) - (RARITY_ORD[b.rarity] || 0); break;
            case 'lvl':    r = (+a.level  || 0) - (+b.level  || 0); break;
            case 'shoot':  r = (+a.shoot  || 0) - (+b.shoot  || 0); break;
            case 'melee':  r = (+a.melee  || 0) - (+b.melee  || 0); break;
            case 'awaken': r = (+a.awaken || 0) - (+b.awaken || 0); break;
            case 'defend': r = (+a.defend || 0) - (+b.defend || 0); break;
            case 'react':  r = (+a.react  || 0) - (+b.react  || 0); break;
            case 'order': {
                const oOf = x => (typeof x.acqOrder === 'number' && x.acqOrder > 0)
                               ? x.acqOrder : Number.MAX_SAFE_INTEGER;
                r = oOf(a) - oOf(b);
                break;
            }
            default:       r = String(a.date_added || '').localeCompare(String(b.date_added || ''));
        }
        if (r === 0) r = String(a.name).localeCompare(String(b.name), 'zh-Hant');
        return r * ord;
    });
    return out;
}