/* =====================================================================
 * render-units.js / render-characters.js / render-supports.js
 * （本檔同時存放三個分頁共用的卡片元件與分頁器）
 * ---------------------------------------------------------------------
 * ★ 本次改動：
 *   1. RENDER.units 排除系統記錄 __wkinds__（武裝效果名稱對照，存於 units
 *      存放區以隨同步／匯出備份；不可渲染為卡片）。
 *   2. 效果／限制顯示改用「類型層級名稱」（formatWeaponEffect／
 *      formatWeaponLimit，見 weapon-effect-types.js）——同類效果跨單位同名。
 * ===================================================================== */
const RENDER = {};
 
function thumbHtml(img) {
    img = String(img || '').trim();
    /* ★ 防呆：網頁檔（.html/.htm）與頁面自身 URL 都不是圖片。
       file:// 下每個檔案皆為獨立 origin，誤載會觸發安全性警告。 */
    if (img && (/\.html?(\?[^#]*)?$/i.test(img) || img === location.href || img === location.pathname)) img = '';
    if (img) {
        return `<div class="thumb">
            <img src="${esc(img)}" alt="" loading="lazy"
                 onerror="this.nextElementSibling.style.display='flex';this.remove()">
            <span class="ph" style="display:none">無圖片</span></div>`;
    }
    return `<div class="thumb"><span class="ph">無圖片</span></div>`;
}
function chips(arr, cls) { return (arr || []).map(x => `<span class="chip ${cls}">${esc(x)}</span>`).join(''); }
 
function rarityBadge(r){ return r ? `<span class="badge b-${esc(r)}">${esc(r)}</span>` : ''; }
function typeBadge(t){
    const m = { '攻擊': 'b-atk', '防禦': 'b-def', '支援': 'b-sup' };
    return t ? `<span class="badge ${m[t] || 'b-N'}">${esc(t)}</span>` : '';
}
/* ★ 獲得順序徽章（無順序值 → 不顯示） */
function ordBadge(n) {
    return (typeof n === 'number' && n > 0)
        ? `<span class="badge b-ord" title="獲得順序：第 ${n} 位">#${esc(n)}</span>` : '';
}
function cardActions(t, id) {
    return `<div class="card-actions">
        <button class="btn btn-warning btn-sm" data-act="edit" data-type="${t}" data-id="${esc(id)}">✎ 編輯</button>
        <button class="btn btn-danger btn-sm"  data-act="del"  data-type="${t}" data-id="${esc(id)}">🗑 刪除</button></div>`;
}
 
/* ---------- 分頁元件 ---------- */
function genPag(type, page, tp, cid) {
    const c = gi(cid); if (!c) return;
    if (tp <= 1) { c.innerHTML = `<button class="pagination-btn active" disabled>1</button>`; return; }
    let h = '';
    const btn = (p, l, dis, act) =>
        `<button class="pagination-btn${act ? ' active' : ''}"${dis ? ' disabled' : ''} onclick="goToPage('${type}',${p})">${l}</button>`;
    h += btn(page - 1, '«', page <= 1, false);
    const s = Math.max(1, page - 2), e = Math.min(tp, page + 2);
    if (s > 1) { h += btn(1, '1', false, page === 1); if (s > 2) h += `<span class="pdots">…</span>`; }
    for (let i = s; i <= e; i++) h += btn(i, i, false, i === page);
    if (e < tp) { if (e < tp - 1) h += `<span class="pdots">…</span>`; h += btn(tp, tp, false, page === tp); }
    h += btn(page + 1, '»', page >= tp, false);
    c.innerHTML = h;
}
function goToPage(t, p) { PAG[t].page = p; RENDER[t](); }
function changePerPage(t) {
    const v = parseInt(gi('pp-' + t).value, 10);
    PAG[t].perPage = isNaN(v) ? 20 : v;
    PAG[t].page = 1;
    RENDER[t]();
}
function fc(t) { PAG[t].page = 1; RENDER[t](); }
function debouncedSearch(t) {
    clearTimeout(_debTimers[t]);
    _debTimers[t] = setTimeout(() => fc(t), 300);
}
 
/* ---------- ★ 武裝詳細顯示（僅列出已設定的項目） ---------- */
function weaponDetailsHtml(u) {
    if (!u.weapons) return '';
    const blocks = [];
    for (let i = 1; i <= 5; i++) {
        const w = u.weapons[i];
        const lv = weaponLevelOf(w);
        if (lv === '-') continue;
        const head = [], stats = [];
        let eff = [], lim = [];
        if (w && typeof w === 'object') {
            if (w.name) head.push('「' + w.name + '」');
            if (w.map === 'Y') {
                head.push('MAP兵器:Y');
                if (w.shape) head.push('形狀:' + w.shape);
                if (w.ammo) head.push('彈藥量:' + w.ammo);   // ★ 新增：彈藥量
            } else {
                if (w.map === 'N') head.push('MAP兵器:N');
                const rt = weaponRangeText(w);          // weapon-filters.js（相容舊格式）
                if (rt) head.push('射程:' + rt);
            }
            if (w.mp) head.push('MP:' + w.mp);
            if (w.power) stats.push('POWER:' + w.power);
            if (w.en)    stats.push('EN:' + w.en);
            if (w.hit)   stats.push('命中:' + w.hit);
            if (w.crit)  stats.push('爆擊:' + w.crit);
            if (Array.isArray(w.atkTypes) && w.atkTypes.length) stats.push(w.atkTypes.join('/'));
            /* 效果／限制：類型層級名稱（所有單位同名），如 防禦力debuff(30%)(1回合) */
            eff = (Array.isArray(w.effects) ? w.effects : []).map(formatWeaponEffect).filter(Boolean);
            lim = (Array.isArray(w.limits)  ? w.limits  : []).map(formatWeaponLimit).filter(Boolean);
        }
        if (!head.length && !stats.length && !eff.length && !lim.length) continue;
        let h = `<div style="margin-top:2px;"><b>武裝${i}</b>（Lv.${esc(lv)}）${head.length ? '：' + esc(head.join('・')) : ''}</div>`;
        if (stats.length) h += `<div style="margin-left:10px;">${esc(stats.join('・'))}</div>`;
        if (eff.length)   h += `<div style="margin-left:10px;">效果：${esc(eff.join('・'))}</div>`;
        if (lim.length)   h += `<div style="margin-left:10px;">限制：${esc(lim.join('・'))}</div>`;
        blocks.push(h);
    }
    return blocks.length ? `<div class="kv" style="font-size:11px;">武裝詳細：${blocks.join('')}</div>` : '';
}
 
/* ---------- 單位 ---------- */

function buildUnitCard(u) {
    const feats = [];
    const uLvDone = isMaxLevel(u, 'units');
    const uLvCap  = getMaxLevel(u, 'units');
    if (u.shield === 'Y') feats.push('盾牌');
    if (u.size2x2 === 'Y') feats.push('2×2格');
    /* ★ 逃生機能：以 escapedId 解析目標單位的最新名稱（對方改名自動同步） */
    if (u.escape === 'Y') feats.push('逃生機能 → ' + (getEscapedName(u) || '?'));
    /* ★ 可變型：以 transformedId 解析目標單位的最新名稱 */
    if (u.transformable === 'Y') feats.push('可變型 → ' + (getTransformedName(u) || '?'));
    const trChips = TERRAINS.map(([lab, k]) => {
        const v = u.terrain && u.terrain[k];
        if (!v || v === '-') return '';   // 不顯示無適性(-)的地形；想全部顯示就刪掉這行
        return `<span class="chip tr">${esc(lab)} ${esc(v)}</span>`;
    }).join('');
    const wLine = [1,2,3,4,5].map(i => weaponLevelOf(u.weapons && u.weapons[i])).join(' / ');
    const hasW = [1,2,3,4,5].some(i => weaponLevelOf(u.weapons && u.weapons[i]) !== '-');
    const wDetails = showUnitWeaponDetails() ? weaponDetailsHtml(u) : '';
 
    return `<div class="card">
        <div class="card-head">${thumbHtml(u.image)}
            <div class="head-main">
                <h3 class="c-title">${esc(u.name)}</h3>
                <div class="badges">${ordBadge(u.acqOrder)}${rarityBadge(u.rarity)}${typeBadge(u.type)}
                    ${u.limited === 'Y' ? '<span class="badge b-ltd">限定</span>' : ''}
                    ${u.sp  === 'Y' ? '<span class="badge b-sp">SP</span>'  : ''}
                    ${u.ssp === 'Y' ? '<span class="badge b-ssp">SSP</span>' : ''}</div>
                ${(u.series || []).length ? `<div class="mini-line">系列：${chips(u.series, '')}</div>` : ''}
                ${(u.tags || []).length   ? `<div class="mini-line">標籤：${chips(u.tags, 'tag')}</div>` : ''}
            </div></div>
        <div class="card-body">
            <div class="kv">移動力 <b>${esc(u.mobility)}</b>　·　等級 <b class="${uLvDone ? 'lv-done' : ''}">${esc(u.level)}${uLvCap ? `<span class="lv-cap">/${uLvCap}</span>` : ''}</b>${uLvDone ? ' ✓滿級' : ''}　·　突破界限 <b>${esc(u.limitBreak)}</b></div>
            ${trChips ? `<div class="kv">地形：${trChips}</div>` : ''}
            ${feats.length ? `<div class="kv">${feats.map(f => `<span class="chip feat">${esc(f)}</span>`).join('')}</div>` : ''}
            ${hasW ? `<div class="kv" style="font-size:11px;">武裝等級：${esc(wLine)}</div>` : ''}
            ${wDetails}
            ${u.src ? `<div class="kv" style="font-size:11px;">獲得來源：${esc(u.src)}</div>` : ''}
            ${u.comments ? `<div class="comments-blk" title="${esc(u.comments)}">${esc(u.comments)}</div>` : ''}
        </div>
        ${cardActions('units', u.id)}</div>`;
}
 
/* 武裝詳細顯示開關：fu-hidewd 勾選＝卡片不渲染武裝詳細。
 * 控制項不存在時預設「顯示」（gi() null-safe）。 */
function showUnitWeaponDetails() {
    const el = gi('fu-hidewd');
    return !(el && el.checked);
}

RENDER.units = async function () {
    /* ★ 排除系統記錄 __wkinds__（武裝效果名稱對照），不計入總數、不渲染 */
    const all = (await getAll('units')).filter(u => u && u.id !== '__wkinds__');
    const list = applyUnitFilters(all);
    const st = PAG.units, tp = totalPagesOf(list.length, st.perPage);
    if (st.page > tp) st.page = tp;
    const pg = paginateArr(list, st.page, st.perPage);
 
    const filtered = list.length !== all.length;
    gi('cnt-units').textContent =
        `單位總數：${all.length}` + (filtered ? `（篩選後顯示 ${list.length} 筆）` : '');
    gi('pi-units').textContent = st.perPage === -1
        ? `顯示全部 ${list.length} 筆`
        : `顯示 ${(st.page - 1) * st.perPage + 1}–${Math.min(st.page * st.perPage, list.length)} / 共 ${list.length} 筆`;
 
    gi('grid-units').innerHTML = pg.length
        ? pg.map(buildUnitCard).join('')
        : `<p class="empty-msg">沒有符合條件的單位。調整篩選條件，或點「➕ 新增單位」。</p>`;
 
    genPag('units', st.page, tp, 'pb-units-top');
    genPag('units', st.page, tp, 'pb-units-bot');
};