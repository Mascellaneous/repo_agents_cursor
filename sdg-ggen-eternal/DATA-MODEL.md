# 資料模型
 
> 對應程式：`js/storage.js`（DB 結構）、`js/forms.js`（欄位收集）、`js/GitHub-sync.js`（正規化）、`js/weapon-*.js`（武裝）、`js/search-*.js`（篩選／滿級判定）。
> 本文為**欄位級規格**；架構請見 [../README.md](../README.md)。

## 1. IndexedDB 結構
 
- 資料庫名稱：`SDGGGenEternalDB`，版本 `3`（版本 2 加入 `optionalParts`，版本 3 加入 `stages`；`onupgradeneeded` 只建立尚不存在的 store）。
- Object stores：
 
| Store | keyPath | 內容 |
|---|---|---|
| `units` | `id` | 單位記錄（含舊版系統記錄 `__wkinds__`，見 §7） |
| `characters` | `id` | 角色記錄 |
| `supports` | `id` | 支援單位記錄 |
| `optionalParts` | `id` | 選擇性零件（見 §4.1）。**不在** `TYPES` 內 |
| `stages` | `id` | 關卡資料（見 §4.2）。**不在** `TYPES` 內 |
| `metadata` | `key` | `{ key, data }`：`lastExportTime`、`localDirty` |
 
- 單位／角色／支援單位共用欄位：`id`（`uid(prefix)` 產生：`u_`／`c_`／`s_` 前綴＋時間戳 base36＋亂數）、`date_added`（ISO 字串）、`date_modified`（ISO 字串，`saveItem` 時更新）。選擇性零件前綴 `op_`，關卡前綴 `st_`。

## 2. units（單位）
 
| 欄位 | 型別 | 說明／允許值 |
|---|---|---|
| `name` | string | 名稱（必填，最長 100；正規化時缺補 `(未命名)`） |
| `image` | string | 圖片路徑（表單儲存時經 `normalizeImagePath()` 正規化；空＝無圖；單位純檔名自動補 `images/units/`） |
| `series` | string[] | 系列（單位＋角色共用建議池；輸入僅以逗號類分隔） |
| `tags` | string[] | 標籤（**單位專屬池**；逗號或空格分隔）。篩選視窗的包含／排除只存在記憶體（`TAG_FILTER_STATE`／`TAG_FILTER_EXCLUDE`），不寫入本欄、也不進同步 payload |
| `rarity` | string | 必填：`UR`／`SSR`／`SR`／`R`／`N` |
| `type` | string | 必填：`攻擊`／`防禦`／`支援` |
| `mobility` | number | 移動力 0–10 |
| `level` | number | 等級 1–100 |
| `limitBreak` | number | 突破界限 0–3 |
| `acqOrder` | number 或 null | 獲得順序（1 起；無＝未排序，排序時排最後） |
| `shield` | string | `Y`／`N`（盾牌） |
| `size2x2` | string | `Y`／`N`（2×2 格） |
| `sp` | string | `Y`／`N`（SP 化；UR 不適用） |
| `ssp` | string | `Y`／`N`（SSP 化） |
| `limited` | string | `Y`／`N`（限定） |
| `transformable` | string | `Y`／`N`（可變型） |
| `transformedId` | string 或 null | 變型後機體的 `id`（精確指向） |
| `transformedName` | string | 變型目標名稱快照（顯示時優先以 ID 解析最新名稱） |
| `escape` | string | `Y`／`N`（逃生機能） |
| `escapedId` | string 或 null | 逃生後單位的 `id` |
| `escapedName` | string | 逃生目標名稱快照 |
| `src` | string | 獲得來源：空（未設定）／`開發單位`／`機體補給獲得單位`／`變型/逃生`／`其他` |
| `comments` | string | 備註（最長 2000） |
| `terrain` | object | 鍵：`space`／`air`／`ground`／`water`／`under`；值：`O`／`△`／`-`（正規化時非法值歸 `-`） |
| `weapons` | object | 見 §5 |
 
正規化規則（`normalizeUnitRecord`，同步下載／匯入時對每筆單位執行）：
 
- `shield`／`size2x2`／`escape`／`sp`／`ssp`／`limited`／`transformable`：非 `'Y'` 一律歸 `'N'`。
- `transformable !== 'Y'` → `transformedId = null`、`transformedName = ''`（逃生同理）。
- `series`／`tags` 非陣列 → `[]`；`weapons` 五格逐一經 `normalizeWeaponEntry()`。
- 圖片子資料夾的對應發生在**表單儲存時**（forms.js `normalizeImagePath(raw, type)`）：
- 純檔名依類型補 `images/units/`／`images/characters/`／`images/supports/`；
- 同步／匯入正規化（`normalizeUnitRecord`）不會改寫 `image`。

## 3. characters（角色）
 
| 欄位 | 型別 | 說明 |
|---|---|---|
| `name`／`image`／`series`／`tags`／`rarity`／`type`／`level`／`acqOrder` | 同單位對應欄位 | 標籤使用**角色專屬池**；`image` 純檔名自動補 `images/characters/` |
| `sp` | string | Y／N（SP 化；UR 不適用；SP 化後等級上限 100） |
| `shoot`／`melee`／`awaken`／`defend`／`react` | number 或 null | 射擊／格鬥／覺醒／守備／反應值（空＝null） |
| `sk1`～`sk3` | string | 角色技能 1–3 |
| `ab1`～`ab3` | string | 角色能力 1–3 |
| `ab1Series`～`ab3Series` | string[] | 觸發對應角色能力所需的**系列清單**（可多選；空陣列＝不限。舊資料可能為單一字串，讀取時以 `abReqArr()` 相容） |
| `ab1Tag`～`ab3Tag` | string[] | 觸發對應角色能力所需的**標籤清單**（可多選；比對駕駛單位的標籤，取自**單位標籤池**；同上相容舊單值） |
| `ab1Logic`～`ab3Logic` | string | 該能力多個需求（系列＋標籤合併計算）之間的關係：`'AND'`（全部符合，預設）／`'OR'`（任一符合） |
| `tagBonusSeries` | string[] | 契合度所需的**系列清單**（可多選；空＝未設定；舊資料單值以 `abReqArr()` 相容） |
| `tagBonusTag` | string[] | 契合度所需的**標籤清單**（可多選；比對駕駛單位的標籤，取自**單位標籤池**；同上相容舊單值） ||
| `tagBonusLogic` | string | 契合度多個需求之間的關係：`'AND'`（全部符合，預設）／`'OR'`（任一符合） |
| `tagBonus` | string | 契合度條件說明（最長 200） |
| `tagBonusEffect` | string | 契合度效果說明（最長 500） |

## 4. supports（支援單位）
 
| 欄位 | 型別 | 說明 |
|---|---|---|
| `name`／`image`／`acqOrder` | 同上 | `image` 純檔名自動補 `images/supports/` |
| `rarity` | string | 表單必填：`UR`／`SSR`／`SR`（`SUPPORT_RARITIES`）。沒有 `R`／`N`，也沒有類型。舊資料或匯入值不在這三個之中 → `sanitizeRecords` 歸 `''`（卡片無徽章；篩選「未設定」用 `fs-rarity=none`） |
| `level` | number | 等級 1–100（滿級判定用固定上限 `SUPPORT_MAX_LEVEL = 100`） |
| `limited` | string | `Y`／`N`（限定）。非 `Y` 正規化為 `N` |
| `captainSeries` | string[] | 隊長技能套用的單位系列（多選，池與角色契合度相同） |
| `captainTags` | string[] | 隊長技能套用的單位標籤 |
| `captainLogic` | string | `'AND'`（預設）／`'OR'` |
| `captainPct` | number 或 null | 全能力值提升百分比（EN 除外）。有系列或標籤時才保留 1–100，否則 `null`。表單預設 36 |
| `supportSkillName` | string | 支援技能名稱，最長 80 |
| `supportEffects` | object[] | `{ stat:'hp'\|'en', pct:1–100 }`，每種最多一筆。顯示為「範圍內的我方單位恢復HP／EN{pct}%」 |

篩選：`fs-limited`、`fs-cap-series`、`fs-cap-tag`、`fs-supskill`（`hp`／`en`／`none`）。排序另有 `limited`、`captain`（百分比）、`skill`（支援技能名稱）。

## 4.1 optionalParts（選擇性零件）

獨立視窗，腳本 `js/optional-parts.js`。按鈕在工具列與單位分頁「操作」。效果句的組法與篩選條件寫在該檔頭註解；此處只列儲存形狀。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | `op_…` |
| `name` | string | 零件名稱，最長 100 |
| `date_added`／`date_modified` | ISO string | 同其他記錄 |
| `effects` | object[] | 最多 12 條。每條含 `clauses`（最多 8）、`tag`、`unit`、`rangeMin`、`rangeMax`（`''` 或 `'1'`～`'6'`）、`excludeMap` |
| `effects[].clauses[]` | object | `stat`：`maxEn`／`mobility`／`maxHp`／`defense`／`attack`／`terrain`；`dir`：`up`／`down`；`amount` 為非負數；`mode`：`flat`／`percent`／`rank`（地形一律 `rank`）；`scope`：`always`／`cond`；`terrain` 僅 `stat==='terrain'` |

`sanitizeOptionalParts()` 丟棄無 id、依 id 去重，並經 `normalizeOptionalPart()`（無有效能力句的效果會被丟掉）。

## 4.2 stages（關卡資料）

獨立視窗，腳本 `js/stage-data.js`。按鈕在工具列，以及單位／角色／支援單位分頁「操作」。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | `st_…` |
| `name` | string | 關卡名稱，最長 100。正規化時空白名稱補 `(未命名)` |
| `date_added`／`date_modified` | ISO string | 同其他記錄 |
| `clears` | object[] | 通關隊伍，最多 20 組。每組 `process`、`comments`（各最長 4000）與固定兩隊 `teams` |
| `clears[].teams[]` | object | `units` 1～5 格；`supportId`／`supportName` 空字串＝沒有支援單位 |
| `teams[].units[]` | object | `unitId`＋`unitName`、`characterId`＋`characterName`（兩者都要有，否則該格丟棄）、`optionalPartId`＋`optionalPartName`（可空） |

名稱是快照；視窗顯示時若 id 仍在快取中，改顯示現名。單位／角色選項文字為「名稱（稀有度・類型・Lv.等級）」；支援單位為「名稱（稀有度・Lv.等級）」。三欄都可打字篩選。`__wkinds__` 不會出現在單位選單。任一隊正規化後少於 1 格，整組通關隊伍丟棄。

`sanitizeStages()` 丟棄無 id、依 id 去重，並經 `normalizeStage()`。

## 5. weapons（武裝，單位專屬）
 
`weapons` 為物件，鍵 `'1'`～`'5'`（固定五格）。值為 `'-'`（該格無武裝）或下列物件；**空字串／空陣列一律代表「未設定」**：
 
| 欄位 | 型別 | 說明 |
|---|---|---|
| `level` | string | `'1'`～`'5'`（正規化時非合法值整格歸 `'-'`） |
| `map` | string | 空／`'Y'`／`'N'`（MAP兵器） |
| `name` | string | 武裝名稱（最長 40） |
| `power` | string | POWER（自由字串，最長 10；篩選時解析數字並忽略逗號等非數字字元） |
| `en`／`hit`／`crit` | string | EN消耗／命中／爆擊（最長 6） |
| `atkTypes` | string[] | 分類：`射擊`／`格鬥`／`覺醒` 的子集合（空＝未設定） |
| `shape` | string | 形狀（**僅 `map:'Y'`**；最長 50；有自動完成建議池） |
| `ammo` | string | 彈藥量（**僅 `map:'Y'`**；最長 6） |
| `rangeMin`／`rangeMax` | string | 最短／最長射程：空或 `'1'`～`'6'`（**僅非 MAP**） |
| `mp` | string | 空／`需要超強勢`／`需要超一擊`／`沒有MP要求` |
| `attrs` | string[] | 屬性：`物理`／`鐳射`／`特殊` 的子集合 |
| `effects` | object[] | 武裝效果：`[{ type, pct }]`（見 §6） |
| `limits` | object[] | 使用限制：`[{ type, pct }]`（見 §6） |
 
**欄位互斥約束**：`map:'Y'` → `shape`／`ammo` 可用、`rangeMin`／`rangeMax` 恆為空；非 MAP → 相反。正規化時強制執行。
 
範例：
 
```js
weapons: {
  '1': '-',
  '2': { level:'3', map:'N', name:'光束步槍', power:'3,500', en:'12', hit:'90', crit:'15',
         atkTypes:['射擊'], shape:'', ammo:'',
         rangeMin:'2', rangeMax:'4', mp:'沒有MP要求', attrs:['鐳射'],
         effects:[{ type:'debuff-def', pct:30 }], limits:[{ type:'pre-move-only', pct:null }] },
  '3': { level:'5', map:'Y', name:'MAP兵器', shape:'直線', ammo:'2',
         rangeMin:'', rangeMax:'', /* … */ },
  '4': '-', '5': '-'
}
```

### 舊格式相容
 
| 舊格式 | 讀取行為 |
|---|---|
| 純字串 `'1'`～`'5'` | 轉為 `{ level, 其餘未設定 }` |
| 物件僅有 `range:'3'` | 轉為 `rangeMin:'1'`、`rangeMax:'3'` |
| 效果／限制項目自帶 `name` | **一律略過**（名稱由類型對照表統一） |

### 滿級判定
 
`isWeaponMaxed(u)`（定義於 `js/search-units.js`）：所有非 `'-'` 的武裝等級皆為 `'5'` → 滿級；全部為 `'-'`（無武裝）→ 未滿級。供「武裝等級」篩選（`fu-wstate`）使用。

## 6. 武裝效果／限制類型代碼
 
顯示名稱**唯一來源**為 `weapon-effect-types.js` 的 `WKIND_DEFAULT_*_NAMES`（要改名編輯該檔即可，全單位同步生效）。顯示格式：`名稱(數值+單位)(1回合)`，如 `防禦力debuff(30%)(1回合)`、`MP消耗技(5MP)`、`絕對命中`。

### 6.1 武裝效果（`effects`，共 17 型）
 
| code | 完整說明（表單／篩選選項文字） | 顯示名稱 | 數值 | 位數上限 | 加註 |
|---|---|---|---|---|---|
| `abs-hit` | 絕對命中 | 絕對命中 | 無 | – | – |
| `attr-null` | 武裝屬性損傷減輕無效 | 屬性減輕無效 | 無 | – | – |
| `dist-power_high` | 距離敵方越遠，武裝POWER越為提升 | 距離POWER+(遠) | `%` | 2 | – |
| `dist-power_low` | 距離敵方越近，武裝POWER越為提升 | 距離POWER+(近) | `%` | 2 | – |
| `mp-power` | 對戰開始時，自身MP越高，武裝POWER越為提升 | MP POWER+ | `%` | 2 | – |
| `def-cut-atk` | 自身攻擊時，以敵方防禦力減少的狀態攻擊 | 破防攻擊 | `%` | 2 | – |
| `hp-power_high` | 自身剩餘HP越高，武裝POWER越為提升 | HP POWER+(高) | `%` | 2 | – |
| `hp-power_low` | 自身剩餘HP越低，武裝POWER越為提升 | HP POWER+(低) | `%` | 2 | – |
| `mp-power_high` | 對戰開始時，自身MP越高，武裝POWER越為提升 | MP POWER+(高) | `%` | 2 | – |
| `debuff-def` | 賦予敵方「防禦力減少」 | 防禦力debuff | `%` | 3 | (1回合) |
| `debuff-atk` | 賦予敵方「攻擊力減少」 | 攻擊力debuff | `%` | 3 | (1回合) |
| `debuff-mob` | 賦予敵方「機動力減少」 | 機動力debuff | `%` | 3 | (1回合) |
| `debuff-hit` | 賦予敵方「命中率減少」 | 命中率debuff | `%` | 3 | (1回合) |
| `weak-phys` | 賦予敵方「遭物理武裝攻擊時，受到的損傷提升」 | 物理弱化 | `%` | 3 | (1回合) |
| `weak-laser` | 賦予敵方「遭鐳射武裝攻擊時，受到的損傷提升」 | 鐳射弱化 | `%` | 3 | (1回合) |
| `weak-spec` | 賦予敵方「遭特殊武裝攻擊時，受到的損傷提升」 | 特殊弱化 | `%` | 3 | (1回合) |
| `critical-damage` | 自身爆擊損傷提升 | 爆擊損傷提升 | `%` | 3 | (1回合) |
 
> 已知歷史重複：`mp-power` 與 `mp-power_high` 的完整說明相同（篩選下拉會出現兩個同文字選項，值不同）；兩者皆有效，顯示名稱不同。

### 6.2 使用限制（`limits`，共 5 型）
 
| code | 完整說明 | 顯示名稱 | 數值 | 位數上限 |
|---|---|---|---|---|
| `pre-move-only` | 僅限移動前使用 | 移動前限定 | 無 | – |
| `underwater-half` | 對水下敵人的傷害減半 | 水下傷害減半 | 無 | – |
| `underwater-all` | 對水下敵人沒有傷害 | 水下傷害歸零 | 無 | – |
| `no-underwater` | 不能在水下使用 | 水下不可 | 無 | – |
| `mp-cost` | 消耗MP即可使用 | MP消耗技 | `MP` | 2 |

### 6.3 `{ type, pct }` 儲存規則
 
- `type`：上表 code；未選類型的表單項目**不儲存**。
- `pct`：僅 `pct:true` 的類型有意義；正整數、最小 $1$、上限 $10^{\text{digits}} - 1$（如 digits $=3$ → $999$）；無效則存 `null`。
- 每把武裝的 `effects`／`limits` 經正規化後**各最多 10 項**（`normalizeWeaponKindList`）。

## 7. metadata（`metadata` store）
 
| key | data 型別 | 說明 |
|---|---|---|
| `lastExportTime` | number（ms 時間戳） | 上傳前由 `buildPayload()` 寫入 `Date.now()`；下載套用後對齊遠端 `exportInfo.exportDate`。作為「遠端較舊」判斷依據 |
| `localDirty` | boolean | `true`＝本地有未上傳變更；任何 `scheduleAutoSync()` 先設 `true`，上傳成功才 `false`。用於啟動時保護本地資料不被自動下載覆蓋 |
| `abilityLib` | object | 角色能力說明庫 { 能力名稱: 說明 }；供「角色能力一覽」視窗與角色表單自動完成顯示。注意：metadata 不在同步 payload 內，此說明庫僅存本地，不會隨 GitHub 同步／JSON 匯出搬移 |
| `skillLib` | object | 角色技能說明庫 { 技能名稱: 說明 }；供「角色技能一覽」視窗與角色表單自動完成顯示。與 `abilityLib` 同樣僅存本地，不隨同步搬移 |

### 舊版系統記錄 `__wkinds__`
 
`units` store 內 id 為 `__wkinds__` 的記錄為舊版「武裝效果名稱對照」殘留，現已無作用（名稱改由 weapon-effect-types.js 提供）。可能仍存在於本地或同步 payload 中，屬無害資料；**任何列出／統計單位的程式必須排除它**（`RENDER.units()`、`updateStorageStatus()` 已處理）。

## 8. 同步／備份 payload 格式（JSON）
 
上傳（GitHub）、匯出 JSON、整庫 `.db` 共用相同結構（`.db` 內容即 JSON，僅副檔名不同）：
 
```json
{
  "exportInfo": {
    "exportDate": "2024-01-01T00:00:00.000Z",
    "source": "SD高達G世代永恆 收藏管理庫 — GitHub Sync",
    "counts": { "units": 0, "characters": 0, "supports": 0, "optionalParts": 0, "stages": 0 }
  },
  "units": [ /* §2 記錄陣列 */ ],
  "characters": [ /* §3 */ ],
  "supports": [ /* §4 */ ],
  "optionalParts": [ /* §4.1 */ ],
  "stages": [ /* §4.2 */ ]
}
```
 
`exportInfo.exportDate` 是自動下載新舊比較的依據（缺失時：下載套用以當下時間代替；比較時視為 $0$）。

## 9. 匯入資料檢查（`sanitizeRecords`，下載／匯入／還原共用）
 
1. 非物件或無 `id`（空字串亦算）→ 捨棄。
2. 依 `id` 去重（僅保留第一筆）→ **絕不產生重複記錄**。
3. 缺 `name` → 補 `(未命名)`。
4. `units` → 執行 `normalizeUnitRecord`（§2；其中 `weapons` 走 `normalizeWeaponEntry` — **有效實作在 weapon-filters.js**，見 README §9）。
5. `supports` → `rarity` 不在 `UR`／`SSR`／`SR` 則歸 `''`。
6. 套用時**先清空單位／角色／支援單位三個 store 再 `bulkPut`** → 這三類完全取代。
7. `optionalParts` 改走 `sanitizeOptionalParts()`，`stages` 改走 `sanitizeStages()`。payload **沒有**該欄時不碰本地；欄位存在（含空陣列）才清空並寫入。