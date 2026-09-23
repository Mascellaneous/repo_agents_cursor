
 
/* ---------- 角色 ---------- */

function buildCharCard(c) {
    const stat = (l, v) => `<span>${l} <b>${esc(v ?? 0)}</b></span>`;
    const cLvDone = isMaxLevel(c, 'characters');
    const cLvCap  = getMaxLevel(c, 'characters');    
    const skl = [1,2,3].map(i => c['sk' + i] ? `<div class="skillline"><strong>技能${i}：</strong>${esc(c['sk' + i])}</div>` : '').join('');
    const abl = [1,2,3].map(i => {
        if (!c['ab' + i]) return '';
        const parts = [
            ...abReqArr(c['ab' + i + 'Series']).map(x => `系列「${esc(x)}」`),
            ...abReqArr(c['ab' + i + 'Tag']).map(x => `標籤「${esc(x)}」`)
        ];
        const sep = (c['ab' + i + 'Logic'] === 'OR') ? '／' : '＋';
        return `<div class="skillline"><strong>能力${i}：</strong>${esc(c['ab' + i])}` +
               (parts.length ? `<span class="mini-line">（需${parts.join(sep)}）</span>` : '') + `</div>`;
    }).join('');
    const tbParts = [
        ...abReqArr(c.tagBonusSeries).map(x => `系列「${esc(x)}」`),
        ...abReqArr(c.tagBonusTag).map(x => `標籤「${esc(x)}」`)
    ];
    const tbSep = (c.tagBonusLogic === 'OR') ? '／' : '＋';
    const tbReq = tbParts.length ? `（需${tbParts.join(tbSep)}）` : '';    
    return `<div class="card">
        <div class="card-head">${thumbHtml(c.image)}
            <div class="head-main">
                <h3 class="c-title">${esc(c.name)}</h3>
                <div class="badges">${ordBadge(c.acqOrder)}${rarityBadge(c.rarity)}${typeBadge(c.type)}${c.sp === 'Y' ? '<span class="badge b-sp">SP</span>' : ''}</div>
                ${(c.series || []).length ? `<div class="mini-line">系列：${chips(c.series, '')}</div>` : ''}
                ${(c.tags || []).length   ? `<div class="mini-line">標籤：${chips(c.tags, 'tag')}</div>` : ''}
            </div></div>
        <div class="card-body">
            <div class="kv">等級 <b class="${cLvDone ? 'lv-done' : ''}">${esc(c.level)}${cLvCap ? `<span class="lv-cap">/${cLvCap}</span>` : ''}</b>${cLvDone ? ' ✓滿級' : ''}</div>
            <div class="statrow">${stat('射擊', c.shoot)}${stat('格鬥', c.melee)}${stat('覺醒', c.awaken)}${stat('守備', c.defend)}${stat('反應', c.react)}</div>
            ${skl}${abl}
            ${(c.tagBonus || tbParts.length) ? `<div class="skillline"><strong>契合度：</strong>${esc(c.tagBonus || '')}${tbReq}</div>` : ''}
        </div>
        ${cardActions('characters', c.id)}</div>`;
}
 
RENDER.characters = async function () {
    const all = await getAll('characters');
    refreshAbReqSelects(); 
    const list = applyCharFilters(all);
    const st = PAG.characters, tp = totalPagesOf(list.length, st.perPage);
    if (st.page > tp) st.page = tp;
    const pg = paginateArr(list, st.page, st.perPage);
 
    const filtered = list.length !== all.length;
    gi('cnt-characters').textContent =
        `角色總數：${all.length}` + (filtered ? `（篩選後顯示 ${list.length} 筆）` : '');
    gi('pi-characters').textContent = st.perPage === -1
        ? `顯示全部 ${list.length} 筆`
        : `顯示 ${(st.page - 1) * st.perPage + 1}–${Math.min(st.page * st.perPage, list.length)} / 共 ${list.length} 筆`;
 
    gi('grid-characters').innerHTML = pg.length
        ? pg.map(buildCharCard).join('')
        : `<p class="empty-msg">沒有符合條件的角色。調整篩選條件，或點「➕ 新增角色」。</p>`;
 
    genPag('characters', st.page, tp, 'pb-characters-top');
    genPag('characters', st.page, tp, 'pb-characters-bot');
};