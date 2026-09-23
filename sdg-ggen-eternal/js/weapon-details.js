/* =====================================================================
 * weapon-details.js — 武裝詳細設定
 *   （名稱／POWER／EN消耗／命中／爆擊／分類／MAP兵器／形狀／彈藥量／
 *     最短·最長射程／MP要求／屬性／武裝效果／使用限制）
 * ---------------------------------------------------------------------
 * ・weapons[i] = '-' 或
 *     { level:'1'..'5',
 *       name:'', power:'', en:'', hit:'', crit:'',       ★ 空字串＝未設定
 *       atkTypes:['射擊','格鬥','覺醒'] 子集合,            ★ 空 = 未設定
 *       map:''|'Y'|'N', shape:'…（僅 MAP兵器=Y）',
 *       ammo:'…（僅 MAP兵器=Y；彈藥量）',
 *       rangeMin/rangeMax:''|'1'..'6'（非 MAP兵器）,
 *       mp:''|'需要超強勢'|'需要超一擊'|'沒有MP要求',
 *       attrs:['物理','鐳射','特殊'] 子集合,
 *       effects:[{ type, pct }…],    ★ 名稱由 weapon-effect-types.js 統一提供
 *       limits:[{ type, pct }…] }
 * ・效果／限制項目＝類型下拉＋數值（視類型）＋✕；名稱不在表單編輯，
 *   顯示名稱由 weapon-effect-types.js 的對照表決定（跨單位自動一致）。
 * ・★ 錯誤修正：refreshWeaponDetails() 先前漏了還原「MP要求」下拉，
 *   導致重開表單一律顯示「未設定」，且再儲存會把已存的 MP要求清空。
 *   現已補上還原（連同新增的彈藥量）。
 * ・舊格式相容：缺欄位視為未設定；僅有 range → 開表單帶入 1–range；
 *   舊格式項目自帶的 name 讀取時略過。
 * ・API：initWeaponDetails() / updWeaponDetails() / refreshWeaponDetails() /
 *        collectWeapons() / updWeaponMapMode(i) / wdAddKind(i,kind)
 * ===================================================================== */
 
function wdOptions(opts) {
    return opts.map(o => `<option value="${esc(o)}">${o === '' ? '未設定' : esc(o)}</option>`).join('');
}
 
/* ---------- 建立 DOM ---------- */
function wdBlockHtml(i) {
    const attrCbs = WEAPON_ATTRS.map(a =>
        `<label class="wd-attr"><input type="checkbox" class="wattr" data-w="${i}" value="${esc(a)}">${esc(a)}</label>`).join('');
    const atkCbs = WEAPON_ATK_TYPES.map(a =>
        `<label class="wd-attr"><input type="checkbox" class="watk" data-w="${i}" value="${esc(a)}">${esc(a)}</label>`).join('');
    return `
    <div class="wdblock" id="wd-row-${i}" style="display:none;flex-direction:column;gap:5px;border:1px solid #cfcfcf;border-radius:6px;padding:6px 8px;margin-bottom:6px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <span class="wd-lv" style="font-weight:bold;">武裝${i}</span>
            <label>MAP兵器
                <select id="u-w${i}-map">${wdOptions(WEAPON_MAP_OPTS)}</select></label>
            <span id="wd-shape-wrap-${i}" style="display:none;position:relative;">
                <label>形狀
                    <input type="text" id="u-w${i}-shape" data-ac="wshape" maxlength="50"
                           placeholder="例：直線／扇形…" style="width:120px;"></label>
            </span>
            <span id="wd-ammo-wrap-${i}" style="display:none;">
                <label>彈藥量
                    <input type="text" id="u-w${i}-ammo" maxlength="6" placeholder="未設定" style="width:52px;"></label>
            </span>
            <span id="wd-range-wrap-${i}">
                <label>最短射程
                    <select id="u-w${i}-rmin" style="width:64px;">${wdOptions(WEAPON_RANGE_OPTS)}</select></label>
                <label>最長射程
                    <select id="u-w${i}-rmax" style="width:64px;">${wdOptions(WEAPON_RANGE_OPTS)}</select></label>
            </span>
            <label>MP要求
                <select id="u-w${i}-mp">${wdOptions(WEAPON_MP_OPTS)}</select></label>
            <span class="wd-attrs">屬性：${attrCbs}<span class="wd-none" id="wd-none-${i}">未設定</span></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <label>名稱
                <input type="text" id="u-w${i}-name" maxlength="40" placeholder="未設定" style="width:130px;"></label>
            <label>POWER
                <input type="text" id="u-w${i}-power" maxlength="10" placeholder="未設定" style="width:64px;"></label>
            <label>EN消耗
                <input type="text" id="u-w${i}-en" maxlength="6" placeholder="未設定" style="width:52px;"></label>
            <label>命中
                <input type="text" id="u-w${i}-hit" maxlength="6" placeholder="未設定" style="width:52px;"></label>
            <label>爆擊
                <input type="text" id="u-w${i}-crit" maxlength="6" placeholder="未設定" style="width:52px;"></label>
            <span class="wd-attrs">分類：${atkCbs}<span class="wd-none" id="wd-atk-none-${i}">未設定</span></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start;">
            <span style="font-weight:bold;font-size:11px;line-height:22px;">效果：</span>
            <span id="wd-eff-list-${i}" data-kind="effects" style="display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0;"></span>
            <button type="button" class="btn btn-info btn-sm" onclick="wdAddKind(${i},'effects')" title="加入一項武裝效果">＋</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start;">
            <span style="font-weight:bold;font-size:11px;line-height:22px;">限制：</span>
            <span id="wd-lim-list-${i}" data-kind="limits" style="display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0;"></span>
            <button type="button" class="btn btn-info btn-sm" onclick="wdAddKind(${i},'limits')" title="加入一項使用限制">＋</button>
        </div>
    </div>`;
}
 
/* 效果／限制單一項目：類型下拉＋數值（視類型）＋✕（名稱由類型對照表統一） */
function wdKindSelectHtml(kind, sel) {
    const types = kind === 'limits' ? WEAPON_LIMIT_TYPES : WEAPON_EFFECT_TYPES;
    return '<select class="wdk-type" style="max-width:200px;font-size:11px;" onchange="wdKindTypeChanged(this)">' +
        '<option value="">未設定</option>' +
        types.map(t => `<option value="${t.code}"${t.code === sel ? ' selected' : ''}>${esc(t.label)}</option>`).join('') +
        '</select>';
}
function wdKindItemHtml(kind, d) {
    d = d || {};
    const types = kind === 'limits' ? WEAPON_LIMIT_TYPES : WEAPON_EFFECT_TYPES;
    const t = types.find(x => x.code === d.type);
    const hasPct = !!(t && t.pct);
    const pctMax = t ? Math.pow(10, t.digits || 2) - 1 : 999;
    return `<span class="wdk" style="display:inline-flex;align-items:center;gap:3px;position:relative;border:1px solid #c8c8c8;border-radius:4px;padding:1px 4px;font-size:11px;background:#f7f7f7;">` +
        wdKindSelectHtml(kind, d.type) +
        `<input type="number" class="wdk-pct" min="1" max="${pctMax}" placeholder="${t && t.pct ? (t.unit || '%') : '%'}" value="${d.pct != null ? esc(d.pct) : ''}" style="width:54px;font-size:11px;${hasPct ? '' : 'display:none;'}">` +
        `<button type="button" class="btn btn-danger btn-sm" style="padding:0 5px;line-height:16px;" onclick="wdRemoveKind(this)" title="移除此項目">✕</button>` +
        `</span>`;
}
 
/* 建立五組武裝詳細控制項（只執行一次） */
function initWeaponDetails() {
    const box = gi('wd-container');
    if (!box || box._wdInit) return;
    box._wdInit = true;
    box.innerHTML = [1, 2, 3, 4, 5].map(i => wdBlockHtml(i)).join('');
 
    /* 屬性／分類勾選 → 同步「未設定」提示 */
    box.addEventListener('change', e => {
        const cb = e.target.closest('.wattr');
        if (cb) { updWdAttrNone(cb.dataset.w); return; }
        const ab = e.target.closest('.watk');
        if (ab) updWdAtkNone(ab.dataset.w);
    });
    /* 武裝等級改變 → 顯示／隱藏詳細區塊；MAP兵器改變 → 切換「形狀／彈藥量／射程」 */
    [1, 2, 3, 4, 5].forEach(i => {
        const sel = gi('u-w' + i);
        if (sel) sel.addEventListener('change', updWeaponDetails);
        const msel = gi('u-w' + i + '-map');
        if (msel) msel.addEventListener('change', () => updWeaponMapMode(i));
    });
    /* 綁定區塊內 data-ac 欄位（形狀；setupAC 有 _acBound 防重綁） */
    if (typeof setupAC === 'function') setupAC(box);
}
 
function updWdAttrNone(i) {
    const any = document.querySelector(`.wattr[data-w="${i}"]:checked`);
    const none = gi('wd-none-' + i);
    if (none) none.style.display = any ? 'none' : '';
}
function updWdAtkNone(i) {
    const any = document.querySelector(`.watk[data-w="${i}"]:checked`);
    const none = gi('wd-atk-none-' + i);
    if (none) none.style.display = any ? 'none' : '';
}
 
/* MAP兵器＝Y → 顯示「形狀＋彈藥量」並隱藏射程；否則顯示射程並隱藏形狀／彈藥量 */
function updWeaponMapMode(i) {
    const isMap = fv('u-w' + i + '-map') === 'Y';
    const sh = gi('wd-shape-wrap-' + i);
    const am = gi('wd-ammo-wrap-' + i);
    const rg = gi('wd-range-wrap-' + i);
    if (sh) sh.style.display = isMap ? '' : 'none';
    if (am) am.style.display = isMap ? '' : 'none';
    if (rg) rg.style.display = isMap ? 'none' : '';
}
 
/* 依目前「武裝等級」下拉顯示／隱藏各武裝的詳細設定區塊 */
function updWeaponDetails() {
    let any = false;
    for (let i = 1; i <= 5; i++) {
        const lv = fv('u-w' + i);
        const row = gi('wd-row-' + i);
        const show = lv && lv !== '-';
        if (row) row.style.display = show ? 'flex' : 'none';
        if (show) any = true;
    }
    const empty = gi('wd-empty');
    if (empty) empty.style.display = any ? 'none' : '';
}
 
/* ---------- 效果／限制項目操作 ---------- */
function wdListId(i, kind) { return 'wd-' + (kind === 'limits' ? 'lim' : 'eff') + '-list-' + i; }
 
function wdRenderKinds(i, kind, arr) {
    const list = gi(wdListId(i, kind));
    if (!list) return;
    const items = Array.isArray(arr) ? arr : [];
    list.innerHTML = items.map(d => wdKindItemHtml(kind, d)).join('');
}
function wdAddKind(i, kind) {
    const list = gi(wdListId(i, kind));
    if (!list) return;
    list.insertAdjacentHTML('beforeend', wdKindItemHtml(kind, null));
}
function wdRemoveKind(btn) {
    const item = btn.closest('.wdk');
    if (item) item.remove();
}
/* 類型改變 → 顯示／隱藏數值欄並調整上限與單位 */
function wdKindTypeChanged(sel) {
    const item = sel.closest('.wdk');
    const pct = item ? item.querySelector('.wdk-pct') : null;
    if (!pct) return;
    const t = WEAPON_EFFECT_TYPE_MAP[sel.value] || WEAPON_LIMIT_TYPE_MAP[sel.value];
    pct.style.display = (t && t.pct) ? '' : 'none';
    if (t && t.pct) {
        pct.placeholder = t.unit || '%';
        pct.max = Math.pow(10, t.digits) - 1;
    } else {
        pct.value = '';
    }
}
 
/* ---------- 開表單：以資料填充（weapons 為空／新舊格式皆可） ---------- */
function refreshWeaponDetails(weapons) {
    weapons = weapons || {};
    for (let i = 1; i <= 5; i++) {
        const w = weapons[i];
        const lv = weaponLevelOf(w);
        const lvSel = gi('u-w' + i);
        if (lvSel) lvSel.value = lv;
        const obj = (w && typeof w === 'object') ? w : {};
        const mapSel = gi('u-w' + i + '-map');
        if (mapSel) mapSel.value = (obj.map === 'Y' || obj.map === 'N') ? obj.map : '';
        const shInp = gi('u-w' + i + '-shape');
        if (shInp) shInp.value = obj.shape || '';
        const amInp = gi('u-w' + i + '-ammo');
        if (amInp) amInp.value = obj.ammo || '';
        /* ★ MP要求還原（先前漏掉 → 重開表單顯示「未設定」，再儲存會清空已存值） */
        const mpSel = gi('u-w' + i + '-mp');
        if (mpSel) mpSel.value = WEAPON_MP_OPTS.includes(obj.mp) ? obj.mp : '';
        /* 射程：新格式 rangeMin／rangeMax；舊格式僅有 range → 帶入 1–range */
        let rmin = String(obj.rangeMin ?? '');
        let rmax = String(obj.rangeMax ?? '');
        if (rmin === '' && rmax === '' && obj.range != null && obj.range !== '') {
            rmax = String(obj.range);
            rmin = '1';
        }
        const mnSel = gi('u-w' + i + '-rmin');
        if (mnSel) mnSel.value = WEAPON_RANGE_OPTS.includes(rmin) ? rmin : '';
        const mxSel = gi('u-w' + i + '-rmax');
        if (mxSel) mxSel.value = WEAPON_RANGE_OPTS.includes(rmax) ? rmax : '';
        const setV = (id, v) => { const el = gi(id); if (el) el.value = v; };
        setV('u-w' + i + '-name',  obj.name  || '');
        setV('u-w' + i + '-power', obj.power || '');
        setV('u-w' + i + '-en',    obj.en    || '');
        setV('u-w' + i + '-hit',   obj.hit   || '');
        setV('u-w' + i + '-crit',  obj.crit  || '');
        document.querySelectorAll(`.wattr[data-w="${i}"]`).forEach(c => {
            c.checked = Array.isArray(obj.attrs) && obj.attrs.includes(c.value);
        });
        document.querySelectorAll(`.watk[data-w="${i}"]`).forEach(c => {
            c.checked = Array.isArray(obj.atkTypes) && obj.atkTypes.includes(c.value);
        });
        updWdAttrNone(i);
        updWdAtkNone(i);
        /* 效果／限制：只取 type 與 pct（舊格式自帶的 name 一律略過） */
        wdRenderKinds(i, 'effects', Array.isArray(obj.effects) ? obj.effects : []);
        wdRenderKinds(i, 'limits',  Array.isArray(obj.limits)  ? obj.limits  : []);
        updWeaponMapMode(i);
    }
    updWeaponDetails();
}
 
/* ---------- 儲存：收集所有武裝控制項 ---------- */
function wdCollectKinds(i, kind) {
    const list = gi(wdListId(i, kind));
    if (!list) return [];
    const types = kind === 'limits' ? WEAPON_LIMIT_TYPES : WEAPON_EFFECT_TYPES;
    const out = [];
    list.querySelectorAll('.wdk').forEach(item => {
        const type = item.querySelector('.wdk-type').value;
        if (!type) return;                                   // 未選類型 → 不儲存
        const t = types.find(x => x.code === type);
        let pct = null;
        if (t && t.pct) {
            const raw = item.querySelector('.wdk-pct').value;
            if (raw !== '') {
                const n = parseInt(raw, 10);
                if (!isNaN(n) && n >= 1) pct = n;
            }
        }
        out.push({ type, pct });                             // 名稱由類型對照表統一提供
    });
    return out;
}
 
function collectWeapons() {
    const w = {};
    for (let i = 1; i <= 5; i++) {
        const lv = fv('u-w' + i) || '-';
        if (lv === '-') { w[i] = '-'; continue; }
        const map = fv('u-w' + i + '-map');
        const isMap = map === 'Y';
        w[i] = {
            level: lv,
            map: map,
            name:  fv('u-w' + i + '-name'),
            power: fv('u-w' + i + '-power'),
            en:    fv('u-w' + i + '-en'),
            hit:   fv('u-w' + i + '-hit'),
            crit:  fv('u-w' + i + '-crit'),
            atkTypes: [...document.querySelectorAll(`.watk[data-w="${i}"]:checked`)].map(c => c.value),
            shape: isMap ? fv('u-w' + i + '-shape') : '',
            ammo:  isMap ? fv('u-w' + i + '-ammo')  : '',
            rangeMin: isMap ? '' : fv('u-w' + i + '-rmin'),
            rangeMax: isMap ? '' : fv('u-w' + i + '-rmax'),
            mp: fv('u-w' + i + '-mp'),
            attrs: [...document.querySelectorAll(`.wattr[data-w="${i}"]:checked`)].map(c => c.value),
            effects: wdCollectKinds(i, 'effects'),
            limits:  wdCollectKinds(i, 'limits')
        };
    }
    return w;
}