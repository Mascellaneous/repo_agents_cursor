# GitHub 同步機制
 
> 對應程式：`js/GitHub-sync.js`（核心）、`api.js`（設定，自建）、`js/import-export.js`（共用 `gatherAll`／`sanitizeRecords`）。

## 1. 設計目標
 
- **單檔快照**：整份資料庫序列化為一個 JSON 檔存於 repo（`GitHub_Config.path`）。
- **完全取代**：下載一律清空本地單位／角色／支援單位再寫入（經去重與正規化），絕不合併、絕不重複。`optionalParts` 與 `stages` 只有 payload 含該欄時才同樣完全取代；缺欄則保留本地。
- **dirty 保護**：本地有未上傳變更時，啟動的自動下載會自動略過（或改為上傳），避免洗掉較新資料。
- **防抖與互斥**：編輯後 1.5 秒防抖才上傳；`_ghBusy` 互斥鎖避免同時 PUT 造成 SHA 衝突。

## 2. 前置設定（api.js）
 
```js
const GitHub_Config = {
    username: 'your-username',
    repo:     'your-repo',
    path:     'data/sdg-ggen-db.json',
    token:    'ghp_xxxxxxxxxxxx',
    branch:   'main'   // 預設 main
};
```
 
- `ghValid()`：五個欄位皆非空，且 `token` 不為 `'XXXXX'`／`'YYYYY'`／`'ZZZZZ'` 才算有效；無效時同步功能自動停用，其餘功能不受影響。
- 憑證安全：token 在前端可見 → 務必使用**私人儲存庫**＋**fine-grained PAT（僅該 repo 的 Contents 讀寫）**；`api.js` 不應提交至公開儲存庫。

## 3. 狀態與儲存位置
 
| 狀態 | 位置 | 說明 |
|---|---|---|
| `#sync-status` | DOM | 工具列同步狀態文字（`setSync()`） |
| `#gh-up`／`#gh-dn`／`#auto-sync` | DOM | 手動上傳／下載按鈕、Auto-sync 核取方塊 |
| `localDirty` | IndexedDB `metadata` | 本地有未上傳變更 |
| `lastExportTime` | IndexedDB `metadata` | 本地上次匯出時間（ms） |
| `sdg-autosync-enabled` | localStorage | Auto-sync 偏好（`'0'`＝關；不存在＝開） |

## 4. 自動上傳（scheduleAutoSync → autoPushToGitHub）
 
流程：`scheduleAutoSync(reason)` → ① `markLocalDirty()`（**無論開關一律執行**）→ ② Auto-sync 開（核取方塊或 localStorage）且 `ghValid()` → ③ 清除並重設 1500ms 計時器 → `autoPushToGitHub(reason)`；若 `_ghBusy` 中 → 以 `reason + '-retry'` 重新排程。

### 觸發點（reason）清單
 
| 來源 | reason | 檔案 |
|---|---|---|
| 新增／編輯儲存 | `save-units`／`save-characters`／`save-supports`／`save-optionalParts`／`save-stages` | database.js `saveItem()` |
| 刪除 | `delete-units`／`delete-characters`／`delete-supports`／`delete-optionalParts`／`delete-stages` | database.js `deleteItem()` |
| 刪除復原 | `undo-units`／… | ui.js `undoDelete()` |
| 獲得順序儲存 | `reorder-units`／… | reorder.js `roSave()`（僅排程一次） |
| 匯入 JSON | `import-json` | import-export.js |
| 還原整庫 .db | `restore-db` | import-export.js |
| 清空資料庫 | `clear-all` | import-export.js |
| 啟動時本地 dirty | `startup-dirty` | GitHub-sync.js |
| 上傳互斥中重試 | `<原reason>-retry` | GitHub-sync.js |
 
> 注意：`import-export.js` 的匯入／還原／清空**不直接動** `lastExportTime`／`localDirty`，交給 `scheduleAutoSync()` 與上傳結果處理，避免干擾自動下載的新舊判斷。

## 5. 上傳流程（pushToGitHub）
 
1. `buildPayload()`：`gatherAll()`（單位、角色、支援單位、選擇性零件、關卡）＋ `exportInfo`（`counts` 含五類筆數）；**先** `db.putMeta('lastExportTime', Date.now())`。
2. JSON → UTF-8 安全 Base64（`encodeBase64`：`btoa(unescape(encodeURIComponent(s)))`）。
3. `ghSha()`：GET 遠端檔案取 SHA（404 → `null` → 建立新檔；其他錯誤 → 拋出）。
4. PUT Contents API：`message`／`content`／`branch`／（有 SHA 時）`sha`。
5. 成功 → `clearLocalDirty()` ＋狀態列顯示時間；失敗 → 錯誤訊息（`localDirty` 保持 `true`，下次啟動會走「dirty → 改上傳」保護）。
 
手動上傳 `syncToGitHub()` 會先 `clearTimeout(_autoSyncTimer)`（內容相同，避免浪費請求）。上傳期間按鈕停用並顯示「上傳中…」（`silent` 模式僅改狀態列）。

## 6. 下載流程

### 6.1 取得遠端檔案（fetchRemotePayload）
 
GET Contents API（`cache: 'no-store'`）。回應 404 → `null`（遠端尚無資料檔）。若 `meta.size > 1000000`（1MB）或無 `content` → 改走 Git Blob API 取 Base64 內容。最後 `decodeBase64` → `JSON.parse`。

### 6.2 手動下載（syncFromGitHub，工具列「⬇ 自 GitHub 下載」）
 
1. `ghValid()` 檢查 → 取得遠端 payload（無 → 提示「GitHub 上尚無資料檔」）。
2. **新舊檢查**：`lastExportTime > remoteTs` → confirm 警告「雲端比本地上次匯出更舊」，可取消。
3. `applyRemoteData(obj, { silent:false })`：confirm（三類筆數；有選擇性零件／關卡欄時一併顯示筆數，缺欄則註明本地會保留）→ `sanitizeRecords()`／`sanitizeOptionalParts()`／`sanitizeStages()` → 清空並寫入單位／角色／支援單位 → 僅在欄位存在時清空並寫入零件與關卡 → `lastExportTime` 對齊遠端 `exportInfo.exportDate`（缺失用 now）→ `clearLocalDirty()` → `getAll` 重填快取＋ `refreshSeriesOptions()` ＋三頁重繪＋`updateStorageStatus()`。視窗若正開著，會重繪（`renderOptionalPartsIfOpen`／`renderStagesIfOpen`）。

### 6.3 啟動自動下載（autoDownloadFromGitHub，main.js 於初始化後呼叫）
 
決策表（依序判斷）：
 
| # | 情境 | 行為 |
|---|---|---|
| 1 | `ghValid()` 為否 | 狀態列「未設定 GitHub — 無法自動同步」，結束 |
| 2 | `localDirty = true` 且 Auto-sync 開 | **改為自動上傳**（`startup-dirty`） |
| 3 | `localDirty = true` 且 Auto-sync 關 | 略過下載；狀態列提示「請手動上傳」 |
| 4 | 遠端 404（無資料檔） | 略過（狀態列提示） |
| 5 | 本地非空 且 `lastExportTime > remoteTs` | 略過（「遠端資料較本地舊」） |
| 6 | 其他 | `applyRemoteData(obj, { silent:true })`：**靜默完全取代**＋Toast 摘要 |

## 7. 資料檢查與正規化
 
下載、匯入 JSON、還原 `.db` 共用 `sanitizeRecords()`（捨棄無 id、依 id 去重、補名稱、單位走 `normalizeUnitRecord`、支援單位稀有度只留 `UR`／`SSR`／`SR`）。選擇性零件與關卡分別走 `sanitizeOptionalParts()`、`sanitizeStages()`。詳細欄位規則見 [DATA-MODEL.md](DATA-MODEL.md) §2／§4／§4.1／§4.2／§5／§9。要點：
 
- `normalizeWeaponEntry()` 的**有效實作已被 `weapon-filters.js` 覆寫**（支援完整新格式：`ammo`、`rangeMin`／`rangeMax`、`effects`／`limits`；舊 `range` 自動轉 $1$–range）。修改時改 weapon-filters.js 內的版本；wrap 的 `applyUnitFilters` 定義於 search-units.js。
- 單位／角色／支援單位套用前一律先清空 → 完全取代、絕不產生重複記錄。
- 舊檔沒有 `optionalParts` 或 `stages` 時，不清除本地對應資料。欄位明示為空陣列則會清掉。

## 8. lastExportTime 語意整理
 
| 時機 | 寫入值 |
|---|---|
| 上傳（`buildPayload`） | `Date.now()`（**在上傳成功前**即寫入；失敗靠 `localDirty` 保護） |
| 下載套用後 | 遠端 `exportInfo.exportDate` 的 ms（缺失用 now） |
| 匯入／還原／清空 | 不直接寫入（交給 `scheduleAutoSync` → 上傳成功路徑） |

## 9. 故障排查
 
| 症狀 | 可能原因／處理 |
|---|---|
| 狀態列「GitHub 設定不完整」 | `api.js` 未建或 `ghValid()` 不過（token 為預留字） |
| 上傳失敗：訊息含 SHA／conflict | 互斥鎖已防大多數情境；手動再按一次上傳即可（會重取 SHA） |
| 下載顯示「遠端尚無資料檔」 | repo 內尚無 `GitHub_Config.path` 檔案（先成功上傳一次） |
| 啟動時提示「本地有未上傳的變更」 | `localDirty=true`；開 Auto-sync 會自動改上傳，或手動上傳一次即清除 |
| 401／Bad credentials | token 無效或過期；檢查 `api.js` |