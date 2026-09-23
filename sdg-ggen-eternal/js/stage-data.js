/* =====================================================================
 * stage-data.js — 關卡資料視窗
 * ---------------------------------------------------------------------
 * 視窗內容（清單、關卡名稱、通關隊伍、兩隊編制）全部由本檔渲染。
 * 進入點：openStageDataModal()。按鈕在工具列，以及單位／角色／支援單位分頁「操作」。
 *
 * ── 原始需求（保留在此，不寫進 markdown）──────────────────────────
 * Add another modal called "關卡資料".
 * The users can enter the name of "關卡".
 * The users can enter multiple "通關隊伍".
 * For each "通關隊伍", the users can enter their "通關過程" and "Comments"
 * (both are string).
 * Each "通關隊伍" should contain two teams, each team has a maximum of
 * 5 units (minimum 1 unit) and 0 or 1 supporting units.
 * Each unit should have a corresponding character.
 * Each unit may carry 1 optional parts.
 *
 * ── 儲存格式（IndexedDB store: stages，keyPath id）──────────────
 * {
 *   id: 'st_…',
 *   name: string,                         // 關卡名稱，最長 100
 *   date_added, date_modified: ISO,
 *   clears: [                             // 通關隊伍，最多 20 組
 *     {
 *       process: string,                  // 通關過程，最長 4000
 *       comments: string,                 // Comments，最長 4000
 *       teams: [                          // 固定兩隊：隊伍 1、隊伍 2
 *         {
 *           units: [                      // 1～5 格。少於 1 格的隊伍整組通關不收
 *             {
 *               unitId, unitName,         // 單位（units）。名稱是快照，顯示時優先用 id 對回現名
 *               characterId, characterName, // 角色（characters）。每格必填
 *               optionalPartId, optionalPartName
 *                                         // 選擇性零件（optionalParts）。空字串＝沒帶
 *             }
 *           ],
 *           supportId, supportName        // 支援單位（supports）。空字串＝這隊沒有支援（0 或 1）
 *         },
 *         { units, supportId, supportName }
 *       ]
 *     }
 *   ]
 * }
 * 支援單位沿用「支援單位」分頁的記錄，本身不再掛角色或選擇性零件；
 * 角色與選擇性零件只掛在每一隊的 1～5 個單位上。
 * 單位 id 為 __wkinds__ 的系統記錄不會出現在下拉選單。
 * 舊備份 JSON 若沒有 stages 欄，匯入／下載不會清掉本地關卡。
 * 檔案裡明示 stages:[] 則會清掉本地關卡（與選擇性零件相同，屬於完全取代）。
 * ===================================================================== */

const ST_MAX_CLEARS = 20;
const ST_MAX_UNITS = 5;
const ST_MIN_UNITS = 1;
const ST_NAME_MAX = 100;
const ST_TEXT_MAX = 4000;

let ST_DRAFT = null;
let ST_CLEAN = '';
let ST_FILTER = '';
let ST_OPENING = false;
let ST_CAT = { units: [], characters: [], supports: [], parts: [] };

function stClip(s, n) {
    return String(s == null ? '' : s).slice(0, n);
}
function stId(v) {
    if (v === undefined || v === null) return '';
    return String(v).trim();
}
function blankStSlot() {
    return { unitId: '', unitName: '', characterId: '', characterName: '', optionalPartId: '', optionalPartName: '' };
}
function blankStTeam() {
    return { units: [blankStSlot()], supportId: '', supportName: '' };
}
function blankStClear() {
    return { process: '', comments: '', teams: [blankStTeam(), blankStTeam()] };
}
function blankStDraft() {
    return { id: null, name: '', clears: [blankStClear()], date_added: null };
}
function stSlotEmpty(u) {
    return !stId(u && u.unitId) && !stId(u && u.characterId) && !stId(u && u.optionalPartId);
}
function stClearUntouched(cl) {
    if (!cl) return true;
    if (String(cl.process || '').trim() || String(cl.comments || '').trim()) return false;
    return (cl.teams || []).every(t => !stId(t && t.supportId) && (t.units || []).every(stSlotEmpty));
}
function stByName(a, b) {
    return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'zh-Hant');
}
function stNameOf(list, id, fallback) {
    if (!id) return '';
    const hit = (list || []).find(x => x && String(x.id) === String(id));
    if (hit) return stClip(hit.name || '(未命名)', ST_NAME_MAX);
    return stClip(fallback || '', ST_NAME_MAX);
}

/* 正規化一筆關卡。缺單位或缺角色的格子會丟掉；任一隊因此少於 1 格時，整組通關隊伍丟掉。 */
function normalizeStage(raw) {
    if (!raw || typeof raw !== 'object') raw = {};
    const clears = [];
    (Array.isArray(raw.clears) ? raw.clears : []).slice(0, ST_MAX_CLEARS).forEach(cl => {
        if (!cl || typeof cl !== 'object') return;
        const teamsIn = Array.isArray(cl.teams) ? cl.teams : [];
        const teams = [0, 1].map(i => {
            const t = teamsIn[i] && typeof teamsIn[i] === 'object' ? teamsIn[i] : {};
            const units = [];
            (Array.isArray(t.units) ? t.units : []).slice(0, ST_MAX_UNITS).forEach(u => {
                if (!u || typeof u !== 'object') return;
                const unitId = stId(u.unitId);
                const characterId = stId(u.characterId);
                if (!unitId || !characterId) return;
                const optionalPartId = stId(u.optionalPartId);
                units.push({
                    unitId,
                    unitName: stClip(u.unitName, ST_NAME_MAX),
                    characterId,
                    characterName: stClip(u.characterName, ST_NAME_MAX),
                    optionalPartId,
                    optionalPartName: optionalPartId ? stClip(u.optionalPartName, ST_NAME_MAX) : ''
                });
            });
            const supportId = stId(t.supportId);
            return {
                units,
                supportId,
                supportName: supportId ? stClip(t.supportName, ST_NAME_MAX) : ''
            };
        });
        if (teams.some(t => t.units.length < ST_MIN_UNITS)) return;
        clears.push({
            process: stClip(cl.process, ST_TEXT_MAX).trim(),
            comments: stClip(cl.comments, ST_TEXT_MAX).trim(),
            teams
        });
    });
    const name = stClip(raw.name, ST_NAME_MAX).trim();
    const rec = {
        id: stId(raw.id),
        name: name || '(未命名)',
        date_added: (typeof raw.date_added === 'string' && raw.date_added) ? raw.date_added : new Date().toISOString(),
        clears
    };
    if (typeof raw.date_modified === 'string' && raw.date_modified) rec.date_modified = raw.date_modified;
    return rec;
}

function sanitizeStages(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    arr.forEach(raw => {
        if (!raw || typeof raw !== 'object') return;
        if (raw.id === undefined || raw.id === null || String(raw.id).trim() === '') return;
        const id = String(raw.id);
        if (seen.has(id)) return;
        seen.add(id);
        out.push(normalizeStage({ ...raw, id }));
    });
    return out;
}

function stSelect(list, selectedId, snapshotName, blankLabel) {
    const sid = selectedId ? String(selectedId) : '';
    let found = !sid;
    const opts = [`<option value="">${esc(blankLabel)}</option>`];
    (list || []).forEach(it => {
        if (!it || it.id === undefined || it.id === null || it.id === '__wkinds__') return;
        const id = String(it.id);
        const name = it.name || '(未命名)';
        const sel = id === sid ? ' selected' : '';
        if (id === sid) found = true;
        opts.push(`<option value="${esc(id)}" data-name="${esc(name)}"${sel}>${esc(name)}</option>`);
    });
    if (sid && !found) {
        const name = snapshotName || '(未命名)';
        opts.push(`<option value="${esc(sid)}" data-name="${esc(name)}" selected>${esc(name)}（已不在資料庫）</option>`);
    }
    return opts.join('');
}

function stSelMeta(sel) {
    if (!sel || !sel.value) return { id: '', name: '' };
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    return { id: sel.value, name: opt ? (opt.getAttribute('data-name') || '') : '' };
}

function stClearText(cl) {
    return (cl.teams || []).map((t, i) => {
        const slots = (t.units || []).filter(u => stId(u.unitId) || stId(u.characterId)).map(u => {
            const unit = u.unitName || '（未選單位）';
            const ch = u.characterName || '（未選角色）';
            const op = u.optionalPartName ? `〔${u.optionalPartName}〕` : '';
            return `${unit}／${ch}${op}`;
        });
        const sup = stId(t.supportId) ? `；支援 ${t.supportName || '支援單位'}` : '';
        return `隊伍 ${i + 1}：${slots.join('、') || '（尚未配置）'}${sup}`;
    }).join('\n');
}

function captureStageDraft() {
    const nameEl = gi('st-name');
    if (!nameEl || !ST_DRAFT) return;
    const clears = [];
    document.querySelectorAll('#st-clears .st-clear').forEach(box => {
        const teams = [0, 1].map(ti => {
            const teamEl = box.querySelector('.st-team[data-ti="' + ti + '"]');
            const units = [];
            if (teamEl) {
                teamEl.querySelectorAll('.st-slot').forEach(row => {
                    const unit = stSelMeta(row.querySelector('.st-unit'));
                    const character = stSelMeta(row.querySelector('.st-char'));
                    const part = stSelMeta(row.querySelector('.st-op'));
                    units.push({
                        unitId: unit.id, unitName: unit.name,
                        characterId: character.id, characterName: character.name,
                        optionalPartId: part.id, optionalPartName: part.name
                    });
                });
            }
            const sup = stSelMeta(teamEl && teamEl.querySelector('.st-sup'));
            return { units: units.length ? units : [blankStSlot()], supportId: sup.id, supportName: sup.name };
        });
        clears.push({
            process: (box.querySelector('.st-process') || {}).value || '',
            comments: (box.querySelector('.st-comments') || {}).value || '',
            teams
        });
    });
    ST_DRAFT = { id: ST_DRAFT.id, name: nameEl.value, clears, date_added: ST_DRAFT.date_added };
}

function stSnap(d) {
    if (!d) return '';
    return JSON.stringify({
        id: d.id || null,
        name: d.name || '',
        clears: (d.clears || []).map(cl => ({
            process: cl.process || '',
            comments: cl.comments || '',
            teams: [0, 1].map(i => {
                const t = (cl.teams || [])[i] || blankStTeam();
                return {
                    supportId: t.supportId || '',
                    supportName: t.supportName || '',
                    units: (t.units && t.units.length ? t.units : [blankStSlot()]).map(u => ({
                        unitId: u.unitId || '',
                        unitName: u.unitName || '',
                        characterId: u.characterId || '',
                        characterName: u.characterName || '',
                        optionalPartId: u.optionalPartId || '',
                        optionalPartName: u.optionalPartName || ''
                    }))
                };
            })
        }))
    });
}
function stDirty() { return stSnap(ST_DRAFT) !== ST_CLEAN; }
function markStClean() { ST_CLEAN = stSnap(ST_DRAFT); }

async function refreshStCatalog() {
    const [units, characters, supports, parts] = await Promise.all([
        getAll('units'), getAll('characters'), getAll('supports'), getAll('optionalParts')
    ]);
    ST_CAT = {
        units: units.filter(u => u && u.id !== '__wkinds__').slice().sort(stByName),
        characters: characters.slice().sort(stByName),
        supports: supports.slice().sort(stByName),
        parts: parts.slice().sort(stByName)
    };
}

async function stAll() {
    return (await getAll('stages')).slice().sort(stByName);
}

function stMatches(stage, q) {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return true;
    const bits = [stage.name || ''];
    (stage.clears || []).forEach(cl => {
        bits.push(cl.process || '', cl.comments || '');
        (cl.teams || []).forEach(t => {
            bits.push(t.supportName || '');
            (t.units || []).forEach(u => bits.push(u.unitName || '', u.characterName || '', u.optionalPartName || ''));
        });
    });
    return bits.join('\n').toLowerCase().includes(query);
}

function renderStList() {
    const box = gi('st-list');
    if (!box) return;
    stAll().then(all => {
        const shown = all.filter(s => stMatches(s, ST_FILTER));
        const count = gi('st-count');
        if (count) count.textContent = `顯示 ${shown.length} / ${all.length}`;
        if (!shown.length) {
            box.innerHTML = '<p class="st-empty">沒有符合的關卡。</p>';
            return;
        }
        box.innerHTML = shown.map(s => {
            const on = ST_DRAFT && ST_DRAFT.id === s.id ? ' on' : '';
            const n = (s.clears || []).length;
            const first = (s.clears || [])[0];
            const blurb = first ? stClearText(first) : '（尚無通關隊伍）';
            return `<button type="button" class="st-card${on}" data-st="pick" data-id="${esc(s.id)}">
                <b>${esc(s.name || '(未命名)')}</b>
                <span>${n} 組通關\n${esc(blurb)}</span></button>`;
        }).join('');
    });
}

function renderStSlot(u, ui) {
    return `<div class="st-slot" data-ui="${ui}">
        <span class="st-idx">${ui + 1}</span>
        <label>單位 *
            <select class="st-unit">${stSelect(ST_CAT.units, u.unitId, u.unitName, '選擇單位')}</select>
        </label>
        <label>角色 *
            <select class="st-char">${stSelect(ST_CAT.characters, u.characterId, u.characterName, '選擇角色')}</select>
        </label>
        <label>選擇性零件
            <select class="st-op">${stSelect(ST_CAT.parts, u.optionalPartId, u.optionalPartName, '無')}</select>
        </label>
        <button type="button" class="btn btn-clear btn-sm" data-st="rm-slot" title="移除此單位">✕</button>
    </div>`;
}

function renderStTeam(team, ti) {
    const units = (team.units && team.units.length) ? team.units : [blankStSlot()];
    const addBtn = units.length >= ST_MAX_UNITS
        ? '<span class="hint">已達 5 個單位</span>'
        : '<button type="button" class="btn btn-clear btn-sm" data-st="add-slot">＋ 單位</button>';
    return `<div class="st-team" data-ti="${ti}">
        <div class="st-team-head">隊伍 ${ti + 1}<span class="hint">${units.length} / ${ST_MAX_UNITS}</span></div>
        ${units.map((u, ui) => renderStSlot(u, ui)).join('')}
        ${addBtn}
        <label class="st-supline">支援單位（可無）
            <select class="st-sup">${stSelect(ST_CAT.supports, team.supportId, team.supportName, '無')}</select>
        </label>
    </div>`;
}

function renderStClear(cl, ci) {
    return `<div class="st-clear" data-ci="${ci}">
        <div class="st-clear-head">
            <b>通關隊伍 ${ci + 1}</b>
            <button type="button" class="btn btn-warning btn-sm" data-st="rm-clear">移除這組</button>
        </div>
        <label class="st-text">通關過程
            <textarea class="st-process" maxlength="${ST_TEXT_MAX}" placeholder="這組隊伍怎麼通關">${esc(cl.process || '')}</textarea>
        </label>
        <label class="st-text">Comments
            <textarea class="st-comments" maxlength="${ST_TEXT_MAX}" placeholder="備註">${esc(cl.comments || '')}</textarea>
        </label>
        <div class="st-teams">
            ${[0, 1].map(ti => renderStTeam((cl.teams || [])[ti] || blankStTeam(), ti)).join('')}
        </div>
    </div>`;
}

function renderStEditor() {
    const box = gi('st-editor');
    if (!box || !ST_DRAFT) return;
    const d = ST_DRAFT;
    const clears = (d.clears && d.clears.length) ? d.clears : [blankStClear()];
    d.clears = clears;
    const preview = clears.map((cl, i) => `通關隊伍 ${i + 1}\n${stClearText(cl)}`).join('\n\n');
    const addClear = clears.length >= ST_MAX_CLEARS
        ? ''
        : '<button type="button" class="btn btn-info btn-sm" data-st="add-clear">＋ 通關隊伍</button>';
    box.innerHTML = `
        <div class="fg" style="margin-bottom:8px;">
            <label>關卡名稱 *</label>
            <input type="text" id="st-name" maxlength="${ST_NAME_MAX}" value="${esc(d.name || '')}" placeholder="關卡名稱">
        </div>
        <div class="st-preview" id="st-preview">${esc(preview)}</div>
        <div id="st-clears">
            ${clears.map((cl, ci) => renderStClear(cl, ci)).join('')}
        </div>
        ${addClear}
        <div class="ro-foot" style="margin-top:8px;">
            <button type="button" class="btn btn-clear btn-sm" data-st="new">＋ 空白關卡</button>
            ${d.id ? '<button type="button" class="btn btn-danger btn-sm" data-st="del">刪除</button>' : ''}
            <button type="button" class="btn btn-success btn-sm" data-st="save">💾 儲存</button>
        </div>`;
}

function refreshStPreview() {
    captureStageDraft();
    const el = gi('st-preview');
    if (!el || !ST_DRAFT) return;
    const text = (ST_DRAFT.clears || []).map((cl, i) => `通關隊伍 ${i + 1}\n${stClearText(cl)}`).join('\n\n') || '（尚未配置）';
    el.textContent = text;
}

function renderStagesIfOpen() {
    if (!gi('st-modal')) return;
    refreshStCatalog().then(() => {
        if (!gi('st-modal')) return;
        ST_DRAFT = blankStDraft();
        markStClean();
        renderStList();
        renderStEditor();
    });
}

function stCatalogHint() {
    const u = ST_CAT.units.length, c = ST_CAT.characters.length;
    const s = ST_CAT.supports.length, p = ST_CAT.parts.length;
    let txt = `可用資料：單位 ${u}、角色 ${c}、支援單位 ${s}、選擇性零件 ${p}。`;
    txt += '每一組通關隊伍固定兩隊；每隊 1～5 個單位，每個單位要選角色，選擇性零件與支援單位可以不選。';
    if (!u || !c) txt += ' 單位或角色還是空的，請先到對應分頁新增。';
    return txt;
}

async function openStageDataModal() {
    if (gi('st-modal') || ST_OPENING) return;
    ST_OPENING = true;
    try {
        await refreshStCatalog();
        if (gi('st-modal')) return;
        if (!ST_DRAFT) ST_DRAFT = blankStDraft();
        markStClean();
        const ov = document.createElement('div');
        ov.id = 'st-modal';
        ov.className = 'ro-overlay show';
        ov.innerHTML = `
            <div class="st-modal" role="dialog" aria-modal="true" aria-labelledby="st-title">
                <div class="ro-head">
                    <h3 id="st-title">🎯 關卡資料</h3>
                    <button type="button" class="btn btn-warning btn-sm" data-st="close">✕</button>
                </div>
                <p class="ro-hint">${esc(stCatalogHint())}</p>
                <div class="st-filters">
                    <label>搜尋<input type="text" id="st-q" value="${esc(ST_FILTER)}" placeholder="關卡、過程、單位或角色" data-st="filter"></label>
                    <button type="button" class="btn btn-clear btn-sm" data-st="clear-filter">清除篩選</button>
                </div>
                <div class="st-body">
                    <div class="st-list" id="st-list"></div>
                    <div class="st-editor" id="st-editor"></div>
                </div>
                <div class="ro-foot">
                    <span class="ro-count" id="st-count"></span>
                    <button type="button" class="btn btn-warning" data-st="close">關閉</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', onStClick);
        ov.addEventListener('input', onStInput);
        ov.addEventListener('change', onStChange);
        document.addEventListener('keydown', onStKey);
        renderStList();
        renderStEditor();
    } finally {
        ST_OPENING = false;
    }
}

function onStKey(e) {
    if (e.key === 'Escape' && gi('st-modal')) { e.preventDefault(); closeStageDataModal(); }
}
function onStInput(e) {
    const t = e.target;
    if (!t) return;
    if (t.dataset && t.dataset.st === 'filter') { ST_FILTER = t.value; renderStList(); return; }
    if (t.closest && t.closest('#st-editor')) refreshStPreview();
}
function onStChange(e) {
    const t = e.target;
    if (!t) return;
    if (t.closest && t.closest('#st-editor')) refreshStPreview();
}
function onStClick(e) {
    if (e.target && e.target.id === 'st-modal') { closeStageDataModal(); return; }
    const btn = e.target.closest ? e.target.closest('[data-st]') : null;
    if (!btn || !gi('st-modal') || !gi('st-modal').contains(btn)) return;
    const act = btn.dataset.st;
    if (act === 'close') return closeStageDataModal();
    if (act === 'filter') return;
    if (act === 'clear-filter') {
        ST_FILTER = '';
        const q = gi('st-q');
        if (q) q.value = '';
        renderStList();
        return;
    }
    if (act === 'pick') return pickStage(btn.dataset.id);
    captureStageDraft();
    if (act === 'add-clear') {
        if (ST_DRAFT.clears.length >= ST_MAX_CLEARS) { showToast('最多 ' + ST_MAX_CLEARS + ' 組通關隊伍', true); return; }
        ST_DRAFT.clears.push(blankStClear());
        renderStEditor();
        return;
    }
    if (act === 'rm-clear') {
        const ci = Number(btn.closest('.st-clear').dataset.ci);
        if (ST_DRAFT.clears.length <= 1) ST_DRAFT.clears = [blankStClear()];
        else ST_DRAFT.clears.splice(ci, 1);
        renderStEditor();
        return;
    }
    if (act === 'add-slot') {
        const ci = Number(btn.closest('.st-clear').dataset.ci);
        const ti = Number(btn.closest('.st-team').dataset.ti);
        const units = ST_DRAFT.clears[ci].teams[ti].units;
        if (units.length >= ST_MAX_UNITS) { showToast('每一隊最多 5 個單位', true); return; }
        units.push(blankStSlot());
        renderStEditor();
        return;
    }
    if (act === 'rm-slot') {
        const ci = Number(btn.closest('.st-clear').dataset.ci);
        const ti = Number(btn.closest('.st-team').dataset.ti);
        const ui = Number(btn.closest('.st-slot').dataset.ui);
        const units = ST_DRAFT.clears[ci].teams[ti].units;
        if (units.length <= 1) units.splice(0, 1, blankStSlot());
        else units.splice(ui, 1);
        renderStEditor();
        return;
    }
    if (act === 'new') return resetStDraft();
    if (act === 'save') return saveStage();
    if (act === 'del') return deleteStage();
}

function confirmDiscardSt() {
    captureStageDraft();
    if (!stDirty()) return true;
    return confirm('這筆關卡資料還沒儲存，要放棄變更嗎？');
}
function resetStDraft() {
    if (!confirmDiscardSt()) return;
    ST_DRAFT = blankStDraft();
    markStClean();
    renderStList();
    renderStEditor();
}
function stDraftFromStored(stage) {
    const src = stage.clears && stage.clears.length ? stage.clears : [blankStClear()];
    const clears = src.map(cl => ({
        process: cl.process || '',
        comments: cl.comments || '',
        teams: [0, 1].map(i => {
            const t = (cl.teams || [])[i] || {};
            let units = (Array.isArray(t.units) && t.units.length ? t.units : [blankStSlot()]).map(u => ({
                unitId: u.unitId || '',
                unitName: stNameOf(ST_CAT.units, u.unitId, u.unitName),
                characterId: u.characterId || '',
                characterName: stNameOf(ST_CAT.characters, u.characterId, u.characterName),
                optionalPartId: u.optionalPartId || '',
                optionalPartName: u.optionalPartId ? stNameOf(ST_CAT.parts, u.optionalPartId, u.optionalPartName) : ''
            }));
            if (!units.length) units = [blankStSlot()];
            const supportId = t.supportId || '';
            return {
                units,
                supportId,
                supportName: supportId ? stNameOf(ST_CAT.supports, supportId, t.supportName) : ''
            };
        })
    }));
    return { id: stage.id, name: stage.name || '', date_added: stage.date_added, clears };
}

async function pickStage(id) {
    if (ST_DRAFT && ST_DRAFT.id === id) return;
    if (!confirmDiscardSt()) return;
    const stage = (await stAll()).find(s => s.id === id);
    if (!stage) { showToast('找不到這筆關卡', true); renderStList(); return; }
    await refreshStCatalog();
    ST_DRAFT = stDraftFromStored(stage);
    markStClean();
    renderStList();
    renderStEditor();
}

/* 把編輯中的草稿收成可儲存的關卡。完全空白的通關隊伍略過；半填的格子回報錯誤。 */
function stCollect(draft) {
    const name = stClip(draft.name, ST_NAME_MAX).trim();
    if (!name) return { error: '請輸入關卡名稱' };
    const clears = [];
    const list = draft.clears || [];
    for (let ci = 0; ci < list.length; ci++) {
        const cl = list[ci] || blankStClear();
        if (stClearUntouched(cl)) continue;
        const teams = [];
        for (let ti = 0; ti < 2; ti++) {
            const t = (cl.teams || [])[ti] || blankStTeam();
            const units = [];
            const slots = t.units || [];
            for (let ui = 0; ui < slots.length; ui++) {
                const raw = slots[ui] || blankStSlot();
                if (stSlotEmpty(raw)) continue;
                if (!stId(raw.unitId) || !stId(raw.characterId)) {
                    return { error: `通關隊伍 ${ci + 1}、隊伍 ${ti + 1} 的第 ${ui + 1} 格要同時選擇單位與角色` };
                }
                const optionalPartId = stId(raw.optionalPartId);
                units.push({
                    unitId: stId(raw.unitId),
                    unitName: stNameOf(ST_CAT.units, raw.unitId, raw.unitName),
                    characterId: stId(raw.characterId),
                    characterName: stNameOf(ST_CAT.characters, raw.characterId, raw.characterName),
                    optionalPartId,
                    optionalPartName: optionalPartId ? stNameOf(ST_CAT.parts, optionalPartId, raw.optionalPartName) : ''
                });
            }
            if (units.length < ST_MIN_UNITS) return { error: `通關隊伍 ${ci + 1} 的隊伍 ${ti + 1} 至少要 1 個單位` };
            if (units.length > ST_MAX_UNITS) return { error: `通關隊伍 ${ci + 1} 的隊伍 ${ti + 1} 最多 5 個單位` };
            const supportId = stId(t.supportId);
            teams.push({
                units,
                supportId,
                supportName: supportId ? stNameOf(ST_CAT.supports, supportId, t.supportName) : ''
            });
        }
        clears.push({
            process: stClip(cl.process, ST_TEXT_MAX).trim(),
            comments: stClip(cl.comments, ST_TEXT_MAX).trim(),
            teams
        });
    }
    if (!clears.length) return { error: '請至少完成一組通關隊伍（兩隊都要有單位與角色）' };
    return {
        record: {
            id: draft.id || uid('st'),
            name,
            date_added: draft.date_added || new Date().toISOString(),
            clears
        }
    };
}

async function saveStage() {
    captureStageDraft();
    const collected = stCollect(ST_DRAFT);
    if (collected.error) { showToast(collected.error, true); return; }
    const built = normalizeStage(collected.record);
    if (!built.clears.length) { showToast('請至少完成一組通關隊伍（兩隊都要有單位與角色）', true); return; }
    await saveItem('stages', built);
    ST_DRAFT = stDraftFromStored(built);
    markStClean();
    updateStorageStatus();
    renderStList();
    renderStEditor();
    showToast('已儲存關卡：' + built.name);
}

async function deleteStage() {
    captureStageDraft();
    if (!ST_DRAFT || !ST_DRAFT.id) return;
    if (!confirm('確定要刪除「' + (ST_DRAFT.name || '這筆關卡') + '」嗎？')) return;
    await deleteItem('stages', ST_DRAFT.id);
    ST_DRAFT = blankStDraft();
    markStClean();
    updateStorageStatus();
    renderStList();
    renderStEditor();
    showToast('已刪除關卡');
}

function closeStageDataModal() {
    if (!confirmDiscardSt()) return;
    const ov = gi('st-modal');
    if (ov) ov.remove();
    document.removeEventListener('keydown', onStKey);
    ST_DRAFT = null;
    ST_CLEAN = '';
}
