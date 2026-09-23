/* =====================================================================
 * weapon-filters.js — 武裝相關篩選＋「形狀」自動完成＋武器新格式工具
 * ---------------------------------------------------------------------
 * 【七個單位篩選】（控制項由本檔自動注入篩選面板，不必改 HTML）
 *   1. MAP兵器   ：有 MAP兵器 / 無 MAP兵器
 *   2. 射程      ：最短射程 ～ 最長射程（任一非 MAP 武裝的射程區間
 *                  與指定範圍「重疊」即符合；只設一端時另一端視為不限）
 *   3. 射程設定  ：所有射程已設定 / 部分射程已設定 / 未設定
 *   4. MP要求    ：需要超強勢 / 需要超一擊 / 有MP要求 / 沒有MP要求 / 未設定
 *   5. POWER     ：最小 ～ 最大（任一武裝的 POWER 數字落於區間即符合；
 *                  自動忽略逗號等非數字字元；只填一端則另一端不限）
 *   6. 武裝效果  ：指定效果類型（14 種）/ 有任一效果 / 無任何效果
 *                  （任一武裝具備該類型效果即符合）
 *   7. 武裝名稱  ：所有武裝已命名 / 部分武裝已命名 / 未命名
 *                  （以「武裝等級非『-』」的武裝計算，MAP兵器也列入）
 *
 * 【武器資料格式】（與 weapon-details.js 一致；類型定義見 weapon-effect-types.js）
 *   weapons[i] = '-' 或
 *   { level, map, name, power, en, hit, crit, atkTypes,
 *     shape, ammo（僅 MAP兵器）, rangeMin, rangeMax, mp, attrs,
 *     effects:[{ type, pct }…], limits:[{ type, pct }…] }
 *   舊格式 { range:'1'..'6' } 可讀取（視為 1–range）；
 *   效果舊格式自帶的 name 一律略過（名稱由 weapon-effect-types.js 統一）；
 *   同步下載時會自動轉為新格式。
 *
 * 【接手擴充的既有函式】（原始檔不必修改；日後改這些函式時請留意本檔）
 *   1. applyUnitFilters()     → 附加本檔七個篩選
 *   2. clearU()               → 清除篩選時一併重置本區控制項
 *   3. normalizeWeaponEntry() → 同步下載時正規化新格式（GitHub-sync.js）
 * ===================================================================== */
 
/* ==================== 資料層小工具（篩選與顯示共用） ==================== */
 
/* 該武裝是否為 MAP兵器（map === 'Y'） */
function weaponIsMap(w) {
    return !!(w && typeof w === 'object' && w.map === 'Y');
}
 
/* 取出單位所有「已裝備」的武裝（等級非 '-'；含新舊格式） */
function armedWeapons(u) {
    const out = [];
    for (let i = 1; i <= 5; i++) {
        const w = u.weapons ? u.weapons[i] : undefined;
        if (w === '-' || w === undefined || w === null || w === '') continue;
        out.push(w);
    }
    return out;
}
 
/* 單位是否擁有至少一把 MAP兵器 */
function unitHasMapWeapon(u) {
    return armedWeapons(u).some(weaponIsMap);
}
 
/* 武裝的射程區間 { min, max }；無法判定（未填妥／MAP兵器／舊字串）→ null
 * 舊格式相容：僅有 range 單一數字 → 視為 1–range */
function weaponRangeBounds(w) {
    if (!w || typeof w !== 'object' || w.map === 'Y') return null;
    const mn = parseInt(w.rangeMin, 10);
    const mx = parseInt(w.rangeMax, 10);
    if (!isNaN(mn) && !isNaN(mx)) return { min: mn, max: mx };
    const lg = parseInt(w.range, 10);
    return isNaN(lg) ? null : { min: 1, max: lg };
}
 
/* 武裝射程顯示文字（供卡片「武裝詳細」使用）；MAP兵器 → '' */
function weaponRangeText(w) {
    if (!w || typeof w !== 'object' || w.map === 'Y') return '';
    const mn = String(w.rangeMin ?? ''), mx = String(w.rangeMax ?? '');
    if (mn && mx) return mn + '～' + mx;
    if (mx) return '～' + mx;
    if (mn) return mn + '～';
    return String(w.range ?? '');      // 舊格式
}
 
/* ★ POWER 數值解析（「3,500」→ 3500；無有效數字 → null） */
function weaponPowerValue(w) {
    if (!w || typeof w !== 'object') return null;
    const s = String(w.power ?? '').replace(/[^\d]/g, '');
    if (!s) return null;
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
}
 
/* 射程設定狀態：'all' | 'part' | 'none'（MAP兵器不列入計算） */
function unitRangeSetState(u) {
    const ws = armedWeapons(u).filter(w => !weaponIsMap(w));
    const withR = ws.filter(w => weaponRangeBounds(w) !== null).length;
    if (withR === 0) return 'none';
    if (withR === ws.length) return 'all';
    return 'part';
}
 
/* ★ 武裝名稱設定狀態：'all' | 'part' | 'none'
 * （以武裝等級非 '-' 的武裝計算，MAP兵器也列入；無武裝單位 → 'none'） */
function unitNameSetState(u) {
    const ws = armedWeapons(u);
    const named = ws.filter(w => typeof w === 'object' && String(w.name || '').trim() !== '').length;
    if (named === 0) return 'none';
    if (named === ws.length) return 'all';
    return 'part';
}
 
const WEAPON_MP_REQS = ['需要超強勢', '需要超一擊'];
 
/* MP要求是否符合（want：'需要超強勢'|'需要超一擊'|'has'|'no'|'unset'） */
function unitMpMatch(u, want) {
    return armedWeapons(u).some(w => {
        const mp = (w && typeof w === 'object') ? (w.mp || '') : '';
        switch (want) {
            case '需要超強勢': return mp === '需要超強勢';
            case '需要超一擊': return mp === '需要超一擊';
            case 'has':        return WEAPON_MP_REQS.includes(mp);
            case 'no':         return mp === '沒有MP要求';
            case 'unset':      return mp === '';
            default:           return true;
        }
    });
}
 
/* 「形狀」自動完成建議池（所有單位武裝的形狀） */
function poolWeaponShapes() {
    const s = new Set();
    (cache.units || []).forEach(u => {
        for (let i = 1; i <= 5; i++) {
            const w = u.weapons ? u.weapons[i] : undefined;
            if (w && typeof w === 'object' && w.shape) s.add(w.shape);
        }
    });
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
 
/* ==================== 篩選本體（套用於單位清單） ==================== */
function matchWeaponFilters(u) {
    /* 1. MAP兵器 有／無 */
    const fMap = fv('fu-map');
    if (fMap) {
        const has = unitHasMapWeapon(u);
        if (fMap === 'Y' && !has) return false;
        if (fMap === 'N' &&  has) return false;
    }
    /* 2. 射程區間：任一非 MAP 武裝與 [lo, hi] 重疊 */
    const fMin = parseInt(fv('fu-rmin'), 10);
    const fMax = parseInt(fv('fu-rmax'), 10);
    if (!isNaN(fMin) || !isNaN(fMax)) {
        const lo = isNaN(fMin) ? 1  : fMin;
        const hi = isNaN(fMax) ? 99 : fMax;
        const hit = armedWeapons(u).some(w => {
            const r = weaponRangeBounds(w);
            return r !== null && r.min <= hi && r.max >= lo;
        });
        if (!hit) return false;
    }
    /* 3. 射程設定狀態 */
    const fRs = fv('fu-rstate');
    if (fRs && unitRangeSetState(u) !== fRs) return false;
    /* 4. MP要求 */
    const fMp = fv('fu-mp');
    if (fMp && !unitMpMatch(u, fMp)) return false;
    /* 5. POWER 區間：任一武裝的 POWER 數字落於 [lo, hi] */
    const pMin = parseInt(fv('fu-pmin'), 10);
    const pMax = parseInt(fv('fu-pmax'), 10);
    if (!isNaN(pMin) || !isNaN(pMax)) {
        const lo = isNaN(pMin) ? -Infinity : pMin;
        const hi = isNaN(pMax) ?  Infinity : pMax;
        const hit = armedWeapons(u).some(w => {
            const p = weaponPowerValue(w);
            return p !== null && p >= lo && p <= hi;
        });
        if (!hit) return false;
    }
    /* 6. 武裝效果：指定類型 / 有任一效果 / 無任何效果 */
    const fEff = fv('fu-eff');
    if (fEff) {
        const allEff = [];
        armedWeapons(u).forEach(w => {
            if (Array.isArray(w.effects)) w.effects.forEach(e => { if (e && e.type) allEff.push(e.type); });
        });
        if (fEff === 'any')  { if (!allEff.length) return false; }
        else if (fEff === 'none') { if (allEff.length) return false; }
        else if (!allEff.includes(fEff)) return false;
    }
    /* 7. ★ 武裝名稱設定狀態：所有已命名 / 部分已命名 / 未命名 */
    const fWn = fv('fu-wname');
    if (fWn && unitNameSetState(u) !== fWn) return false;
    return true;
}
 
/* POWER 數字輸入的防抖（每鍵觸發 → 300ms 後重繪） */
let _wpTimer = null;
function debouncedWPower() {
    clearTimeout(_wpTimer);
    _wpTimer = setTimeout(() => fc('units'), 300);
}
 
/* ==================== 篩選面板注入（插在「武裝等級」之後） ==================== */
function buildWeaponFilterPanel() {
    if (gi('fu-map')) return;                        // 已建立
    const anchor = gi('fu-wstate');                  // 錨點：武裝等級篩選
    if (!anchor) return;
    const fg = anchor.closest('.fgroup');
    if (!fg) return;
    const rOpts = ['1', '2', '3', '4', '5', '6']
        .map(v => `<option value="${v}">${v}</option>`).join('');
    const effOpts = WEAPON_EFFECT_TYPES
        .map(t => `<option value="${t.code}">${esc(t.label)}</option>`).join('');
    fg.insertAdjacentHTML('afterend', `
        <div class="fgroup"><label>MAP兵器</label>
            <select id="fu-map" onchange="fc('units')"
                    title="有MAP兵器＝任一武裝的MAP兵器為 Y">
                <option value="">全部</option>
                <option value="Y">有 MAP兵器</option>
                <option value="N">無 MAP兵器</option>
            </select></div>
        <div class="fgroup"><label>射程</label>
            <select id="fu-rmin" onchange="fc('units')"
                    title="符合條件＝任一（非MAP兵器）武裝的最短～最長射程與指定範圍重疊（可攻擊到該範圍內的距離）。只設一端時另一端視為不限。">
                <option value="">最短：不限</option>${rOpts}</select>
            <span style="opacity:.6;">～</span>
            <select id="fu-rmax" onchange="fc('units')"
                    title="同左（最長射程）">
                <option value="">最長：不限</option>${rOpts}</select>
        </div>
        <div class="fgroup"><label>射程設定</label>
            <select id="fu-rstate" onchange="fc('units')"
                    title="以「武裝等級非『-』且非MAP兵器」的武裝計算（MAP兵器不使用射程，不列入）：所有射程已設定＝每把適用武裝都填了最短＋最長射程；未設定＝完全沒有武裝填射程（含無武裝單位）">
                <option value="">全部</option>
                <option value="all">所有射程已設定</option>
                <option value="part">部分射程已設定</option>
                <option value="none">未設定</option>
            </select></div>
        <div class="fgroup"><label>MP要求</label>
            <select id="fu-mp" onchange="fc('units')"
                    title="符合條件＝任一武裝的MP要求為所選項目。有MP要求＝需要超強勢或需要超一擊；未設定＝MP要求空白">
                <option value="">全部</option>
                <option value="需要超強勢">需要超強勢</option>
                <option value="需要超一擊">需要超一擊</option>
                <option value="has">有MP要求</option>
                <option value="no">沒有MP要求</option>
                <option value="unset">未設定</option>
            </select></div>
        <div class="fgroup"><label>POWER</label>
            <input type="number" id="fu-pmin" min="0" placeholder="最小" style="width:70px;"
                   oninput="debouncedWPower()"
                   title="符合條件＝任一武裝的POWER（數字）落於區間。自動忽略逗號等非數字字元；只填一端則另一端不限。">
            <span style="opacity:.6;">～</span>
            <input type="number" id="fu-pmax" min="0" placeholder="最大" style="width:70px;"
                   oninput="debouncedWPower()" title="同左（最大值）">
        </div>
        <div class="fgroup"><label>武裝效果</label>
            <select id="fu-eff" onchange="fc('units')"
                    title="符合條件＝任一武裝具備所選類型的效果。效果名稱為「類型層級」（所有單位同名），此處以完整類型說明列出。">
                <option value="">全部</option>
                <option value="any">有任一效果</option>
                <option value="none">無任何效果</option>
                ${effOpts}
            </select></div>
        <div class="fgroup"><label>武裝名稱</label>
            <select id="fu-wname" onchange="fc('units')"
                    title="以「武裝等級非『-』」的武裝計算（MAP兵器也列入）：所有武裝已命名＝每把都填了名稱；未命名＝完全沒有武裝填名稱（含無武裝單位）">
                <option value="">全部</option>
                <option value="all">所有武裝已命名</option>
                <option value="part">部分武裝已命名</option>
                <option value="none">未命名</option>
            </select></div>`);
}
 
function clearWeaponFilters() {
    ['fu-map', 'fu-rmin', 'fu-rmax', 'fu-rstate', 'fu-mp', 'fu-pmin', 'fu-pmax', 'fu-eff', 'fu-wname']
        .forEach(id => { const el = gi(id); if (el) el.value = ''; });
}
 
/* ==================== 「形狀」自動完成來源註冊 ==================== */
function registerShapeAutocomplete() {
    if (typeof AC_SOURCES === 'undefined' || AC_SOURCES.wshape) return;
    AC_SOURCES.wshape = { mode: 'whole', get: () => poolWeaponShapes() };
}
 
/* ==================== 接手擴充既有函式 ==================== */
function installWeaponFilterHooks() {
    /* 1) applyUnitFilters → 附加武裝篩選（原函式已排序，filter 保留其順序） */
    if (typeof window.applyUnitFilters === 'function' && !window.applyUnitFilters._wf) {
        const orig = window.applyUnitFilters;
        const wrapped = function (list) { return orig(list).filter(matchWeaponFilters); };
        wrapped._wf = true;
        window.applyUnitFilters = wrapped;
    }
    /* 2) clearU → 先重置本區，再執行原清除（原函式最後會重繪清單） */
    if (typeof window.clearU === 'function' && !window.clearU._wf) {
        const orig = window.clearU;
        const wrapped = function () { clearWeaponFilters(); orig(); };
        wrapped._wf = true;
        window.clearU = wrapped;
    }
    /* 3) normalizeWeaponEntry → 支援完整新格式（含彈藥量 ammo；效果／限制為
     *    { type, pct }，舊格式 name 略過），並把舊格式 { range } 轉為
     *    { rangeMin:'1', rangeMax:range } */
    if (typeof window.normalizeWeaponEntry === 'function' && !window.normalizeWeaponEntry._wf) {
        window.normalizeWeaponEntry = function (w) {
            if (w === '-' || w === undefined || w === null || w === '') return '-';
            if (typeof w === 'object') {
                const lv = String(w.level ?? '');
                if (!WEAPON_LEVELS.includes(lv)) return '-';
                const isMap = w.map === 'Y';
                let rmin = String(w.rangeMin ?? '');
                let rmax = String(w.rangeMax ?? '');
                if (rmin === '' && rmax === '' && w.range != null && w.range !== '') {
                    rmax = String(w.range); rmin = '1';      // 舊格式 → 1–range
                }
                if (rmin !== '' && !WEAPON_RANGE_OPTS.includes(rmin)) rmin = '';
                if (rmax !== '' && !WEAPON_RANGE_OPTS.includes(rmax)) rmax = '';
                return {
                    level: lv,
                    map: (w.map === 'Y' || w.map === 'N') ? w.map : '',
                    name:  wdCleanStr(w.name, 40),
                    power: wdCleanStr(w.power, 10),
                    en:    wdCleanStr(w.en, 6),
                    hit:   wdCleanStr(w.hit, 6),
                    crit:  wdCleanStr(w.crit, 6),
                    atkTypes: Array.isArray(w.atkTypes) ? w.atkTypes.filter(a => WEAPON_ATK_TYPES.includes(a)) : [],
                    shape: isMap ? wdCleanStr(w.shape, 50) : '',
                    ammo:  isMap ? wdCleanStr(w.ammo, 6)   : '',
                    rangeMin: isMap ? '' : rmin,
                    rangeMax: isMap ? '' : rmax,
                    mp: WEAPON_MP_OPTS.includes(w.mp) ? w.mp : '',
                    attrs: Array.isArray(w.attrs) ? w.attrs.filter(a => WEAPON_ATTRS.includes(a)) : [],
                    effects: normalizeWeaponKindList(w.effects, WEAPON_EFFECT_TYPE_MAP, 'effects'),
                    limits:  normalizeWeaponKindList(w.limits,  WEAPON_LIMIT_TYPE_MAP,  'limits')
                };
            }
            const lv = String(w);
            return WEAPON_LEVELS.includes(lv)
                ? { level: lv, map: '', name: '', power: '', en: '', hit: '', crit: '', atkTypes: [],
                    shape: '', ammo: '', rangeMin: '', rangeMax: '', mp: '', attrs: [],
                    effects: [], limits: [] }
                : '-';
        };
        window.normalizeWeaponEntry._wf = true;
    }
}
 
/* ==================== 自動初始化 ==================== */
function initWeaponFilters() {
    installWeaponFilterHooks();
    buildWeaponFilterPanel();
    registerShapeAutocomplete();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWeaponFilters);
} else {
    initWeaponFilters();
}