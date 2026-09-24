# SD高達G世代永恆 收藏管理庫
 
> **本文件的主要讀者是 AI（程式助理）**，目標是讓你在最短時間內理解本專案的架構、慣例與陷阱。
> 所有描述以程式碼現況（含各檔頭註解）為準。深入規格請另見：
> - [DATA-MODEL.md](DATA-MODEL.md) — 資料欄位、武裝格式、效果／限制類型代碼表、選擇性零件與關卡
> - [GITHUB-SYNC.md](GITHUB-SYNC.md) — 雲端同步完整機制與決策邏輯
 
---

## 🤖 AI 快速摘要（先讀這段）
 
| 面向 | 事實 |
|---|---|
| 形態 | 單一 HTML 頁面的純前端應用：Vanilla JS、無框架、無模組系統、無建置流程、無外部套件 |
| 函式組織 | 所有 JS 以 `<script>` 依**固定順序**載入，全部是**全域函式／變數**（載入順序敏感，見 §6） |
| 儲存 | IndexedDB `SDGGGenEternalDB` 版本 3（object stores：`units`／`characters`／`supports`／`optionalParts`／`stages`／`metadata`）＋一層記憶體快取 |
| 雲端 | GitHub Contents API 單檔 JSON 同步；**必須自行建立根目錄 `api.js`**（見 §3.1），缺少時儲存流程會中斷 |
| 同步語意 | 上傳＝全量快照；下載／匯入／還原＝**完全取代**本地單位／角色／支援單位（先清空再寫入，經去重與正規化）。`optionalParts`／`stages` 僅在 payload **有該欄**時才取代；缺欄保留本地 |
| 命名鐵律 | 篩選面板控制項 ID：`fu-*`／`fc-*`／`fs-*`；表單控制項 ID：`u-*`／`c-*`／`s-*`。**兩者嚴禁混用**（`search-units.js`／`search-characters.js`／`search-supports.js` 檔頭明文規定） |
| 擴充模式 | `weapon-filters.js` 在載入時以 wrap（包裝）方式擴充 `applyUnitFilters`／`clearU`／`normalizeWeaponEntry` 三個既有函式（`_wf` 旗標防重複），見 §9 |
| 特殊記錄 | `units` store 內 id 為 `__wkinds__` 的舊版系統記錄：現已無作用但**必須從渲染與統計中排除**，見 §8.12 |
| 等級上限 | UR 100；SSR／SR／R／N 為 90／80／70／60；SP 化後一律 100（UR 不適用 SP）；支援單位固定 100（`SUPPORT_MAX_LEVEL`）。支援單位稀有度只有 `UR`／`SSR`／`SR`（`SUPPORT_RARITIES`） |
| XSS 防護 | 所有動態插入 HTML 的插值一律經 `esc()`；輸入清理用 `sanitizeText()`／`wdCleanStr()` |
 
---

## 1. 專案簡介
 
《SD高達G世代永恆》的收藏管理工具，管理三類收藏：**單位**、**角色**、**支援單位**，另有兩個獨立視窗資料：**選擇性零件 (OP)**、**關卡資料**（不進 `TYPES`，沒有自己的分頁）。功能含：
 
- 完整 CRUD 表單（單位含五組武裝等級＋武裝詳細：MAP兵器、射程、MP要求、屬性、效果／限制等）
- 完整篩選（系列／稀有度／類型／突破界限／地形／標籤 AND-OR-排除／武裝七項篩選等）、多鍵排序、分頁（20／50／100／全部）；卡片武裝詳細可一鍵隱藏
- 變型後機體與逃生後單位的**以 ID 精確關聯**（對方改名後顯示自動同步）
- 獲得順序（`acqOrder`）與拖曳排序視窗
- 匯出 JSON／整庫 `.db` 備份、匯入／還原（完全取代）、清空
- GitHub 雲端同步（Auto-sync：編輯後自動上傳；載入時自動下載）
- 角色技能／角色能力一覽視窗（說明庫存 IndexedDB metadata：`skillLib`／`abilityLib`，僅本地）
- 角色能力觸發需求：每能力可多選系列／標籤＋AND/OR 邏輯（`ab*Series[]`／`ab*Tag[]`／`ab*Logic`）；
  契合度需求同架構（`tagBonusSeries[]`／`tagBonusTag[]`／`tagBonusLogic`）；
  對應篩選（角色能力／角色技能／能力觸發需求系列／標籤／契合度需求系列／標籤）
- 選擇性零件視窗（`optional-parts.js`）：名稱與多條效果（數值／百分比／地形級、標籤或指定單位、射程、MAP 除外），可依條件篩選
- 關卡資料視窗（`stage-data.js`）：關卡名稱、多組通關隊伍（通關過程、Comments、固定兩隊）。每隊 1～5 個單位（各配一名角色、最多一個選擇性零件）與 0 或 1 個支援單位。單位／角色／支援單位為可打字搜尋的下拉，選項附稀有度與等級
- 深色模式、Toast（含刪除復原）、自動完成、可搜尋下拉

## 2. 技術棧
 
| 項目 | 說明 |
|---|---|
| 語言 | HTML／CSS／JavaScript（ES2020：使用 `??`、`?.`、spread；需 2020 年後的瀏覽器） |
| 儲存 | IndexedDB（`js/storage.js` 的 `IDB` 類別，全域單例 `db`） |
| 雲端 | GitHub REST Contents API（`fetch` + PAT） |
| 建置／測試 | 無（改完重新整理即生效；無自動化測試） |

## 3. 快速開始

### 3.1 ★ 必要設定：建立 `api.js`
 
`api.js` **未包含在專案中，須自行建立於根目錄**（它是 HTML 第一個載入的腳本）。缺少此檔時 `ghValid()` 會拋 `ReferenceError`，導致儲存／刪除等操作的中後段流程失效。內容：
 
```js
const GitHub_Config = {
    username: 'your-username',          // GitHub 帳號
    repo:     'your-repo',              // 儲存庫名稱（建議私人）
    path:     'data/sdg-ggen-db.json',  // 遠端資料檔路徑
    token:    'ghp_xxxxxxxxxxxx',       // Personal Access Token（最小權限）
    branch:   'main'                    // 預設 main
};
```
 
- `token` 不可為 `'XXXXX'`、`'YYYYY'`、`'ZZZZZ'`（`ghValid()` 視為未設定，同步自動停用，其餘功能照常）。
- `api.js` 內含憑證，**不應提交至公開儲存庫**（建議加入 `.gitignore`）。

### 3.2 執行
 
直接以瀏覽器開啟 `sdg-ggen-eternal.html` 即可；亦可本地伺服器開啟。`file://` 下每個檔案為獨立 origin，程式對圖片誤載已有防呆（`thumbHtml()`）。

## 4. 檔案結構
 
```
sdg-ggen-eternal/
├── sdg-ggen-eternal.html      # 唯一頁面：工具列／三分頁／篩選面板／表單
├── api.js                     # ★ 使用者自建：GitHub_Config（同步憑證）
├── README.md
├── DATA-MODEL.md              # 資料欄位與武裝格式規格
├── GITHUB-SYNC.md             # 同步機制詳解
├── css/                       # 樣式（依功能分檔）
│   ├── base.css  layout.css  buttons.css  filters.css  cards.css
│   ├── forms.css  autocomplete.css  toast.css  reorder.css
│   └── dark-mode.css  extras.css
├── js/
│   ├── tab-units.js          # 單位分頁 HTML 模板（TAB_UNITS_HTML）＋載入時注入 #tab-units
│   ├── tab-characters.js     # 角色分頁 HTML 模板＋注入
│   ├── tab-supports.js       # 支援單位分頁 HTML 模板＋注入
│   ├── GitHub-sync.js         # 雲端同步：上傳／下載／Auto-sync／dirty 旗標
│   ├── storage.js             # IDB 類別（IndexedDB 封裝；全域 db）
│   ├── globals.js             # 常數與全域狀態（TYPES／PAG／EDIT／標籤篩選狀態…）
│   ├── utils.js               # esc／sanitize／fv／gi／分頁工具／Toast／儲存狀態
│   ├── search-common.js       # 篩選共用工具（等級上限／滿級判定／圖片／標籤條件）
│   ├── search-units.js        # 單位篩選／排序（applyUnitFilters；weapon-filters wrap 對象）
│   ├── search-characters.js   # 角色篩選／排序（applyCharFilters）
│   ├── search-supports.js    # 支援單位篩選／排序（applySupFilters）
│   ├── database.js            # 快取層：cache／inv／getAll／saveItem／deleteItem／uid
│   ├── combo.js               # 可搜尋下拉（變型後機體／逃生後單位）
│   ├── weapon-effect-types.js # 武裝效果／限制類型定義＋顯示名稱對照（名稱唯一來源）
│   ├── weapon-details.js      # 武裝詳細表單（建立／還原／收集）
│   ├── weapon-filters.js      # 武裝七項篩選（注入面板＋wrap 既有函式）
│   ├── autocomplete.js        # 通用自動完成（data-ac 欄位）
│   ├── render-units.js        # 單位渲染＋三頁共用卡片元件／分頁器／fc()
│   ├── render-characters.js   # 角色渲染
│   ├── render-supports.js     # 支援單位渲染
│   ├── ui.js                  # 分頁切換／標籤視窗／深色模式／刪除與復原／clearU-C-S
│   ├── forms.js               # 表單開關／填充／收集／驗證／儲存
│   ├── import-export.js       # 匯出 JSON／.db 備份／匯入／還原／清空
│   ├── reorder.js             # 獲得順序調整視窗（拖曳＋按鈕＋跳號）
│   ├── optional-parts.js      # 選擇性零件視窗（store: optionalParts）
│   ├── stage-data.js          # 關卡資料視窗（store: stages）
│   └── main.js                # 進入點（DOMContentLoaded → initApp）
└── images/                    # 本地圖片（依類型分三個子資料夾）
    ├── units/                 # 單位圖片；表單填純檔名 → 自動補 images/units/
    ├── characters/            # 角色圖片；純檔名 → images/characters/
    └── supports/              # 支援單位圖片；純檔名 → images/supports/
```

## 5. 架構總覽

### 5.1 分層職責
 
| 層 | 檔案 | 職責 |
|---|---|---|
| 頁面 | `sdg-ggen-eternal.html` 僅含骨架（工具列、三個空分頁容器 `#tab-*`）；三分頁的篩選面板／分頁控制／grid／表單 HTML 定義於 `js/tab-units.js`／`tab-characters.js`／`tab-supports.js` 的模板字串，於腳本載入時注入（`dataset.injected` 防重複）。所有元素 ID 與原 HTML 完全相同。 |
| 樣式 | `css/*.css` | 深色模式以 `body.dark-mode` 覆寫 |
| 儲存 | `storage.js` | `IDB` 類別：`getAll`／`put`／`del`／`clearStore`／`bulkPut`／`getMeta`／`putMeta`；惰性初始化（`ensure()`） |
| 快取／CRUD | `database.js` | `cache`（記憶體）／`inv(t)` 清快取／`getAll(t)`／`saveItem`／`deleteItem`／`uid(prefix)` |
| 篩選排序 | `search-common.js`＋`search-units.js`／`search-characters.js`／`search-supports.js`（＋`weapon-filters.js` wrap） | 只負責「從清單挑項目並排序」，不碰資料庫 |
| 渲染 | `render-*.js` | `RENDER` 映射、卡片、分頁器（**共用元件定義在 render-units.js**） |
| UI 元件 | `ui.js`／`combo.js`／`autocomplete.js`／`reorder.js` | 分頁切換、標籤視窗、可搜尋下拉、自動完成、排序視窗 |
| 表單 | `forms.js`／`weapon-details.js` | 開啟／填充／收集／驗證／儲存 |
| 資料搬運 | `import-export.js`／`GitHub-sync.js` | 備份匯入匯出、雲端同步 |
| 進入點 | `main.js` | `initApp()` |

### 5.2 啟動流程
 
```
DOMContentLoaded（監聽依註冊順序執行）
├─ initWeaponFilters()（weapon-filters.js，先註冊 → 先執行）
│   ├─ installWeaponFilterHooks()：wrap applyUnitFilters／clearU／normalizeWeaponEntry
│   ├─ buildWeaponFilterPanel()：此時 #tab-units 尚未注入 → 面板建構失敗（無害，稍後補建）
│   └─ registerShapeAutocomplete()：註冊 wshape 自動完成來源
└─ initApp()（main.js）
    ├─ injectTabUnits()／injectTabCharacters()／injectTabSupports()
    │     注入三分頁 HTML（fu-*／u-*／c-*／s-*／fs-* 等控制項此時才存在；
    │     dataset.injected 防重複）
    ├─ initWeaponFilters()（補呼叫）：注入後重跑 — wrap 有 _wf 旗標防重複，
    │     buildWeaponFilterPanel() 此時才找得到 fu-wstate，武裝七項篩選面板於此建成
    ├─ initDB()（storage.js 若提供）
    ├─ initForms()：靜態下拉、initWeaponDetails()、兩個 combo、三個 form 的 submit 綁定
    ├─ populateFilterTerrainSelects()
    ├─ initDarkMode()
    ├─ initAutocomplete()：綁定所有 [data-ac] 欄位
    ├─ initUI()：document 層卡片按鈕委派（僅綁一次）
    ├─ loadAbilityLib()／loadSkillLib()
    ├─ getAll('units')／getAll('characters')（★ 先填快取，池函式才有資料）
    ├─ refreshSeriesOptions()（→ refreshTagOptions() → refreshAbReqSelects()）
    ├─ RENDER.units()／RENDER.characters()（角色渲染會再刷 refreshAbReqSelects()）／RENDER.supports()
    ├─ updateStorageStatus()
    └─ autoDownloadFromGitHub()（非同步，不阻塞）
```
 
注入時機鐵律：**所有 `gi('fu-*')`／`gi('u-*')` 等分頁控制項的存取，都必須在 `injectTab*()` 之後**。因此任何新增的 `DOMContentLoaded` 監聽器若會碰分頁 DOM，應改為由 `initApp()` 在注入後呼叫，或自行確認注入已完成。

### 5.3 編輯資料流
 
```
表單／視窗操作（forms.js、reorder.js、ui.js、import-export.js）
   │  saveItem()／deleteItem()／db.put()…
   ▼
database.js（寫入後 inv(t) 清快取；saveItem 另寫 date_modified）
   ▼
storage.js → IndexedDB
   │
   └─ scheduleAutoSync(reason)（GitHub-sync.js）
        └─ markLocalDirty() →（Auto-sync 開且設定有效）1.5 秒防抖 → pushToGitHub()
```

## 6. 腳本載入順序（★ 順序敏感）
 
HTML 內的載入順序即下表；**不可調換**：
 
| # | 檔案 | 關鍵相依 |
|---|---|---|
| 1 | `js/tab-units.js` | 定義 `TAB_UNITS_HTML`；`injectTabUnits()` 由 `initApp()` 呼叫 |
| 2 | `js/tab-characters.js` | 定義 `TAB_CHARACTERS_HTML`；注入由 `initApp()` 呼叫 |
| 3 | `js/tab-supports.js` | 定義 `TAB_SUPPORTS_HTML`；注入由 `initApp()` 呼叫 |
| 4 | `api.js` | 定義 `GitHub_Config`（其他檔案的函式執行期才取用） |
| 5 | `js/GitHub-sync.js` | 同步全部邏輯；用到 `db`／`gatherAll` 等執行期才存在 |
| 6 | `js/storage.js` | 定義全域 `db` |
| 7 | `js/globals.js` | 常數／全域狀態（`TYPES`、`PAG`、`EDIT`、`TAG_FILTER_*`…） |
| 8 | `js/utils.js` | 依賴 globals（`TYPES`） |
| 9 | `js/search-common.js` | 篩選共用工具：依賴 globals＋utils；定義 `getMaxLevel`／`isMaxLevel`／`matchImageFilter`／`matchTagCondition` |
| 10 | `js/search-units.js` | 依賴 common；定義 `applyUnitFilters`（**weapon-filters wrap 的對象**）與 `getTransformedName`／`getEscapedName` 等 |
| 11 | `js/search-characters.js` | 依賴 common；定義 `applyCharFilters` |
| 12 | `js/search-supports.js` | 依賴 common；定義 `applySupFilters` |
| 13 | `js/database.js` | 依賴 storage；定義快取與 CRUD |
| 14 | `js/combo.js` | 可搜尋下拉元件 |
| 15 | `js/weapon-effect-types.js` | 類型定義（weapon-details／weapon-filters 依賴） |
| 16 | `js/weapon-details.js` | 武裝詳細表單 |
| 17 | `js/weapon-filters.js` | **必須晚於 search-units.js 與 weapon-effect-types.js**（wrap 前者、取用後者常數） |
| 18 | `js/autocomplete.js` | `AC_SOURCES`（weapon-filters 會註冊 `wshape`） |
| 19 | `js/render-units.js` | 定義 `RENDER` 與三頁共用元件（另兩個 render 檔依賴） |
| 20–21 | `render-characters.js`／`render-supports.js` | 依賴 16 |
| 22 | `js/ui.js` | 分頁切換、標籤視窗、刪除復原 |
| 23 | `js/forms.js` | 依賴 combo／weapon-details |
| 24 | `js/import-export.js` | |
| 25 | `js/reorder.js` | |
| 26 | `js/optional-parts.js` | 選擇性零件視窗；`sanitizeOptionalParts` 供匯入／同步使用 |
| 27 | `js/stage-data.js` | 關卡資料視窗；須晚於 optional-parts.js（選單讀零件快取）。`sanitizeStages` 供匯入／同步使用 |
| 28 | `js/main.js` | 進入點，必須最後 |

## 7. 命名慣例（★ 鐵律）
 
| 類別 | 慣例 | 範例 |
|---|---|---|
| 篩選面板（角色） | `fc-*` | `fc-series`、`fc-lvlstate`、`fc-ab`、`fc-sk`、`fc-abreq-series`、`fc-abreq-tag`、`fc-tbseries`、`fc-tbtag` |
| 表單（單位／角色／支援） | `u-*`／`c-*`／`s-*` | `u-name`、`c-shoot`、`c-ab1logic`、`c-ab1req-chips`、`c-tblogic`、`c-tbreq-chips`、`s-lvl` |
| 篩選面板（支援） | `fs-*` | `fs-sort`、`fs-rarity`（`none`＝未設定）、`fs-lvlstate`、`fs-image` |
| 表單（單位／角色／支援） | `u-*`／`c-*`／`s-*` | `u-name`、`c-shoot`、`s-lvl`、`s-rarity`（UR／SSR／SR） |
| 隱藏 ID 欄 | `<前綴>-id` | `u-id` |
| 表單區塊／標題／表單本體 | `sec-<type>`／`ft-<type>`／`form-<type>` | `sec-units` |
| 分頁按鈕／內容 | `tabbtn-<type>`／`tab-<type>` | `tabbtn-units` |
| 清單容器／計數／分頁資訊 | `grid-<type>`／`cnt-<type>`／`pi-<type>` | `grid-units` |
| 每頁筆數／分頁按鈕組 | `pp-<type>`／`pb-<type>-top`、`pb-<type>-bot` | `pp-units` |
| 通用函式 | `fc(t)`＝篩選變更（重置頁碼＋重繪，定義於 render-units.js）；`fv(id)`／`gi(id)` 取值／取元素 | |
 
注意：`fu-mob-min/max` 是**移動力**；`fu-rmin/fu-rmax`（weapon-filters 注入）是**武裝射程**，勿混淆。

## 8. 核心機制

### 8.1 快取與 CRUD（database.js）
 
- `getAll(t)`：命中 `cache[t]` 直接回傳；miss 才 `db.getAll` 並寫入快取。
- `saveItem(t, item)`：寫入 `date_modified` → `db.put` → `inv(t)` → `scheduleAutoSync('save-'+t)`。
- `deleteItem(t, id)`：`db.del` → `inv(t)` → `scheduleAutoSync('delete-'+t)`。
- `uid(prefix)`：`prefix + '_' + Date.now().toString(36) + 亂數`，如 `u_lx3k2a9bc`。
- **繞過 saveItem／deleteItem 的寫入**（如 `undoDelete`、`roSave`）必須自行補上三件套：`inv(t)`、`RENDER[t]()`、`scheduleAutoSync()`。

### 8.2 渲染與分頁（render-*.js）
 
- `RENDER`＝`{ units, characters, supports }` 三個 async 函式；`switchTab`／儲存／刪除等都透過 `RENDER[type]()` 重繪。
- `PAG[type] = { page, perPage }`；`perPage` 可為 `-1`（全部）。
- `fc(t)`＝篩選變更（`page=1` ＋重繪）；`debouncedSearch(t)` 300ms 防抖；`genPag()` 產生上／下兩組分頁按鈕。
- `RENDER.units()` 會先過濾 `u.id !== '__wkinds__'`（見 §8.12）。
- `buildUnitCard()` 依 `fu-hidewd` 決定是否輸出武裝詳細區塊（判定函式 `showUnitWeaponDetails()`，定義於 render-units.js）。

### 8.3 篩選、搜尋與排序（search.js）
 
- `applyUnitFilters`／`applyCharFilters`／`applySupFilters`（分別定義於三個檔案）：只讀控制項值過濾＋排序，回傳新陣列，不碰 DB。
- 單位搜尋欄位（`u-search`）：名稱／系列／標籤／**變型後名稱（解析後）**／**逃生後名稱（解析後）**／獲得來源／備註。
- 預設隱藏「獲得來源＝變型/逃生」的單位（`fu-hidesrc` 預設勾選，`clearU()` 會回復勾選）。
- 地形篩選值：`O`／`△`／`-`／`yes`（`yes`＝O 或 △）。
- 突破界限篩選（`fu-limit`）：空值＝全部；`0`／`1`／`2`／`3`＝精確符合；`0-2`＝未達突破上限（<3）。
  舊資料缺 `limitBreak` 視為 0（同時落入「突破 0」與「0-2」的結果）；變更時走 `fc('units')`。
- 武裝詳細顯示開關（`fu-hidewd`，單位篩選面板）：勾選時卡片不渲染武裝詳細。純顯示偏好 — 不影響篩選／排序／統計，
  **不會被 `clearU()` 重置**；切換時直接 `RENDER.units()` 重繪（不重置頁碼），不觸發 `scheduleAutoSync`。
- 角色篩選：`fc-ab`／`fc-sk` 比對 `ab1`–`ab3`／`sk1`–`sk3`；`fc-abreq-series`／`fc-abreq-tag` 比對
  「任一能力的 `ab*Series`／`ab*Tag` 陣列是否包含該值」（系列與標籤分開兩個篩選）；
  `fc-tbseries`／`fc-tbtag` 比對「契合度需求的 `tagBonusSeries`／`tagBonusTag` 陣列是否包含該值」。
  選項由 `refreshAbReqSelects()`（ui.js，`refreshSeriesOptions()` 尾部呼叫）自資料池刷新，`clearC()` 會一併重置。
- 排序預設「獲得順序（`order`）降冪」；同值以名稱 `zh-Hant` localeCompare 破平；無 `acqOrder` 者排最後。
- 武裝七項篩選（MAP兵器／射程區間／射程設定／MP要求／POWER 區間／武裝效果／武裝名稱）由 `weapon-filters.js` 以 wrap 附加，不修改 search-units.js。

### 8.4 武裝資料格式
 
`weapons` 物件鍵 `'1'..'5'`；值為 `'-'`（無武裝）或物件（完整規格見 [DATA-MODEL.md](DATA-MODEL.md)）。要點：
 
- `map:'Y'`（MAP兵器）→ 使用 `shape`（形狀）＋`ammo`（彈藥量），**射程欄為空**；非 MAP → 使用 `rangeMin`／`rangeMax`。
- 效果／限制只存 `{ type, pct }`；**顯示名稱由 `weapon-effect-types.js` 的對照表統一提供**（同類效果跨單位自動同名），格式如「防禦力debuff(30%)(1回合)」。
- 數值上限：$10^{\text{digits}} - 1$（digits $=2$ → $99$；digits $=3$ → $999$）。
- **舊格式相容**：純字串等級 `'1'..'5'`；物件僅有 `range` → 視為 $1$–range；效果舊版自帶的 `name` 一律略過。
- 正規化入口 `normalizeWeaponEntry()`（**有效實作已被 weapon-filters.js 覆寫**，見 §9）。

### 8.5 變型／逃生目標（ID ＋名稱快照）
 
- 欄位對：`transformable`＋`transformedId`＋`transformedName`；`escape`＋`escapedId`＋`escapedName`。
- 顯示與搜尋時優先以 ID 解析最新名稱（`getTransformedName`／`getEscapedName`，定義於 search-units.js；用單位快取）；找不到才回退名稱快照。
- 正規化（`normalizeUnitRecord`）：`transformable !== 'Y'` 時清空 ID 與名稱（逃生同理）。
- 表單以可搜尋下拉（combo.js）選單位，選項顯示「名稱（稀有度・類型・Lv.等級）」，並排除正在編輯的單位本身。
- 舊資料僅有名稱 → combo 值以 `name:xxx` 暫代（建議重選）。
- **順序陷阱**：`resolveTargetRef()` 必須在 `ensureUniqueAcqOrder()` **之前**呼叫（後者會 `inv()` 清快取，之後就解析不到目標）。`saveUnit()` 已按此順序撰寫，改動時勿調換。

### 8.6 等級上限與滿級判定（search.js）
 
| 對象 | 上限 |
|---|---|
| UR | 100（不適用 SP） |
| SSR／SR／R／N | 90／80／70／60；SP 化後一律 100 |
| 支援單位 | 100（常數 `SUPPORT_MAX_LEVEL`，與遊戲不符時改 globals.js） |
 
`getMaxLevel()` 在稀有度不合法時回傳 `null` → `isMaxLevel()` 為 false（兩者定義於 search-common.js）。滿級判定供「等級」篩選與卡片 ✓ 顯示；另有武裝滿級判定 `isWeaponMaxed()`（定義於 search-units.js；所有非 `-` 的武裝等級皆為 5）。

### 8.7 標籤系統（AND／OR／排除）
 
- 全域狀態（globals.js）：`TAG_FILTER_STATE`（包含集合）、`TAG_FILTER_MODE`（`'AND'`／`'OR'`）、`TAG_FILTER_EXCLUDE`（排除集合）。
- 標籤視窗（ui.js `openTagModal`）採**暫存 → 套用**制：左欄勾選／⊘ 排除切換／搜尋／全選（符合），右欄已選預覽；「💾 套用」才寫回並 `fc(t)`；關閉／Esc／點背景＝捨棄。
- 判定（search-common.js `matchTagCondition`）：**排除優先** — 具備任一排除標籤即不合格；包含條件依 AND（全部具備）或 OR（任一具備）。
- 標籤池：單位／角色各自獨立（`poolTags(t)`）；系列池為單位＋角色聯集（`poolSeries()`）。
- `refreshTagOptions()` 會剔除已從資料中消失的標籤，避免殘留無效篩選。
- 輸入分隔：標籤可用逗號（`，、` 亦可）**或空白**；系列僅逗號類（避免含空格的英文系列名被拆開）— 見 `splitTokens(str, spaceOk)`。
- 說明庫（`skillLib`／`abilityLib`）存於 metadata store，僅本地（不隨同步 payload 搬移）；
  「📖 角色技能一覽」／「📖 角色能力一覽」視窗（ui.js）可編輯說明，自動完成下拉會顯示。
  ★ 陷阱：所有池函式（`poolSeries`／`poolTags`／`poolSkillNames`…）讀記憶體快取 —
- 角色能力需求為多選：表單以「＋ 系列…／＋ 標籤…」開啟多選視窗（ui.js `openAbReqPicker`，
  暫存於 forms.js 的 `ABREQ`，chips 即時顯示、可 ✕ 移除），AND/OR 由 `c-ab{i}logic` 下拉決定，需求挑選視窗的系列池為單位＋角色聯集（poolSeries()）；標籤池一律使用單位標籤池（poolTags('units')） — 因為能力／契合度需求比的是「駕駛的單位」的系列與標籤。
  存入 `ab*Logic`。舊資料單值欄位以 `abReqArr()` 相容（讀取時包成陣列）。
- 契合度需求同架構，暫存於 `ABREQ[0]`（表單 id `c-tbreq-chips`／logic 下拉 `c-tblogic`），
    存入 `tagBonusSeries[]`／`tagBonusTag[]`／`tagBonusLogic`；舊資料單值 `tagBonusSeries` 以 `abReqArr()` 相容。  
  呼叫前必須確保 `getAll()` 已跑過（initApp 已按此順序；勿在啟動早期呼叫）。

### 8.8 GitHub 同步（摘要）
 
- 任何「編輯性操作」（儲存／刪除／復原／排序／匯入／還原／清空）→ `scheduleAutoSync(reason)` → `markLocalDirty()` →（Auto-sync 開且設定有效）1.5 秒防抖後自動上傳。
- 頁面載入 → `autoDownloadFromGitHub()`：本地 dirty → 改為自動上傳（或略過）；遠端較舊且本地非空 → 略過；否則**靜默完全取代**本地。
- 上傳互斥鎖 `_ghBusy`（避免手動＋自動同時 PUT 造成 SHA 衝突）；遠端檔大於 1MB 時改走 Blob API。
- 詳細流程、決策表與 reason 清單：[GITHUB-SYNC.md](GITHUB-SYNC.md)。

### 8.9 匯入／匯出／備份／清空（import-export.js）
 
| 操作 | 函式 | 產出／行為 |
|---|---|---|
| 匯出 JSON | `exportData()` | `sdg-ggen-export_YYYYMMDD_HHMM.json`（僅下載，不動 DB） |
| 整庫備份 | `saveDbFile()` | `sdg-ggen-db_….db`（內容同 JSON，副檔名不同） |
| 匯入 JSON | `importData()` | `applyExternalData()`：檢查 → confirm → **完全取代**單位／角色／支援單位；零件與關卡僅在檔案有該欄時取代 → `scheduleAutoSync('import-json')` |
| 還原 .db | `loadDbFile()` | 同上（accept `.db,.json`；兩者內容皆為 JSON），reason `'restore-db'` |
| 清空 | `clearAllData()` | 兩次 confirm；清空單位／角色／支援單位／選擇性零件／關卡；reason `'clear-all'`（Auto-sync 開啟時會自動上傳空庫覆蓋遠端，確認對話已警告） |
 
`gatherAll()` 收集單位、角色、支援單位、選擇性零件、關卡（同步 payload 也用它）。

### 8.10 刪除與復原（ui.js）
 
`delItem(type, id)`：confirm → `deleteItem()` → `lastDeleted` 保存最後一筆 → Toast 附「↩ 復原」按鈕（約 6 秒）。`undoDelete()`：`db.put` 回寫 → `inv` → `RENDER` → `scheduleAutoSync('undo-'+type)`。**僅支援一層復原**。

### 8.11 深色模式與本地偏好
 
localStorage：`sdg-dark`（`'1'`／`'0'`，深色模式）、`sdg-autosync-enabled`（不存在視為開啟）。舊 key `sdg-wkind-names` 已廢棄並被 weapon-effect-types.js 主動清除。

### 8.12 系統記錄 `__wkinds__`（舊版遺留）
 
舊版將「武裝效果名稱對照」存為 `units` store 內 id 為 `__wkinds__` 的記錄。現版名稱改由 `weapon-effect-types.js` 靜態提供，此記錄**無作用亦無害**（可能殘留於本地或同步 payload 中），但讀取 units 時**必須排除**：`RENDER.units()` 與 `updateStorageStatus()` 已處理；新增任何「列出全部單位」的程式碼時記得比照。

## 9. 函式覆寫wrap 擴充模式（weapon-filters.js）
 
`installWeaponFilterHooks()` 於初始化時包裝三個既有函式（以 `fn._wf = true` 防重複包裝）：
 
| 被包裝函式 | 定義處 | wrap 後行為 |
|---|---|---|
| `applyUnitFilters` | search-units.js | 結果再 `.filter(matchWeaponFilters)`（附加武裝七項篩選） |
| `clearU` | ui.js | 先 `clearWeaponFilters()` 重置武裝篩選控制項，再執行原清除 |
| `normalizeWeaponEntry` | GitHub-sync.js | **整段被取代**為支援完整新格式（含 ammo／rangeMin／rangeMax／effects／limits）的版本 |
 
修改這三個函式時的規則：
 
1. `normalizeWeaponEntry` 的**有效實作在 weapon-filters.js**（GitHub-sync.js 內的原版已死碼）；支援新欄位時改 weapon-filters.js 的版本，並同步更新 weapon-details.js（表單）與 DATA-MODEL.md。
2. 修改 `applyUnitFilters`／`clearU` 時，wrap 仍套在外層 — 必須維持契約（回傳陣列／「重置並重繪」的副作用）。

## 10. 安全性
 
- **XSS**：所有動態插值進 HTML 一律 `esc()`；使用者輸入另經 `sanitizeText()`（剝 `<>`、引號、`javascript:`、`on*=`）與 `wdCleanStr()`（同步／匯入時清理武裝字串並截長）。
- **圖片路徑**：`normalizeImagePath(raw, type)` 正規化（支援 http(s)／`data:`／`/` 根路徑／相對路徑；
  **純檔名依記錄類型自動補 `images/units/`／`images/characters/`／`images/supports/`**；
  含專案資料夾名的絕對路徑會切出相對段；已含 `/` 的路徑原樣保留、不自動改寫子資料夾）；
  `thumbHtml()` 會擋掉 `.html` 副檔名與頁面自身 URL（`file://` 誤載防呆），載入失敗 fallback「無圖片」。
- **憑證**：PAT 存於前端 `api.js` → 僅適合私人 repo＋fine-grained 最小權限（僅該 repo 的 Contents 讀寫）。

## 11. 擴充指南
 
**新增單位篩選條件**
1. 在 HTML（或比照 weapon-filters.js 動態注入）加 `fu-*` 控制項，`onchange="fc('units')"`（數字輸入比照 `debouncedWPower()` 做 300ms 防抖）。
2. `search-units.js applyUnitFilters()` 讀值過濾（角色／支援分別改 search-characters.js／search-supports.js）。
3. `ui.js clearU()`（或注入面板的清除函式）重置該控制項。
 
新增／修改篩選控制項（`fu-*`／`fc-*`／`fs-*`）或表單欄位（`u-*`／`c-*`／`s-*`）時，編輯對應的模板檔：
- 單位：`js/tab-units.js`（篩選 `fu-*`、表單 `u-*`）
- 角色：`js/tab-characters.js`（篩選 `fc-*`、表單 `c-*`）
- 支援單位：`js/tab-supports.js`（篩選 `fs-*`、表單 `s-*`） 
不是編輯 `sdg-ggen-eternal.html`。模板內容為靜態字面值，不需 `esc()`；但嚴禁把使用者資料插值進模板（XSS 風險）。
角色表單欄位同理（`c-*` → forms.js `editCharacter()`／`collectCharFromForm()` → render-characters.js）。

**新增表單欄位（單位）**
1. HTML 加 `u-*` 控制項。
2. `forms.js`：`editUnit()` 回填、`collectUnitFromForm()` 收集。
3. 卡片顯示 → `render-units.js buildUnitCard()`；搜尋 → `applyUnitFilters` 的 hay；同步正規化 → `GitHub-sync.js normalizeUnitRecord()`（與 DATA-MODEL.md）。
 
**新增武裝效果／限制類型**：只改 `weapon-effect-types.js` 兩處（類型陣列 `WEAPON_EFFECT_TYPES`／`WEAPON_LIMIT_TYPES` ＋名稱對照表 `WKIND_DEFAULT_*_NAMES`）；表單下拉、篩選下拉、正規化（`normalizeWeaponKindList`）自動跟上。
 
**新增資料類型（第四種分頁）**：屬大工程 — 需動 `globals.js`（`TYPES`／`LABEL`／`PAG`／`EDIT`）、`storage.js`（store 建立＋DB 版本升級）、HTML 分頁與表單、`search-common.js`＋新的 search 檔、新 render 檔、`forms.js`、`import-export.js`、`GitHub-sync.js sanitizeRecords()`。選擇性零件與關卡**不是**第四種分頁：它們有自己的 store 與視窗腳本，不加入 `TYPES`。新的同類視窗資料比照 `optional-parts.js`／`stage-data.js`：獨立腳本、`storage.js` 升版建 store、`gatherAll`／匯入／同步缺欄保留本地、`updateStorageStatus()`。

## 12. 常見陷阱
 
1. **載入順序**：weapon-filters.js 必須晚於 search-units.js（及其他 search-*.js）；render-characters／supports 依賴 render-units.js 的共用元件；main.js 必須最後。
2. **ID 前綴嚴禁混用**（`fu-*` 是篩選、`u-*` 是表單）。
3. **`ensureUniqueAcqOrder()` 會 `inv()` 清快取** → 變型／逃生解析（`resolveTargetRef`）必須在其之前。
4. **列出單位前先濾掉 `__wkinds__`**。
5. 手動 `db.put`／`db.del` 後記得三件套：`inv(t)`、`RENDER[t]()`、`scheduleAutoSync()`。
6. HTML 插值一律 `esc()`（含 `title` 屬性、內聯 `onerror` 字串跳脫，可參考 reorder.js／render-units.js 的寫法）。
7. 修改 `clearU`／`clearC`／`clearS` 時記得涵蓋新控制項（`clearC()` 需重置 `fc-ab`／`fc-sk`／
   `fc-abreq-series`／`fc-abreq-tag`／`fc-tbseries`／`fc-tbtag`）；`clearU()` 有特殊預設：`fu-hidesrc` 回復勾選、
   排序回「獲得順序／降冪」。
8. `lastExportTime` 在**上傳前**即寫入（`buildPayload` 內）— 上傳失敗時靠 `localDirty=true` 在下次啟動時保護本地資料。
9. `applyRemoteData`／`applyExternalData` 是破壞性完全取代：手動路徑務必保留 confirm；自動下載靠 dirty 與新舊檢查保護。
10. combo 的 `name:` 前綴值是舊資料暫代，勿用於新資料。
11. 表單圖片欄：純檔名由 `normalizeImagePath()` 依類型補 `images/units|characters|supports/`；
    **已含 `/` 的路徑一律原樣保留**（含舊格式 `images/XXX.webp`，不會被自動遷移到子資料夾）。
12. 單值篩選含 `'0'` 合法值時（如 `fu-limit`），空值判斷必須用 `!== ''`，不能依賴 truthy／falsy。
13. 分頁 HTML 已抽至 `js/tab-*.js`：模板字串內**不可**再包含 `<div id="tab-*">` 容器本身（會造成巢狀重複 ID——`switchTab()` 只切換外層 class，內層無 `active` 會導致分頁空白），也不可重複 `stats-bar`／`filter-panel`／`form-section` 的開頭標籤。修改分頁內容請改模板檔，而非 HTML。
14. `ABREQ`（forms.js）是角色表單的需求暫存：`ABREQ[0]`＝契合度、`ABREQ[1..3]`＝角色能力。
    `openCharForm()` 必須 `resetABREQ()`、`editCharacter()` 必須 `loadABREQ(c)`，
    且 `collectCharFromForm()` 直接讀 `ABREQ` — 新增任何「繞過這三個函式」寫入角色的路徑時需自行維護。
    
## 13. 文件地圖
 
| 文件 | 內容 |
|---|---|
| `README.md`（本文件） | 架構、慣例、機制摘要、擴充與陷阱 |
| `DATA-MODEL.md` | units／characters／supports／optionalParts／stages 欄位、weapons 格式、效果／限制類型代碼表、同步 payload、正規化規則 |
| `GITHUB-SYNC.md` | 同步設定、上傳／下載流程、auto-download 決策表、reason 清單、安全建議 |