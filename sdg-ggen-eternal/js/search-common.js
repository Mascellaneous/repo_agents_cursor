/* =====================================================================
 * search-common.js — 搜尋／篩選共用工具
 * ---------------------------------------------------------------------
 * 職責：等級上限判定、滿級判定、圖片篩選、標籤條件（AND/OR/排除）。
 * 規則：篩選控制項 ID 一律 fu-* / fc-* / fs-*；
 *      表單控制項 ID 一律 u-* / c-* / s-*。兩者嚴禁混用。
 * 載入順序：globals.js → utils.js → search-common.js
 *          → search-units/characters/supports.js → render-*.js
 * ===================================================================== */
 
/* ---- 等級上限與滿級判定 ---- */
function getMaxLevel(it, type) {
    if (type === 'supports') return SUPPORT_MAX_LEVEL;
    if (!it || !RARITIES.includes(it.rarity)) return null;
    if (it.rarity === 'UR') return BASE_MAX_LEVEL.UR;          // SP 不適用於 UR
    return (it.sp === 'Y') ? MAX_LEVEL_WITH_SP : BASE_MAX_LEVEL[it.rarity];
}
function isMaxLevel(it, type) {
    const mx = getMaxLevel(it, type);
    if (mx === null || typeof it.level !== 'number') return false;
    return it.level >= mx;
}
 
/* ---- 圖片篩選共用 ---- */
function matchImageFilter(it, fImg) {
    if (fImg === 'y' && !it.image) return false;
    if (fImg === 'n' &&  it.image) return false;
    return true;
}
 
/* ---------- ★ 標籤條件共用（依模式 AND/OR；支援排除標籤） ----------
 * exclude：排除標籤集合 — 資料具備任一排除標籤即不符合（優先於包含條件）。
 * want：包含標籤 — 依 mode 決定 AND（全部具備）或 OR（任一具備）。 */
function matchTagCondition(tags, want, mode, exclude) {
    const own = tags || [];
    if (exclude && exclude.length && exclude.some(tg => own.includes(tg))) return false;
    if (!want.length) return true;
    return mode === 'OR' ? want.some(tg => own.includes(tg))
                         : want.every(tg => own.includes(tg));
}