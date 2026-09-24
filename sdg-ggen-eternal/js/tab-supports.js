/* tab-supports.js — 支援單位分頁 HTML 模板與注入（內容＝原 #tab-supports 的「內部」內容） */
const TAB_SUPPORTS_HTML = `
    <div class="stats-bar"><span id="cnt-supports"></span></div>
    <div class="filter-panel">
        <div class="fsec">
            <div class="ttl">🔍 搜尋 — 支援單位</div>
            <input type="text" id="s-search" class="search-box" placeholder="搜尋名稱…" oninput="debouncedSearch('supports')">
            <div class="fgroup"><label>稀有度</label><select id="fs-rarity" onchange="fc('supports')">
                <option value="">全部</option><option>UR</option><option>SSR</option><option>SR</option><option value="none">未設定</option></select></div>
            <div class="fgroup"><label>圖片</label><select id="fs-image" onchange="fc('supports')">
                <option value="">全部</option><option value="y">有圖片</option><option value="n">無圖片</option></select></div>
            <div class="fgroup"><label>限定</label><select id="fs-limited" onchange="fc('supports')">
                <option value="">全部</option><option value="Y">限定</option><option value="N">非限定</option></select></div>
            <div class="fgroup"><label>隊長技能（系列）</label><select id="fs-cap-series" onchange="fc('supports')" title="隊長技能的系列清單包含此值">
                <option value="">全部</option></select></div>
            <div class="fgroup"><label>隊長技能（標籤）</label><select id="fs-cap-tag" onchange="fc('supports')" title="隊長技能的標籤清單包含此值">
                <option value="">全部</option></select></div>
            <div class="fgroup"><label>支援技能</label><select id="fs-supskill" onchange="fc('supports')">
                <option value="">全部</option><option value="hp">恢復HP</option><option value="en">恢復EN</option><option value="none">沒有支援技能</option></select></div>
            <div class="fgroup"><label>等級</label>
                <select id="fs-lvlstate" onchange="fc('supports')"
                        title="支援單位以上限值判斷滿級（上限見程式內 SUPPORT_MAX_LEVEL）">
                    <option value="">全部</option>
                    <option value="max">已滿級</option>
                    <option value="notmax">未滿級</option>
                </select>
            </div>
            <div class="fgroup"><label>排序</label>
                <select id="fs-sort" onchange="fc('supports')"><option value="date">加入日期</option><option value="order" selected>獲得順序</option><option value="name">名稱</option><option value="rarity">稀有度</option><option value="limited">限定</option><option value="captain">隊長技能%</option><option value="skill">支援技能名稱</option></select>
                <select id="fs-order" onchange="fc('supports')"><option value="desc">降冪</option><option value="asc">升冪</option></select>
            </div>
            <button class="btn btn-clear" onclick="clearS()">清除</button>
        </div>
        <div class="fsec">
            <div class="ttl">🛠 操作</div>
            <button class="btn btn-primary" onclick="openSupportForm()">➕ 新增支援單位</button>
            <button class="btn btn-info" onclick="openReorderModal('supports')">↕ 調整獲得順序</button>
            <button class="btn btn-info" onclick="openStageDataModal()">🎯 關卡資料</button>
        </div>
    </div>
    <div class="pagination-controls">
        <div class="pagination-info"><span id="pi-supports"></span>
            <select id="pp-supports" onchange="changePerPage('supports')">
                <option value="20" selected>20 筆/頁</option><option value="50">50 筆/頁</option>
                <option value="100">100 筆/頁</option><option value="-1">全部</option>
            </select>
        </div>
        <div class="pagination-buttons" id="pb-supports-top"></div>
    </div>
    <div class="grid grid-sm" id="grid-supports"></div>
    <div class="pagination-controls bottom"><div class="pagination-buttons" id="pb-supports-bot"></div></div>
 
    <!-- 支援單位 表單 -->
    <div class="form-section hidden" id="sec-supports">
        <h3 id="ft-supports">新增支援單位</h3>
        <form id="form-supports" autocomplete="off">
            <input type="hidden" id="s-id">
            <div class="frow">
                <div class="fg"><label>名稱 *</label><input type="text" id="s-name" maxlength="100" required></div>
                <div class="fg"><label>圖片 (URL)</label><input type="text" id="s-image" placeholder="https://…"></div>
                <div class="fg slim"><label>稀有度 *</label><select id="s-rarity">
                    <option value="">請選擇</option><option>UR</option><option>SSR</option><option>SR</option></select></div>
                <div class="fg slim"><label>獲得順序</label><input type="number" id="s-acq" min="1" step="1" placeholder="自動"></div>
                <div class="fg slim"><label>等級 (1–100)</label><input type="number" id="s-lvl" min="1" max="100" step="1" value="1"></div>
                <div class="fg slim"><label>限定</label><select id="s-limited"><option value="N">N</option><option value="Y">Y</option></select></div>
            </div>
            <div class="frow">
                <div class="fg"><label>隊長技能</label>
                    <p class="hint">選擇單位的系列或標籤。顯示為「系列／標籤升特定單位的全能力值n%（EN除外）」。</p>
                    <div class="frow" style="margin:3px 0 0;gap:4px;align-items:center;">
                        <button type="button" class="btn btn-info btn-sm" onclick="openSupCapPicker('series')">＋ 系列…</button>
                        <button type="button" class="btn btn-info btn-sm" onclick="openSupCapPicker('tag')">＋ 標籤…</button>
                        <select id="s-caplogic" title="多個系列／標籤之間的關係">
                            <option value="AND">AND・且</option><option value="OR">OR・或</option></select>
                        <label>全能力值%<input type="number" id="s-cappct" min="1" max="100" step="1" value="36" style="width:64px;"></label>
                    </div>
                    <div id="s-cap-chips" class="abreq-chips" style="margin-top:3px;min-height:18px;"></div>
                </div>
            </div>
            <div class="frow">
                <div class="fg"><label>支援技能名稱</label><input type="text" id="s-skname" maxlength="80" placeholder="技能名稱"></div>
                <div class="fg slim"><label>恢復HP %</label><input type="number" id="s-skhp" min="1" max="100" step="1" placeholder="空白＝無"></div>
                <div class="fg slim"><label>恢復EN %</label><input type="number" id="s-sken" min="1" max="100" step="1" placeholder="空白＝無"></div>
            </div>
            <div class="frow">
                <button type="submit" class="btn btn-success">💾 儲存支援單位</button>
                <button type="button" class="btn btn-warning" onclick="cancelForm('supports')">取消</button>
            </div>
        </form>
    </div>
`;
 
function injectTabSupports() {
    const el = gi('tab-supports');
    if (el && !el.dataset.injected) {
        el.innerHTML = TAB_SUPPORTS_HTML;
        el.dataset.injected = '1';
    }
}