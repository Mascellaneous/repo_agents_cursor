/* =====================================================================
 * ui.js — 分頁切換、系列選單、深色模式、標籤篩選視窗（雙欄＋AND/OR＋排除）
 * ---------------------------------------------------------------------
 * ★ 本次改動：
 *   1. 標籤篩選支援「排除標籤」（TAG_FILTER_EXCLUDE）：視窗中每個標籤
 *      附 ⊘ 排除切換鈕；被排除的標籤會隱藏具備該標籤的資料（優先於
 *      包含條件）。面板摘要同時顯示包含（AND/OR）與排除（⊘ 紅色）標籤。
 *   2. clearU() 重置新增的「逃生機能」（fu-escape）篩選。
 * ===================================================================== */
function switchTab(t) {
    currentTab = t;
    TYPES.forEach(x => {
        gi('tabbtn-' + x).classList.toggle('active', x === t);
        gi('tab-' + x).classList.toggle('active', x === t);
    });
    RENDER[t]();
}
async function refreshSeriesOptions() {
    const arr = poolSeries();
    [['fu-series'], ['fc-series']].forEach(([id]) => {
        const el = gi(id); if (!el) return;
        const cur = el.value;
        el.innerHTML = '<option value="">全部</option>' +
            arr.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        if ([...el.options].some(o => o.value === cur)) el.value = cur;
    });
    refreshTagOptions();
    refreshAbReqSelects();
}
 
/* =========================================================
 * ★ 標籤篩選 — 生效狀態維護與面板摘要（含排除標籤）
 * ========================================================= */
function refreshTagOptions() {
    ['units', 'characters'].forEach(t => {
        const pool = new Set(poolTags(t));
        TAG_FILTER_STATE[t] = new Set([...TAG_FILTER_STATE[t]].filter(x => pool.has(x)));
        TAG_FILTER_EXCLUDE[t] = new Set([...TAG_FILTER_EXCLUDE[t]].filter(x => pool.has(x)));
        updateTagSummary(t);
    });
}
function tagSummaryId(t) { return (t === 'units' ? 'fu' : 'fc') + '-tags-summary'; }
 
/* 面板摘要：已選 N ＋ AND/OR 徽章 ＋ 各標籤 chip（✕ 移除單一）
 * ＋ 排除標籤（⊘ 紅色 chip，✕ 移除單一） */
function updateTagSummary(t) {
    const el = gi(tagSummaryId(t)); if (!el) return;
    const arr = [...TAG_FILTER_STATE[t]];
    const exc = [...TAG_FILTER_EXCLUDE[t]];
    const mode = TAG_FILTER_MODE[t];
    let html = '';
    if (arr.length) {
        html += `<span class="ts-label">已選 ${arr.length}</span>` +
          `<button type="button" class="ts-mode" data-type="${t}" ` +
          `title="點擊切換 AND／OR 邏輯">${mode === 'AND' ? 'AND・且' : 'OR・或'}</button>` +
          `<span class="ts-sep">：</span>` +
          arr.map(tag =>
              `<span class="chip tag sel-chip">${esc(tag)}` +
              `<button type="button" class="sel-rm" data-type="${t}" data-tag="${esc(tag)}" title="移除此標籤篩選">✕</button></span>`
          ).join('');
    }
    if (exc.length) {
        html += (html ? ' ' : '') +
          `<span class="ts-label">排除 ${exc.length}</span><span class="ts-sep">：</span>` +
          exc.map(tag =>
              `<span class="chip tag sel-chip exc-chip">⊘${esc(tag)}` +
              `<button type="button" class="sel-rm-exc" data-type="${t}" data-tag="${esc(tag)}" title="移除此排除標籤">✕</button></span>`
          ).join('');
    }
    el.innerHTML = html;
}
 
/* 面板事件委派：chip ✕ 移除單一標籤；AND/OR 徽章點擊切換模式 */
document.addEventListener('click', e => {
    const rm = e.target.closest('.sel-rm');
    if (rm) {
        const t = rm.dataset.type, tag = rm.dataset.tag;
        TAG_FILTER_STATE[t].delete(tag);
        updateTagSummary(t);
        fc(t);
        return;
    }
    const rx = e.target.closest('.sel-rm-exc');
    if (rx) {
        const t = rx.dataset.type, tag = rx.dataset.tag;
        TAG_FILTER_EXCLUDE[t].delete(tag);
        updateTagSummary(t);
        fc(t);
        return;
    }
    const mb = e.target.closest('.ts-mode');
    if (mb) {
        const t = mb.dataset.type;
        TAG_FILTER_MODE[t] = (TAG_FILTER_MODE[t] === 'AND') ? 'OR' : 'AND';
        updateTagSummary(t);
        fc(t);
    }
});
 
function clearTagFilter(t) {
    TAG_FILTER_STATE[t].clear();
    TAG_FILTER_EXCLUDE[t].clear();
    updateTagSummary(t);
}
 
/* =========================================================
 * ★ 標籤篩選視窗（雙欄版面、暫存 → 套用制；支援排除標籤）
 * ---------------------------------------------------------------------
 * 左欄：搜尋＋全選（符合）＋清空，標籤清單（附使用筆數）
 *       每個標籤：☐ 勾選（包含）＋ ⊘ 切換（排除；同一標籤不可同時包含與排除）
 * 右欄：已選預覽（包含／排除分區，各可 ✕ 移除，僅改暫存）
 * 底部上方：AND／OR 邏輯分段按鈕＋動態說明
 * 「💾 套用」寫回；關閉／取消／Esc／點背景捨棄暫存。
 * ========================================================= */
const TAG_MODAL = { type: null, draftInc: null, draftExc: null, mode: 'AND' };
 
function ensureTagModal() {
    let ov = document.getElementById('__tag-modal');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = '__tag-modal';
        ov.className = 'tagov';
        ov.innerHTML = `
            <div class="tag-modal">
                <div class="ro-head">
                    <h3 id="__tag-title">選擇標籤</h3>
                    <button type="button" class="btn btn-clear btn-sm" onclick="closeTagModal()">✕ 關閉</button>
                </div>
 
                <div class="tag-modewrap">
                    <span class="tm-label">比對邏輯：</span>
                    <div class="tag-modeswitch" role="group">
                        <button type="button" id="__tag-mode-and" onclick="setTagMode('AND')">AND・且</button>
                        <button type="button" id="__tag-mode-or"  onclick="setTagMode('OR')">OR・或</button>
                    </div>
                    <span class="tm-hint" id="__tag-mode-hint"></span>
                </div>
 
                <div class="tag-body">
                    <div class="tag-left">
                        <div class="tag-toolbar">
                            <input type="text" id="__tag-search" placeholder="🔍 搜尋標籤…" oninput="renderTagList()">
                            <button type="button" class="btn btn-info btn-sm" onclick="tagSelectVisible()" title="勾選目前搜尋結果中的所有標籤">全選（符合）</button>
                            <button type="button" class="btn btn-warning btn-sm" onclick="tagDraftClear()" title="取消所有勾選與排除（尚未套用）">清空</button>
                        </div>
                        <div class="tag-list" id="__tag-list"></div>
                    </div>
                    <aside class="tag-right">
                        <div class="tr-head">已選（<span id="__tag-selcount">0</span>）／排除（<span id="__tag-exccount">0</span>）</div>
                        <div class="tag-selbox" id="__tag-selbox"></div>
                    </aside>
                </div>
 
                <div class="ro-foot">
                    <span class="ro-count" id="__tag-total"></span>
                    <button type="button" class="btn btn-warning" onclick="closeTagModal()">取消</button>
                    <button type="button" class="btn btn-success" onclick="applyTagModal()">💾 套用</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
 
        ov.addEventListener('click', e => { if (e.target === ov) closeTagModal(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && ov.classList.contains('show')) closeTagModal();
        });
 
        /* 左欄勾選 → 只改暫存，同步右欄預覽（事件委派） */
        ov.querySelector('#__tag-list').addEventListener('change', e => {
            const cb = e.target.closest('input[type=checkbox]');
            if (!cb || !TAG_MODAL.draftInc) return;
            if (cb.checked) {
                TAG_MODAL.draftInc.add(cb.value);
                TAG_MODAL.draftExc.delete(cb.value);      // 不可同時包含與排除
            } else {
                TAG_MODAL.draftInc.delete(cb.value);
            }
            cb.closest('.tagpick').classList.toggle('on', cb.checked);
            updateTagSelBox();
        });
        /* 左欄 ⊘ 排除切換 → 只改暫存，同步右欄預覽 */
        ov.querySelector('#__tag-list').addEventListener('click', e => {
            const xb = e.target.closest('.tag-exc');
            if (!xb || !TAG_MODAL.draftExc) return;
            const tag = xb.dataset.tag;
            if (TAG_MODAL.draftExc.has(tag)) TAG_MODAL.draftExc.delete(tag);
            else { TAG_MODAL.draftExc.add(tag); TAG_MODAL.draftInc.delete(tag); }
            renderTagList();
            updateTagSelBox();
        });
        /* 右欄 ✕ → 自暫存移除（包含／排除），並同步左欄狀態 */
        ov.querySelector('#__tag-selbox').addEventListener('click', e => {
            const b = e.target.closest('.tsel-rm, .tsel-rm-exc');
            if (!b || !TAG_MODAL.draftInc) return;
            const tag = b.dataset.tag;
            if (b.classList.contains('tsel-rm')) TAG_MODAL.draftInc.delete(tag);
            else TAG_MODAL.draftExc.delete(tag);
            const cb = [...ov.querySelectorAll('#__tag-list input')]
                       .find(c => c.value === tag);
            if (cb) { cb.checked = false; cb.closest('.tagpick').classList.remove('on'); }
            renderTagList();
            updateTagSelBox();
        });
    }
    return ov;
}
 
function openTagModal(type) {
    if (type !== 'units' && type !== 'characters') return;
    TAG_MODAL.type = type;
    TAG_MODAL.draftInc = new Set(TAG_FILTER_STATE[type]);     // 以目前生效狀態為起點
    TAG_MODAL.draftExc = new Set(TAG_FILTER_EXCLUDE[type]);
    TAG_MODAL.mode  = TAG_FILTER_MODE[type];
    const ov = ensureTagModal();
    gi('__tag-title').textContent = `選擇「${LABEL[type]}」標籤`;
    gi('__tag-search').value = '';
    setTagMode(TAG_MODAL.mode);
    renderTagList();
    updateTagSelBox();
    ov.classList.add('show');
    setTimeout(() => gi('__tag-search').focus(), 50);
}
 
function closeTagModal() {
    const ov = document.getElementById('__tag-modal');
    if (ov) ov.classList.remove('show');
    TAG_MODAL.type = null;
    TAG_MODAL.draftInc = null;                                // 捨棄暫存
    TAG_MODAL.draftExc = null;
}
 
/* AND/OR 切換（僅影響暫存，套用後才生效） */
function setTagMode(m) {
    TAG_MODAL.mode = m;
    const a = gi('__tag-mode-and'), o = gi('__tag-mode-or'), h = gi('__tag-mode-hint');
    if (a) a.classList.toggle('active', m === 'AND');
    if (o) o.classList.toggle('active', m === 'OR');
    if (h) h.textContent = (m === 'AND')
        ? '資料必須具備【所有】勾選標籤才會顯示（⊘ 排除標籤優先：具備任一排除標籤即隱藏）'
        : '資料只要具備【任一】勾選標籤即會顯示（⊘ 排除標籤優先：具備任一排除標籤即隱藏）';
}
 
function tagUsageMap(t) {
    const m = {};
    (cache[t] || []).forEach(it => (it.tags || []).forEach(x => { m[x] = (m[x] || 0) + 1; }));
    return m;
}
 
function renderTagList() {
    if (!TAG_MODAL.type || !TAG_MODAL.draftInc) return;
    const q = fv('__tag-search').toLowerCase();
    const usage = tagUsageMap(TAG_MODAL.type);
    let tags = poolTags(TAG_MODAL.type);
    if (q) tags = tags.filter(t => t.toLowerCase().includes(q));
 
    gi('__tag-list').innerHTML = tags.length
        ? tags.map(t => {
            const on  = TAG_MODAL.draftInc.has(t);
            const exc = TAG_MODAL.draftExc.has(t);
            return `<span class="tagwrap" style="display:inline-flex;align-items:center;gap:2px;">` +
                   `<label class="tagpick${on ? ' on' : ''}" title="${usage[t] || 0} 筆資料使用此標籤">` +
                   `<input type="checkbox" value="${esc(t)}"${on ? ' checked' : ''}>${esc(t)}` +
                   `<span class="tag-use">${usage[t] || 0}</span></label>` +
                   `<button type="button" class="tag-exc${exc ? ' on' : ''}" data-tag="${esc(t)}" ` +
                   `title="${exc ? '取消排除此標籤' : '排除此標籤（具備此標籤的資料將被隱藏）'}">⊘</button>` +
                   `</span>`;
          }).join('')
        : `<p class="empty-msg" style="width:100%;">沒有符合的標籤。</p>`;
    gi('__tag-total').textContent = `標籤池共 ${poolTags(TAG_MODAL.type).length} 種`;
}
 
/* 右欄：已選預覽（包含／排除分區；每個 chip 附 ✕，僅改暫存） */
function updateTagSelBox() {
    const box = gi('__tag-selbox'); if (!box || !TAG_MODAL.draftInc) return;
    const inc = [...TAG_MODAL.draftInc];
    const exc = [...TAG_MODAL.draftExc];
    let html = '';
    html += inc.length
        ? `<div class="tr-sub">包含</div>` +
          inc.map(t =>
            `<span class="tagpick on tsel">${esc(t)}` +
            `<button type="button" class="tsel-rm" data-tag="${esc(t)}" title="自暫存移除">✕</button></span>`
          ).join('')
        : '';
    html += exc.length
        ? `<div class="tr-sub tr-sub-exc">排除</div>` +
          exc.map(t =>
            `<span class="tagpick on tsel tsel-exc">⊘${esc(t)}` +
            `<button type="button" class="tsel-rm-exc" data-tag="${esc(t)}" title="自暫存移除">✕</button></span>`
          ).join('')
        : '';
    if (!html) html = '<span class="empty-msg" style="font-size:11px;">尚未選擇標籤</span>';
    box.innerHTML = html;
    gi('__tag-selcount').textContent = inc.length;
    gi('__tag-exccount').textContent = exc.length;
}
 
/* 全選目前搜尋結果中的標籤（僅加入暫存；同時自排除暫存移除） */
function tagSelectVisible() {
    if (!TAG_MODAL.draftInc) return;
    const q = fv('__tag-search').toLowerCase();
    let tags = poolTags(TAG_MODAL.type);
    if (q) tags = tags.filter(t => t.toLowerCase().includes(q));
    tags.forEach(t => { TAG_MODAL.draftInc.add(t); TAG_MODAL.draftExc.delete(t); });
    renderTagList();
    updateTagSelBox();
}
 
function tagDraftClear() {
    if (!TAG_MODAL.draftInc) return;
    TAG_MODAL.draftInc.clear();
    TAG_MODAL.draftExc.clear();
    renderTagList();
    updateTagSelBox();
}
 
function applyTagModal() {
    const t = TAG_MODAL.type;
    if (!t || !TAG_MODAL.draftInc) return;
    TAG_FILTER_STATE[t]  = new Set(TAG_MODAL.draftInc);
    TAG_FILTER_EXCLUDE[t] = new Set(TAG_MODAL.draftExc);
    TAG_FILTER_MODE[t]  = TAG_MODAL.mode;
    updateTagSummary(t);
    closeTagModal();
    fc(t);
}
 
/* ---------- 其他分頁功能 ---------- */
function clearU() {
    ['u-search'].forEach(id => gi(id).value = '');
    ['fu-series','fu-rarity','fu-limit','fu-type','fu-shield','fu-trans','fu-escape','fu-sp','fu-ssp','fu-ltd','fu-src',
     'fu-mob-min','fu-mob-max','fu-lvlstate','fu-image','fu-wstate']
        .forEach(id => gi(id).value = '');
    TERRAINS.forEach(([_, k]) => gi('fu-tr_' + k).value = '');
    const hb = gi('fu-hidesrc'); if (hb) hb.checked = true;       // 回復預設勾選
    clearTagFilter('units');
    gi('fu-sort').value = 'order'; gi('fu-order').value = 'desc'; // 預設：獲得順序降冪
    fc('units');
}
function clearC() {
    gi('c-search').value = '';
    ['fc-series','fc-rarity','fc-type','fc-sp','fc-lvlstate','fc-image',
     'fc-ab','fc-sk','fc-abreq-series','fc-abreq-tag','fc-tbseries','fc-tbtag'].forEach(id => gi(id).value = '');
    clearTagFilter('characters');
    gi('fc-sort').value = 'order'; gi('fc-order').value = 'desc';
    fc('characters');
}
function clearS() {
    gi('s-search').value = '';
    ['fs-lvlstate','fs-image','fs-rarity','fs-limited','fs-cap-series','fs-cap-tag','fs-supskill'].forEach(id => gi(id).value = '');
    gi('fs-sort').value = 'order'; gi('fs-order').value = 'desc'; // 預設：獲得順序降冪
    fc('supports');
}
 
/* ---------- 深色模式 ---------- */
function initDarkMode() {
    let on = false;
    try { on = localStorage.getItem('sdg-dark') === '1'; } catch (_) {}
    document.body.classList.toggle('dark-mode', on);
    const btn = gi('dark-mode-toggle');
    if (btn) btn.textContent = on ? '☀' : '☾';
}
function toggleDarkMode() {
    const on = document.body.classList.toggle('dark-mode');
    gi('dark-mode-toggle').textContent = on ? '☀' : '☾';
    try { localStorage.setItem('sdg-dark', on ? '1' : '0'); } catch (_) {}
}
 
/* =========================================================
 * 卡片按鈕委派（編輯／刪除）＋ 刪除復原
 * ---------------------------------------------------------------------
 * cardActions() 產生的按鈕帶 data-act / data-type / data-id，
 * 在 document 層統一委派（initUI 只綁一次）。
 * ========================================================= */
function initUI() {
    if (document._cardActBound) return;
    document._cardActBound = true;
    document.addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act, type = b.dataset.type, id = b.dataset.id;
        if (act === 'edit') {
            if (type === 'units') editUnit(id);
            else if (type === 'characters') editCharacter(id);
            else if (type === 'supports') editSupport(id);
        } else if (act === 'del') {
            delItem(type, id);
        }
    });
}
 
/* 刪除（含 Toast 復原按鈕；lastDeleted 僅保留最後一層） */
async function delItem(type, id) {
    const item = (await getAll(type)).find(x => x.id === id);
    if (!item) { showToast('找不到要刪除的資料', true); return; }
    if (!confirm('確定要刪除「' + (item.name || id) + '」嗎？')) return;
    await deleteItem(type, id);        // database.js：寫入 DB、清快取、排程自動上傳
    lastDeleted = { type, item };
    RENDER[type]();
    updateStorageStatus();
    showToast(LABEL[type] + '已刪除：' + (item.name || ''), false, { label: '↩ 復原', fn: undoDelete });
}
 
async function undoDelete() {
    if (!lastDeleted) { showToast('沒有可復原的刪除'); return; }
    const { type, item } = lastDeleted;
    await db.put(type, item);
    inv(type);
    lastDeleted = null;
    RENDER[type]();
    updateStorageStatus();
    showToast('已復原：' + (item.name || ''));
    scheduleAutoSync('undo-' + type);  // ★ 編輯性操作 → 自動上傳
}

/* =========================================================
 * 角色技能一覽：名稱／說明資料庫（存於 metadata store，key: skillLib）
 * ========================================================= */
let SKILL_LIB = {};
 
async function loadSkillLib() {
    const d = await db.getMeta('skillLib');
    SKILL_LIB = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}
async function saveSkillLib() {
    await db.putMeta('skillLib', SKILL_LIB);
    showToast('角色技能說明已儲存');
    scheduleAutoSync('skill-lib');
}
function getSkillDesc(name) { return SKILL_LIB[name] || ''; }
function poolSkillNames() {
    const s = new Set();
    (cache.characters || []).forEach(c =>
        ['sk1','sk2','sk3'].forEach(k => { if (c[k]) s.add(c[k]); }));
    Object.keys(SKILL_LIB).forEach(k => s.add(k));
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
 
function openSkillModal() {
    let ov = gi('skill-modal');
    if (ov) ov.remove();
    const names = poolSkillNames();
    ov = document.createElement('div');
    ov.id = 'skill-modal';
    ov.className = 'ro-overlay show';
    ov.innerHTML = `
        <div class="ro-modal">
            <div class="ro-head">
                <h3>📖 角色技能一覽</h3>
                <button type="button" class="btn btn-warning btn-sm" onclick="closeSkillModal()">✕</button>
            </div>
            <p class="ro-hint">共 ${names.length} 種技能。可直接編輯各技能的說明（角色表單的自動完成會一併顯示）。</p>
            <div class="ro-list" style="max-height:60vh;overflow:auto;">
                ${names.length ? names.map(n => `
                    <div class="ro-item" style="display:block;">
                        <div style="font-weight:bold;margin-bottom:3px;">${esc(n)}</div>
                        <input type="text" class="sk-desc" data-name="${esc(n)}"
                               value="${esc(SKILL_LIB[n] || '')}" maxlength="500"
                               placeholder="輸入此技能的說明…"
                               style="width:95%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
                    </div>`).join('')
                : '<p class="empty-msg" style="width:100%;">尚無任何角色技能資料。</p>'}
            </div>
            <div class="ro-foot">
                <span class="ro-count">共 ${names.length} 種</span>
                <button type="button" class="btn btn-success" onclick="saveSkillModal()">💾 儲存說明</button>
                <button type="button" class="btn btn-warning" onclick="closeSkillModal()">關閉</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeSkillModal(); });
}
function saveSkillModal() {
    document.querySelectorAll('#skill-modal .sk-desc').forEach(inp => {
        const v = inp.value.trim();
        if (v) SKILL_LIB[inp.dataset.name] = v;
        else delete SKILL_LIB[inp.dataset.name];
    });
    saveSkillLib();
    refreshAbReqSelects();
    closeSkillModal();
}
function closeSkillModal() {
    const ov = gi('skill-modal');
    if (ov) ov.remove();
}

/* =========================================================
 * 角色能力一覽：名稱／說明資料庫（存於 metadata store）
 * 說明來源：所有角色的 ab1–ab3 名稱 ∪ 已登錄的說明資料庫。
 * ========================================================= */
let ABILITY_LIB = {};                       // { 能力名稱: 說明 }
 
async function loadAbilityLib() {
    const d = await db.getMeta('abilityLib');
    ABILITY_LIB = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}
async function saveAbilityLib() {
    await db.putMeta('abilityLib', ABILITY_LIB);
    showToast('角色能力說明已儲存');
    scheduleAutoSync('ability-lib');
}
function getAbilityDesc(name) { return ABILITY_LIB[name] || ''; }
 
/* 收集所有角色能力名稱（ab1–ab3 ∪ 資料庫鍵） */
function poolAbilityNames() {
    const s = new Set();
    (cache.characters || []).forEach(c =>
        ['ab1','ab2','ab3'].forEach(k => { if (c[k]) s.add(c[k]); }));
    Object.keys(ABILITY_LIB).forEach(k => s.add(k));
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}
 
function openAbilityModal() {
    let ov = gi('ability-modal');
    if (ov) ov.remove();
    const names = poolAbilityNames();
    ov = document.createElement('div');
    ov.id = 'ability-modal';
    ov.className = 'ro-overlay show';       // 沿用 reorder 視窗樣式
    ov.innerHTML = `
        <div class="ro-modal">
            <div class="ro-head">
                <h3>📖 角色能力一覽</h3>
                <button type="button" class="btn btn-warning btn-sm" onclick="closeAbilityModal()">✕</button>
            </div>
            <p class="ro-hint">共 ${names.length} 種能力。可直接編輯各能力的說明（角色表單的自動完成會一併顯示）。</p>
            <div class="ro-list" style="max-height:60vh;overflow:auto;">
                ${names.length ? names.map(n => `
                    <div class="ro-item" style="display:block;">
                        <div style="font-weight:bold;margin-bottom:3px;">${esc(n)}</div>
                        <input type="text" class="ab-desc" data-name="${esc(n)}"
                               value="${esc(ABILITY_LIB[n] || '')}" maxlength="500"
                               placeholder="輸入此能力的說明…"
                               style="width:95%;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
                    </div>`).join('')
                : '<p class="empty-msg" style="width:100%;">尚無任何角色能力資料。</p>'}
            </div>
            <div class="ro-foot">
                <span class="ro-count">共 ${names.length} 種</span>
                <button type="button" class="btn btn-success" onclick="saveAbilityModal()">💾 儲存說明</button>
                <button type="button" class="btn btn-warning" onclick="closeAbilityModal()">關閉</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeAbilityModal(); });
}
function saveAbilityModal() {
    document.querySelectorAll('#ability-modal .ab-desc').forEach(inp => {
        const v = inp.value.trim();
        if (v) ABILITY_LIB[inp.dataset.name] = v;
        else delete ABILITY_LIB[inp.dataset.name];      // 清空＝移除說明
    });
    saveAbilityLib();
    refreshAbReqSelects(); 
    closeAbilityModal();
}
function closeAbilityModal() {
    const ov = gi('ability-modal');
    if (ov) ov.remove();
}

/* 角色能力／契合度需求（多選）：篩選下拉選項刷新 */
function refreshAbReqSelects() {
    const keep = (el, arr, blank) => {
        if (!el) return;
        const cur = el.value;
        el.innerHTML = `<option value="">${blank}</option>` +
            arr.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        if ([...el.options].some(o => o.value === cur)) el.value = cur;
    };
    /* 篩選：角色能力／角色技能名稱池 */
    keep(gi('fc-ab'), poolAbilityNames(), '全部');
    keep(gi('fc-sk'), poolSkillNames(), '全部');
    /* 篩選：能力／契合度需求（系列／標籤分開，僅列出實際被設定的值） */
    const reqS = new Set(), reqT = new Set(), tbS = new Set(), tbT = new Set();
    (cache.characters || []).forEach(c => {
        for (let i = 1; i <= 3; i++) {
            abReqArr(c['ab' + i + 'Series']).forEach(x => reqS.add(x));
            abReqArr(c['ab' + i + 'Tag']).forEach(x => reqT.add(x));
        }
        abReqArr(c.tagBonusSeries).forEach(x => tbS.add(x));
        abReqArr(c.tagBonusTag).forEach(x => tbT.add(x));
    });
    const srt = (a, b) => a.localeCompare(b, 'zh-Hant');
    keep(gi('fc-abreq-series'), [...reqS].sort(srt), '全部');
    keep(gi('fc-abreq-tag'),   [...reqT].sort(srt), '全部');
    keep(gi('fc-tbseries'),    [...tbS].sort(srt), '全部');
    keep(gi('fc-tbtag'),       [...tbT].sort(srt), '全部');
    if (typeof refreshSupFilterSelects === 'function') refreshSupFilterSelects();
}

/* =========================================================
 * ★ 角色能力需求多選挑選視窗（系列／標籤；暫存 → 套用制）
 * ABREQ[i] = { series:[], tag:[] }（forms.js 定義；logic 存於 c-ab{i}logic 下拉）
 * ========================================================= */
const ABREQ_PICK = { idx: 0, kind: 'series', draft: null };
 
function abReqArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
 
function openAbReqPicker(idx, kind) {
    if (!ABREQ || !ABREQ[idx]) return;
    ABREQ_PICK.idx = idx; ABREQ_PICK.kind = kind;
    ABREQ_PICK.draft = new Set(ABREQ[idx][kind]);
    const pool = (kind === 'series') ? poolSeries() : poolTags('units');
    let ov = gi('abreq-modal'); if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'abreq-modal'; ov.className = 'ro-overlay show';
    ov.innerHTML = `
        <div class="ro-modal">
            <div class="ro-head">
                <h3>選擇需求${kind === 'series' ? '系列' : '標籤'}（${idx === 0 ? '契合度' : '角色能力' + idx}）</h3>
                <button type="button" class="btn btn-warning btn-sm" onclick="closeAbReqPicker()">✕</button>
            </div>
            <p class="ro-hint">可複選；多個需求之間的關係由表單上的 AND／OR 下拉決定。</p>
            <div class="ro-list" style="max-height:55vh;overflow:auto;">
                ${pool.length ? pool.map(s => `
                    <label class="abreq-pick" style="display:block;padding:3px 6px;cursor:pointer;">
                        <input type="checkbox" value="${esc(s)}"${ABREQ_PICK.draft.has(s) ? ' checked' : ''}> ${esc(s)}
                    </label>`).join('')
                : '<p class="empty-msg" style="width:100%;">沒有可選項目。</p>'}
            </div>
            <div class="ro-foot">
                <button type="button" class="btn btn-warning" onclick="closeAbReqPicker()">取消</button>
                <button type="button" class="btn btn-success" onclick="applyAbReqPicker()">💾 套用</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('change', e => {
        const cb = e.target.closest('input[type=checkbox]');
        if (!cb || !ABREQ_PICK.draft) return;
        cb.checked ? ABREQ_PICK.draft.add(cb.value) : ABREQ_PICK.draft.delete(cb.value);
    });
    ov.addEventListener('click', e => { if (e.target === ov) closeAbReqPicker(); });
}
function applyAbReqPicker() {
    if (ABREQ_PICK.draft && ABREQ[ABREQ_PICK.idx]) {
        ABREQ[ABREQ_PICK.idx][ABREQ_PICK.kind] =
            [...ABREQ_PICK.draft].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        updAbReqChips(ABREQ_PICK.idx);
    }
    closeAbReqPicker();
}
function closeAbReqPicker() { const ov = gi('abreq-modal'); if (ov) ov.remove(); }
 
/* 表單 chips 上的 ✕：移除單一需求（委派） */
document.addEventListener('click', e => {
    const rm = e.target.closest('.sel-rm-abreq');
    if (rm && ABREQ) {
        const i = +rm.dataset.i, kind = rm.dataset.kind, v = rm.dataset.v;
        if (ABREQ[i]) { ABREQ[i][kind] = ABREQ[i][kind].filter(x => x !== v); updAbReqChips(i); }
    }
    const cap = e.target.closest('.sel-rm-supcap');
    if (cap && typeof SUP_CAP !== 'undefined') {
        const kind = cap.dataset.kind === 'series' ? 'series' : 'tags';
        SUP_CAP[kind] = (SUP_CAP[kind] || []).filter(x => x !== cap.dataset.v);
        updSupCapChips();
    }
});

function refreshSupFilterSelects() {
    const keep = (el, arr) => {
        if (!el) return;
        const cur = el.value;
        el.innerHTML = '<option value="">全部</option>' +
            arr.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        if ([...el.options].some(o => o.value === cur)) el.value = cur;
    };
    const series = new Set(), tags = new Set();
    (cache.supports || []).forEach(s => {
        abReqArr(s.captainSeries).forEach(x => series.add(x));
        abReqArr(s.captainTags).forEach(x => tags.add(x));
    });
    const srt = (a, b) => a.localeCompare(b, 'zh-Hant');
    keep(gi('fs-cap-series'), [...series].sort(srt));
    keep(gi('fs-cap-tag'), [...tags].sort(srt));
}

function openSupCapPicker(kind) {
    if (typeof SUP_CAP === 'undefined') return;
    const key = kind === 'series' ? 'series' : 'tags';
    const draft = new Set(SUP_CAP[key] || []);
    const pool = key === 'series' ? poolSeries() : poolTags('units');
    let ov = gi('supcap-modal'); if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'supcap-modal'; ov.className = 'ro-overlay show';
    ov.innerHTML = `
        <div class="ro-modal">
            <div class="ro-head">
                <h3>隊長技能${key === 'series' ? '系列' : '標籤'}</h3>
                <button type="button" class="btn btn-warning btn-sm" onclick="closeSupCapPicker()">✕</button>
            </div>
            <p class="ro-hint">可複選，也可直接打字搜尋名稱。多個條件用表單上的 AND／OR。</p>
            <input type="text" id="supcap-q" placeholder="輸入名稱搜尋" autocomplete="off" style="width:100%;margin-bottom:6px;">
            <div class="ro-list" id="supcap-list" style="max-height:55vh;overflow:auto;"></div>
            <div class="ro-foot">
                <button type="button" class="btn btn-warning" onclick="closeSupCapPicker()">取消</button>
                <button type="button" class="btn btn-success" id="supcap-apply">💾 套用</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const list = gi('supcap-list');
    const paint = () => {
        const q = (gi('supcap-q').value || '').trim().toLowerCase();
        const shown = q ? pool.filter(s => String(s).toLowerCase().includes(q)) : pool;
        list.innerHTML = shown.length ? shown.map(s => `
            <label class="abreq-pick" style="display:block;padding:3px 6px;cursor:pointer;">
                <input type="checkbox" value="${esc(s)}"${draft.has(s) ? ' checked' : ''}> ${esc(s)}
            </label>`).join('')
            : `<p class="empty-msg" style="width:100%;">${pool.length ? '沒有符合的名稱。' : '沒有可選項目。請先在單位加上系列或標籤。'}</p>`;
    };
    paint();
    gi('supcap-q').addEventListener('input', paint);
    gi('supcap-q').focus();
    ov.addEventListener('change', e => {
        const cb = e.target.closest('input[type=checkbox]');
        if (!cb) return;
        cb.checked ? draft.add(cb.value) : draft.delete(cb.value);
    });
    ov.addEventListener('click', e => { if (e.target === ov) closeSupCapPicker(); });
    gi('supcap-apply').onclick = () => {
        SUP_CAP[key] = [...draft].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        updSupCapChips();
        closeSupCapPicker();
    };
}
function closeSupCapPicker() { const ov = gi('supcap-modal'); if (ov) ov.remove(); }