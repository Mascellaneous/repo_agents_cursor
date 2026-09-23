/* tab-units.js — 單位分頁 HTML 模板與注入（內容＝原 #tab-units 的「內部」內容） */
const TAB_UNITS_HTML = `
    <div class="stats-bar"><span id="cnt-units"></span></div>
    <div class="filter-panel">
        <div class="fsec">
            <div class="ttl">🔍 搜尋與篩選 — 單位</div>
            <input type="text" id="u-search" class="search-box" placeholder="搜尋名稱／系列／標籤／變型後名稱／逃生後名稱／獲得來源／備註…" oninput="debouncedSearch('units')">
            <div class="fgroup"><label>系列</label><select id="fu-series" onchange="fc('units')"></select></div>
            <div class="fgroup"><label>稀有度</label><select id="fu-rarity" onchange="fc('units')">
                <option value="">全部</option><option>UR</option><option>SSR</option><option>SR</option><option>R</option><option>N</option></select></div>
            <div class="fgroup"><label>類型</label><select id="fu-type" onchange="fc('units')">
                <option value="">全部</option><option>攻擊</option><option>防禦</option><option>支援</option></select></div>
            <div class="fgroup"><label>圖片</label><select id="fu-image" onchange="fc('units')">
                <option value="">全部</option><option value="y">有圖片</option><option value="n">無圖片</option></select></div>
            <div class="fgroup"><label>移動力</label>
                <select id="fu-mob-min" onchange="fc('units')" title="移動力下限">
                    <option value="">下限：不限</option>
                    <option>0</option><option>1</option><option>2</option><option>3</option><option>4</option>
                    <option>5</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option>
                </select>
                <span style="opacity:.6;">～</span>
                <select id="fu-mob-max" onchange="fc('units')" title="移動力上限">
                    <option value="">上限：不限</option>
                    <option>0</option><option>1</option><option>2</option><option>3</option><option>4</option>
                    <option>5</option><option>6</option><option>7</option><option>8</option><option>9</option><option>10</option>
                </select>
            </div>
            <div class="fgroup"><label>等級</label>
                <select id="fu-lvlstate" onchange="fc('units')"
                        title="UR 上限 100；SSR/SR/R/N 為 90/80/70/60；SP化後一律 100（UR 不適用 SP）">
                    <option value="">全部</option>
                    <option value="max">已滿級</option>
                    <option value="notmax">未滿級</option>
                </select>
            </div>
                <select id="fu-limit" onchange="fc('units')">
                    <option value="">突破界限：全部</option>
                    <option value="0">突破 0</option>
                    <option value="1">突破 1</option>
                    <option value="2">突破 2</option>
                    <option value="3">突破 3 (已達上限)</option>
                    <option value="0-2">突破 0–2 (未達至突破上限)</option>
                </select>
            <div class="fgroup"><label>武裝等級</label><select id="fu-wstate" onchange="fc('units')"
                    title="滿級＝所有非「-」的武裝等級皆為 5；全部皆為「-」（無武裝）視為未滿級">
                <option value="">全部</option>
                <option value="max">已滿級</option>
                <option value="notmax">未滿級</option></select></div>
            <!-- 地形篩選：每個下拉前加上地形名稱，讓使用者清楚各下拉的意義 -->
            <div class="fgroup"><label>地形</label>
                <span class="tr-flab">宇宙</span><select id="fu-tr_space"  onchange="fc('units')" title="宇宙"></select>
                <span class="tr-flab">空中</span><select id="fu-tr_air"    onchange="fc('units')" title="空中"></select>
                <span class="tr-flab">地面</span><select id="fu-tr_ground" onchange="fc('units')" title="地面"></select>
                <span class="tr-flab">水上</span><select id="fu-tr_water"  onchange="fc('units')" title="水上"></select>
                <span class="tr-flab">水中</span><select id="fu-tr_under"  onchange="fc('units')" title="水中"></select>
            </div>
            <!-- 標籤篩選：按鈕開啟視窗；摘要含 AND/OR 徽章（可點擊切換）＋排除標籤 -->
            <div class="fgroup"><label>標籤</label>
                <button type="button" class="btn btn-info btn-sm" onclick="openTagModal('units')">🏷 選擇標籤…</button>
                <span class="tag-summary" id="fu-tags-summary"></span>
            </div>
            <div class="fgroup"><label>盾牌</label><select id="fu-shield" onchange="fc('units')"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>可變型</label><select id="fu-trans" onchange="fc('units')"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <!-- 逃生機能篩選：有／無逃生機能 -->
            <div class="fgroup"><label>逃生機能</label><select id="fu-escape" onchange="fc('units')"
                    title="有逃生機能＝逃生機能欄位為 Y"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>SP化</label><select id="fu-sp" onchange="fc('units')"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>SSP化</label><select id="fu-ssp" onchange="fc('units')"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>限定</label><select id="fu-ltd" onchange="fc('units')"><option value="">全部</option><option>Y</option><option>N</option></select></div>
            <div class="fgroup"><label>獲得來源</label><select id="fu-src" onchange="fc('units')"
                    title="注意：「隱藏變型/逃生」勾選時，此處選「變型/逃生」將永遠查無結果">
                <option value="">全部</option><option>開發單位</option><option>機體補給獲得單位</option><option>其他</option><option>變型/逃生</option><option>未設定</option></select></div>
            <!-- 預設勾選：隱藏獲得來源＝變型/逃生 的單位 -->
            <div class="fgroup ckline"><label class="ck">
                <input type="checkbox" id="fu-hidesrc" onchange="fc('units')" checked>
                隱藏「變型/逃生」來源的單位</label></div>
                <label><input type="checkbox" id="fu-hidewd" onchange="RENDER.units()" checked> 隱藏武裝詳細</label>
            <div class="fgroup"><label>排序</label>
                <select id="fu-sort" onchange="fc('units')">
                    <option value="date">加入日期</option><option value="order" selected>獲得順序</option><option value="name">名稱</option><option value="rarity">稀有度</option>
                    <option value="type">類型</option><option value="mob">移動力</option><option value="lvl">等級</option><option value="lim">界限次數</option>
                </select>
                <select id="fu-order" onchange="fc('units')"><option value="desc">降冪</option><option value="asc">升冪</option></select>
            </div>
            <button class="btn btn-clear" onclick="clearU()">清除篩選</button>
        </div>
        <div class="fsec">
            <div class="ttl">🛠 操作</div>
            <button class="btn btn-primary" onclick="openUnitForm()">➕ 新增單位</button>
            <button class="btn btn-info" onclick="openReorderModal('units')">↕ 調整獲得順序</button>
        </div>
    </div>
    <div class="pagination-controls">
        <div class="pagination-info"><span id="pi-units"></span>
            <select id="pp-units" onchange="changePerPage('units')">
                <option value="20" selected>20 筆/頁</option><option value="50">50 筆/頁</option>
                <option value="100">100 筆/頁</option><option value="-1">全部</option>
            </select>
        </div>
        <div class="pagination-buttons" id="pb-units-top"></div>
    </div>
    <div class="grid" id="grid-units"></div>
    <div class="pagination-controls bottom"><div class="pagination-buttons" id="pb-units-bot"></div></div>
 
    <!-- 單位 表單 -->
    <div class="form-section hidden" id="sec-units">
        <h3 id="ft-units">新增單位</h3>
        <form id="form-units" autocomplete="off">
            <input type="hidden" id="u-id">
            <div class="frow">
                <div class="fg"><label>名稱 *</label><input type="text" id="u-name" maxlength="100" required></div>
                <div class="fg"><label>圖片 (URL)</label><input type="text" id="u-image" placeholder="https://…"><div class="hint">支援 http(s)://、相對路徑（images/xxx.png）、/ 根路徑、data: URI</div></div>
            </div>
            <div class="frow">
                <div class="fg"><label>系列</label><input type="text" id="u-series" data-ac="series" placeholder="逗號分隔，與角色共用建議"><div class="hint">例：機動戰士高達</div></div>
                <div class="fg"><label>標籤</label><input type="text" id="u-tags" data-ac="utags" placeholder="逗號或空格分隔（僅使用「單位」標籤池）"><div class="hint">可用逗號（，、亦可）或空格分隔多個標籤</div></div>
            </div>
            <div class="frow">
                <div class="fg slim"><label>稀有度 *</label><select id="u-rarity">
                    <option value="">請選擇</option><option>UR</option><option>SSR</option><option selected>SR</option><option>R</option><option>N</option></select></div>
                <div class="fg slim"><label>類型 *</label><select id="u-type">
                    <option value="">請選擇</option><option>攻擊</option><option>防禦</option><option>支援</option></select></div>
                <div class="fg slim"><label>移動力 (0–10)</label><input type="number" id="u-mob" min="0" max="10" step="1" value="0"></div>
                <div class="fg slim"><label>等級 (1–100)</label><input type="number" id="u-lvl" min="1" max="100" step="1" value="1"></div>
                <div class="fg slim"><label>突破界限 (0–3)</label><select id="u-lim">
                    <option>0</option><option>1</option><option>2</option><option>3</option></select></div>
                <div class="fg slim"><label>獲得順序</label><input type="number" id="u-acq" min="1" step="1" placeholder="自動"></div>
            </div>
            <div class="frow">
                <div class="fg slim"><label>盾牌</label><select id="u-shield"><option>N</option><option>Y</option></select></div>
                <div class="fg slim"><label>2x2格</label><select id="u-size"><option>N</option><option>Y</option></select></div>
                <div class="fg slim"><label>SP化</label><select id="u-sp"><option>N</option><option>Y</option></select></div>
                <div class="fg slim"><label>SSP化</label><select id="u-ssp"><option>N</option><option>Y</option></select></div>
                <div class="fg slim"><label>限定</label><select id="u-ltd"><option>N</option><option>Y</option></select></div>
            </div>
            <div class="frow">
                <div class="fg slim"><label>可變型</label><select id="u-trans" onchange="updTrans()"><option>N</option><option>Y</option></select></div>
                <!-- 可搜尋下拉（combo.js）：select 為隱藏值容器（value = 目標單位 id）；
                     下拉選項顯示「名稱（稀有度・Lv.等級）」 -->
                <div class="fg"><label>變型後機體</label><select id="u-tname" disabled></select>
                    <div class="hint">從現有單位中選擇。變型目標會精確對應到該筆資料；對方改名後此處顯示會自動更新。</div></div>
            </div>
            <div class="frow">
                <!-- 逃生機能：新增「逃生後單位」欄位（運作方式同可變型／變型後機體） -->
                <div class="fg slim"><label>逃生機能</label><select id="u-escape" onchange="updEscape()"><option>N</option><option>Y</option></select></div>
                <div class="fg"><label>逃生後單位</label><select id="u-ename" disabled></select>
                    <div class="hint">從現有單位中選擇。逃生目標會精確對應到該筆資料；對方改名後此處顯示會自動更新。</div></div>
                <div class="fg slim"><label>獲得來源</label><select id="u-src">
                    <option value="">未設定</option><option>開發單位</option><option>機體補給獲得單位</option><option>變型/逃生</option><option>其他</option></select></div>
            </div>
            <fieldset class="mini">
                <legend>地形適性</legend>
                <div class="frow" style="margin-bottom:0;">
                    <div class="fg slim"><label>地形：宇宙</label><select id="u-tr_space" class="trsel"></select></div>
                    <div class="fg slim"><label>地形：空中</label><select id="u-tr_air" class="trsel"></select></div>
                    <div class="fg slim"><label>地形：地面</label><select id="u-tr_ground" class="trsel"></select></div>
                    <div class="fg slim"><label>地形：水上</label><select id="u-tr_water" class="trsel"></select></div>
                    <div class="fg slim"><label>地形：水中</label><select id="u-tr_under" class="trsel"></select></div>
                </div>
            </fieldset>
            <fieldset class="mini">
                <legend>武裝等級（1–5 或 - ）</legend>
                <div class="frow" style="margin-bottom:0;">
                    <div class="fg slim"><label>武裝等級1</label><select id="u-w1" class="wsel"></select></div>
                    <div class="fg slim"><label>武裝等級2</label><select id="u-w2" class="wsel"></select></div>
                    <div class="fg slim"><label>武裝等級3</label><select id="u-w3" class="wsel"></select></div>
                    <div class="fg slim"><label>武裝等級4</label><select id="u-w4" class="wsel"></select></div>
                    <div class="fg slim"><label>武裝等級5</label><select id="u-w5" class="wsel"></select></div>
                </div>
            </fieldset>
            <!-- 武裝詳細：僅「武裝等級」非「-」者可設定（由 weapon-details.js 產生控制項） -->
            <fieldset class="mini" id="wd-fieldset">
                <legend>武裝詳細（MAP兵器／射程／MP要求／屬性）— 僅武裝等級非「-」者</legend>
                <div id="wd-container"></div>
                <p class="wd-none" id="wd-empty" style="margin:4px 2px;">（所有武裝等級皆為「-」— 設定武裝等級後即可輸入詳細資料）</p>
            </fieldset>
            <div class="frow">
                <div class="fg" style="flex:3;"><label>Comments</label><textarea id="u-comments" rows="2" maxlength="2000"></textarea></div>
            </div>
            <div class="frow">
                <button type="submit" class="btn btn-success">💾 儲存單位</button>
                <button type="button" class="btn btn-warning" onclick="cancelForm('units')">取消</button>
            </div>
        </form>
    </div>
`;
 
function injectTabUnits() {
    const el = gi('tab-units');
    if (el && !el.dataset.injected) {
        el.innerHTML = TAB_UNITS_HTML;
        el.dataset.injected = '1';
    }
}