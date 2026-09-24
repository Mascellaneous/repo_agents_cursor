
 
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
                    <div class="badges">${ordBadge(s.acqOrder)}${rarityBadge(s.rarity)}${s.limited === 'Y' ? '<span class="badge b-ltd">限定</span>' : ''}</div></div></div>
            <div class="card-body">
                <div class="kv">等級 <b class="${isMaxLevel(s, 'supports') ? 'lv-done' : ''}">${esc(s.level ?? '—')}${s.level != null ? `<span class="lv-cap">/${SUPPORT_MAX_LEVEL}</span>` : ''}</b>${isMaxLevel(s, 'supports') ? ' ✓滿級' : ''}</div>
                ${supportCaptainLine(s)}${supportSkillLine(s)}
            </div>
            ${cardActions('supports', s.id)}</div>`).join('')
        : `<p class="empty-msg">沒有符合條件的支援單位。</p>`;
 
    genPag('supports', st.page, tp, 'pb-supports-top');
    genPag('supports', st.page, tp, 'pb-supports-bot');
};

function supportCaptainLine(s) {
    const series = abReqArr(s.captainSeries);
    const tags = abReqArr(s.captainTags);
    if (!series.length && !tags.length) return '';
    const bits = series.map(x => '系列「' + x + '」').concat(tags.map(x => '標籤「' + x + '」'));
    const sep = s.captainLogic === 'OR' ? '或' : '且';
    const pct = (s.captainPct >= 1 && s.captainPct <= 100) ? s.captainPct : 36;
    return `<div class="skillline"><strong>隊長技能：</strong>${esc(bits.join(sep))}升特定單位的全能力值${pct}%（EN除外）</div>`;
}
function supportSkillLine(s) {
    const effects = (s.supportEffects || []).filter(e => e && (e.stat === 'hp' || e.stat === 'en') && e.pct);
    if (!effects.length && !s.supportSkillName) return '';
    const text = effects.map(e => '範圍內的我方單位恢復' + (e.stat === 'hp' ? 'HP' : 'EN') + e.pct + '%').join('、');
    const name = s.supportSkillName ? esc(s.supportSkillName) : '';
    return `<div class="skillline"><strong>支援技能：</strong>${name}${name && text ? ' — ' : ''}${esc(text)}</div>`;
}
 
