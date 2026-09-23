/* =====================================================================
 * reorder.js — 獲得順序調整視窗
 * ---------------------------------------------------------------------
 * ★ 功能：
 *   1. 拖曳排序（HTML5 Drag & Drop）
 *   2. 置頂（⤒）／置底（⤓）按鈕，以及 ↑↓ 上移／下移
 *   3. 數字輸入直接跳到指定位置
 *   4. 每列顯示縮圖、稀有度、類型徽章
 *   5. 儲存後 scheduleAutoSync('reorder-<type>') 僅排程一次自動上傳
 * ===================================================================== */
 
const RO = { type: null, items: [] };   // items：{ id, name, image, rarity, type }
 
async function openReorderModal(type) {
    roClose();                                          // 確保同時只有一個視窗
    const all = await getAll(type);
    if (!all || !all.length) { showToast(LABEL[type] + '尚無資料', true); return; }
 
    /* 依目前 acqOrder 排序（無順序者排最後，其次依加入日期、名稱） */
    const oOf = x => (typeof x.acqOrder === 'number' && x.acqOrder > 0) ? x.acqOrder : Number.MAX_SAFE_INTEGER;
    const items = [...all].sort((a, b) => {
        let r = oOf(a) - oOf(b);
        if (r === 0) r = String(a.date_added || '').localeCompare(String(b.date_added || ''));
        if (r === 0) r = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
        return r;
    }).map(x => ({
        id: x.id, name: x.name,
        image: x.image || '',
        rarity: x.rarity || '',
        type: x.type || ''
    }));
 
    RO.type = type;
    RO.items = items;
 
    const ov = document.createElement('div');
    ov.id = 'reorder-overlay';
    ov.className = 'ro-overlay show';
    ov.innerHTML = `
        <div class="ro-modal">
            <div class="ro-head">
                <h3>↕ 調整獲得順序 — ${esc(LABEL[type])}</h3>
                <button class="btn btn-warning btn-sm" onclick="roClose()">✕</button>
            </div>
            <p class="ro-hint">拖曳項目、使用 ↑↓／⤒⤓ 按鈕，或直接輸入目標位置編號。</p>
            <div id="ro-list" class="ro-list"></div>
            <div class="ro-foot">
                <span class="ro-count">共 ${RO.items.length} 筆</span>
                <button class="btn btn-success" onclick="roSave()">💾 儲存順序</button>
                <button class="btn btn-warning" onclick="roClose()">取消</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) roClose(); });
    roRender();
}
 
/* 稀有度徽章底色（沿用 cards.css 的 .b-* 配色概念） */
function roRarityColor(r) {
    return ({ UR: '#f1c40f', SSR: '#8e44ad', SR: '#2980b9', R: '#27ae60', N: '#7f8c8d' })[r] || '#7f8c8d';
}
 
function roRender() {
    const list = gi('ro-list');
    if (!list) return;
 
    list.innerHTML = RO.items.map((it, i) => `
        <div class="ro-item" draggable="true" data-i="${i}">
            <span class="ro-handle" title="拖曳以調整順序">⠿</span>
            <span class="ro-num">${i + 1}</span>
            <span class="ro-thumb" title="${esc(it.name)}">${
                it.image
                    ? `<img src="${esc(it.image)}" alt="" loading="lazy"
                           onerror="this.parentElement.innerHTML='<span class=\\'ph\\'>無圖</span>'">`
                    : '<span class="ph">無圖</span>'
            }</span>
            <span class="ro-name" title="${esc(it.name)}">${esc(it.name)}</span>
            <span class="ro-meta">${
                it.rarity
                    ? `<span class="badge" style="background:${roRarityColor(it.rarity)};
                        ${it.rarity === 'UR' ? 'color:#5b4a00;' : 'color:#fff;'}">${esc(it.rarity)}</span>`
                    : ''
            }${
                it.type
                    ? `<span class="badge" style="background:#95a5a6;color:#fff;margin-left:3px;">${esc(it.type)}</span>`
                    : ''
            }</span>
            <span class="ro-btns">
                <button class="btn btn-info btn-sm" title="置頂"   ${i === 0 ? 'disabled' : ''} onclick="roTop(${i})">⤒</button>
                <button class="btn btn-info btn-sm" title="上移"   ${i === 0 ? 'disabled' : ''} onclick="roMove(${i},-1)">↑</button>
                <button class="btn btn-info btn-sm" title="下移"   ${i === RO.items.length - 1 ? 'disabled' : ''} onclick="roMove(${i},1)">↓</button>
                <button class="btn btn-info btn-sm" title="置底"   ${i === RO.items.length - 1 ? 'disabled' : ''} onclick="roBottom(${i})">⤓</button>
                <input type="number" class="ro-jump" min="1" max="${RO.items.length}" step="1"
                       value="${i + 1}" data-i="${i}" title="輸入位置編號後按 Enter"
                       style="width:48px;text-align:center;padding:2px;border:1px solid #ccc;border-radius:4px;font-size:11px;">
            </span>
        </div>`).join('');
 
    /* 數字輸入：改變即移動到該位置 */
    list.querySelectorAll('.ro-jump').forEach(inp => {
        inp.addEventListener('change', () => roSetPos(+inp.dataset.i, parseInt(inp.value, 10)));
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
 
    roBindDrag(list);
}
 
/* ---------- 拖曳排序（HTML5 Drag & Drop） ---------- */
function roBindDrag(list) {
    let dragIdx = null;
 
    list.querySelectorAll('.ro-item').forEach(el => {
        el.addEventListener('dragstart', e => {
            dragIdx = +el.dataset.i;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (_) {}
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            list.querySelectorAll('.ro-item').forEach(x => x.style.borderTop = '');
            dragIdx = null;
        });
        el.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragIdx === null) return;
            const overIdx = +el.dataset.i;
            list.querySelectorAll('.ro-item').forEach(x => x.style.borderTop = '');
            if (overIdx !== dragIdx) el.style.borderTop = '2px solid #3498db';
        });
        el.addEventListener('dragleave', () => { el.style.borderTop = ''; });
        el.addEventListener('drop', e => {
            e.preventDefault();
            if (dragIdx === null) return;
            const to = +el.dataset.i;
            if (to !== dragIdx) {
                const [it] = RO.items.splice(dragIdx, 1);
                RO.items.splice(to, 0, it);
            }
            dragIdx = null;
            roRender();
        });
    });
}
 
/* ---------- 按鈕操作 ---------- */
function roMove(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= RO.items.length) return;
    [RO.items[i], RO.items[j]] = [RO.items[j], RO.items[i]];
    roRender();
}
 
function roTop(i) {
    if (i <= 0) return;
    const [it] = RO.items.splice(i, 1);
    RO.items.unshift(it);
    roRender();
}
 
function roBottom(i) {
    if (i >= RO.items.length - 1) return;
    const [it] = RO.items.splice(i, 1);
    RO.items.push(it);
    roRender();
}
 
function roSetPos(i, val) {
    if (isNaN(val)) { roRender(); return; }
    const pos = Math.min(Math.max(val, 1), RO.items.length) - 1;
    const [it] = RO.items.splice(i, 1);
    RO.items.splice(pos, 0, it);
    roRender();
}
 
/* ---------- 儲存 ---------- */
async function roSave() {
    const type = RO.type;
    if (!type) return;
    const all = await getAll(type);
    const byId = new Map(all.map(x => [x.id, x]));
    /* 依最終排列重新編號 1..n（順序值正規化為連續整數） */
    for (let i = 0; i < RO.items.length; i++) {
        const rec = byId.get(RO.items[i].id);
        if (!rec) continue;                       // 視窗開啟期間被刪除的記錄 → 略過
        rec.acqOrder = i + 1;
        await db.put(type, rec);
    }
    inv(type);
    roClose();
    RENDER[type]();
    showToast(LABEL[type] + '獲得順序已更新');
    scheduleAutoSync('reorder-' + type);          // ★ 編輯性操作 → 自動上傳（僅排程一次）
}
 
function roClose() {
    RO.type = null;
    RO.items = [];
    const ov = gi('reorder-overlay');
    if (ov) ov.remove();
}