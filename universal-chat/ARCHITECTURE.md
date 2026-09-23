# 架構文件（ARCHITECTURE）
 
本文件說明 **Universal Chat v2.4.4** 的設計理念、模組職責、資料結構、
主要流程與擴充方式，供維護者與二次開發者參考。
 
---

## 目錄
 
1. [設計原則](#1-設計原則)
2. [整體架構](#2-整體架構)
3. [檔案結構與職責](#3-檔案結構與職責)
4. [模組依賴關係](#4-模組依賴關係)
5. [資料結構](#5-資料結構)
6. [核心流程](#6-核心流程)
7. [渲染與重繪策略](#7-渲染與重繪策略)
8. [CSS 架構](#8-css-架構)
9. [安全設計](#9-安全設計)
10. [效能考量](#10-效能考量)
11. [錯誤處理策略](#11-錯誤處理策略)
12. [擴充指南](#12-擴充指南)
13. [已知限制與未來方向](#13-已知限制與未來方向)
 
---

## 1. 設計原則
 
| 原則 | 說明 |
| --- | --- |
| **零建置** | 不需 bundler / transpiler；用 script 標籤依序載入，file:// 也能跑。 |
| **可選相依** | 核心零依賴。唯一外部資源 KaTeX 採「需要時才載入 + 內建 fallback」；GitHub 同步預設關閉。 |
| **單一職責** | 每個 JS 檔案只負責一件事，檔案間以全域單例互相呼叫。 |
| **資料與視圖分離** | chatStore.js 完全不碰 DOM；ui.js 完全不直接寫 localStorage。 |
| **設定驅動** | 幾乎所有行為都由 Settings 控制，UI 只需宣告 data-setting 即自動綁定。 |
| **供應商抽象** | api.js / models.js 是唯一知道「OpenRouter vs Poe」差異的地方；其餘模組只呼叫 Models.defaultModel() / Models.resolve()。 |
| **預設安全** | 所有外部文字（模型輸出、使用者輸入、檔案內容）先轉義再渲染；金鑰與設定分離存放。 |
| **漸進降級** | 語音、串流、KaTeX、color-mix() 缺失時自動退化，不影響核心功能。 |
| **不覆蓋資料** | 同步、匯入都走三方合併；刪除一律用墓碑，避免跨裝置遺失或復活。 |
| **安靜的背景作業** | 背景同步不得改變畫面：內容指紋相同就不寫回、不重繪；生成中不同步。 |
| **層級由 JS 決定，而非 DOM 順序** | 多層 Modal 的疊放順序由開啟堆疊決定，不受 index.html 撰寫順序影響。 |
| **工作綁資料、不綁畫面** | 生成任務登記在 `UIState.state.jobs`（chatId → job），畫面只是「投影」；切換對話不會中斷任何請求。 |
| **視圖層再細分** | ui.js 只保留門面（renderAll / bindEvents / init）；渲染細節分到 ui-state / ui-header / ui-messages / ui-composer / ui-sidebar / ui-modals。 |
| **可拋棄的資料層級** | 暫時對話（temporary）只存在記憶體：不寫 localStorage、不進備份、不同步；持久化與同步兩端各自有單一守門點（`persist()` 過濾、`publicChat()` 移除、`pushOne()` 跳過）。 |
| **非同步引擎、同步門面** | 儲存改為 IndexedDB（非同步），但 `Store` 以記憶體快取提供同步 API，
啟動時 `await Store.init()` 灌入一次 —— 其餘 20 多個模組一行都不必改。 |
| **儲存可降級** | 無法使用 IndexedDB 時自動退回 localStorage 後備驅動，格式與 v2.3 相同，功能不變。 |

### 為什麼不用 ES Module？
 
type="module" 在 file:// 協定下會因 CORS 而無法載入。為了讓使用者「下載即可用」，
本專案採用傳統 script + 全域單例（IIFE 回傳物件）的模式，代價是需自行維護載入順序
（見 index.html 底部，順序即依賴順序）。
 
---

## 2. 整體架構
 
分層的 **Store → Controller → View** 模式：
 
    ┌────────────────────────────────────────────────────────────┐
    │                        View 層                              │
    │  index.html（骨架）＋ css/*（樣式）                          │
    │  ui.js（渲染 & 事件）  markdown.js + math.js（內容渲染）      │
    │  modal.js / toast.js（互動元件）                            │
    └───────────────▲──────────────────────────┬─────────────────┘
                    │ 讀取資料                  │ 使用者操作
    ┌───────────────┴──────────────────────────▼─────────────────┐
    │                      Controller 層                          │
    │  ui.js（送出流程 / 訊息操作）  shortcuts.js（鍵盤）          │
    │  prompts.js（Slash 指令）      exporter.js（匯入匯出）       │
    │  files.js（附件）              voice.js（語音）              │
    │  github.js（同步排程與合併）                                 │
    └───────────────▲──────────────────────────┬─────────────────┘
                    │                          │
    ┌───────────────┴──────────────────────────▼─────────────────┐
    │                        Model 層                             │
    │  chatStore.js（對話）  settings.js（設定）  models.js（目錄） │
    └───────────────▲──────────────────────────┬─────────────────┘
                    │                          │
┌────────────────────────────────────────────────────────────┐
    │                       基礎設施層                             │
    │  storage.js（Store：同步門面／記憶體快取／遷移／備份）        │
    │  db.js（IDB：IndexedDB 引擎 ＋ localStorage 後備驅動）        │
    │  api.js（HTTP/SSE、供應商）  utils.js（工具）  config.js（常數）│
    └────────────────────────────────────────────────────────────┘
 
**單向資料流**
 
    使用者操作 → UI 事件處理 → 呼叫 Store 修改資料 → Store 持久化 → 通知同步
                                        ↓
                        UI 依「內容指紋」決定要不要重新渲染
 
---
 
## 3. 檔案結構與職責
 
### 3.1 JavaScript（27 個模組）
 
| 檔案 | 全域名稱 | 量級 | 職責 | 依賴 |
| --- | --- | --- | --- | --- |
| config.js | APP、DEFAULT_SETTINGS、STORAGE_KEYS、SECRET_SETTINGS、PROVIDERS、POE_DEFAULT_MODELS、EXPORT_FORMATS、KATEX_VERSION… | 小 | 所有常數與預設值，無邏輯 | 無 |
| utils.js | U | 中 | DOM 建構、轉義、格式化、token 估算、檔案讀取、剪貼簿、下載、debounce/throttle | 無 |
| db.js | IDB | 小 | **IndexedDB 引擎**：開啟／升級、`kv` 與 `chats` 兩個 object store 的讀寫、配額估算、持久性申請、DataCloneError 保護；不支援時自動切換 localStorage 後備驅動 | config（STORAGE_KEYS） |
| storage.js | Store | 中 | **儲存門面**：記憶體快取提供同步 `get/set`、debounce＋序列化寫入、**對話逐筆 diff**、localStorage → IndexedDB 一次性遷移、多把金鑰的位置切換、容量統計、備份還原（merge 走三方合併）、**BroadcastChannel 多分頁廣播** | IDB、U、Toast、Chats（執行期） |
| toast.js | Toast | 小 | 右下角通知，支援 loading → ok/error 更新 | U |
| modal.js | Modal | 小 | Modal 開關與**堆疊式 z-index**、焦點交還、Promise 版 ask()（支援 input / select / extra 按鈕；Esc 也會 resolve）、**role="dialog"／aria-modal／焦點陷阱** | U、Settings |
| settings.js | Settings | 中 | 設定讀寫、持久化、事件訂閱、data-setting 自動雙向綁定；機密鍵永不寫進 settings JSON | Store、U |
| theme.js | Theme | 小 | 把設定轉成 html 上的 data-* 與 CSS 變數；系統深淺色監聽 | Settings、U |
| math.js | MathX | 中 | 數學抽取、KaTeX 動態載入（含 SRI／節點清理／**版本常數與失敗提示**）、內建輕量 TeX→HTML fallback、渲染快取、複製還原 LaTeX、早載入守門（UI.init 前 repaint 安全返回）| U、Settings |
| markdown.js | MD | 中 | Markdown → HTML、**逐行圍籬解析（CommonMark 規則）**、**數學／程式碼保護**、語法高亮、程式碼工具列 | U、Settings、MathX |
| files.js | Files | 中 | 拖放／選檔／貼上、文字擷取、圖片 dataURL、**可收合附件列**、轉 API content | U、Settings、Toast |
| models.js | Models | 中 | **供應商感知目錄**：OpenRouter 線上抓取 / Poe 手動清單；搜尋篩選排序、收藏、價格、defaultModel/titleModel/resolve、選擇器 UI（可從任何 Modal 之上開啟） | Store、Settings、U、Modal |
| api.js | API | 中 | **多供應商 OpenAI 相容客戶端**（OpenRouter / Poe）：SSE 串流、重試、逾時、錯誤翻譯、金鑰驗證、標題產生、摘要 | Settings、Models、U |
| chatStore.js | Chats | 大 | 對話／資料夾／訊息 CRUD、穩定訊息 id / seq / 軟刪除 / rev / **三類墓碑**、_offloaded 保護、**渲染指紋**、**書籤（toggleBookmark）**、搜尋、分支、統計、組裝 API messages | Store、Settings、Files、Models |
| github.js | GitHubSync | 大 | GitHub 客戶端（Contents API ＋ **Git Data API 大檔推送** ＋ **git trees API 目錄列表**）、ETag 條件請求、三方合併、樂觀鎖衝突重試、墓碑傳播、備份、卸載／回載 | Store、Chats、Prompts、Exporter、Modal、Toast、U |
| prompts.js | Prompts | 中 | 提示詞庫 CRUD（含墓碑）與 UI、Slash 指令解析（含 /summary） | Store、Modal、Chats、UI |
| exporter.js | Exporter | 中 | JSON / MD / TXT / **HTML（含 KaTeX 樣式）** / **CSV** 匯出、整體備份匯入 | U、Store、MD、Modal |
| voice.js | Voice | 小 | SpeechRecognition（STT）與 SpeechSynthesis（TTS） | Settings、U |
| ui-state.js | UIState | 小 | 視圖層共享狀態：`state.jobs`（多對話並行生成）、`state.bookmarkIdx`（書籤游標）、`R`（DOM 快取）、renderEpoch、`msgSig()` / `sideSig()` 指紋；`state.generating` 為 `jobs.size > 0` 的 getter（供 github.js 判斷是否暫停同步） | Chats、U |
| ui-header.js | UIHeader | 小 | 頂列（標題／統計／模型標籤／供應商標籤／暫時＆生成中提示、摘要狀態（📝 已摘要 N 則））、儲存空間統計（**IndexedDB 用量／配額**，3 秒節流） | UIState、Chats、Models、Store |
| ui-messages.js | UIMessages | 中 | 訊息區渲染（含**日期＋時間**、**⏱ 生成耗時**、**⬆ 回頂鈕**、**⏩ 續寫鈕**）、歡迎頁、訊息操作列（**重試／助理編輯／書籤**）、**附件下載**、行內編輯、分支、書籤列 | UIState、MD、Chats、Modal |
| ui-composer.js | UIComposer | 中 | 輸入框、草稿、token 計數、**並行生成流程 runCompletion（含 replaceMessageId 失敗重試）**、**continueGeneration 續寫**、狀態列與送出／停止切換、自動標題／摘要（支援 force 手動重摘） | UIState、API、Chats、UIMessages |
| ui-sidebar.js | UISidebar | 中 | 對話清單（暫時 🕶️／生成中 ⏳ 指示）、**資料夾排序（↑↓ 與拖放）**、切換對話、暫時 ↔ 永久轉換、**側邊欄寬度拖曳把手（含鍵盤操作）** | UIState、Chats、Settings、Modal |
| ui-modals.js | UIModals | 中 | 設定 Modal（分頁／供應商 UI／標籤）、模型選擇、全文搜尋、本對話設定（含自動摘要檢視／編輯／維護）、匯出下拉、AI 標題、金鑰驗證 | Models、Modal、Exporter、API |
| ui.js | UI | 中 | **門面**：renderAll / newChat、**專注模式（toggleFocusMode / exitFocusMode）**、所有 DOM 事件綁定、init，並把上述模組收斂成單一 `window.UI` API（其他模組只認得 UI.xxx） | 以上全部 |
| shortcuts.js | Shortcuts | 小 | 全域鍵盤快捷鍵（含**專注模式 Ctrl+Shift+F、書籤導航 Alt+[ / ]**）、說明表格生成 | UI、Chats、Modal |
| app.js | （無） | 小 | 啟動順序、設定遷移、首次使用引導、全域錯誤攔截（過濾跨域遮蔽的 Script error.） | 全部 |
 
### 3.2 CSS（8 個檔案）
 
| 檔案 | 職責 |
| --- | --- |
| variables.css | 設計 Token：4 套主題的顏色、尺寸、字體、陰影、動畫時間；JS 覆寫的 --accent、--font-size-base、--chat-width、--msg-gap；data-animations="off" 與 prefers-reduced-motion |
| base.css | Reset、基礎排版、滾動條、工具類、共用 keyframes |
| layout.css | App Shell：側邊欄、資料夾、對話項目、頂列、訊息滾動容器、輸入區、拖放層；**v2.4.1–2.4.2：可收合附件列（.attachments__head/__grid）、回頂懸浮鈕（.msg__jump）、專注模式（.app.focus-mode）、書籤列（.bookmark-bar）、續寫列（.msg__continue-row）** |
| components.css | 按鈕、輸入、range、switch、tabs、badge、chip（含**附件下載鈕 .file-chip .dl**）、Modal（基礎 z-index 1000）、Toast、模型列、提示詞卡、kbd 表 |
| chat.css | 訊息氣泡、meta、操作列、編輯器、思考過程、Markdown 全套樣式、程式碼區塊與語法高亮配色 |
| settings.css | 設定 Modal 的雙欄版面與面板切換 |
| addons.css | 同步燈號、供應商標籤、hint 狀態色、多層 Modal backdrop 調淡、KaTeX 微調、內建 mathx fallback、數學錯誤，**以及 v2.3：暫時對話樣式（.is-temp）、生成中指示（.is-generating / .chat-item__spin）、資料夾排序（.folder__actions / .drop-before）、側邊欄寬度把手（.sidebar-resizer / body.is-resizing）、訊息耗時（.msg__elapsed）** |
| responsive.css | 1024 / 820 / 480 三個斷點，以及列印樣式 |
 
---
 
## 4. 模組依賴關係
 
    config.js
       ↓
    utils.js ──────────┬──────────┬──────────┬──────────┐
       ↓               ↓          ↓          ↓          ↓
    db.js          toast.js   modal.js   math.js ──► markdown.js
       ↓
    storage.js
       ↓
    settings.js ───► theme.js
       ↓
    models.js ◄──► api.js        files.js      voice.js
       ↓
    chatStore.js ──► github.js ──► (Prompts / Exporter，皆為執行期取用)
       ↓                 ↓
    prompts.js     exporter.js
       ↓                 ↓
    ui-state.js ──► ui-header.js ──► ui-messages.js ──► ui-composer.js
         │                                  ▲                 │
         └──────► ui-sidebar.js ────────────┴─────► ui-modals.js
                          ↓
                        ui.js（門面：bindEvents / renderAll / init）
       ↓
    shortcuts.js → app.js（啟動）
 
> ⚠️ 存在少量**刻意的循環引用**（prompts.js → UI、files.js → UI.updateTokenCounter、
> storage.js → Chats.normalize、models.js → UI.onProviderChanged、math.js → UI.renderMessages）。
> 因為全域單例在執行期才互相取用（而非載入期），所以不會出錯；
> 呼叫時一律使用 X?.method?.() 的安全寫法。
>
> ⚠️ github.js 在**模組載入時**就會呼叫一次 loadCfg()，
> 這是為了讓 Chats.softMode() 在 Chats.load() 之前就得到正確結果（決定要不要用墓碑、墓碑保留天數）。
> ⚠️ ui-* 六個模組之間是**刻意的互相引用**（例如 ui-sidebar 呼叫 UIComposer.loadDraft、
> ui-composer 呼叫 UISidebar.renderSidebar）。因為都在使用者互動時（執行期）才呼叫，
> 載入順序只有一個硬性要求：**ui-state.js 必須最先載入**（其餘檔案在載入期就取
> `UIState.R` 的物件參考；R 的 identity 固定，`cacheDom()` 只是往裡面塞屬性）。
> ⚠️ `db.js` 必須排在 `storage.js` 之前載入（`Store` 在載入期不呼叫 IDB，但 `Store.init()` 會用到）。
> `Store.init()` 是**唯一的非同步啟動步驟**：app.js 必須 `await` 它之後，
> 才能呼叫任何 `Settings.load()` / `Chats.load()` 等同步讀取。
---
 
## 5. 資料結構
 
### 5.1 Settings
 
DEFAULT_SETTINGS（config.js）即完整 schema，共 9 組約 70 個鍵：
供應商、OpenRouter、Poe、共用 API、取樣參數、上下文、介面、數學、語音、檔案。
 
- 儲存位置：orpc:settings（**不含 SECRET_SETTINGS 列出的任何鍵**）。
- 機密鍵（apiKey / poeApiKey）依 keyStorage 存於 localStorage / sessionStorage / 記憶體。
- 讀寫：Settings.get(k) / Settings.set(k, v)；set 立即寫進 Store cache（v2.4.3 起
  IDB 的 debounce 由 Store 統一負責）並觸發訂閱。
- _modelMigrated 是一次性遷移旗標，避免每次啟動都重設使用者選過的模型。
 
### 5.2 供應商抽象
 
    PROVIDERS = {
      openrouter: { label:'OpenRouter', baseUrl:'https://openrouter.ai/api/v1', catalog:'online' },
      poe:        { label:'Poe',        baseUrl:'https://api.poe.com/v1',       catalog:'manual' },
    }
 
| 概念 | OpenRouter 設定鍵 | Poe 設定鍵 | 統一存取 |
| --- | --- | --- | --- |
| 金鑰 | apiKey | poeApiKey | API.conn().key / API.hasKey() |
| Base URL | baseUrl | poeBaseUrl | API.conn().baseUrl |
| 預設模型 | model | poeModel | Models.defaultModel() / setDefaultModel() |
| 標題模型 | titleModel | poeTitleModel | Models.titleModel() / setTitleModel() |
| 模型目錄 | 線上 /models + 12 小時快取 | poeModels（字串陣列） | Models.load() / Models.all() |
 
Models.resolve(id)：對話上記錄的模型若不在目前供應商目錄中，回退到 defaultModel()。
所有渲染與送出流程都經過它，因此**切換供應商不會產生無效請求**。
 
### 5.3 Chat
 
    {
      id, schema: 2,
      title, titleLocked: false,       // 使用者手動命名過 → 自動命名不再覆蓋
      folderId, pinned, archived,
      deleted: false, deletedAt: null, // 墓碑（同步用）
      model, systemPrompt, overrides,
      summary, summarizedUpTo, draft,  // summary＝自動摘要（v2.4.4 起可在 🎛️ 檢視／編輯）；draft 為本機專屬，不上傳、不進指紋
      rev: 3,                          // 遞增計數（不進指紋，避免裝置間互推）
      lastEditBy: 'dev_xxx',           // 最後編輯的裝置（同分決勝）
      createdAt, updatedAt,
      messages: [ Message ],
      temporary: true,
      _offloaded: true                 // 內容已卸載到 GitHub，本機只留標題（禁止就地修改）
    }
 
### 5.4 Message
 
    {
      id: 'msg_...',                   // 穩定 id（舊資料由 djb2(內容+位置) 補上）
      seq: 7,                          // 排序（合併時保序）
      role, content, attachments, model, reasoning, usage, cost, error,
      deleted: false,                  // 軟刪除；刪除時同時清空 content
      bookmarked: false,               // v2.4.2 書籤（進渲染指紋與同步指紋）
      createdAt, editedAt,
      startedAt: '2025-01-08T06:03:11.220Z',   // v2.3 送出請求的時刻（僅 assistant，存在才寫）
      durationMs: 92140,                       // v2.3 生成耗時（含在訊息指紋內）
      finishReason: 'length'                   // v2.4.2 'length' ⇒ 顯示「⏩ 繼續生成」（存在才寫）
    }
 
> `bookmarked` 是普通欄位：切換時 bump editedAt，跨裝置以最後切換者為準（last-writer-wins）。
> `finishReason` 只在成功回應帶 finish_reason 時寫入；舊訊息沒有此欄位，不會出現續寫鈕（保守行為）。
 
### 5.5 Attachment
 
    // 文字檔
    { id, kind:'text',  name:'main.py', size:1234, type:'text/x-python',
      text:'檔案內容…', truncated:false }
 
    // 圖片
    { id, kind:'image', name:'shot.png', size:88231, type:'image/png',
      dataUrl:'data:image/png;base64,…' }
 
storeAttachments = false 時，寫入 localStorage 前會移除 text / dataUrl 並標記 stripped: true
（此類附件在歷史訊息中顯示「內容未保存」，下載鈕停用）。
 
### 5.6 Folder / Prompt / ModelInfo
 
    Folder  { id, name, collapsed, order, deleted, deletedAt, createdAt, updatedAt }
 
    Prompt  { id, name, icon, content, builtin?, deleted, deletedAt, createdAt, updatedAt }
 
    ModelInfo {              // models.js 的統一輸出
      id, name, context, promptPrice, completionPrice,
      vision, free, description, created,
      provider: 'openrouter' | 'poe'
    }
 
> Folder 與 Prompt 也有墓碑，因此刪除會跨裝置傳播，且不會在下次同步時復活。
 
### 5.7 生成任務（Job，非持久化）
 
    UIState.state.jobs : Map<chatId, {
      aborter: AbortController,   // 只中止這個對話
      status: string,             // 狀態文字（切回該對話時重新顯示）
      startedAt: number
    }>
 
- 不寫入任何儲存；重新載入頁面即消失。
- `state.generating`（getter）= `jobs.size > 0`，供 github.js 判斷「是否暫停自動同步」。
- 訊息物件本身也帶 `startedAt`，所以即使 job 消失，UI 仍能算出耗時。
 
### 5.8 儲存層（v2.4）
 
**IndexedDB schema**（`DB_CONFIG` 定義於 config.js）
 
    orpc-db (version 1)
    ├─ kv     keyPath 'k'    { k: 'orpc:settings', v: {...} }
    │                        { k: 'orpc:folders' | 'orpc:prompts' | 'orpc:modelCache'
    │                          | 'orpc:currentChatId' | 'orpc:github' | 'orpc:syncMeta', v }
    │                        { k: '__migrated_v1', v: { at, chats } }   ← 內部旗標，不進 cache
    └─ chats  keyPath 'id'   完整 Chat 物件（見 5.3），一個對話一筆
 
**仍留在 localStorage 的鍵**（刻意不搬）
 
| 鍵 | 原因 |
| --- | --- |
| orpc:apiKey / orpc:poeKey / orpc:ghToken | 必須支援「僅本次工作階段（sessionStorage）」與「不保存（記憶體）」三種模式；同步 API 較簡單，且明確與資料庫隔離 |
| orpc:deviceId | 在 chatStore.js 的 IIFE 載入期就要同步取得（早於 `Store.init()`） |
 
**Store 的內部狀態**
 
    cache     : Map<key, value>      同步讀取的唯一真相（開機 hydrate）
    dirty     : Set<key>             待寫入的 key
    chatSigs  : Map<chatId, string>  上次寫入時的對話簽章 → 逐筆 diff 的依據
    chain     : Promise              序列化所有寫入，避免交錯的 transaction
    bc        : BroadcastChannel     多分頁廣播（'orpc-sync'；不支援時為 null）
 
**對話簽章**（`chatSig`）串接 rev、updatedAt、訊息數、deleted / _offloaded / temporary、
title、folderId、pinned、archived、titleLocked、model、draft 長度、summary 長度、
systemPrompt 長度，以及最後一則訊息的 content / reasoning 長度與 editedAt。
任何一項改變就重寫該筆記錄；其餘記錄完全不碰。
（chatStore 的每個寫入路徑都會 `touch()` → rev 遞增，因此不會漏寫。）
 
---
 
## 6. 核心流程
 
### 6.1 啟動（app.js）
 
    （載入期）github.js 自我 loadCfg() → 若尚未 init，Store 會退回讀 localStorage，
              仍足以讓 Chats.softMode() 判斷正確
 
    DOMContentLoaded
     0. await Store.init()       ★ 唯一的非同步啟動步驟
           IDB.open()            開啟 orpc-db；失敗 → 切換 localStorage 後備驅動
           migrate()             首次：把 orpc:* 搬進 IndexedDB → 刪除舊副本 → 記旗標
           hydrate               kv 全部 + chats 全部載入記憶體 cache，並建立 chatSigs
           listenRemoteChanges() BroadcastChannel / storage 事件（多分頁互通）
           requestPersistence()  申請持久性儲存（不阻塞）
     1. Settings.load()          讀設定 + 依 keyStorage 取「所有」金鑰
        migrateModel()           一次性：舊預設模型 → 新預設；補 provider / poeModels
     2. Theme.init()
     3. Modal.init() / MathX.init() / MD.bindCodeActions()
     4. GitHubSync.loadCfg() → Chats.load()
     5. Settings.bindDom()
     6. Files / Models / Prompts / Voice.init()
     7. await Models.load()
     8. UI.init() / Shortcuts.init()
     9. GitHubSync.init()
    9.5 遷移／降級提示（Toast）
    10. 若 !API.hasKey() → 引導開啟設定
 
    離開頁面：pagehide / beforeunload / visibilitychange(hidden) → Store.flushNow()
 
### 6.2 送出訊息（UIComposer.handleSend → runCompletion）
 
    handleSend()
     ├─ 若「目前這個對話」正在生成 → 提示並中止（其他對話不受影響）
     ├─ 取輸入 + 附件；皆空 → return
     ├─ 若以 / 開頭 → Prompts.handleSlash()，已處理則 return
     ├─ !API.hasKey() → Toast + 開啟設定
     ├─ Chats.addMessage(user, …)     ← _offloaded 會回傳 null 並中止
     └─ runCompletion(chat)
 
    runCompletion(chat, opts)
     ├─ chatId = chat.id；若 jobs 已有此 id → 拒絕（同一對話不並發）
     ├─ targets = opts.model ?? compareModels(有效者) ?? [Models.resolve(chat.model)]
     ├─ opts.replaceMessageId（v2.4.2 失敗重試）：
     │    不新建訊息，而是找到該則 → 清空 error/content/reasoning/usage/finishReason
     │    → 原地重用（id / seq / 位置不變）；上下文由 excludeId 自動排除自己
     ├─ jobs.set(chatId, { aborter, status, startedAt })
     │    → syncComposerState()（只影響目前對話的按鈕）
     │    → renderSidebar(true)（該列出現 ⏳）
     ├─ onScreen()  = Chats.currentIdOf() === chatId
     │  nodeOf(id)  = onScreen() ? 查 DOM : null      ← ★ 所有 DOM 操作的守門
     └─ for each model：
          ├─ placeholder = addMessage(...) 或（重試時）原地重用的訊息
          ├─ 若 onScreen() → append / replaceWith 節點 + markMessagesRendered()
          ├─ ticker = setInterval(paintElapsed, 1000)   ← ⏱ 每秒跳動
          ├─ API.chat({ onDelta / onReasoning / onMeta / onReset })
          │     onDelta：placeholder.content += chunk（**資料一定會累積**）
          │              paint() 只在 nodeOf() 拿到節點時才寫 DOM
          │     onReset（v2.4.3）：API 自動重試前呼叫 → 清空 placeholder 已累積的
          │              部分串流，避免第二輪 delta 接在第一輪後面造成文字重複
          ├─ 成功：updateMessage({ …, durationMs, finishReason: res.finish_reason })
          ├─ 失敗：updateMessage({ error, content, durationMs })
          │        （重試失敗 → 該則回到 error 狀態，可再按重試）
          └─ finally：clearInterval、若節點還在就 replaceWith(最終節點)
     ├─ finally：jobs.delete(chatId) → syncComposerState / renderHeader / renderSidebar(true)
     └─ maybeAutoTitle / maybeAutoSummarize（後者支援 opts.force，见 6.14）；
        **非暫時對話**才 GitHubSync.markDirty()
 
**為什麼切換對話不會遺失內容**：串流資料寫進 `placeholder`（就是 store 內的訊息物件），
DOM 只是投影。`UISidebar.selectChat()` 一律 `renderAll(true)` 重建，
因此切回去時會看到「當下累積到的內容」，且之後的 `paint()` 又能重新找到節點繼續更新。
 
### 6.2.1 繼續生成（UIComposer.continueGeneration，v2.4.2）
 
    觸發：訊息帶 finishReason === 'length' → 內容尾端顯示「⏩ 繼續生成」按鈕
 
    continueGeneration(chat, messageId)
     ├─ target = 該則助理訊息；model = Models.resolve(target.model)
     ├─ jobs.set(chatId, job)（與一般生成共用互斥與 UI 規則）
     ├─ messages = Chats.buildApiMessages(live, { upToId: target.id })
     │              + { role:'user', content: 延續指示 }
     │              （historyLimit 裁切發生在 tail，被續寫的那則一定保留）
     ├─ onDelta：streamed += chunk；target.content = 原文 + streamed（直接 mutate 原訊息物件）
     │            paint() 只更新該則的 .msg__content
     ├─ 成功：updateMessage({
     │     content: 原文 + streamed,
     │     finishReason: res.finish_reason,   ← 仍是 'length' ⇒ 按鈕保留，可再續
     │     usage: mergeUsage(舊 usage, 新 usage),   ← token 逐段累計
     │     cost / durationMs 同步累計 })
     ├─ 失敗：**不標記整則錯誤**（原文仍在），Toast 提示並保留已續寫的部分內容
     └─ finally：jobs.delete → syncComposerState / renderHeader / renderSidebar(true)
 
### 6.3 供應商切換
 
    Settings.set('provider', 'poe')
     ├─ settings.js emit('provider')
     ├─ models.js 訂閱 → await Models.load()
     │     poe   → 由 Settings.poeModels 就地重建目錄（無網路請求）
     │     other → 讀 orpc:modelCache（12 小時內）或抓 /models
     ├─ models.js → UI.onProviderChanged()
     │     applyProviderUI()       切換 API 分頁的 OpenRouter / Poe 區塊
     │     refreshSettingsLabels() 預設模型 / 標題模型標籤改讀新供應商的鍵
     │     bumpRenderEpoch()       模型名稱標籤會變 → 允許重繪
     │     renderHeader() / renderSidebar(true)
     └─ 之後所有請求由 API.conn() 決定 baseUrl / key / 標頭
 
api.js 對 Poe 的差異處理：
 
- 不送 HTTP-Referer / X-Title。
- 不送 stream_options。
- buildParams() 只保留 temperature / top_p / max_tokens / stop。
- credits() 直接丟出「Poe 不支援」；verifyKey() 先試 /models，失敗則送 4-token 的 ping。
- 設定頁的 Poe 清單是逐筆新增／刪除／改名（`poeModels` 仍是字串陣列），不再綁定逗號文字框。
  每一列的「測試」呼叫 `API.testPoeModel()`：永遠打 Poe 的 `/chat/completions`（不看目前供應商），
  非串流、temperature 0、max_tokens 256、60 秒逾時、不套用自動重試，提示詞固定為「請只用兩個字回覆：收到」。
  有文字（或只有思考內容）視為可用，並把回覆顯示在該列；HTTP 錯誤、空回覆與逾時則顯示原因。
 
### 6.4 SSE 串流解析（api.js → readStream）
 
    fetch(stream:true) → res.body.getReader()
    loop:
      read() → TextDecoder.decode(..., {stream:true}) 累積到 buffer
      以 '\n' 切行；最後一段（可能不完整）留在 buffer
      逐行：
        忽略空行與 ':' 開頭（keep-alive）
        'data: [DONE]' → 略過
        'data: {...}'  → JSON.parse
            json.error         → throw
            json.model         → onMeta（僅第一次）
            json.usage         → 記錄用量
            delta.reasoning    → onReasoning
            delta.content      → onDelta（字串或 multi-part 皆處理）
            finish_reason      → 記錄
    回傳 { content, reasoning, usage, model, finish_reason }
 
**重試策略**：4xx（除 408/429）不重試；408/429/5xx、逾時、TypeError（網路）可重試。
等待時間 = retryDelayMs × 2^attempt。使用者主動 abort 立即拋出且不重試。
**重試前的清理**：每次自動重試前會先呼叫 `o.onReset?.()`，讓呼叫端清空
第一輪已透過 onDelta 累積的部分串流內容；使用者主動 abort 直接拋出、不重試也不觸發 onReset。
 
### 6.5 Markdown + 數學渲染管線
 
    MD.render(src)
     0. 移除 NUL 字元
     1. extractFences(text)       → \u0000C{n}\u0000
          ★ v2.4.2：逐行解析，遵循 CommonMark 圍籬規則
          開欄：行首 ≤3 空格 ＋ 3 個以上的 ` 或 ~ ＋ 資訊字串
                （反引號欄的資訊字串不可含反引號）
          關欄：同一字元、長度 ≥ 開欄，且該行其餘只有空白
          掃描到結尾都沒等到關欄 → 視為未閉合，其餘全部是程式碼（串流安全）
          ⇒ 內容中的 ```（字串字面值、docstring、巢狀範例）不會再誤斷區塊
          ⇒ 支援長圍欄（4 反引號）包短圍欄、以及波浪線 ~~~ 圍欄
     2. 抽出行內程式碼            → \u0000I{n}\u0000
          先 ``雙反引號``（內容可含單一反引號）、再 `單反引號`
          ★ 必須在數學之前，否則 `$x$` 會被當公式
     3. MathX.extract(text)       → \u0000M{n}\u0000
          掃描 $$ / \[ \] / \( \) / \begin{} / $
          找不到結束符 → 原樣保留（串流安全）
          "$5.00" 這類純數字 → 判定為貨幣，不當公式
          區塊公式若位於行首 → 前後補空行，讓它自成一段
          立即 renderTex()：查快取 → KaTeX 或內建 fallback
     4. escapeHtml(全文)          ★ 安全關鍵；placeholder 不受影響
     5. 逐行區塊語法（標題 / 清單 / 表格 / 引言 / hr / 段落）
     6. 行內語法（圖片 → 連結 → 裸網址 → 粗體/斜體/刪除線）
     7. 還原順序：Math → Code → InlineCode
 
引擎切換與載入：MathX.init() 依設定注入 KaTeX 的 link/script；使用官方 CDN 位址時會帶
integrity + crossorigin（SRI 以 config.js 的 KATEX_VERSION 為 key 索引），改成自架路徑時則不帶。
每次重新載入前會移除上一次注入的節點，避免使用者逐字輸入路徑時累積殘留。
載入成功或失敗都會清空快取並呼叫 MathX.repaint()（內部轉發 UI.bumpRenderEpoch() +
UI.renderMessages(true)）。★ v2.4.4：repaint 會先確認 `UIState.R.scroll` 已存在——
KaTeX 可能比 `UI.init()` 更早載入完成（快取命中／網路極快），此時直接跳過，
由啟動流程末端的 `UI.init()` → `renderAll(true)` 補畫，避免在空的 DOM 快取上炸出 TypeError；
**失敗時以 Toast 明確告知原因（離線／SRI 不符），不再靜默退回內建渲染**。
 
### 6.6 上下文組裝（Chats.buildApiMessages）
 
    [system]  chat.systemPrompt || settings.systemPrompt
              + sendChatMetadata → 時間資訊
              + mathPromptHint   → 「請用 $…$ 輸出數學」規則
    [system]  【先前對話摘要】…            ← 若 chat.summary 存在
    [...]     messages
                只取 visible()（跳過墓碑）、過濾 error / 非 user|assistant
                upToId / excludeId 裁切
                slice(summarizedUpTo) → slice(-historyLimit)
                附件 → Files.toApiContent(text, atts, allowVision)
                         allowVision = Models.supportsVision(Models.resolve(...))
 
> 續寫（6.2.1）使用 `upToId: 目標訊息` 把該則助理回覆含在上下文內，
> 再附加一段「延續指示」user 訊息；重試（6.2）使用 `excludeId` 排除自己。
 
### 6.7 設定的自動綁定（settings.js）
 
    bindDom()
      對每個 [data-setting="key"]：
        writeInput(input, data[key])                 初始值 → DOM
        監聽 input/change：set(key, readInput(input)) → updateOut(key)
    readInput 依型別轉換：
        checkbox → boolean
        number/range → Number（空字串 → null）
        data-type="array" → 以逗號／全形逗號／換行分隔 → 陣列
    set(key) 特例：
        key ∈ SECRET_SETTINGS → 寫入專用儲存位置，不進 orpc:settings
        key === 'keyStorage'  → 把「所有」機密搬到新位置
        bindDom() 第一步先跑 associateLabels()：把每個 `.field > label` 自動用 for/id 關聯到
        其中的控制項——HTML 不必逐一手寫，螢幕閱讀器就能唸出欄位名稱。

**新增設定只需三步**：DEFAULT_SETTINGS 加鍵 → HTML 加 data-setting → 需要時訂閱 Settings.on(key, fn)。
 
### 6.8 AI 產生標題
 
    使用者按「✨ AI 產生」
     ├─ UI.aiTitleInto(chat, inputEl, btnEl, hintEl)
     │    ├─ 45s AbortController 逾時保護（逾時訊息與 API 錯誤分開判斷）
     │    ├─ 按鈕轉 spinner、hint 清空
     │    ├─ model = Models.titleModel() || Models.resolve(chat.model)
     │    └─ API.generateTitle(model, Chats.visible(chat))
     │         ├─ buildTitleContext：前 4 則 + 後 2 則，各截 600 字，總長 ≤ 4000
     │         ├─ chat({stream:false, temperature:.2, maxTokens:200, reasoningEffort:null})
     │         │        ★ reasoningEffort:null 表示「明確關閉」，不會 fallback 到全域 high
     │         └─ sanitizeTitle：移除思考標籤、程式碼、"標題:"、引號、句尾標點、限 24 字
     └─ 結果填進 input（不直接寫入資料）→ 使用者確認後才 Chats.update({titleLocked:true})
 
    自動命名（maybeAutoTitle）：
      條件：autoTitle && !titleLocked && title === '新對話' && 已有 2 則以上有效訊息
      先用第一句話當備援標題（立即可見）→ 再非同步換成 LLM 標題（失敗就沿用備援）
 
### 6.9 匯出流程
 
    UI.exportMenu()
     ├─ Modal.ask({ select: { options: EXPORT_FORMATS, value:'md' } })   ← 下拉選單，不需打字
     └─ Exporter.exportChat(chat, fmt)
           FORMATS = { json, md, txt, html, csv }
           html：內嵌 KaTeX CSS（CDN）＋ mathx fallback 樣式 → 離線檔也看得到公式
           csv ：加 BOM，Excel 開啟不亂碼
    「設定 → 資料」的 [data-export] 按鈕則直接指定格式，跳過選單。
 
### 6.10 GitHub 同步
 
    sync()
     ├─ 互斥鎖（同時只跑一個）
     ├─ 若 UI.state.generating → 略過，8 秒後再試（畫面不被打斷）
     ├─ ensureBranch()（沒填 branch 就抓 repo 預設分支）
     ├─ PULL
     │   ├─ listRemote()：git trees API（recursive=1），帶 If-None-Match
     │   │                304 → 不計 API 額度，直接用快取 sha
     │   │                trees 失敗 → 退回 contents API（>1000 檔會截斷，僅為備援）
     │   ├─ 只抓 sha 有變的檔案
     │   └─ 每個檔案：mergeChat(local, remote)
     │        localFp !== mergedFp → Chats.upsertRaw(merged, true) 並標記 touched
     │        mergedFp !== remoteFp → 標記需要推回
     │        兩者都相同 → 什麼都不做（不寫 IndexedDB、不重繪）
     ├─ META：_folders.json / _prompts.json
     │        用 Chats.foldersAll() / Prompts.rawCustom()（含墓碑）
     │        比較一律用 stableStringify（鍵順序無關）→ 不會每輪都重寫
     │        推送用「setLocal 之後再讀回」的正規化版本 → 兩邊真正一致
     ├─ PUSH
     │   └─ 對每個「遠端沒有」或「指紋 ≠ 上次同步指紋」的對話：
     │        payload ≤ ~900 KB → PUT contents(publicChat(chat), sha)
     │        payload >  ~900 KB → Git Data API（blob → tree(base_tree) → commit → PATCH ref）
     │                             ref 非快進失敗（422）→ 視為 CONFLICT
     │        409/422 → 重抓 → mergeChat → 重推（最多 3 次）★ 永不硬蓋
     └─ 更新 meta.lastSync / shas / fp；**只有 touched 才呼叫 UI.renderAll()**
 
    觸發時機：啟動、markDirty(debounce 5s)、每 N 分鐘、online、visibilitychange
    失敗退避：RATE_LIMIT / NETWORK → 60 秒後自動重試
    備份（backupToRepo）一律走 Git Data API（備份可能很大）
 
**合併函式的性質**
 
- **可交換**：merge(a,b) 與 merge(b,a) 的訊息集合相同（union by id）。
- **可收斂**：中繼資料以 updatedAt 比大小，同分用 lastEditBy 字典序 → 兩台裝置得到相同結果。
- **不遺失**：訊息只增不減；刪除以 deleted 旗標表達，而不是移除元素。
 
**指紋（dirty 判定）**：hash32(stableStringify(publicChat(chat)))，
忽略 `_` 開頭欄位、draft、以及 **rev**。
rev 只是遞增計數，若納入指紋會讓多台裝置每輪同步都互相推送同一份內容（無限 ping-pong）。
 
**寫入來源標記**：Chats.save(remote) / upsertRaw(chat, remote) / setFolders(list, remote) /
Prompts.setCustom(list, remote)。remote = true 時不會設定 userDirty，
因此不會回頭觸發 markDirty，避免同步迴圈。
 
**卸載（offload）保護**
 
- 只卸載「已確認同步成功（指紋相符）」且不在最近 N 個的對話。
- _offloaded 的對話：Chats.update / addMessage / clearMessages 全部拒絕並提示；
  pushOne 也會跳過，避免把空殼推上雲端。
- 開啟時 UI.selectChat → GitHubSync.ensureLoaded() 下載後才切換。
 
### 6.11 暫時對話（temporary）
 
    建立：UI.newChat({ temporary:true })（🕶️ 按鈕 / Alt+T / /temporary）
          → Chats.create({ temporary:true })（標題預設「暫時對話」）
 
    四道守門（缺一不可）：
      1. chatStore.persist()  → chats.filter(c => !c.temporary) 才寫入 orpc:chats
      2. chatStore.commit()   → 對暫時對話的寫入視同 remote，不設 userDirty → 不觸發 markDirty
      3. github.publicChat()  → 移除 temporary 欄位（保險）
      4. github.pushOne() / doSync() PUSH 迴圈 / offloadOld() / backupToRepo() → 一律跳過
 
    轉換：
      暫時 → 永久  Chats.makePermanent(id)：delete c.temporary → touch → save()
                   （同一個 id、同一批訊息，下輪同步就會建立 chats/<id>.json）
      永久 → 暫時  Chats.makeTemporary(id)：deepClone 成新 id 的暫時對話 → 切換 currentId
                   → 對舊 id 走正常 remove()（softMode 下留墓碑 → 雲端副本也會被清掉）
 
    離開頁面：UI 的 beforeunload 若 `Chats.hasTemporaryContent()` 為真就要求確認。
 
### 6.12 側邊欄寬度與資料夾排序
 
    寬度（UISidebar.initSidebarResizer）
      pointerdown → 記 startX / startW，body 加 .is-resizing（關閉 transition）
      pointermove → 直接寫 document.documentElement.style --sidebar-w（不進 Settings，60fps 不落地）
      pointerup   → 讀回實際值 → Settings.set('sidebarWidth', clamp(…))
                    → Theme.apply() 訂閱該鍵，成為單一真相來源
      keydown     → ← → 每次 16px 微調、Home 還原預設（把手為可聚焦的 role="separator"）
      dblclick    → 還原 SIDEBAR_W.default；≤820px（抽屜模式）整個把手 display:none
 
    資料夾排序（Chats.normalizeFolderOrder / moveFolder / reorderFolders）
      order 缺失時視為 +∞ → 第一次調整時 normalizeFolderOrder() 補成 0..n-1
      ↑↓ 按鈕 = 交換兩者的 order；拖放 = 陣列 splice 後整批重編號
      每次都會更新 updatedAt → mergeList 以 updatedAt 決勝 → 順序會同步到其他裝置
 
### 6.13 儲存寫入流程（v2.4）
 
    業務模組（Chats / Settings / Prompts）
      └─ 直接呼叫 Store.set(key, value)   ← v2.4.3：業務層不再各自 debounce
 
    Store.set(key, value)                 ← 同步、立即生效（寫進 cache）
      ├─ cache.set(key, value)
      ├─ dirty.add(key)
      └─ debounce 200ms → flush()         ← IDB 寫入的 debounce 只留在這一層；
                                             pagehide 的 flushNow() 因此一定有資料可刷
 
    flush()
      keys = [...dirty]；dirty.clear()
      chain = chain.then(() => write(keys))     ← 序列化，避免 transaction 交錯
 
    write(keys)
      ├─ key === 'orpc:chats' → writeChats()
      │     對每個對話計算 chatSig()
      │     簽章不同 → 放進 puts；cache 中已消失的 id → 放進 deletes
      │     IDB.chatsWrite(puts, deletes)       ← 單一 transaction
      └─ 其餘 key → IDB.kvWrite([[k, v], …])
      └─ broadcast(keys)                        ← 通知其他分頁（BroadcastChannel）
 
    錯誤處理
      QuotaExceededError → Toast 指引（刪對話 / 卸載到 GitHub / 關閉保存附件）
      其餘 → console.error；chain 不中斷（後續寫入照常）
 
**與舊版的差異**：v2.3 每次 persist 都 `JSON.stringify(全部對話)` 再整包寫入；
v2.4 只重寫真的變動的那幾筆記錄，寫入量與對話總數脫鉤。
 
**多分頁（完整雙向同步）**：
 
    分頁 A 寫入成功 → broadcast(keys)
    分頁 B 收到廣播：
      1. 先 flush 本分頁待寫資料（避免排程中的舊快照稍後蓋掉遠端新內容）
      2. refreshKeys()：從 IDB 重灌變動的 key 到 cache
      3. absorbFromStore()：依 key 呼叫 Chats / Prompts / Settings 的 absorbRemote()
         —— 用 mergeChat（訊息聯集）或 updatedAt LWW 把 IDB 最新版併回模組記憶體
      4. UI.renderAll()（指紋沒變就不動 DOM）
 
Chats.absorbRemote 的守門規則：
  • 正在生成的對話保留本機物件（串流中的 placeholder 參考不可被換掉）；
  • 合併結果與 IDB 內容相同 → 只更新記憶體、不寫回（避免兩個分頁無限互推）；
  • 合併結果含 IDB 沒有的內容 → 寫回（remote=true，不觸發 GitHub markDirty）。
 
localStorage 後備驅動走原生 storage 事件，語意相同。
同一則訊息被兩個分頁同時編輯時，合併取 editedAt 較新者（last-writer-wins per message）。
 
### 6.14 自動摘要（autoSummarize，v2.4.4 透明化）
 
**資料面**（欄位早已存在，見 5.3）：每個對話帶 `summary`（累加的摘要文字）與
`summarizedUpTo`（已壓縮到第幾則）；`buildApiMessages()` 把它變成「【先前對話摘要】」
系統訊息插在歷史之前，兩個欄位都隨 GitHub 同步。v2.4.4 補上的是「監看與編輯」的視圖層。
 
    觸發（UIComposer.maybeAutoSummarize(chat, opts)）
     ├─ opts.force 缺省（自動模式，由 runCompletion 收尾呼叫）：
     │    需要 s.autoSummarize 開啟、未壓縮訊息數 ≥ s.summarizeThreshold、
     │    且待摘切片 ≥ 4 則
     ├─ opts.force = true（手動模式，🎛️「立即重新摘要」按鈕）：
     │    略過開關與門檻
     ├─ 切片 = visible()[summarizedUpTo .. length-8]   ← 最後 8 則永遠保留原文
     ├─ API.summarize(Models.resolve(model), slice)
     │    （temperature .3 / maxTokens 400 / reasoningEffort:null；
     │      提示詞硬编码於 api.js，見「已知限制」）
     └─ 成功：Chats.update({ summary: 舊摘要 + '\n' + 新摘要,
                             summarizedUpTo: msgs.length - 8 })
          → Toast 提示；developerMode 且該對話在畫面上時，
            appendSystemNote() 附加暫時性系統卡（僅 DOM，不寫資料、不進上下文）
 
**四個監看／編輯入口（全部被動、收合；從未使用摘要功能的人看不到任何新 UI）**
 
| 入口 | 實作位置 |
| --- | --- |
| 頂列「📝 已摘要 N 則」 | ui-header.renderHeader()：`chat.summary` 存在才 push；有 summarizedUpTo 顯示「N 則」，否則顯示「含自訂摘要」 |
| 🎛️ 摘要區塊 | index.html 的 `<details id="chat-config-summary-box">`（位於 modal-chat-config 的 modal__body 內）；openChatConfig() 依 `summary || summarizedUpTo > 0` 決定整塊顯示或隱藏 |
| 三顆維護按鈕 | ui.js bindEvents()：resummarize → `UI.maybeAutoSummarize(chat, {force:true})`；reset-summary-ptr → summarizedUpTo 歸零（保留文字）＋ renderHeader；clear-summary → 兩者皆清＋隱藏區塊 |
| `/summary` | prompts.handleSlash() → appendSystemNote 印出進度與全文 |
 
**正確性要點**
 
- **saveChatConfig 的連動**：使用者把摘要文字清空 ⇒ summarizedUpTo 一併歸零。
  否則那批訊息既不在摘要裡、又因 `slice(summarizedUpTo)` 不會再被送出，
  上下文會憑空缺一段。
- **系統卡的畫面守門**：摘要可能由背景對話觸發，必須確認
  `Chats.currentIdOf() === fresh.id` 才插卡，否則會插到目前畫面上的別的對話。
- **系統卡是暫時投影**：與 developerMode 的原始請求卡同一機制——不寫入任何儲存、
  不會進 API 上下文，下次整區重繪即自然消失。

---
 
## 7. 渲染與重繪策略
 
這是 v2.2 的重點：**背景作業（尤其是 GitHub 同步）不得造成畫面閃爍。**
 
### 7.1 內容指紋
 
chatStore.js 提供兩個純函式：
 
| 函式 | 內容 | 用途 |
| --- | --- | --- |
| messagesSignature(chat) | 目前對話每則可見訊息的 id、editedAt/createdAt、content 長度、reasoning 長度、error、model、completion_tokens、附件數、durationMs、**bookmarked、finishReason** | 決定要不要重建訊息區 DOM |
| sidebarSignature() | 每個對話的 id、title、pinned、archived、folderId、updatedAt、可見訊息數、_offloaded、temporary；以及資料夾的 id/name/collapsed；再加上 currentId | 決定要不要重建側邊欄 |
 
ui.js 另外維護 renderEpoch：只有「影響訊息外觀的設定」變更時才 +1
（renderMarkdown、showTimestamps、showModelBadge、showTokenUsage、showReasoning、codeWrap、
數學引擎、供應商）。指紋 = 內容指紋 + renderEpoch。
`sideSig()` 另外串接 `[...state.jobs.keys()].sort()`：
生成開始／結束會改變指紋 → 側邊欄的 ⏳ 指示能即時出現與消失，
但生成過程中（keys 不變）不會每個 token 都重畫側邊欄。
 
> 書籤切換走 `renderMessages(true, { keepScroll: true })`：bookmarked 已進指紋，
> force 只是保險；keepScroll 確保視角不跳。
 
### 7.2 重繪規則
 
    renderMessages(force = false, opts = {})
      if (!R.scroll) return;   // ★ v2.4.4：DOM 快取未建立（早於 UI.init 的呼叫一律忽略，
                               //   例如 KaTeX 比 UI.init 更早 onload 時的 repaint）
      sig = messagesSignature + renderEpoch
      if (!force && sig === lastMsgSig) return;   // 內容沒變 → 不動 DOM
      if (!force && UIState.isGenerating(Chats.currentIdOf())) return; // 只擋「目前這個」對話
      重繪前記下 scrollTop 與「是否貼底」
      → 重建整區並記錄 sig
      opts.keepScroll 且原本不是貼底 → 還原原捲動位置（編輯／刪除／書籤不跳視角）
      否則 → 滾到底部
 
    renderSidebar(force = false)
      同理，另外把 filter / 搜尋字串納入指紋
 
    renderHeader()
      不重建 DOM，只在字串真的不同時才寫 textContent（避免 layout thrash）
 
    updateStorageBadge(force = false)
      Store.usage() 會讀取所有 orpc:* 的字串長度，成本較高
      → 3 秒節流；開啟設定時用 force = true 立即更新
 
需要**強制**重建的情境一律傳 force = true：
取消／儲存行內編輯、刪除訊息、清空對話、切換對話、新對話、切換渲染設定、
KaTeX 載入完成、重設設定、force pull / offload。
 
### 7.3 串流期間
 
- 每 60ms 只更新「當前 placeholder」那一則的 innerHTML（不動其他訊息）。
- 每則結束時用 node.replaceWith(messageNode(fresh)) 換掉單一節點，
  然後 markMessagesRendered() 讓指紋與 DOM 對齊，避免之後被整區重建。
- 重試（replaceMessageId）同樣走「replaceWith 單一節點」，不重建整區。
- 生成期間 GitHubSync.sync() 直接回傳 skipped: 'busy'，8 秒後再試。
 
### 7.4 同步期間
 
- 只有「本機資料真的被改動」（touched）才呼叫 UI.renderAll()，
  且該次 renderAll 不帶 force → 仍會被指紋擋下，除非內容真的不同。
- 同步燈號用「值不同才寫」的方式更新 textContent / className / title。
 
### 7.5 多層 Modal 的疊放
 
CSS 讓所有 `.modal` 共用 `z-index: 1000`，因此**同時開啟兩個 Modal 時，
誰在上面完全取決於它在 index.html 的先後順序**。這在「從 A Modal 內開啟 B Modal」
的情境下是錯的（例如從「🎛️ 本對話設定」點「選擇…」開啟模型選擇器，
但 `#modal-models` 在 HTML 中排在 `#modal-chat-config` 之前，結果被蓋住而無法點選）。
 
modal.js 因此改為**堆疊式 z-index**：
 
    stack = ['modal-chat-config', 'modal-models']   // 後面 = 上層
 
    open(id)
      1. 若 id 已在 stack 中 → 先移除（重新開啟一律移到最上層）
      2. push(id)
      3. applyZ()：stack.forEach((id, i) => el.style.zIndex = 1000 + (i+1)*10)
      4. 聚焦該 Modal 的第一個可見輸入元素
 
    close(id)
      1. 加上 .hidden、清掉 inline z-index（還原給 CSS）
      2. 從 stack 移除 → applyZ()
      3. 把焦點交還給仍開著的最上層 Modal
 
搭配 addons.css：第二層以上的 `.modal__backdrop` 透明度調淡（.55 → .35），
避免疊兩層之後整個畫面過暗。
 
實務影響：
 
| 情境 | 行為 |
| --- | --- |
| 設定 → 選擇預設模型 | 模型選擇器疊在設定之上（1020 > 1010） |
| 本對話設定 → 選擇… | 模型選擇器疊在本對話設定之上（可正常點選） |
| 任一 Modal 內觸發 Modal.ask() | ask 永遠在最上層 |
| Esc | Modal.closeTop() 依 stack 由上往下關 |
| 點 backdrop | `t.closest('.modal')` 取到最近的那層，只關該層 |
 
### 7.6 並行生成時的 DOM 規則
 
| 狀況 | 行為 |
| --- | --- |
| 生成中且該對話**在畫面上** | 每 60ms 只更新那一則的 innerHTML；每則結束 `replaceWith` 單一節點 |
| 生成中但該對話**不在畫面上** | `nodeOf()` 回傳 null → 完全不碰 DOM，只累積資料與 `job.status` |
| 切換到「正在生成」的對話 | `selectChat()` → `renderAll(true)` 強制重建，之後 `paint()` 自動接上 |
| 目前對話正在生成 | 整區重建被擋（避免打斷串流）；刪除訊息／編輯等操作一律傳 `force = true` |
| ⏱ 耗時 | `setInterval(paintElapsed, 1000)`，只寫一個 `<span>` 的 textContent，不重排整則 |
| 狀態列 / 送出停止鈕 | `setStatus(text, chatId)`：`chatId !== 目前對話` 就直接 return，不動畫面 |
 
### 7.7 專注模式與書籤列（v2.4.2）
 
**專注模式**（ui.js → toggleFocusMode / exitFocusMode）
 
- 純 CSS class 切換：`#app` 加 `.focus-mode` → layout.css 隱藏 `.sidebar` 與 `.topbar`。
- 進入：Ctrl+Shift+F；退出：同鍵或 Esc（shortcuts.js 的 Esc 優先序，v2.4.3 起：
  退出專注模式 → 關 Modal → 停止朗讀 → 停止生成——最無害的操作優先，
  避免想退出專注模式卻誤停了正在生成的回覆）。
- 不持久化：重整後回到一般模式（刻意保持簡單）。
 
**書籤列**（ui-messages.js → renderBookmarkBar / jumpBookmark）
 
- 位置：index.html 的 `#bookmark-bar`（頂列下方、訊息區上方）；沒有書籤整條隱藏。
- 資料來源：`Chats.visible(chat).filter(m => m.bookmarked)`——書籤列隨訊息指紋一起更新。
- 游標：`UIState.state.bookmarkIdx`（工作階段內有效）；切換對話自動歸零。
- 跳轉：複用 `scrollToMessage()`（與回頂按鈕同一條路徑）。
 
---
 
## 8. CSS 架構
 
### 分層順序（載入順序即權重順序）
 
    variables → base → layout → components → chat → settings → addons → responsive
    （Token） （Reset）（骨架）  （元件）    （內容）（頁面）  （數學/同步/多層 Modal）（斷點）
 
### 主題機制
 
- 顏色一律以語意變數表示：--bg、--bg-elev、--text、--border、--accent…
- 4 套主題各自定義同一組變數，透過 html 上的 data-theme 切換；
  system 由 JS 依 prefers-color-scheme 解析。
- JS 只寫入 4 個動態變數與 3 個 data-* 開關：
 
| 由 JS 設定 | 影響 |
| --- | --- |
| --accent / --font-size-base / --chat-width / --msg-gap | 強調色、字級、內容寬度、訊息密度 |
| data-theme | 整組配色 |
| data-animations / data-avatars / data-linenumbers | 動畫、頭像、程式碼行號 |
| --sidebar-w | 側邊欄寬度（拖曳時由 UISidebar 直接寫入 root，放手後改由 Settings → Theme.apply 接手） |
 
> data-animations="off" 與 prefers-reduced-motion 是**兩條獨立規則**
>（不能寫在同一個選擇器列表裡，否則整條 ruleset 會被 parser 丟棄）。
 
### z-index 分層
 
| 層 | 值 | 說明 |
| --- | --- | --- |
| 頂列 | 5 | .topbar |
| 回到底部 | 6 | .scroll-bottom |
| 訊息回頂懸浮鈕 | 3 | .msg__jump（sticky，位於訊息流內） |
| 側邊欄抽屜遮罩 | 40 | .sidebar-overlay |
| 側邊欄（手機） | 50 | .sidebar |
| 拖放層 | 900 | .drop-zone |
| Modal 基準 | 1000 | CSS 預設值 |
| Modal 實際 | 1010 / 1020 / 1030… | **由 modal.js 依開啟堆疊寫入 inline style** |
| Toast | 2000 | .toast-root（永遠在最上） |
| 側邊欄寬度把手 | 60 | .sidebar-resizer（僅桌機；收合或 ≤820px 時隱藏） |
 
### 命名慣例
 
簡化 BEM：block__element--modifier，狀態類別統一以 is- 開頭
（is-active、is-pinned、is-selected、is-editing、is-wrap、is-poe）。
 
---
 
## 9. 安全設計
 
| 風險 | 對策 |
| --- | --- |
| **XSS（模型輸出）** | MD.render() 在解析前先 escapeHtml 全文，之後只可能出現本程式產生的標籤 |
| **XSS（行內程式碼）** | 行內 code 在還原時再次 escapeHtml（抽取發生在 escape 之前） |
| **XSS（Markdown 連結）** | safeUrl() 只允許 http:、https:、mailto:、data:image/、#、/ |
| **XSS（屬性注入）** | 屬性一律用 U.escapeAttr() |
| **innerHTML 濫用** | 只在「已轉義」或「本程式產生的字串」使用；使用者資料一律走 textContent / U.el({text}) |
| **KaTeX 注入** | trust:false、strict:'ignore'；輸出由我們自己呼叫產生，且在全文 escape 之後才插入 |
| **CDN 供應鏈** | 使用官方 KaTeX 網址時附 integrity + crossorigin（版本集中於 KATEX_VERSION）；可改自架路徑或改用內建渲染器完全離線 |
| **金鑰洩漏** | SECRET_SETTINGS 列出的鍵永不寫進 orpc:settings、永不進任何匯出檔；可選 session / 記憶體；只放在 Authorization 標頭 |
| **GitHub Token 洩漏** | 與 settings 分開存放（orpc:ghToken），同上；Store.clearAll() 一併清除 session 副本 |
| **外部連結** | 一律加 target="_blank" rel="noopener noreferrer" |
| **原生 dialog 阻塞** | 以 Modal.ask() 取代 confirm/prompt；Esc / backdrop 也會 resolve（不會卡住 await） |
| **UI 誤導（點不到的按鈕）** | 多層 Modal 由 modal.js 指派堆疊式 z-index，並在關閉時交還焦點，避免「開了卻在背後」的失效互動 |
| **儲存空間耗盡** | Store.set() 捕捉 QuotaExceeded 並給出具體解法 |
| **同步覆蓋資料** | 樂觀鎖（sha）＋三方合併＋衝突重試；覆蓋型操作需打字 OVERWRITE 並自動備份 |
| **匯入覆蓋資料** | 「合併」模式改走 GitHubSync.mergeChat，不會用舊備份蓋掉較新的本機對話 |
| **NUL 注入（渲染崩潰）** | MD.render() 開頭移除 \u0000 字元；模型輸出含字面 placeholder 序列不會讓還原階段查表失敗 |
| **SVG 附件腳本** | 圖片附件僅點陣圖（png/jpg/gif/webp…）可開新視窗檢視；SVG 等一律下載 |
| **危險操作確認強度** | 全部打字確認：匯入覆蓋＝OVERWRITE、清除全部資料＝DELETE ALL、刪除封存＝DELETE、重設設定＝RESET（GitHub 覆蓋原本就是 OVERWRITE） |
 
---
 
## 10. 效能考量
 
| 手法 | 位置 | 目的 |
| --- | --- | --- |
| **指紋式重繪** | renderMessages / renderSidebar | 內容沒變就完全不動 DOM（背景同步不閃爍） |
| throttle(60ms) | 串流重繪 | 避免每個 token 都重排整個 Markdown |
| **單則替換** | 串流結束 node.replaceWith(...) | 只換一則訊息的 DOM（重試同樣走此路徑） |
| **數學渲染快取** | MathX.renderTex | 同一條公式在串流期間只渲染一次（上限 800 筆） |
| debounce | IDB 寫入(200ms，僅 Store 一層)、搜尋(200ms)、KaTeX 位址(800ms) | 減少寫入與重複注入；v2.4.3 起設定／對話／草稿改為立即寫進 Store cache（O(1)），pagehide 的 flushNow 才涵蓋得到最後一刻 |
| 儲存統計節流 | UI.updateStorageBadge(3s) | Store.usage() 會讀取全部 orpc:* 字串，避免頻繁執行 |
| 局部重繪 | renderSidebar / renderHeader / renderMessages 分離 | 不做整頁重建 |
| inline z-index 而非全域重排 | Modal.applyZ() | 只改 stack 內的少數節點，不觸發整頁 repaint |
| 模型清單快取 | orpc:modelCache，TTL 12 小時；Poe 完全不連網 | 避免每次啟動抓數百筆模型 |
| 事件委派 | 程式碼區塊工具列、Modal 關閉 | 動態內容不需逐一綁定 |
| 附件瘦身 | storeAttachments = false 時剝除 base64 | 節省儲存空間 |
| 上下文裁切 | historyLimit + 自動摘要 | 降低 token 成本與延遲 |
| ETag 條件請求 | listRemote()（trees API） | 304 不計 GitHub API 額度 |
| sha 差異同步 | PULL 階段 | 只下載真的有變動的對話檔 |
| **內容指紋（排除 rev）** | fingerprint(publicChat(chat)) | 比 dirty flag 可靠，且不會造成裝置間無限互推 |
| stableStringify 比較 | syncMetaList | 鍵順序不同不算差異 → 資料夾／提示詞不會每輪重寫 |
| 生成中暫停同步 | GitHubSync.sync() | 不與串流搶主執行緒、不打斷畫面 |
| 離畫面零 DOM 成本 | runCompletion 的 `nodeOf()` | 背景生成的對話完全不觸發 layout / paint |
| 耗時只更新單一 span | UIMessages.paintElapsed | 每秒 1 次、不重排整則訊息 |
| 拖曳寬度不落地 | UISidebar.initSidebarResizer | 拖曳中只寫 CSS 變數，放手才 Settings.set（避免 debounce 風暴） |
| 暫時對話不寫 IndexedDB | Chats.persist 過濾 | 大量圖片附件的臨時測試不會吃掉配額 |
| **逐筆 diff 寫入** | Store.writeChats | 只寫變動的對話記錄，寫入量不隨對話總數成長 |
| 結構化複製取代 JSON | IndexedDB put | 省下大字串序列化／解析 |
| 寫入序列化 + debounce(200ms) | Store.flush | 合併連續設定變更，避免 transaction 打架 |
| 用量統計改為長度累加 | Store.chatsSize | 不對數十 MB 資料做 JSON.stringify；並取 `navigator.storage.estimate()` 的配額 |
| **逐行圍籬解析** | MD.extractFences | 單次線性掃描，複雜度與舊版正則相同，但判定正確（內容中的 ``` 不會引發重試式重繪） |
| keepScroll 重繪 | renderMessages({keepScroll}) | 編輯／刪除／書籤不重排視角，避免不必要的滾動 |
 
---
 
## 11. 錯誤處理策略
 
三層防護：
 
1. **模組層**：可預期錯誤（讀檔失敗、JSON 壞掉、語音不支援、Poe 不支援額度查詢）
   → Toast 提示並優雅降級。
2. **流程層**：runCompletion 的 try/catch/finally 確保
   - 錯誤寫入該則訊息的 error 欄位（保留部分已串流內容），
   - jobs.delete 一定會執行，UI 不會卡在生成狀態。
   - 失敗訊息可「↻ 重試」原地重送；續寫失敗不標記整則錯誤（保留原文與已續寫部分）。
3. **全域層**：app.js 監聽 error / unhandledrejection；啟動失敗時顯示救援畫面
   （附「清除資料並重載」按鈕）。
   ★ v2.4.4：error 攔截器略過「filename 為空且訊息恰為 Script error.」的事件——
   這是瀏覽器對跨域腳本（KaTeX CDN、擴充功能注入碼）拋錯的同源政策遮蔽，
   沒有檔名與堆疊、無法處理，記錄只是噪音；自家模組的錯誤必帶 filename，不受影響。
   unhandledrejection 不受同源遮蔽，不需過濾。
 
HTTP 狀態碼會依供應商翻譯成中文可行動訊息
（400 參數不支援、401 金鑰無效、402 額度不足、403 資料政策、404 模型名稱、429 速率限制…）。
 
---
 
## 12. 擴充指南
 
### 12.1 新增一個設定項
 
    // 1) js/config.js
    DEFAULT_SETTINGS.myFeature = true;
 
    <!-- 2) index.html：放進對應的 settings__panel -->
    <label class="switch">
      <input type="checkbox" data-setting="myFeature">
      <span>啟用我的新功能</span>
    </label>
 
    // 3) 需要即時反應時（ui.js 的 bindEvents 內）
    Settings.on('myFeature', () => { UI.bumpRenderEpoch(); UI.renderMessages(true); });
 
不需要寫任何讀寫程式碼——Settings.bindDom() 會自動處理。
若是機密（金鑰類），額外在 SECRET_SETTINGS 加一筆對應的 storage key 即可。
 
> ⚠️ 若新設定會改變訊息外觀，務必呼叫 UI.bumpRenderEpoch() 再 renderMessages(true)，
> 否則指紋不變、畫面不會更新。
 
### 12.2 新增一個 Modal
 
1. 在 index.html 任意位置加上：
 
       <div class="modal hidden" id="modal-foo">
         <div class="modal__backdrop"></div>
         <div class="modal__panel">
           <div class="modal__head"><h2>Foo</h2>
             <button class="btn btn--ghost btn--icon" data-close>✕</button></div>
           <div class="modal__body">…</div>
         </div>
       </div>
 
2. 用 `Modal.open('modal-foo')` / `Modal.close('modal-foo')` 控制。
3. **不需要**自行處理 z-index：擺在 HTML 哪裡都可以，堆疊順序由開啟順序決定。
4. 若要在此 Modal 內再開別的 Modal（例如模型選擇器），直接呼叫即可，會自動疊在上層。
 
### 12.3 新增第三個供應商
 
1. config.js → PROVIDERS 加一筆；DEFAULT_SETTINGS 加 xxxApiKey / xxxBaseUrl / xxxModel / xxxTitleModel；
   SECRET_SETTINGS 加 xxxApiKey。
2. api.js → conn() 加分支；必要時在 buildParams() / headers() / verifyKey() 加例外。
3. models.js → modelKey() / titleKey() 加分支；load() 決定目錄來源。
4. index.html → API 分頁加一個 div#api-xxx 區塊；ui.js 的 applyProviderUI() 加一行。
 
其餘模組完全不必動（都經由 Models.defaultModel() / Models.resolve()）。
 
### 12.4 新增 Slash 指令
 
    // js/config.js
    SLASH_COMMANDS.push({ cmd: '/stats', desc: '顯示全域統計' });
 
    // js/prompts.js → handleSlash() 的 switch 中
    case '/stats': {
      const g = Chats.globalStats();
      UI.appendSystemNote(`對話 ${g.chats} 個、訊息 ${g.messages} 則、花費 ${U.formatCost(g.cost)}`);
      return true;
    }
 
### 12.5 新增匯出格式
 
    // js/exporter.js
    function toXml(chat) { /* … */ return { ext:'xml', mime:'application/xml;charset=utf-8', content }; }
    // 註冊：const FORMATS = { json, md, txt, html, csv, xml: toXml };
 
    // js/config.js — 讓它出現在匯出下拉選單
    EXPORT_FORMATS.push({ value: 'xml', label: 'XML（.xml）' });
 
（可選）再於 index.html 資料頁加一顆 data-export="xml" 的按鈕。

### 12.6 新增主題
 
    /* css/variables.css */
    html[data-theme="forest"] {
      --bg:#12211a; --bg-elev:#1b3026; --bg-sidebar:#0c1712; --text:#e6f2ec;
      /* …補齊其餘變數（照現有主題的鍵） */
      color-scheme: dark;
    }
 
    <!-- index.html 主題下拉 -->
    <option value="forest">森林</option>

### 12.7 新增訊息操作按鈕
 
    // js/ui-messages.js → actionsNode()
    add('🔁 翻譯', '翻成英文', () => {
      R.input.value = `請把以下內容翻成英文：\n\n${m.content}`;
      UI.focusInput();
      UI.updateTokenCounter();
    });
 
> 操作列的 add() 已自動補 aria-label（title 同時作為無障礙名稱）。

### 12.8 換成自訂後端 / 代理
 
只要相容 OpenAI Chat Completions 格式，把「設定 → API → Base URL」改成你的位址即可
（例如自建的 Cloudflare Worker，以隱藏真實金鑰）。api.js 不需修改。

### 12.9 加入新模組的檢查清單
 
1. 以 IIFE 撰寫並回傳公開 API：window.MyModule = (() => { … return {…}; })();
2. 在 index.html 的 script 區塊放到**其依賴之後**。
3. 若需初始化，在 app.js 的啟動序列中呼叫 MyModule.init()。
4. 只透過 Store 存取儲存、只透過 Settings 讀設定，不要自己碰 localStorage。
5. 若會在背景改資料，務必：寫入時傳 remote 標記、並讓 UI 用指紋判斷是否重繪。
6. 若會開 Modal，一律走 Modal.open/close，不要自己設 z-index。
7. 在 README 的功能表與本文件的模組表補上說明。

### 12.10 該把新程式碼放進哪個 ui-* 模組？
 
| 你要做的事 | 檔案 | 備註 |
| --- | --- | --- |
| 新增跨模組共享的狀態 / 指紋 | ui-state.js | 加完記得檢查是否該進 `sideSig()` / `msgSig()` |
| 改頂列顯示 | ui-header.js | 一律「值不同才寫 textContent」 |
| 改訊息外觀、加訊息操作按鈕 | ui-messages.js | 外觀改動需 `UIState.bumpRenderEpoch()` |
| 改送出流程、參數、生成行為 | ui-composer.js | 所有 DOM 存取都要經過 `nodeOf()` 守門 |
| 改側邊欄、資料夾、對話項目 | ui-sidebar.js | 改動要反映到 `Chats.sidebarSignature()` |
| 新增 / 修改 Modal 行為 | ui-modals.js | 只用 `Modal.open/close`，不要自己設 z-index |
| 綁定新的 DOM 事件 | **ui.js 的 bindEvents()** | 事件綁定只有這一個入口，方便追蹤 |
| 其他模組要呼叫視圖 | 加進 ui.js 的 `return {…}` | 外部一律只認 `UI.xxx`，不要直接呼叫 `UIComposer.xxx` |

### 12.11 新增一個 IndexedDB object store
 
1. `config.js` → `DB_CONFIG.version` +1，並在 `DB_CONFIG.stores` 補上名稱。
2. `db.js` → `onupgradeneeded` 內加
   `if (!d.objectStoreNames.contains('foo')) d.createObjectStore('foo', { keyPath:'id' });`
   （**只能新增，不要刪既有 store**，否則舊使用者會遺失資料）。
3. `db.js` → 加上該 store 的存取函式，並在 `LS` 後備驅動補上對應實作。
4. `storage.js` → 若需要同步存取，在 `init()` 的 hydrate 階段一併載入 cache，
   並決定它的 flush 策略（整包 or diff）。
5. 記得更新 `clearAll()`。
 
> 建議：**大型二進位資料（圖片附件）未來可獨立成 `blobs` store 並存 Blob**，
> 訊息只保留 `blobId`。這樣就不必再把 base64 塞進對話記錄，
> 也能讓「不保存附件內容」這個設定退休。
 
---

## 13. 已知限制與未來方向

### 限制
 
| 項目 | 說明 |
| --- | --- |
| Markdown 為簡化實作 | 圍籬已遵循 CommonMark 逐行解析（內容中的 ``` 不會誤斷、支援長欄包短欄與 ~~~）；仍不支援腳註、嵌套引言內清單等進階語法（LaTeX 已由 math.js 支援）。**唯一無法區分的情況**：程式碼本身含「行首恰好是 ``` 的獨立行」——語意上與真正的關欄相同，請讓模型用 4 反引號外欄或 `~~~` |
| 內建數學渲染為簡化版 | 不支援矩陣、對齊環境、化學式；需要時請讓 KaTeX 可載入 |
| 語法高亮為啟發式 | 少數語言（如 JSX 屬性、Regex 字面量）可能著色不精準 |
| Token 估算為近似值 | 未使用真實 tokenizer；實際數字以 API usage 為準 |
| 語音輸入相容性 | Web Speech API 主要在 Chrome / Edge 可用 |
| Poe 模型清單需手動維護 | Poe 未提供公開目錄 API；bot 名稱大小寫敏感且會改版 |
| Modal 堆疊上限 | z-index 以 10 為級距、Toast 固定 2000，實務上最多疊 4 層（1010–1040）；再深就需調整 Z_STEP |
| 同步為「檔案級」而非「操作級」 | 極端情況（同一秒、同一則訊息、兩邊都編輯）仍以 editedAt 決勝，較舊的那份會被蓋掉 |
| GitHub API 額度 | 已認證 5000 req/hr；本設計每輪同步只用 1 + 變動檔數，日常使用綽綽有餘 |
| 載入順序需手動維護 | 為支援 file:// 而放棄 ES Module 的自動依賴解析 |
| 長對話仍會整區重建 | 目前尚無虛擬滾動；>500 則的對話切換時會有明顯延遲 |
| 並行生成沒有數量上限 | 同時對 5 個對話送出就會有 5 條 SSE 連線；瀏覽器與供應商的速率限制會先擋住你（429）。需要時可在 runCompletion 開頭加 `state.jobs.size >= N` 的檢查 |
| 暫時對話不耐重整 | 只在記憶體：F5、當掉、關分頁都會消失（beforeunload 只能「提醒」，無法保留）。想留就先 `/keep` 或匯出 |
| 側邊欄寬度為全域設定 | 不隨視窗大小自動記憶多組；縮小視窗時以 `window.innerWidth - 160` 動態夾住上限 |
| 專注模式不持久化 | 刻意保持簡單：重整後回到一般模式；要記住狀態可搬進 DEFAULT_SETTINGS |
| ui-* 載入順序仍需手動維護 | ui-state.js 必須第一個；為支援 file:// 而放棄 ES Module 的自動依賴解析 |
| **記憶體而非磁碟是瓶頸** | v2.4 起容量由瀏覽器配額決定（通常數 GB），但**啟動時仍會把全部對話載入記憶體**；數千個對話時啟動會變慢。解法仍是封存、刪除或 GitHub 卸載；未來可改成「清單先載入、訊息延遲載入」（`chats` store 已按對話分筆，改動範圍可控） |
| 隱私模式無 IndexedDB | 自動退回 localStorage 後備驅動（約 5 MB），啟動時以 Toast 告知 |
| 多分頁同時開啟 | 已透過 BroadcastChannel 互通變更（v2.4.1）；同一則訊息的並發編輯仍是後寫入者為準，需要嚴格一致請用 GitHub 同步 |
| 附件仍以 base64 存放 | IndexedDB 支援 Blob，但目前沿用 dataURL 以維持匯出／API 送出流程不變；改用 Blob 可再省約 33% 空間 |
| 續寫僅涵蓋「長度截斷」 | 只有 `finish_reason === 'length'` 顯示續寫鈕；`content_filter` 等其他截斷原因不提供（避免誤導使用者重送被過濾的內容） |
| 舊訊息無法續寫 | finishReason 是 v2.4.2 才開始記錄的欄位；升級前完成的回覆不會出現續寫鈕（保守行為，避免對未知狀態誤判） |
| 摘要提示詞硬編碼 | api.js 的 summarize() 使用固定提示使用固定提示詞（繁中、條列、250 字內）；想調整風格需改碼（未來可抽成 DEFAULT_SETTINGS.summarizePrompt ＋ data-setting，走 12.1 的三步驟） |