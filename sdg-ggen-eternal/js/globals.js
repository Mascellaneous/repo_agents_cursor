/* =====================================================================
 * globals.js — 常數與全域狀態
 * ===================================================================== */
const APP_NAME = 'SD高達G世代永恆 收藏管理庫';
const TYPES = ['units', 'characters', 'supports'];
const LABEL = { units: '單位', characters: '角色', supports: '支援單位' };
const RARITIES = ['UR', 'SSR', 'SR', 'R', 'N'];
const RARITY_ORD = { UR: 5, SSR: 4, SR: 3, R: 2, N: 1 };
const TYPE_ORD = { '攻擊': 1, '防禦': 2, '支援': 3 };
const WEAPON_OPTS = ['-', '1', '2', '3', '4', '5'];
const TERRAIN_OPTS = { 'O': 2, '△': 1, '-': 0 };
const TERRAINS = [['宇宙', 'space'], ['空中', 'air'], ['地面', 'ground'], ['水上', 'water'], ['水中', 'under']];
 
/* ---- ★ 武裝詳細設定（MAP兵器／射程／MP要求／屬性）----
 * 資料格式：weapons[i] = '-' 或 { level:'1'..'5', map:'', map:'Y'|'N',
 *          range:''|'1'..'6', mp:''|'需要超強勢'|'需要超一擊'|'沒有MP要求',
 *          attrs:['物理','鐳射','特殊'] 子集合 }
 * '' / [] 皆代表「未設定」。 */
const WEAPON_LEVELS = ['1', '2', '3', '4', '5'];
const WEAPON_MAP_OPTS = ['', 'Y', 'N'];
const WEAPON_RANGE_OPTS = ['', '1', '2', '3', '4', '5', '6'];
const WEAPON_MP_OPTS = ['', '需要超強勢', '需要超一擊', '沒有MP要求'];
const WEAPON_ATTRS = ['物理', '鐳射', '特殊'];
 
let currentTab = 'units';
const PAG = {
    units:       { page: 1, perPage: 20 },
    characters:  { page: 1, perPage: 20 },
    supports:    { page: 1, perPage: 20 }
};
const EDIT = { units: null, characters: null, supports: null };
let lastDeleted = null;           // { type, item }
let _toastTimer = null;
const _debTimers = {};
 
/* ---- 等級上限規則 ---- */
const BASE_MAX_LEVEL = { UR: 100, SSR: 90, SR: 80, R: 70, N: 60 };
const MAX_LEVEL_WITH_SP = 100;
// 支援單位無稀有度／SP化，使用固定上限（若與實際遊戲不同，改這個數字即可）
const SUPPORT_MAX_LEVEL = 100;
 
/* ---- ★ 標籤篩選：目前生效的勾選狀態與 AND/OR 模式（由 ui.js 的標籤視窗維護） ---- */
const TAG_FILTER_STATE = { units: new Set(), characters: new Set() };
const TAG_FILTER_MODE  = { units: 'AND',    characters: 'AND' };   // ★ 'AND' | 'OR'
/* ---- ★ 標籤排除：具備這些標籤的資料一律隱藏（優先於包含條件） ---- */
const TAG_FILTER_EXCLUDE = { units: new Set(), characters: new Set() };