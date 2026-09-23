/* =====================================================================
 * search-units.js — 單位搜尋／篩選／排序
 * ---------------------------------------------------------------------
 * 職責：只負責「從清單挑出要顯示的單位並排序」，不碰資料庫。
 * 規則：篩選控制項 ID 一律 fu-*；表單控制項 ID 一律 u-*。嚴禁混用。
 * 載入順序：globals.js → utils.js → search-common.js → 本檔
 * ★ weapon-filters.js 會 wrap 本檔的 applyUnitFilters（見 README §9）。
 * ===================================================================== */
 
/* ---- ★ 武裝等級讀取（相容新舊格式）----
 * 新格式：{ level:'1'..'5', map, range, mp, attrs[] }
 * 舊格式：'1'..'5' 字串；無武裝：'-' */
function weaponLevelOf(w) {
    if (w === '-' || w === undefined || w === null || w === '') return '-';
    if (typeof w === 'object') return (w.level === undefined || w.level === null) ? '-' : String(w.level);
    return String(w);
}
 
/* ---- 武裝等級滿級判定 ----
 * 所有非「-」的武裝等級皆為 5 → 已滿級；全部皆為「-」（無武裝）→ 未滿級。 */
function isWeaponMaxed(u) {
    const vals = [1, 2, 3, 4, 5].map(i => weaponLevelOf(u.weapons && u.weapons[i]));
    const armed = vals.filter(v => v !== '-');
    return armed.length > 0 && armed.every(v => v === '5');
}
 
/* ---------- 變型後機體／逃生後單位：以 ID 解析實際單位 ----------
 * 資料欄位：transformedId/escapedId（精確指向）＋ transformedName/escapedName（名稱快照）。
 * 有 ID 且找得到 → 回傳最新名稱（對方改名自動同步）；
 * 找不到或舊資料只有名稱 → 回退到快照名稱。 */
function getUnitById(id) {
    return (cache.units || []).find(u => u.id === id) || null;
}
function getTransformedName(it) {
    if (it.transformedId) {
        const u = getUnitById(it.transformedId);
        if (u) return u.name;
    }
    return it.transformedName || '';
}
/* 逃生後單位（邏輯同變型） */
function getEscapedName(it) {
    if (it.escapedId) {
        const u = getUnitById(it.escapedId);
        if (u) return u.name;
    }
    return it.escapedName || '';
}
 
/* ---------- 單位 ---------- */
function applyUnitFilters(list) {
    const q       = fv('u-search').trim().toLowerCase();
    const fSeries = fv('fu-series');
    const fRar    = fv('fu-rarity');
    const fLim = fv('fu-limit') || '';   
    const fTyp    = fv('fu-type');
    const fShield = fv('fu-shield');
    const fTrans  = fv('fu-trans');
    const fEsc    = fv('fu-escape');                          // ★ 逃生機能
    const fSp     = fv('fu-sp');
    const fSsp    = fv('fu-ssp');
    const fLtd    = fv('fu-ltd');
    const fSrc    = fv('fu-src');
    const fMobMin = fv('fu-mob-min');
    const fMobMax = fv('fu-mob-max');
    const fLvlSt  = fv('fu-lvlstate');
    const fImg    = fv('fu-image');
    const fWSt    = fv('fu-wstate');
    const fTags   = [...TAG_FILTER_STATE.units];
    const fMode   = TAG_FILTER_MODE.units;                   // AND/OR
    const fExTags = [...TAG_FILTER_EXCLUDE.units];           // 排除標籤
    /* 隱藏「變型/逃生」來源（核取方塊，預設勾選） */
    const hideBox = gi('fu-hidesrc');
    const fHideTE = hideBox ? hideBox.checked : false;
 
    const out = list.filter(it => {
        /* 隱藏來源＝變型/逃生（優先於其他條件） */
        if (fHideTE && (it.src || '').trim() === '變型/逃生') return false;
 
        if (q) {
            const hay = [it.name,
                         ...(Array.isArray(it.series) ? it.series : []),
                         ...(Array.isArray(it.tags)   ? it.tags   : []),
                         getTransformedName(it),                  // 以解析後的名稱搜尋
                         getEscapedName(it),                      // 逃生後名稱一併搜尋
                         it.src || '', it.comments || '']
                        .join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (fSeries && !(it.series || []).includes(fSeries)) return false;
        if (fRar    && it.rarity !== fRar)                   return false;
        if (fLim !== '') {
            const lb = typeof it.limitBreak === 'number' ? it.limitBreak : 0;
            if (fLim === '0-2') {
                if (lb >= 3) return false;               // 只保留 0／1／2
            } else if (lb !== parseInt(fLim, 10)) {
                return false;
            }
        }
        if (fTyp    && it.type !== fTyp)                     return false;
        if (fShield && it.shield !== fShield)                return false;
        if (fTrans  && it.transformable !== fTrans)          return false;
        if (fEsc    && it.escape !== fEsc)                   return false;   // ★ 逃生機能
        if (fSp     && it.sp !== fSp)                        return false;
        if (fSsp    && it.ssp !== fSsp)                      return false;
        if (fLtd    && it.limited !== fLtd)                  return false;
        if (fSrc) {
            const itemSrc = (it.src || '').trim();
            if (fSrc === '未設定' ? itemSrc !== '' : itemSrc !== fSrc) return false;
        }
        if (fMobMin !== '' && (+it.mobility || 0) < +fMobMin) return false;
        if (fMobMax !== '' && (+it.mobility || 0) > +fMobMax) return false;
        if (fLvlSt === 'max'    && !isMaxLevel(it, 'units')) return false;
        if (fLvlSt === 'notmax' &&  isMaxLevel(it, 'units')) return false;
 
        if (!matchImageFilter(it, fImg)) return false;
 
        if (fWSt === 'max'    && !isWeaponMaxed(it)) return false;
        if (fWSt === 'notmax' &&  isWeaponMaxed(it)) return false;
 
        /* 地形（五種各別；O / △ / - ；'yes' = O 或 △） */
        for (const [, k] of TERRAINS) {
            const want = fv('fu-tr_' + k);
            if (!want) continue;
            const tv = String((it.terrain && it.terrain[k]) ?? '-');
            if (want === 'yes') { if (tv !== 'O' && tv !== '△') return false; }
            else if (tv !== want) return false;
        }
 
        /* 標籤（依 TAG_FILTER_MODE 決定 AND / OR；排除標籤優先） */
        if (!matchTagCondition(it.tags, fTags, fMode, fExTags)) return false;
 
        return true;
    });
 
    const sort = fv('fu-sort');
    const ord  = fv('fu-order') === 'asc' ? 1 : -1;
    out.sort((a, b) => {
        let r = 0;
        switch (sort) {
            case 'name':   r = String(a.name).localeCompare(String(b.name), 'zh-Hant'); break;
            case 'rarity': r = (RARITY_ORD[a.rarity] || 0) - (RARITY_ORD[b.rarity] || 0); break;
            case 'type':   r = (TYPE_ORD[a.type]   || 9) - (TYPE_ORD[b.type]   || 9); break;
            case 'mob':    r = (+a.mobility   || 0) - (+b.mobility   || 0); break;
            case 'lvl':    r = (+a.level      || 0) - (+b.level      || 0); break;
            case 'lim':    r = (+a.limitBreak || 0) - (+b.limitBreak || 0); break;
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
 