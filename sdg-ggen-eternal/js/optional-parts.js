/* =====================================================================
 * optional-parts.js — 選擇性零件 (OP) 視窗
 * ---------------------------------------------------------------------
 * 視窗內容（篩選、清單、編輯表單、預覽句）全部由本檔渲染。
 * 進入點：openOptionalPartsModal()。按鈕在工具列與單位分頁「操作」。
 *
 * ── 原始需求（保留在此，不寫進 markdown）──────────────────────────
 * New modal: 選擇性零件 (OP)
 * The users can enter the name of "選擇性零件" and its effects.
 * The effects might include:
 *   「自身最大EN提升10」
 *   「自身機動力提升100」
 *   「自身最大HP提升1000」
 *   「自身防禦力提升250、自身機動力減少50」
 *   「自身攻擊力提升10%、裝備的單位含有上述「標籤」時，自身攻擊力提升2%」
 *       （標籤：宇宙世紀系列）
 *   「自身防禦力提升8%, 裝備的單位為「全裝甲型高達Mk-III」時，自身防禦力提升2%」
 *       （units: 全裝甲型高達Mk-III）
 *   「自身攻擊力提升860、自身機動力提升86」
 *   「「宇宙」地形適性提升1級」
 *   「自身使用射程「1-1」的武裝攻擊時，攻擊力提升20% ※MAP兵器除外」
 *   「自身攻擊力提升12%」
 *   「自身防禦力提升15%、自身機動力減少5%」
 * 同一零件可有多條效果。一條效果可含多個能力增減（以「、」連接）。
 * 增減可以是數值或百分比；地形適性是「級」。
 * 可以只在「單位含有某標籤」或「指定單位」時追加能力。
 * 可以限定「使用某射程（例如 1-1）的武裝」才生效，並可註記 MAP 兵器除外。
 * 視窗要有對應欄位，以及能依這些條件篩選零件。
 *
 * ── 儲存格式（IndexedDB store: optionalParts，keyPath id）────────
 * {
 *   id: 'op_…',
 *   name: string,                    // 零件名稱，最長 100
 *   date_added, date_modified: ISO,
 *   effects: [                       // 最多 12 條
 *     {
 *       clauses: [                   // 最多 8 個能力句，最多對應一句預覽
 *         {
 *           stat: 'maxEn'|'mobility'|'maxHp'|'defense'|'attack'|'terrain',
 *           dir:  'up'|'down',       // 提升 / 減少（地形用提升／降低）
 *           amount: number,          // 正數；方向看 dir
 *           mode: 'flat'|'percent'|'rank',  // 數值 / % / 級（terrain 一律 rank）
 *           scope:'always'|'cond',   // 始終，或套用本效果的條件
 *           terrain: ''|'space'|'air'|'ground'|'water'|'under'
 *                    // 僅 stat==='terrain' 時有意義（哪一種地形適性）
 *         }
 *       ],
 *       tag: string,                 // 條件：裝備單位含有此標籤（單位標籤池）
 *       unit: string,                // 條件：裝備單位名稱完全是這台
 *       rangeMin, rangeMax: ''|'1'..'6',  // 條件：武裝射程。1 與 1 →「1-1」
 *       excludeMap: boolean          // ※MAP兵器除外（通常與射程一併使用）
 *     }
 *   ]
 * }
 * scope==='cond' 的能力句，在預覽裡接在條件子句後面；
 * scope==='always' 的能力句不受標籤／單位／射程影響。
 * 多個條件同時填寫時以 AND 理解（標籤且指定單位且該射程）。
 * 舊備份 JSON 若沒有 optionalParts 欄，匯入／下載不會清掉本地零件。
 * ===================================================================== */

const OP_STATS = [
    { id: 'maxEn',    label: '最大EN' },
    { id: 'mobility', label: '機動力' },
    { id: 'maxHp',    label: '最大HP' },
    { id: 'defense',  label: '防禦力' },
    { id: 'attack',   label: '攻擊力' },
    { id: 'terrain',  label: '地形適性' }
];
const OP_STAT_LABEL = Object.fromEntries(OP_STATS.map(s => [s.id, s.label]));
const OP_DIRS  = [{ id: 'up', label: '提升' }, { id: 'down', label: '減少' }];
const OP_MODES = [{ id: 'flat', label: '數值' }, { id: 'percent', label: '百分比' }, { id: 'rank', label: '級' }];
const OP_SCOPES = [{ id: 'always', label: '始終' }, { id: 'cond', label: '符合條件時' }];
const OP_STAT_IDS = OP_STATS.map(s => s.id);
const OP_MAX_EFFECTS = 12;
const OP_MAX_CLAUSES = 8;

let OP_DRAFT = null;
let OP_CLEAN = '';
let OP_FILTER = blankOpFilter();

function blankOpFilter() {
    return { q: '', stat: '', mode: '', dir: '', cond: '', tag: '', unit: '', rangeMin: '', rangeMax: '' };
}
function blankOpClause() {
    return { stat: 'attack', dir: 'up', amount: '', mode: 'flat', scope: 'always', terrain: '' };
}
function blankOpEffect() {
    return { clauses: [blankOpClause()], tag: '', unit: '', rangeMin: '', rangeMax: '', excludeMap: false };
}
function blankOpDraft() {
    return { id: null, name: '', effects: [blankOpEffect()], date_added: null };
}

function opRangeOk(v) {
    return v === '' || v === undefined || v === null || ['1', '2', '3', '4', '5', '6'].includes(String(v));
}
function opTerrainOk(v) {
    return TERRAINS.some(([, k]) => k === v);
}
function opTerrainLabel(k) {
    const hit = TERRAINS.find(([, id]) => id === k);
    return hit ? hit[0] : '';
}

/* 正規化一筆零件。無有效能力句的效果會被丟掉。 */
function normalizeOptionalPart(raw) {
    const effects = [];
    (Array.isArray(raw && raw.effects) ? raw.effects : []).slice(0, OP_MAX_EFFECTS).forEach(ef => {
        if (!ef || typeof ef !== 'object') return;
        const clauses = [];
        (Array.isArray(ef.clauses) ? ef.clauses : []).slice(0, OP_MAX_CLAUSES).forEach(c => {
            if (!c || !OP_STAT_IDS.includes(c.stat)) return;
            const amount = typeof c.amount === 'number' ? c.amount : parseFloat(String(c.amount).replace(/,/g, ''));
            if (!Number.isFinite(amount) || amount < 0) return;
            const terrain = (c.stat === 'terrain' && opTerrainOk(c.terrain)) ? c.terrain : '';
            if (c.stat === 'terrain' && !terrain) return;
            clauses.push({
                stat: c.stat,
                dir: c.dir === 'down' ? 'down' : 'up',
                amount: Math.round(amount * 100) / 100,
                mode: c.stat === 'terrain' ? 'rank' : (c.mode === 'percent' ? 'percent' : 'flat'),
                scope: c.scope === 'cond' ? 'cond' : 'always',
                terrain
            });
        });
        if (!clauses.length) return;
        const rangeMin = opRangeOk(ef.rangeMin) ? String(ef.rangeMin || '') : '';
        const rangeMax = opRangeOk(ef.rangeMax) ? String(ef.rangeMax || '') : '';
        effects.push({
            clauses,
            tag: String(ef.tag || '').trim().slice(0, 80),
            unit: String(ef.unit || '').trim().slice(0, 100),
            rangeMin, rangeMax,
            excludeMap: !!ef.excludeMap
        });
    });
    const added = raw && raw.date_added ? raw.date_added : new Date().toISOString();
    return {
        id: String(raw && raw.id || ''),
        name: String(raw && raw.name || '').trim().slice(0, 100) || '(未命名)',
        effects,
        date_added: added,
        date_modified: (raw && raw.date_modified) || added
    };
}

function sanitizeOptionalParts(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    arr.forEach(raw => {
        if (!raw || typeof raw !== 'object') return;
        if (raw.id === undefined || raw.id === null || String(raw.id).trim() === '') return;
        const id = String(raw.id);
        if (seen.has(id)) return;
        seen.add(id);
        out.push(normalizeOptionalPart({ ...raw, id }));
    });
    return out;
}

function opClauseText(c, dropSelf) {
    const dir = c.dir === 'down' ? (c.stat === 'terrain' ? '降低' : '減少') : '提升';
    const n = String(c.amount);
    if (c.stat === 'terrain') return `「${opTerrainLabel(c.terrain)}」地形適性${dir}${n}級`;
    const suffix = c.mode === 'percent' ? '%' : '';
    const who = dropSelf ? '' : '自身';
    return `${who}${OP_STAT_LABEL[c.stat]}${dir}${n}${suffix}`;
}

function opCondLead(ef) {
    const bits = [];
    if (ef.tag) bits.push('裝備的單位含有上述「標籤」');
    if (ef.unit) bits.push(`裝備的單位為「${ef.unit}」`);
    const hasRange = !!(ef.rangeMin || ef.rangeMax);
    if (hasRange) bits.push(`使用射程「${ef.rangeMin || '?'}-${ef.rangeMax || '?'}」的武裝攻擊`);
    if (!bits.length) return '';
    const subject = (hasRange && !ef.tag && !ef.unit) ? '自身' : '';
    return subject + bits.join('、') + '時，';
}

function opEffectHasCond(ef) {
    return !!(ef.tag || ef.unit || ef.rangeMin || ef.rangeMax || ef.excludeMap ||
        (ef.clauses || []).some(c => c.scope === 'cond'));
}

/* 把一條效果編成與遊戲內文相近的一句話，供清單與預覽使用。 */
function opEffectText(ef) {
    const always = (ef.clauses || []).filter(c => c.scope !== 'cond');
    const cond = (ef.clauses || []).filter(c => c.scope === 'cond');
    const parts = [];
    if (always.length) parts.push(always.map(c => opClauseText(c, false)).join('、'));
    if (cond.length) {
        const lead = opCondLead(ef);
        const dropSelf = lead.startsWith('自身');
        parts.push(lead + cond.map(c => opClauseText(c, dropSelf)).join('、'));
    }
    let text = parts.join('、');
    if (ef.excludeMap) text += ' ※MAP兵器除外';
    if (ef.tag) text += `（標籤：${ef.tag}）`;
    return text || '（此效果沒有能力句）';
}

function opPartText(part) {
    return (part.effects || []).map(opEffectText).join('\n');
}

function opMatches(part, f) {
    const blob = (part.name + '\n' + opPartText(part)).toLowerCase();
    if (f.q && !blob.includes(f.q.trim().toLowerCase())) return false;
    const rows = [];
    (part.effects || []).forEach(ef => (ef.clauses || []).forEach(c => rows.push({ c, ef })));
    if (f.stat && !rows.some(r => r.c.stat === f.stat)) return false;
    if (f.mode && !rows.some(r => r.c.mode === f.mode && (!f.stat || r.c.stat === f.stat))) return false;
    if (f.dir && !rows.some(r => r.c.dir === f.dir && (!f.stat || r.c.stat === f.stat))) return false;
    if (f.cond === 'none' && (part.effects || []).some(opEffectHasCond)) return false;
    if (f.cond === 'tag' && !(part.effects || []).some(e => e.tag)) return false;
    if (f.cond === 'unit' && !(part.effects || []).some(e => e.unit)) return false;
    if (f.cond === 'range' && !(part.effects || []).some(e => e.rangeMin || e.rangeMax)) return false;
    if (f.cond === 'terrain' && !rows.some(r => r.c.stat === 'terrain')) return false;
    if (f.cond === 'exmap' && !(part.effects || []).some(e => e.excludeMap)) return false;
    if (f.tag && !(part.effects || []).some(e => (e.tag || '').includes(f.tag.trim()))) return false;
    if (f.unit && !(part.effects || []).some(e => (e.unit || '').includes(f.unit.trim()))) return false;
    if (f.rangeMin && !(part.effects || []).some(e => e.rangeMin === f.rangeMin)) return false;
    if (f.rangeMax && !(part.effects || []).some(e => e.rangeMax === f.rangeMax)) return false;
    return true;
}

function opOpts(list, cur, placeholder) {
    const head = placeholder === undefined ? '' : `<option value="">${esc(placeholder)}</option>`;
    return head + list.map(o => {
        const id = typeof o === 'string' ? o : o.id;
        const label = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
}

function captureOpFilter() {
    const root = gi('op-modal');
    if (!root) return;
    const g = id => { const el = root.querySelector('#' + id); return el ? el.value : ''; };
    OP_FILTER = {
        q: g('op-q'), stat: g('op-f-stat'), mode: g('op-f-mode'), dir: g('op-f-dir'),
        cond: g('op-f-cond'), tag: g('op-f-tag'), unit: g('op-f-unit'),
        rangeMin: g('op-f-rmin'), rangeMax: g('op-f-rmax')
    };
}
function captureOpDraft() {
    const nameEl = gi('op-name');
    if (!nameEl || !OP_DRAFT) return;
    const effects = [];
    document.querySelectorAll('#op-effects .op-effect').forEach(box => {
        const clauses = [];
        box.querySelectorAll('.op-clause').forEach(row => {
            clauses.push({
                stat: row.querySelector('.op-stat').value,
                dir: row.querySelector('.op-dir').value,
                amount: row.querySelector('.op-amt').value,
                mode: row.querySelector('.op-mode').value,
                scope: row.querySelector('.op-scope').value,
                terrain: (row.querySelector('.op-terrain') || {}).value || ''
            });
        });
        effects.push({
            clauses,
            tag: box.querySelector('.op-tag').value,
            unit: box.querySelector('.op-unit').value,
            rangeMin: box.querySelector('.op-rmin').value,
            rangeMax: box.querySelector('.op-rmax').value,
            excludeMap: box.querySelector('.op-exmap').checked
        });
    });
    OP_DRAFT = { id: OP_DRAFT.id, name: nameEl.value, effects, date_added: OP_DRAFT.date_added };
}
/* 比對時固定鍵序，並把數字欄位一律當字串，避免「剛儲存又被當成未儲存」。 */
function opSnap(d) {
    if (!d) return '';
    return JSON.stringify({
        id: d.id || null,
        name: d.name || '',
        effects: (d.effects || []).map(ef => ({
            tag: ef.tag || '',
            unit: ef.unit || '',
            rangeMin: ef.rangeMin || '',
            rangeMax: ef.rangeMax || '',
            excludeMap: !!ef.excludeMap,
            clauses: (ef.clauses || []).map(c => ({
                stat: c.stat || '',
                dir: c.dir || 'up',
                amount: c.amount == null ? '' : String(c.amount),
                mode: c.mode || 'flat',
                scope: c.scope || 'always',
                terrain: c.terrain || ''
            }))
        }))
    });
}
function opDirty() {
    return opSnap(OP_DRAFT) !== OP_CLEAN;
}
function markOpClean() {
    OP_CLEAN = opSnap(OP_DRAFT);
}

async function opAll() {
    return (await getAll('optionalParts')).slice().sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant'));
}

function fillOpLists() {
    const tags = (typeof poolTags === 'function' ? poolTags('units') : []);
    const names = (typeof poolNames === 'function' ? poolNames('units') : []);
    const t = gi('op-dl-tags'), u = gi('op-dl-units');
    if (t) t.innerHTML = tags.map(s => `<option value="${esc(s)}"></option>`).join('');
    if (u) u.innerHTML = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
        .map(s => `<option value="${esc(s)}"></option>`).join('');
}

function renderOpList() {
    const box = gi('op-list');
    if (!box) return;
    opAll().then(all => {
        const shown = all.filter(p => opMatches(p, OP_FILTER));
        const count = gi('op-count');
        if (count) count.textContent = `顯示 ${shown.length} / ${all.length}`;
        if (!shown.length) {
            box.innerHTML = '<p class="op-empty">沒有符合篩選的選擇性零件。</p>';
            return;
        }
        box.innerHTML = shown.map(p => {
            const preview = opPartText(p) || '（尚無效果）';
            const on = OP_DRAFT && OP_DRAFT.id === p.id ? ' on' : '';
            return `<button type="button" class="op-card${on}" data-op="pick" data-id="${esc(p.id)}">
                <b>${esc(p.name)}</b><span>${esc(preview)}</span></button>`;
        }).join('');
    });
}

function renderOpEditor() {
    const box = gi('op-editor');
    if (!box || !OP_DRAFT) return;
    const d = OP_DRAFT;
    const effects = (d.effects && d.effects.length) ? d.effects : [blankOpEffect()];
    d.effects = effects;
    const preview = effects.map(opEffectText).filter(Boolean).join('\n') || '（尚無效果）';
    box.innerHTML = `
        <div class="fg" style="margin-bottom:8px;">
            <label>零件名稱 *</label>
            <input type="text" id="op-name" maxlength="100" value="${esc(d.name)}" placeholder="選擇性零件名稱">
        </div>
        <div class="op-preview" id="op-preview">${esc(preview)}</div>
        <div id="op-effects">
            ${effects.map((ef, ei) => renderOpEffect(ef, ei)).join('')}
        </div>
        <button type="button" class="btn btn-info btn-sm" data-op="add-effect">＋ 新增一條效果</button>
        <div class="ro-foot" style="margin-top:8px;">
            <button type="button" class="btn btn-clear btn-sm" data-op="new">＋ 空白零件</button>
            ${d.id ? '<button type="button" class="btn btn-danger btn-sm" data-op="del">刪除</button>' : ''}
            <button type="button" class="btn btn-success btn-sm" data-op="save">💾 儲存</button>
        </div>`;
}

function renderOpEffect(ef, ei) {
    const clauses = (ef.clauses && ef.clauses.length) ? ef.clauses : [blankOpClause()];
    return `<div class="op-effect" data-ei="${ei}">
        <div style="font-size:11px;font-weight:bold;margin-bottom:4px;">效果 ${ei + 1}</div>
        ${clauses.map((c, ci) => renderOpClause(c, ci)).join('')}
        <button type="button" class="btn btn-clear btn-sm" data-op="add-clause">＋ 能力</button>
        <div class="op-cond">
            <label>標籤<input class="op-tag" list="op-dl-tags" value="${esc(ef.tag || '')}" placeholder="例：宇宙世紀系列"></label>
            <label>指定單位<input class="op-unit" list="op-dl-units" value="${esc(ef.unit || '')}" placeholder="例：全裝甲型高達Mk-III"></label>
            <label>射程
                <select class="op-rmin">${opOpts(['1','2','3','4','5','6'], ef.rangeMin || '', '最短')}</select>
                –
                <select class="op-rmax">${opOpts(['1','2','3','4','5','6'], ef.rangeMax || '', '最長')}</select>
            </label>
            <label><input type="checkbox" class="op-exmap"${ef.excludeMap ? ' checked' : ''}> MAP兵器除外</label>
            ${clauses.length > 1 || ei > 0 ? '' : ''}
            <button type="button" class="btn btn-warning btn-sm" data-op="rm-effect">移除這條效果</button>
        </div>
        <p class="hint">「符合條件時」的能力才套用標籤／單位／射程。地形適性請把能力設成「地形適性」並選擇地形。</p>
    </div>`;
}

function renderOpClause(c, ci) {
    const terrain = c.stat === 'terrain';
    const mode = terrain ? 'rank' : (c.mode === 'percent' ? 'percent' : 'flat');
    return `<div class="op-clause" data-ci="${ci}">
        <select class="op-stat" data-op="stat">${opOpts(OP_STATS, c.stat)}</select>
        ${terrain ? `<select class="op-terrain">${opOpts(TERRAINS.map(([lab, id]) => ({ id, label: lab })), c.terrain || '', '地形')}</select>` : '<input type="hidden" class="op-terrain" value="">'}
        <select class="op-dir">${opOpts(OP_DIRS, c.dir === 'down' ? 'down' : 'up')}</select>
        <input class="op-amt" type="number" min="0" step="0.01" value="${esc(c.amount)}" placeholder="數值">
        <select class="op-mode"${terrain ? ' disabled' : ''}>${opOpts(terrain ? [{ id: 'rank', label: '級' }] : OP_MODES.filter(m => m.id !== 'rank'), mode)}</select>
        <select class="op-scope">${opOpts(OP_SCOPES, c.scope === 'cond' ? 'cond' : 'always')}</select>
        <button type="button" class="btn btn-clear btn-sm" data-op="rm-clause">✕</button>
    </div>`;
}

function refreshOpPreview() {
    captureOpDraft();
    const el = gi('op-preview');
    if (!el || !OP_DRAFT) return;
    const text = (OP_DRAFT.effects || []).map(opEffectText).filter(Boolean).join('\n') || '（尚無效果）';
    el.textContent = text;
}

function renderOptionalPartsIfOpen() {
    if (!gi('op-modal')) return;
    OP_DRAFT = blankOpDraft();
    markOpClean();
    renderOpList();
    renderOpEditor();
}

function openOptionalPartsModal() {
    let ov = gi('op-modal');
    if (ov) ov.remove();
    if (!OP_DRAFT) OP_DRAFT = blankOpDraft();
    markOpClean();
    ov = document.createElement('div');
    ov.id = 'op-modal';
    ov.className = 'ro-overlay show';
    const f = OP_FILTER;
    ov.innerHTML = `
        <div class="op-modal" role="dialog" aria-modal="true" aria-labelledby="op-title">
            <div class="ro-head">
                <h3 id="op-title">🧩 選擇性零件 (OP)</h3>
                <button type="button" class="btn btn-warning btn-sm" data-op="close">✕</button>
            </div>
            <p class="ro-hint">登錄零件名稱與效果。一條效果可含多個能力；「符合條件時」才套用標籤、指定單位或射程。</p>
            <div class="op-filters">
                <label>搜尋<input type="text" id="op-q" value="${esc(f.q)}" placeholder="名稱或效果" data-op="filter"></label>
                <label>能力<select id="op-f-stat" data-op="filter">${opOpts(OP_STATS, f.stat, '全部')}</select></label>
                <label>算法<select id="op-f-mode" data-op="filter">${opOpts(OP_MODES, f.mode, '全部')}</select></label>
                <label>方向<select id="op-f-dir" data-op="filter">${opOpts(OP_DIRS, f.dir, '全部')}</select></label>
                <label>條件<select id="op-f-cond" data-op="filter">
                    <option value=""${f.cond === '' ? ' selected' : ''}>全部</option>
                    <option value="none"${f.cond === 'none' ? ' selected' : ''}>無條件</option>
                    <option value="tag"${f.cond === 'tag' ? ' selected' : ''}>有標籤</option>
                    <option value="unit"${f.cond === 'unit' ? ' selected' : ''}>有指定單位</option>
                    <option value="range"${f.cond === 'range' ? ' selected' : ''}>有射程</option>
                    <option value="terrain"${f.cond === 'terrain' ? ' selected' : ''}>有地形適性</option>
                    <option value="exmap"${f.cond === 'exmap' ? ' selected' : ''}>MAP除外</option>
                </select></label>
                <label>標籤<input type="text" id="op-f-tag" value="${esc(f.tag)}" data-op="filter"></label>
                <label>單位<input type="text" id="op-f-unit" value="${esc(f.unit)}" data-op="filter"></label>
                <label>射程
                    <select id="op-f-rmin" data-op="filter">${opOpts(['1','2','3','4','5','6'], f.rangeMin, '最短')}</select>
                    –
                    <select id="op-f-rmax" data-op="filter">${opOpts(['1','2','3','4','5','6'], f.rangeMax, '最長')}</select>
                </label>
                <button type="button" class="btn btn-clear btn-sm" data-op="clear-filter">清除篩選</button>
            </div>
            <datalist id="op-dl-tags"></datalist>
            <datalist id="op-dl-units"></datalist>
            <div class="op-body">
                <div class="op-list" id="op-list"></div>
                <div class="op-editor" id="op-editor"></div>
            </div>
            <div class="ro-foot">
                <span class="ro-count" id="op-count"></span>
                <button type="button" class="btn btn-warning" data-op="close">關閉</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', onOpClick);
    ov.addEventListener('input', onOpInput);
    ov.addEventListener('change', onOpChange);
    document.addEventListener('keydown', onOpKey);
    fillOpLists();
    renderOpList();
    renderOpEditor();
}

function onOpKey(e) {
    if (e.key === 'Escape' && gi('op-modal')) { e.preventDefault(); closeOptionalPartsModal(); }
}
function onOpInput(e) {
    if (e.target && e.target.dataset && e.target.dataset.op === 'filter') {
        captureOpFilter(); renderOpList(); return;
    }
    if (e.target && e.target.closest && e.target.closest('#op-editor')) refreshOpPreview();
}
function onOpChange(e) {
    const t = e.target;
    if (!t) return;
    if (t.dataset && t.dataset.op === 'filter') { captureOpFilter(); renderOpList(); return; }
    if (t.dataset && t.dataset.op === 'stat') {
        captureOpDraft();
        renderOpEditor();
        return;
    }
    if (t.closest && t.closest('#op-editor')) refreshOpPreview();
}
function onOpClick(e) {
    if (e.target && e.target.id === 'op-modal') { closeOptionalPartsModal(); return; }
    const btn = e.target.closest ? e.target.closest('[data-op]') : null;
    if (!btn || !gi('op-modal') || !gi('op-modal').contains(btn)) return;
    const act = btn.dataset.op;
    if (act === 'close') return closeOptionalPartsModal();
    if (act === 'filter') return;
    if (act === 'clear-filter') {
        OP_FILTER = blankOpFilter();
        gi('op-modal').querySelectorAll('.op-filters input, .op-filters select').forEach(el => { el.value = ''; });
        renderOpList();
        return;
    }
    if (act === 'pick') return pickOptionalPart(btn.dataset.id);
    captureOpDraft();
    if (act === 'add-effect') {
        if (OP_DRAFT.effects.length >= OP_MAX_EFFECTS) { showToast('一條零件最多 ' + OP_MAX_EFFECTS + ' 條效果', true); return; }
        OP_DRAFT.effects.push(blankOpEffect());
        renderOpEditor();
        return;
    }
    if (act === 'rm-effect') {
        const ei = Number(btn.closest('.op-effect').dataset.ei);
        if (OP_DRAFT.effects.length <= 1) { OP_DRAFT.effects = [blankOpEffect()]; }
        else OP_DRAFT.effects.splice(ei, 1);
        renderOpEditor();
        return;
    }
    if (act === 'add-clause') {
        const ei = Number(btn.closest('.op-effect').dataset.ei);
        const list = OP_DRAFT.effects[ei].clauses;
        if (list.length >= OP_MAX_CLAUSES) { showToast('一條效果最多 ' + OP_MAX_CLAUSES + ' 個能力', true); return; }
        list.push(blankOpClause());
        renderOpEditor();
        return;
    }
    if (act === 'rm-clause') {
        const box = btn.closest('.op-effect');
        const ei = Number(box.dataset.ei);
        const ci = Number(btn.closest('.op-clause').dataset.ci);
        const list = OP_DRAFT.effects[ei].clauses;
        if (list.length <= 1) list.splice(0, 1, blankOpClause());
        else list.splice(ci, 1);
        renderOpEditor();
        return;
    }
    if (act === 'new') return resetOpDraft();
    if (act === 'save') return saveOptionalPart();
    if (act === 'del') return deleteOptionalPart();
}

function confirmDiscardOp() {
    captureOpDraft();
    if (!opDirty()) return true;
    return confirm('這筆選擇性零件還沒儲存，要放棄變更嗎？');
}
function resetOpDraft() {
    if (!confirmDiscardOp()) return;
    OP_DRAFT = blankOpDraft();
    markOpClean();
    renderOpList();
    renderOpEditor();
}
function opDraftFromStored(part) {
    const effects = JSON.parse(JSON.stringify(part.effects && part.effects.length ? part.effects : [blankOpEffect()]));
    effects.forEach(ef => (ef.clauses || []).forEach(c => {
        c.amount = (c.amount === '' || c.amount == null) ? '' : String(c.amount);
    }));
    return { id: part.id, name: part.name, date_added: part.date_added, effects };
}

async function pickOptionalPart(id) {
    if (OP_DRAFT && OP_DRAFT.id === id) return;
    if (!confirmDiscardOp()) return;
    const part = (await opAll()).find(p => p.id === id);
    if (!part) { showToast('找不到這筆零件', true); renderOpList(); return; }
    OP_DRAFT = opDraftFromStored(part);
    markOpClean();
    renderOpList();
    renderOpEditor();
}

async function saveOptionalPart() {
    captureOpDraft();
    const name = String(OP_DRAFT.name || '').trim();
    if (!name) { showToast('請輸入零件名稱', true); return; }
    const built = normalizeOptionalPart({
        id: OP_DRAFT.id || uid('op'),
        name,
        effects: OP_DRAFT.effects,
        date_added: OP_DRAFT.date_added || new Date().toISOString()
    });
    if (!built.effects.length) { showToast('請至少填一個有效能力（種類與數值）', true); return; }
    const condMissing = (OP_DRAFT.effects || []).some(ef =>
        (ef.clauses || []).some(c => c.scope === 'cond') &&
        !String(ef.tag || '').trim() && !String(ef.unit || '').trim() && !ef.rangeMin && !ef.rangeMax);
    if (condMissing) {
        showToast('有能力設成「符合條件時」，但沒填標籤、單位或射程', true);
        return;
    }
    await saveItem('optionalParts', built);
    OP_DRAFT = opDraftFromStored(built);
    markOpClean();
    updateStorageStatus();
    renderOpList();
    renderOpEditor();
    showToast('已儲存選擇性零件：' + built.name);
}

async function deleteOptionalPart() {
    captureOpDraft();
    if (!OP_DRAFT || !OP_DRAFT.id) return;
    if (!confirm('確定要刪除「' + (OP_DRAFT.name || '這筆零件') + '」嗎？')) return;
    await deleteItem('optionalParts', OP_DRAFT.id);
    OP_DRAFT = blankOpDraft();
    markOpClean();
    updateStorageStatus();
    renderOpList();
    renderOpEditor();
    showToast('已刪除選擇性零件');
}

function closeOptionalPartsModal() {
    if (!confirmDiscardOp()) return;
    const ov = gi('op-modal');
    if (ov) ov.remove();
    document.removeEventListener('keydown', onOpKey);
    OP_DRAFT = null;
    OP_CLEAN = '';
}
