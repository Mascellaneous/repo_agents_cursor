/* =====================================================================
 * forms.js — 表單開關、填充、收集、驗證、儲存
 * ---------------------------------------------------------------------

 * ===================================================================== */

/* ---------- 角色能力需求（多選）表單工作狀態 ----------
 * ABREQ[i] = { series:[], tag:[] }；logic 由 c-ab{i}logic 下拉直接讀取。 */
let ABREQ = {
    0: { series: [], tag: [] },          // 0＝契合度需求
    1: { series: [], tag: [] },
    2: { series: [], tag: [] },
    3: { series: [], tag: [] }
};
function resetABREQ() {
    for (let i = 0; i <= 3; i++) { ABREQ[i].series = []; ABREQ[i].tag = []; }
}
function loadABREQ(c) {
    resetABREQ();
    for (let i = 1; i <= 3; i++) {
        ABREQ[i].series = abReqArr(c['ab' + i + 'Series']);
        ABREQ[i].tag    = abReqArr(c['ab' + i + 'Tag']);
    }
    ABREQ[0].series = abReqArr(c.tagBonusSeries);   // 契合度（相容舊單值）
    ABREQ[0].tag    = abReqArr(c.tagBonusTag);
}
function updAbReqChips(i) {
    const el = gi(i === 0 ? 'c-tbreq-chips' : 'c-ab' + i + 'req-chips'); if (!el) return;
    const mk = (arr, kind, pre) => (arr || []).map(v =>
        `<span class="chip tag">${pre}${esc(v)}` +
        `<button type="button" class="sel-rm-abreq" data-i="${i}" data-kind="${kind}" data-v="${esc(v)}" title="移除此需求">✕</button></span>`).join('');
    el.innerHTML = mk(ABREQ[i].series, 'series', '系列：') + mk(ABREQ[i].tag, 'tag', '標籤：');
}

/* ---------- 共用小工具 ---------- */
function splitList(s) {
    return (s || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
}
function splitSeries(s) {
    return (s || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
}
function numVal(id) {
    const v = gi(id) ? gi(id).value : '';
    if (v === '') return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
}
 
/* ---------- 圖片路徑正規化 ----------
 * 支援：http(s)://、//、data: URI、/ 根路徑、相對路徑、純檔名（依類型自動補子資料夾）、
 *       Windows 絕對路徑（含專案資料夾名稱時自動切出相對段落）。
 * type：'units' / 'characters' / 'supports' → 決定純檔名要補進哪個子資料夾；
 *       未傳或傳入未知值時退回 images/（相容舊呼叫端行為）。 */
const IMAGE_SUBDIR = {
    units:      'images/units/',
    characters: 'images/characters/',
    supports:   'images/supports/'
};
function normalizeImagePath(raw, type) {
    if (!raw) return '';
    let p = raw.trim().replace(/^file:\/\//i, '').replace(/\\/g, '/');
 
    // 1. 若是 C:/.../sdg-ggen-eternal/images/... → 切出相對段落
    const projectFolder = 'sdg-ggen-eternal';
    const idx = p.toLowerCase().indexOf(projectFolder.toLowerCase() + '/');
    if (idx >= 0) p = p.slice(idx + projectFolder.length + 1);
 
    // 2. http(s)://、//、data: URI、/ 根路徑 → 原樣保留
    if (/^(https?:)?\/\//i.test(p) || p.startsWith('data:') || p.startsWith('/')) return p;
 
    // 3. 去除開頭的 ./
    p = p.replace(/^\.\//, '');
 
    // 4. 純檔名（無資料夾）→ 依記錄類型補上對應子資料夾
    //    units → images/units/XXX.webp、characters → images/characters/YYY.webp、
    //    supports → images/supports/ZZZ.webp
    if (!p.includes('/')) {
        p = (IMAGE_SUBDIR[type] || 'images/') + p;
    }
    // 5. 已含資料夾的路徑（images/units/…、自訂相對路徑、舊格式 images/XXX.webp）
    //    → 一律原樣保留，不自動改寫子資料夾
    return p;
}
 
/* ---------- 靜態下拉（地形／武裝等級）— 只填一次 ---------- */
function populateStaticSelects() {
    document.querySelectorAll('select.trsel').forEach(sel => {
        if (sel.options.length) return;
        sel.innerHTML = Object.keys(TERRAIN_OPTS)
            .map(v => `<option value="${esc(v)}" title="${v === 'O' ? '良好' : (v === '△' ? '可（弱）' : '不可')}">${esc(v)}</option>`)
            .join('');
    });
    document.querySelectorAll('select.wsel').forEach(sel => {
        if (sel.options.length) return;
        sel.innerHTML = WEAPON_OPTS.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    });
}
 
/* ---------- 初始化（main.js 於載入時呼叫一次） ---------- */
function initForms() {
    if (gi('form-units') && gi('form-units')._bound) return;
 
    populateStaticSelects();
    initWeaponDetails();                       // weapon-details.js
 
    /* 可搜尋下拉：變型後機體 / 逃生後單位（排除正在編輯的單位本身）
     * ★ 選項顯示「名稱（稀有度・Lv.等級）」— 使用者選擇時可辨識目標單位 */
    const unitPool = () => (cache.units || [])
        .filter(u => u.id !== EDIT.units)
        .map(u => ({
            v: u.id,
            label: `${u.name}（${u.rarity || '?'}・${u.type ?? '?'}・Lv.${u.level ?? '?'}）`
        }));
 
    initSearchCombo({
        selId: 'u-tname', inpId: 'u-tname-inp', pool: unitPool,
        placeholder: '🔍 搜尋要變型成的單位…',
        hint: '從現有單位中選擇（選項附稀有度與等級）。變型目標會精確對應到該筆資料；對方改名後此處顯示會自動更新。'
    });
    initSearchCombo({
        selId: 'u-ename', inpId: 'u-ename-inp', pool: unitPool,
        placeholder: '🔍 搜尋逃生後的單位…',
        hint: '從現有單位中選擇（選項附稀有度與等級）。逃生目標會精確對應到該筆資料；對方改名後此處顯示會自動更新。'
    });
 
    /* submit 綁定（HTML 表單未寫 onsubmit，統一在此處理） */
    gi('form-units').addEventListener('submit', e => { e.preventDefault(); saveUnit(); });
    gi('form-characters').addEventListener('submit', e => { e.preventDefault(); saveChar(); });
    gi('form-supports').addEventListener('submit', e => { e.preventDefault(); saveSupport(); });
    if (gi('form-units')) gi('form-units')._bound = true;
}
 
/* ---------- 表單顯示／隱藏 ---------- */
function showForm(type, title) {
    gi('ft-' + type).textContent = title;
    gi('sec-' + type).classList.remove('hidden');
    gi('sec-' + type).scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideForm(type) {
    gi('form-' + type).reset();
    EDIT[type] = null;
    if (type === 'units') {
        refreshCombo('u-tname', '');
        refreshCombo('u-ename', '');
        refreshWeaponDetails({});
    }
    gi('sec-' + type).classList.add('hidden');
}
function cancelForm(type) { hideForm(type); }
 
/* ---------- 可變型／逃生機能：啟用／停用對應下拉 ---------- */
function updTrans() {
    const on = fv('u-trans') === 'Y';
    setComboDisabled('u-tname', !on);
    if (!on) refreshCombo('u-tname', '');
}
function updEscape() {
    const on = fv('u-escape') === 'Y';
    setComboDisabled('u-ename', !on);
    if (!on) refreshCombo('u-ename', '');
}
 
/* ---------- 獲得順序 ----------
 * 有填手動值 → 採用手動值；否則新記錄排到目前最大值之後。
 * ★ 結尾會 inv(type) 清空快取 → 變型／逃生目標解析必須在本函式「之前」完成。 */
const ACQ_INPUT = { units: 'u-acq', characters: 'c-acq', supports: 's-acq' };
async function ensureUniqueAcqOrder(type, item) {
    const inp = gi(ACQ_INPUT[type]);
    const manual = inp ? parseInt(inp.value, 10) : NaN;
    if (!isNaN(manual) && manual > 0) {
        item.acqOrder = manual;
    } else if (!(typeof item.acqOrder === 'number' && item.acqOrder > 0)) {
        const all = await getAll(type);
        const max = all.reduce((m, x) =>
            Math.max(m, (typeof x.acqOrder === 'number' && x.acqOrder > 0) ? x.acqOrder : 0), 0);
        item.acqOrder = max + 1;
    }
    inv(type);
    return item;
}
 
/* ================= 單位 ================= */
async function openUnitForm() {
    EDIT.units = null;
    gi('u-id').value = '';
    gi('form-units').reset();
    TERRAINS.forEach(([_, k]) => { const el = gi('u-tr_' + k); if (el) el.value = '-'; });
    refreshCombo('u-tname', ''); setComboDisabled('u-tname', true);
    refreshCombo('u-ename', ''); setComboDisabled('u-ename', true);
    refreshWeaponDetails({});
    showForm('units', '新增單位');
}
 
async function editUnit(id) {
    const u = (await getAll('units')).find(x => x.id === id);
    if (!u) { showToast('找不到該筆單位資料', true); return; }
    EDIT.units = id;
    gi('u-id').value = u.id;
    gi('u-name').value = u.name || '';
    gi('u-image').value = u.image || '';
    gi('u-series').value = (u.series || []).join(', ');
    gi('u-tags').value = (u.tags || []).join(', ');
    gi('u-rarity').value = u.rarity || '';
    gi('u-type').value = u.type || '';
    gi('u-mob').value = (u.mobility ?? 0);
    gi('u-lvl').value = (u.level ?? 1);
    gi('u-lim').value = String(u.limitBreak ?? 0);
    gi('u-acq').value = (typeof u.acqOrder === 'number' && u.acqOrder > 0) ? u.acqOrder : '';
    gi('u-shield').value = u.shield || 'N';
    gi('u-size').value = u.size2x2 || 'N';
    gi('u-sp').value = u.sp || 'N';
    gi('u-ssp').value = u.ssp || 'N';
    gi('u-ltd').value = u.limited || 'N';
    gi('u-trans').value = u.transformable || 'N';
    gi('u-escape').value = u.escape || 'N';
    gi('u-src').value = u.src || '';
    /* 變型／逃生目標：優先 ID；舊資料僅有名稱 → 'name:' 暫代值 */
    refreshCombo('u-tname', u.transformedId || (u.transformedName ? 'name:' + u.transformedName : ''));
    refreshCombo('u-ename', u.escapedId || (u.escapedName ? 'name:' + u.escapedName : ''));
    setComboDisabled('u-tname', gi('u-trans').value !== 'Y');
    setComboDisabled('u-ename', gi('u-escape').value !== 'Y');
    TERRAINS.forEach(([_, k]) => {
        const el = gi('u-tr_' + k);
        if (el) el.value = (u.terrain && u.terrain[k]) || '-';
    });
    refreshWeaponDetails(u.weapons || {});
    gi('u-comments').value = u.comments || '';
    showForm('units', '編輯單位 — ' + (u.name || ''));
}
 
/* 解析下拉值 → { id, name }；'name:xxx' 為舊資料暫代（僅名稱）。
 * ★ 必須在 ensureUniqueAcqOrder() 之前呼叫（依賴尚未清空的單位快取）。 */
function resolveTargetRef(selId) {
    const v = fv(selId);
    if (!v) return { id: null, name: '' };
    if (String(v).startsWith('name:')) return { id: null, name: String(v).slice(5) };
    const u = getUnitById(v);
    return u ? { id: u.id, name: u.name } : { id: null, name: '' };
}
 
function collectUnitFromForm() {
    const u = {
        name: gi('u-name').value.trim(),
        image: normalizeImagePath(gi('u-image').value, 'units'),
        series: splitSeries(gi('u-series').value),
        tags: splitList(gi('u-tags').value),
        rarity: gi('u-rarity').value,
        type: gi('u-type').value,
        mobility: parseInt(gi('u-mob').value, 10) || 0,
        level: parseInt(gi('u-lvl').value, 10) || 1,
        limitBreak: parseInt(gi('u-lim').value, 10) || 0,
        shield: gi('u-shield').value,
        size2x2: gi('u-size').value,
        sp: gi('u-sp').value,
        ssp: gi('u-ssp').value,
        limited: gi('u-ltd').value,
        transformable: gi('u-trans').value,
        escape: gi('u-escape').value,
        src: gi('u-src').value || '',
        comments: gi('u-comments').value.trim(),
        terrain: {},
        weapons: collectWeapons()          // weapon-details.js：含 MAP兵器／射程／MP／屬性
    };
    TERRAINS.forEach(([_, k]) => { u.terrain[k] = gi('u-tr_' + k).value || '-'; });
    return u;
}
 
async function saveUnit() {
    const u = collectUnitFromForm();
    if (!u.name)   { showToast('請輸入名稱', true); return; }
    if (!u.rarity) { showToast('請選擇稀有度', true); return; }
    if (!u.type)   { showToast('請選擇類型', true); return; }
 
    const editingId = gi('u-id').value || null;
 
    /* ★ 先解析變型／逃生目標（需使用單位快取；ensureUniqueAcqOrder 會清空快取） */
    const tRef = resolveTargetRef('u-tname');
    const eRef = resolveTargetRef('u-ename');
    u.transformedId   = (u.transformable === 'Y') ? tRef.id   : null;
    u.transformedName = (u.transformable === 'Y') ? tRef.name : '';
    u.escapedId       = (u.escape === 'Y')        ? eRef.id   : null;
    u.escapedName     = (u.escape === 'Y')        ? eRef.name : '';
 
    if (editingId) {
        const old = (await getAll('units')).find(x => x.id === editingId);
        if (!old) { showToast('原資料已不存在，請重新整理後再試', true); return; }
        const item = { ...old, ...u, id: editingId, date_added: old.date_added };
        await ensureUniqueAcqOrder('units', item);
        await saveItem('units', item);            // → scheduleAutoSync('save-units')
        showToast('單位已更新：' + item.name);
    } else {
        const item = { id: uid('u'), date_added: new Date().toISOString(), ...u };
        await ensureUniqueAcqOrder('units', item);
        await saveItem('units', item);
        showToast('單位已新增：' + item.name);
    }
    hideForm('units');
    RENDER.units();
}
 
/* ================= 角色 ================= */
async function openCharForm() {
    EDIT.characters = null;
    gi('c-id').value = '';
    gi('form-characters').reset();
    refreshAbReqSelects();
    resetABREQ();                                  // 清空需求暫存（含契合度）
    for (let i = 0; i <= 3; i++) updAbReqChips(i); // chips 清空
    showForm('characters', '新增角色');
}
 
async function editCharacter(id) {
    const c = (await getAll('characters')).find(x => x.id === id);
    if (!c) { showToast('找不到該筆角色資料', true); return; }
    EDIT.characters = id;
    gi('c-id').value = c.id;
    gi('c-name').value = c.name || '';
    gi('c-image').value = c.image || '';
    gi('c-series').value = (c.series || []).join(', ');
    gi('c-tags').value = (c.tags || []).join(', ');
    gi('c-rarity').value = c.rarity || '';
    gi('c-type').value = c.type || '';
    gi('c-sp').value = c.sp || 'N';
    gi('c-lvl').value = (c.level ?? 1);
    gi('c-acq').value = (typeof c.acqOrder === 'number' && c.acqOrder > 0) ? c.acqOrder : '';
    gi('c-shoot').value  = c.shoot  ?? '';
    gi('c-melee').value  = c.melee  ?? '';
    gi('c-awaken').value = c.awaken ?? '';
    gi('c-defend').value = c.defend ?? '';
    gi('c-react').value  = c.react  ?? '';
    gi('c-sk1').value = c.sk1 || ''; gi('c-sk2').value = c.sk2 || ''; gi('c-sk3').value = c.sk3 || '';
    gi('c-ab1').value = c.ab1 || ''; gi('c-ab2').value = c.ab2 || ''; gi('c-ab3').value = c.ab3 || '';
    loadABREQ(c);                                   // 多選需求回填（相容舊單值）
    for (let i = 1; i <= 3; i++) {
        gi('c-ab' + i + 'logic').value = (c['ab' + i + 'Logic'] === 'OR') ? 'OR' : 'AND';
        updAbReqChips(i);
    }
    gi('c-tblogic').value = (c.tagBonusLogic === 'OR') ? 'OR' : 'AND';
    updAbReqChips(0);     
    gi('c-tagbonus').value = c.tagBonus || '';
    gi('c-tagbonuseff').value = c.tagBonusEffect || '';
    showForm('characters', '編輯角色 — ' + (c.name || ''));
}
/* 別名（相容不同呼叫端） */
function editChar(id) { return editCharacter(id); }
 
function collectCharFromForm() {
    return {
        name: gi('c-name').value.trim(),
        image: normalizeImagePath(gi('c-image').value, 'characters'),
        series: splitSeries(gi('c-series').value),
        tags: splitList(gi('c-tags').value),
        rarity: gi('c-rarity').value,
        type: gi('c-type').value,
        sp: gi('c-sp').value,
        level: parseInt(gi('c-lvl').value, 10) || 1,
        shoot: numVal('c-shoot'), melee: numVal('c-melee'), awaken: numVal('c-awaken'),
        defend: numVal('c-defend'), react: numVal('c-react'),
        sk1: gi('c-sk1').value.trim(), sk2: gi('c-sk2').value.trim(), sk3: gi('c-sk3').value.trim(),
        ab1: gi('c-ab1').value.trim(), ab2: gi('c-ab2').value.trim(), ab3: gi('c-ab3').value.trim(),
        ab1Series: [...ABREQ[1].series], ab1Tag: [...ABREQ[1].tag], ab1Logic: gi('c-ab1logic').value,
        ab2Series: [...ABREQ[2].series], ab2Tag: [...ABREQ[2].tag], ab2Logic: gi('c-ab2logic').value,
        ab3Series: [...ABREQ[3].series], ab3Tag: [...ABREQ[3].tag], ab3Logic: gi('c-ab3logic').value,
        tagBonusSeries: [...ABREQ[0].series], tagBonusTag: [...ABREQ[0].tag], tagBonusLogic: gi('c-tblogic').value,
        tagBonus: gi('c-tagbonus').value.trim(),
        tagBonusEffect: gi('c-tagbonuseff').value.trim()
    };
}
 
async function saveChar() {
    const c = collectCharFromForm();
    if (!c.name)   { showToast('請輸入名稱', true); return; }
    if (!c.rarity) { showToast('請選擇稀有度', true); return; }
    if (!c.type)   { showToast('請選擇類型', true); return; }
    const editingId = gi('c-id').value || null;
    if (editingId) {
        const old = (await getAll('characters')).find(x => x.id === editingId);
        if (!old) { showToast('原資料已不存在，請重新整理後再試', true); return; }
        const item = { ...old, ...c, id: editingId, date_added: old.date_added };
        await ensureUniqueAcqOrder('characters', item);
        await saveItem('characters', item);       // → scheduleAutoSync('save-characters')
        showToast('角色已更新：' + item.name);
    } else {
        const item = { id: uid('c'), date_added: new Date().toISOString(), ...c };
        await ensureUniqueAcqOrder('characters', item);
        await saveItem('characters', item);
        showToast('角色已新增：' + item.name);
    }
    hideForm('characters');
    RENDER.characters();
}
 
/* ================= 支援單位 ================= */
async function openSupportForm() {
    EDIT.supports = null;
    gi('s-id').value = '';
    gi('form-supports').reset();
    showForm('supports', '新增支援單位');
}
 
async function editSupport(id) {
    const s = (await getAll('supports')).find(x => x.id === id);
    if (!s) { showToast('找不到該筆支援單位資料', true); return; }
    EDIT.supports = id;
    gi('s-id').value = s.id;
    gi('s-name').value = s.name || '';
    gi('s-image').value = s.image || '';
    gi('s-acq').value = (typeof s.acqOrder === 'number' && s.acqOrder > 0) ? s.acqOrder : '';
    gi('s-lvl').value = (s.level ?? 1);
    showForm('supports', '編輯支援單位 — ' + (s.name || ''));
}
 
function collectSupportFromForm() {
    return {
        name: gi('s-name').value.trim(),
        image: normalizeImagePath(gi('s-image').value, 'supports'),
        level: parseInt(gi('s-lvl').value, 10) || 1
    };
}
 
async function saveSupport() {
    const s = collectSupportFromForm();
    if (!s.name) { showToast('請輸入名稱', true); return; }
    const editingId = gi('s-id').value || null;
    if (editingId) {
        const old = (await getAll('supports')).find(x => x.id === editingId);
        if (!old) { showToast('原資料已不存在，請重新整理後再試', true); return; }
        const item = { ...old, ...s, id: editingId, date_added: old.date_added };
        await ensureUniqueAcqOrder('supports', item);
        await saveItem('supports', item);         // → scheduleAutoSync('save-supports')
        showToast('支援單位已更新：' + item.name);
    } else {
        const item = { id: uid('s'), date_added: new Date().toISOString(), ...s };
        await ensureUniqueAcqOrder('supports', item);
        await saveItem('supports', item);
        showToast('支援單位已新增：' + item.name);
    }
    hideForm('supports');
    RENDER.supports();
}