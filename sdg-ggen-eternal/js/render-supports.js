
 
/* ---------- 支援單位 ---------- */
 
RENDER.supports = async function () {
    const all = await getAll('supports');
    const list = applySupFilters(all);
    const st = PAG.supports, tp = totalPagesOf(list.length, st.perPage);
    if (st.page > tp) st.page = tp;
    const pg = paginateArr(list, st.page, st.perPage);
 
    const filtered = list.length !== all.length;
    gi('cnt-supports').textContent =
        `支援單位總數：${all.length}` + (filtered ? `（篩選後顯示 ${list.length} 筆）` : '');
    gi('pi-supports').textContent = st.perPage === -1
        ? `顯示全部 ${list.length} 筆`
        : `顯示 ${(st.page - 1) * st.perPage + 1}–${Math.min(st.page * st.perPage, list.length)} / 共 ${list.length} 筆`;
 
    gi('grid-supports').innerHTML = pg.length
        ? pg.map(s => `<div class="card">
            <div class="card-head">${thumbHtml(s.image)}
                <div class="head-main"><h3 class="c-title">${esc(s.name)}</h3>
                    <div class="badges">${ordBadge(s.acqOrder)}${rarityBadge(s.rarity)}</div></div></div>
            <div class="card-body">
                <div class="kv">等級 <b class="${isMaxLevel(s, 'supports') ? 'lv-done' : ''}">${esc(s.level ?? '—')}${s.level != null ? `<span class="lv-cap">/${SUPPORT_MAX_LEVEL}</span>` : ''}</b>${isMaxLevel(s, 'supports') ? ' ✓滿級' : ''}</div>
            </div>
            ${cardActions('supports', s.id)}</div>`).join('')
        : `<p class="empty-msg">沒有符合條件的支援單位。</p>`;
 
    genPag('supports', st.page, tp, 'pb-supports-top');
    genPag('supports', st.page, tp, 'pb-supports-bot');
};
 
