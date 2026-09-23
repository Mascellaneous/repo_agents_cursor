/* =============================================================================
 * config.js — 全域常數與預設值（無邏輯）
 * ============================================================================= */
 
window.APP = {
  name: 'Universal Chat',
  version: '2.4.5',
  repo: '',
};
 
/* KaTeX 版本（math.js 的 CDN 位址與 SRI 都以此為準，升級時只改這裡並同步更新 SRI） */
window.KATEX_VERSION = '0.16.11';
 
/* IndexedDB 設定（storage.js / db.js 使用） ------------------------------- */
window.DB_CONFIG = {
  name: 'orpc-db',
  version: 1,
  stores: { kv: 'kv', chats: 'chats' },
};
 
/* localStorage / sessionStorage 鍵名 -------------------------------------- */
window.STORAGE_KEYS = {
  settings:  'orpc:settings',
  chats:     'orpc:chats',
  folders:   'orpc:folders',
  current:   'orpc:currentChatId',
  prompts:   'orpc:prompts',
  modelCache:'orpc:modelCache',
  apiKey:    'orpc:apiKey',       // OpenRouter 金鑰
  poeKey:    'orpc:poeKey',       // Poe 金鑰
  device:    'orpc:deviceId',     // 本裝置識別碼（同步合併用）
  github:    'orpc:github',       // GitHub 同步設定（不含 token）
  ghToken:   'orpc:ghToken',      // GitHub token（依 tokenStore 存 local/session）
  syncMeta:  'orpc:syncMeta',     // 同步狀態（sha 快取、指紋、最後同步時間）
  pubCfg:    'orpc:pubCfg',       // 檔案輸出設定（不含 token）
  pubToken:  'orpc:pubToken',     // 輸出專用 GitHub token（依 tokenStore 存放）
};
 
/* 供應商 ------------------------------------------------------------------ */
window.PROVIDERS = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', catalog: 'online' },
  poe:        { label: 'Poe',        baseUrl: 'https://api.poe.com/v1',       catalog: 'manual' },
};
 
/** Poe 沒有公開模型目錄 API → 由使用者自行維護的預設清單 */
window.POE_DEFAULT_MODELS = ['Gemini-3.6-Flash', 'Claude-Opus-5'];
 
/** 名稱符合這些關鍵字的 Poe 模型視為支援圖片輸入 */
window.POE_VISION_HINT = /(gemini|claude|gpt-4o|gpt-4\.|gpt-5|o[34]|grok|llama-?4|pixtral|qwen.*vl)/i;
 
/* -----------------------------------------------------------------------------
 * 預設設定
 * -------------------------------------------------------------------------- */
window.DEFAULT_SETTINGS = {
  /* ---------- 供應商 ---------- */
  provider: 'openrouter',                               // openrouter | poe
 
  /* ---------- OpenRouter ---------- */
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  titleModel: 'nvidia/nemotron-3-ultra-550b-a55b:free', // '' = 跟隨對話模型
 
  /* ---------- Poe ---------- */
  poeApiKey: '',
  poeBaseUrl: 'https://api.poe.com/v1',
  poeModel: 'Gemini-3.6-Flash',
  poeTitleModel: 'Gemini-3.6-Flash',
  poeModels: ['Gemini-3.6-Flash', 'Claude-Opus-5'],
 
  /* ---------- 共用 API ---------- */
  keyStorage: 'local',
  appTitle: 'Universal Chat',
  referer: '',
  timeoutSec: 1800,
  maxRetries: 2,
  retryDelayMs: 800,
 
  /* ---------- 取樣參數 ---------- */
  favoriteModels: [],
  compareEnabled: false,
  compareModels: [],
  stream: true,
  temperature: 0.7,
  topP: 1,
  topK: 0,
  maxTokens: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1,
  seed: null,
  stopSequences: [],
  reasoningEffort: '',
  showReasoning: true,
 
  /* ---------- 上下文 ---------- */
  systemPrompt: '',
  historyLimit: 24,
  contextWarnRatio: 0.8,
  autoTitle: true,
  autoSummarize: false,
  summarizeThreshold: 30,
  sendChatMetadata: false,
 
  /* ---------- 介面 ---------- */
  theme: 'dark',
  accent: '#10a37f',
  fontSize: 15,
  chatWidth: 820,
  density: 'comfortable',
  renderMarkdown: true,
  codeWrap: false,
  showLineNumbers: false,
  showTimestamps: true,
  showModelBadge: true,
  showTokenUsage: true,
  showAvatars: true,
  autoScroll: true,
  sendOnEnter: true,
  animations: true,
  soundOnDone: false,
  confirmDelete: true,
  saveDraft: true,
  developerMode: false,
  sidebarCollapsed: false,
  sidebarWidth: 272,
 
  /* ---------- 數學公式 ---------- */
  mathEnabled: true,
  mathEngine: 'auto',                       // auto | katex | builtin
  katexBase: `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/`,
  mathPromptHint: true,
 
  /* ---------- 語音 ---------- */
  ttsEnabled: false,
  ttsAutoPlay: false,
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 1,
  sttLang: 'zh-TW',
  sttAutoSend: false,
 
  /* ---------- 檔案 ---------- */
  maxFileSizeMB: 64,
  maxTextChars: 400000,
  visionEnabled: true,
  pasteImage: true,
  storeAttachments: true,
 
  /* ---------- 內部（不顯示於 UI） ---------- */
  _modelMigrated: 0,
};
 
/** 這些設定是機密，永遠不寫進 orpc:settings，也不進任何備份檔 */
window.SECRET_SETTINGS = {
  apiKey: STORAGE_KEYS.apiKey,
  poeApiKey: STORAGE_KEYS.poeKey,
};
 
/* -----------------------------------------------------------------------------
 * GitHub 同步預設（獨立於 settings，避免被備份檔帶走 token）
 * -------------------------------------------------------------------------- */
window.GITHUB_DEFAULTS = {
  enabled: false,
  tokenStore: 'local',        // local | session | memory
  owner: '',
  repo: '',
  branch: '',                 // 空 = 用 repo 預設分支
  dir: 'chats',
  autoSync: true,
  intervalMin: 5,
  offloadKeep: 40,            // 本機保留最近幾個對話的完整內容
};

window.PUBLISH_DEFAULTS = {
  enabled: false,
  useSyncToken: true,             // true＝沿用同步 Token；false＝用專用 Token
  tokenStore: 'local',            // local | session | memory
  owner: '', repo: '', branch: '', dir: 'outputs',
};

/* -----------------------------------------------------------------------------
 * 備援模型清單（OpenRouter 離線 / 抓取失敗時使用）
 * -------------------------------------------------------------------------- */
window.FALLBACK_MODELS = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA: Nemotron 3 Ultra (free)',
    context_length: 131072, pricing: { prompt: '0', completion: '0' }, vision: false },
  { id: 'openai/gpt-oss-20b:free',          name: 'OpenAI: gpt-oss-20b (free)',      context_length: 131072,  pricing: { prompt: '0', completion: '0' }, vision: false },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Google: Gemini 2.0 Flash (free)', context_length: 1048576, pricing: { prompt: '0', completion: '0' }, vision: true },
];
 
/* 舊版預設模型：升級時自動換成新預設（使用者自己選過的不會被動到） */
window.LEGACY_DEFAULT_MODELS = [
  'openai/gpt-3.5-turbo', 'openai/gpt-4o-mini', 'google/gemini-flash-1.5',
];
 
/* 匯出格式（匯出 Modal 的下拉選單） --------------------------------------- */
window.EXPORT_FORMATS = [
  { value: 'md',   label: 'Markdown（.md）— 可讀性最佳' },
  { value: 'json', label: 'JSON（.json）— 保留完整結構' },
  { value: 'txt',  label: '純文字（.txt）' },
  { value: 'html', label: '獨立 HTML（.html）— 可離線瀏覽、含公式' },
  { value: 'csv',  label: 'CSV（.csv）— 可用 Excel 開啟' },
];
 
/* 強調色色票 --------------------------------------------------------------- */
window.ACCENTS = ['#10a37f', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#64748b'];
 
/* 側邊欄可調寬度範圍 ------------------------------------------------------- */
window.SIDEBAR_W = { min: 200, max: 520, default: 272 };
 
/* 可被視為「純文字」而直接讀取內容的副檔名 -------------------------------- */
window.TEXT_EXTENSIONS = [
  'txt','md','markdown','json','jsonl','csv','tsv','log','ini','conf','env',
  'js','mjs','cjs','ts','tsx','jsx','html','htm','css','scss','less','vue','svelte',
  'py','rb','php','java','kt','swift','c','h','cpp','hpp','cs','go','rs','sh','bash','zsh',
  'sql','yml','yaml','xml','toml','gradle','dockerfile','makefile','r','lua','pl','dart','ipynb','tex'
];
 
/* 快捷鍵表 --------------------------------------------------------------- */
window.SHORTCUTS = [
  { keys: ['Enter'],                 desc: '送出訊息（可在設定改為 Ctrl+Enter）' },
  { keys: ['Shift', 'Enter'],        desc: '換行' },
  { keys: ['Ctrl', 'Enter'],         desc: '強制送出' },
  { keys: ['Esc'],                   desc: '退出專注模式 → 關閉視窗 → 停止朗讀 → 停止生成（依序嘗試，避免誤停生成中回覆）' },
  { keys: ['Ctrl', 'Shift', 'O'],    desc: '開新對話' },
  { keys: ['Alt', 'T'],              desc: '開新的暫時對話（不儲存、不同步）' },
  { keys: ['Ctrl', 'K'],             desc: '全文搜尋' },
  { keys: ['Ctrl', 'M'],             desc: '選擇模型' },
  { keys: ['Ctrl', 'P'],             desc: '提示詞庫' },
  { keys: ['Ctrl', 'B'],             desc: '收起／展開側邊欄' },
  { keys: ['Ctrl', 'Shift', 'F'],    desc: '專注模式：隱藏側邊欄與頂列（再按一次或 Esc 退出）' },
  { keys: ['Ctrl', ','],             desc: '開啟設定' },
  { keys: ['Ctrl', '/'],             desc: '快捷鍵說明' },
  { keys: ['Ctrl', 'Shift', 'R'],    desc: '重新生成最後一則回覆' },
  { keys: ['Ctrl', 'Shift', 'C'],    desc: '複製最後一則回覆' },
  { keys: ['Ctrl', 'Shift', 'E'],    desc: '匯出目前對話（Markdown）' },
  { keys: ['Ctrl', 'Shift', 'S'],    desc: '立即與 GitHub 同步' },
  { keys: ['Alt', '↑ / ↓'],          desc: '切換上／下一個對話' },
  { keys: ['Alt', '[ / ]'],          desc: '跳到上一個／下一個書籤' },
];
 
/* Slash 指令表 ------------------------------------------------------------ */
window.SLASH_COMMANDS = [
  { cmd: '/help',      desc: '顯示可用指令' },
  { cmd: '/clear',     desc: '清空目前對話訊息' },
  { cmd: '/new',       desc: '開一個新對話' },
  { cmd: '/temporary', desc: '開一個暫時對話（不儲存、不同步，關閉分頁即消失）' },
  { cmd: '/keep',      desc: '把目前的暫時對話轉為永久對話（開始儲存與同步）' },
  { cmd: '/model',     desc: '開啟模型選擇器' },
  { cmd: '/provider',  desc: '切換供應商：/provider poe 或 /provider openrouter' },
  { cmd: '/system',    desc: '設定本對話系統提示詞：/system 你是…' },
  { cmd: '/temp',      desc: '設定溫度：/temp 0.9' },
  { cmd: '/title',     desc: '重新命名對話：/title 新標題' },
  { cmd: '/autotitle', desc: '用 AI 依內容自動產生對話標題' },
  { cmd: '/prompts',   desc: '開啟提示詞庫' },
  { cmd: '/export',    desc: '匯出目前對話（選擇格式）' },
  { cmd: '/sync',      desc: '立即與 GitHub 同步' },
  { cmd: '/settings',  desc: '開啟設定' },
  { cmd: '/tokens',    desc: '顯示本對話 token / 花費統計' },
  { cmd: '/summary',   desc: '顯示本對話的自動摘要內容與壓縮進度' },
  { cmd: '/publish', desc: '把最後一則回覆的程式碼區塊發佈到 GitHub（依本對話輸出目的地）' },  
];