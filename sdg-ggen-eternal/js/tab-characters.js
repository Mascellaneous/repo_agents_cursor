/* tab-characters.js — 角色分頁 HTML 模板與注入（內容＝原 #tab-characters 的「內部」內容） */
const TAB_CHARACTERS_HTML = `
    <div class="stats-bar"><span id="cnt-characters"></span></div>
    <div class="filter-panel">
        <div class="fsec">
            <div class="ttl">🔍 搜尋與篩選 — 角色</div>
            <input type="text" id="c-search" class="search-box" placeholder="搜尋名稱／系列／標籤／技能／能力／標籤加乘…" oninput="debouncedSearch('characters')">
            <div class="fgroup"><label>系列</label><select id="fc-series" onchange="fc('characters')"></select></div>
            <div class="fgroup"><label>稀有度</label><select id="fc-rarity" onchange="fc('characters')">
                <option value="">全部</option><option>UR</option><option>SSR</option><option>SR</option><option>R</option><option>N</option></select></div>
            <div class="fgroup"><label>等級</label>
                <select id="fc-lvlstate" onchange="fc('characters')"
                        title="UR 上限 100；SSR/SR/R/N 為 90/80/70/60；SP化後一律 100（UR 不適用 SP）">
                    <option value="">全部</option>
                    <option value="max">已滿級</option>
                    <option value="notmax">未滿級</option>
                </select>
            </div>
            <div class="fgroup"><label>類型</label><select id="fc-type" onchange="fc('characters')">
                <option value="">全部</option><option>攻擊</option><option>防禦</option><option>支援</option></select></div>
            <div class="fgroup"><label>SP化</label><select id="fc-sp" onchange="fc('characters')"
                    title="UR 上限 100；SSR/SR/R/N 為 90/80/70/60；SP化後一律 100（UR 不適用 SP）">
                <option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>圖片</label><select id="fc-image" onchange="fc('characters')">
                <option value="">全部</option><option value="y">有圖片</option><option value="n">無圖片</option></select></div>
            <div class="fgroup"><label>角色能力</label><select id="fc-ab" onchange="fc('characters')"></select></div>
            <div class="fgroup"><label>角色技能</label><select id="fc-sk" onchange="fc('characters')"></select></div>
            <div class="fgroup"><label>能力觸發需求（系列）</label>
                <select id="fc-abreq-series" onchange="fc('characters')"
                        title="篩選「任一角色能力的觸發需求系列清單」包含此值的角色"></select></div>
            <div class="fgroup"><label>能力觸發需求（標籤）</label>
                <select id="fc-abreq-tag" onchange="fc('characters')"
                        title="篩選「任一角色能力的觸發需求標籤清單」包含此值的角色"></select></div>
            <div class="fgroup"><label>契合度需求（系列）</label>
                <select id="fc-tbseries" onchange="fc('characters')"
                        title="篩選「契合度需求系列清單」包含此值的角色"></select></div>
            <div class="fgroup"><label>契合度需求（標籤）</label>
                <select id="fc-tbtag" onchange="fc('characters')"
                        title="篩選「契合度需求標籤清單」包含此值的角色"></select></div>               
            <div class="fgroup"><label>標籤</label>
                <button type="button" class="btn btn-info btn-sm" onclick="openTagModal('characters')">🏷 選擇標籤…</button>
                <span class="tag-summary" id="fc-tags-summary"></span>
            </div>
            <div class="fgroup"><label>排序</label>
                <select id="fc-sort" onchange="fc('characters')">
                    <option value="date">加入日期</option><option value="order" selected>獲得順序</option><option value="name">名稱</option><option value="rarity">稀有度</option>
                    <option value="lvl">等級</option><option value="shoot">射擊值</option><option value="melee">格鬥值</option>
                    <option value="awaken">覺醒值</option><option value="defend">守備值</option><option value="react">反應值</option>
                </select>
                <select id="fc-order" onchange="fc('characters')"><option value="desc">降冪</option><option value="asc">升冪</option></select>
            </div>
            <button class="btn btn-clear" onclick="clearC()">清除篩選</button>
        </div>
        <div class="fsec">
            <div class="ttl">🛠 操作</div>
            <button class="btn btn-primary" onclick="openCharForm()">➕ 新增角色</button>
            <button class="btn btn-info" onclick="openReorderModal('characters')">↕ 調整獲得順序</button>
            <button class="btn btn-info" onclick="openSkillModal()">📖 角色技能一覽</button>
            <button class="btn btn-info" onclick="openAbilityModal()">📖 角色能力一覽</button>
        </div>
    </div>
    <div class="pagination-controls">
        <div class="pagination-info"><span id="pi-characters"></span>
            <select id="pp-characters" onchange="changePerPage('characters')">
                <option value="20" selected>20 筆/頁</option><option value="50">50 筆/頁</option>
                <option value="100">100 筆/頁</option><option value="-1">全部</option>
            </select>
        </div>
        <div class="pagination-buttons" id="pb-characters-top"></div>
    </div>
    <div class="grid" id="grid-characters"></div>
    <div class="pagination-controls bottom"><div class="pagination-buttons" id="pb-characters-bot"></div></div>
 
    <!-- 角色 表單 -->
    <div class="form-section hidden" id="sec-characters">
        <h3 id="ft-characters">新增角色</h3>
        <form id="form-characters" autocomplete="off">
            <input type="hidden" id="c-id">
            <div class="frow">
                <div class="fg"><label>名稱 *</label><input type="text" id="c-name" maxlength="100" required></div>
                <div class="fg"><label>圖片 (URL)</label><input type="text" id="c-image" placeholder="https://…"></div>
            </div>
            <div class="frow">
                <div class="fg"><label>系列</label><input type="text" id="c-series" data-ac="series" placeholder="逗號分隔（與單位共用）"></div>
                <div class="fg"><label>標籤</label><input type="text" id="c-tags" data-ac="ctags" placeholder="逗號或空格分隔（僅使用「角色」標籤池）"><div class="hint">可用逗號（，、亦可）或空格分隔多個標籤</div></div>
            </div>
            <div class="frow">
                <div class="fg slim"><label>稀有度 *</label><select id="c-rarity">
                    <option value="">請選擇</option><option>UR</option><option>SSR</option><option selected>SR</option><option>R</option><option>N</option></select></div>
                <div class="fg slim"><label>類型 *</label><select id="c-type">
                    <option value="">請選擇</option><option>攻擊</option><option>防禦</option><option>支援</option></select></div>
                    <div class="fg slim"><label>SP化</label><select id="c-sp"><option>N</option><option>Y</option></select></div>
                <div class="fg slim"><label>等級 (1–100)</label><input type="number" id="c-lvl" min="1" max="100" step="1" value="1"></div>
                <div class="fg slim"><label>獲得順序</label><input type="number" id="c-acq" min="1" step="1" placeholder="自動"></div>
            </div>
            <fieldset class="mini">
                <legend>數值</legend>
                <div class="frow" style="margin-bottom:0;">
                    <div class="fg slim"><label>射擊值</label><input type="number" id="c-shoot" min="0" step="1" placeholder="0"></div>
                    <div class="fg slim"><label>格鬥值</label><input type="number" id="c-melee" min="0" step="1" placeholder="0"></div>
                    <div class="fg slim"><label>覺醒值</label><input type="number" id="c-awaken" min="0" step="1" placeholder="0"></div>
                    <div class="fg slim"><label>守備值</label><input type="number" id="c-defend" min="0" step="1" placeholder="0"></div>
                    <div class="fg slim"><label>反應值</label><input type="number" id="c-react" min="0" step="1" placeholder="0"></div>
                </div>
            </fieldset>
            <fieldset class="mini">
                <legend>角色技能</legend>
                <div class="frow" style="margin-bottom:0;">
                    <div class="fg"><label>角色技能1</label><input type="text" id="c-sk1" data-ac="csk" maxlength="120"></div>
                    <div class="fg"><label>角色技能2</label><input type="text" id="c-sk2" data-ac="csk" maxlength="120"></div>
                    <div class="fg"><label>角色技能3</label><input type="text" id="c-sk3" data-ac="csk" maxlength="120"></div>
                </div>
            </fieldset>
            <fieldset class="mini">
                <legend>角色能力</legend>
                <div class="hint" style="margin-bottom:4px;">部分能力需駕駛特定系列／標籤的單位才生效；每個能力可各自設定（留空＝不限）。</div>
                <div class="frow" style="margin-bottom:6px;">
                <div class="fg"><label>角色能力1</label><input type="text" id="c-ab1" data-ac="cab" maxlength="120">
                    <div class="frow" style="margin:3px 0 0;gap:4px;align-items:center;">
                        <button type="button" class="btn btn-info btn-sm" type="button"
                                onclick="openAbReqPicker(1,'series')">＋ 系列…</button>
                        <button type="button" class="btn btn-info btn-sm"
                                onclick="openAbReqPicker(1,'tag')">＋ 標籤…</button>
                        <select id="c-ab1logic" title="多個需求之間的關係">
                            <option value="AND">AND・且</option><option value="OR">OR・或</option></select>
                    </div>
                    <div id="c-ab1req-chips" class="abreq-chips" style="margin-top:3px;min-height:18px;"></div>
                </div>
                <div class="fg"><label>角色能力2</label><input type="text" id="c-ab2" data-ac="cab" maxlength="120">
                    <div class="frow" style="margin:3px 0 0;gap:4px;align-items:center;">
                        <button type="button" class="btn btn-info btn-sm" type="button"
                                onclick="openAbReqPicker(2,'series')">＋ 系列…</button>
                        <button type="button" class="btn btn-info btn-sm"
                                onclick="openAbReqPicker(2,'tag')">＋ 標籤…</button>
                        <select id="c-ab2logic" title="多個需求之間的關係">
                            <option value="AND">AND・且</option><option value="OR">OR・或</option></select>
                    </div>
                    <div id="c-ab2req-chips" class="abreq-chips" style="margin-top:3px;min-height:18px;"></div>
                </div>
                <div class="fg"><label>角色能力3</label><input type="text" id="c-ab3" data-ac="cab" maxlength="120">
                    <div class="frow" style="margin:3px 0 0;gap:4px;align-items:center;">
                        <button type="button" class="btn btn-info btn-sm" type="button"
                                onclick="openAbReqPicker(3,'series')">＋ 系列…</button>
                        <button type="button" class="btn btn-info btn-sm"
                                onclick="openAbReqPicker(3,'tag')">＋ 標籤…</button>
                        <select id="c-ab3logic" title="多個需求之間的關係">
                            <option value="AND">AND・且</option><option value="OR">OR・或</option></select>
                    </div>
                    <div id="c-ab3req-chips" class="abreq-chips" style="margin-top:3px;min-height:18px;"></div>
                </div>
                </div>
            </fieldset>
            <div class="frow">
                <div class="fg"><label>契合度</label>
                    <input type="text" id="c-tagbonus" maxlength="200" placeholder="契合度名稱" style="margin-top:3px;">
                    <input type="text" id="c-tagbonuseff" maxlength="500" placeholder="契合度效果說明" style="margin-top:3px;">
                    <div class="frow" style="margin:3px 0 0;gap:4px;align-items:center;">
                        <button type="button" class="btn btn-info btn-sm"
                                onclick="openAbReqPicker(0,'series')">＋ 系列…</button>
                        <button type="button" class="btn btn-info btn-sm"
                                onclick="openAbReqPicker(0,'tag')">＋ 標籤…</button>
                        <select id="c-tblogic" title="多個需求之間的關係">
                            <option value="AND">AND・且</option><option value="OR">OR・或</option></select>
                    </div>
                    <div id="c-tbreq-chips" class="abreq-chips" style="margin-top:3px;min-height:18px;"></div>
                </div>
            </div>
            <div class="frow">
                <button type="submit" class="btn btn-success">💾 儲存角色</button>
                <button type="button" class="btn btn-warning" onclick="cancelForm('characters')">取消</button>
            </div>
        </form>
    </div>
`;
 
function injectTabCharacters() {
    const el = gi('tab-characters');
    if (el && !el.dataset.injected) {
        el.innerHTML = TAB_CHARACTERS_HTML;
        el.dataset.injected = '1';
    }
}