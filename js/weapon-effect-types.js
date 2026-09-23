/* =====================================================================
 * weapon-effect-types.js — 武裝效果／使用限制：類型定義・名稱對照・顯示格式
 * ---------------------------------------------------------------------
 * 【名稱機制（本版簡化：名稱固定於本檔，表單不再提供改名）】
 *   ・效果／限制項目只存 { type, pct }，顯示名稱完全由本檔的
 *     WKIND_DEFAULT_EFFECT_NAMES／WKIND_DEFAULT_LIMIT_NAMES 決定
 *     → 同類效果在所有單位自動同名
 *      （例：debuff-def →「防禦力debuff」，30% 與 25% 都顯示「防禦力debuff(…)」）。
 *   ・要調整名稱：直接編輯下方兩個對照表即可，所有單位的卡片顯示
 *     一併生效（不需改其他檔案）。
 *   ・舊版的自訂名稱（項目自帶 name、__wkinds__ 系統記錄、localStorage
 *     覆蓋）全部停用：讀取時略過舊名稱，一律使用本檔名稱。
 *     舊資料中可能殘留的 __wkinds__ 系統記錄無作用亦無害
 *    （render-units.js／utils.js 已排除其顯示與統計）。
 * ===================================================================== */
 
/* 攻擊分類（可複選；空 = 未設定） */
const WEAPON_ATK_TYPES = ['射擊', '格鬥', '覺醒'];
 
/* 武裝效果類型（pct=true 需填數值；digits=位數上限；round1=顯示時加「(1回合)」） */
const WEAPON_EFFECT_TYPES = [
    { code: 'abs-hit',     label: '絕對命中', pct: false },
    { code: 'attr-null',   label: '武裝屬性損傷減輕無效', pct: false },
    { code: 'dist-power_high',  label: '距離敵方越遠，武裝POWER越為提升', pct: true, unit: '%', digits: 2 },
    { code: 'dist-power_low',  label: '距離敵方越近，武裝POWER越為提升', pct: true, unit: '%', digits: 2 },    
    { code: 'mp-power',    label: '對戰開始時，自身MP越高，武裝POWER越為提升', pct: true, unit: '%', digits: 2 },
    { code: 'def-cut-atk', label: '自身攻擊時，以敵方防禦力減少的狀態攻擊', pct: true, unit: '%', digits: 2 },
    { code: 'hp-power_high',    label: '自身剩餘HP越高，武裝POWER越為提升', pct: true, unit: '%', digits: 2 },
    { code: 'hp-power_low',    label: '自身剩餘HP越低，武裝POWER越為提升', pct: true, unit: '%', digits: 2  },
    { code: 'mp-power_high',    label: '對戰開始時，自身MP越高，武裝POWER越為提升', pct: true, unit: '%', digits: 2 },    
    { code: 'debuff-def',  label: '賦予敵方「防禦力減少」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'debuff-atk',  label: '賦予敵方「攻擊力減少」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'debuff-mob',  label: '賦予敵方「機動力減少」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'debuff-hit',  label: '賦予敵方「命中率減少」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'weak-phys',   label: '賦予敵方「遭物理武裝攻擊時，受到的損傷提升」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'weak-laser',  label: '賦予敵方「遭鐳射武裝攻擊時，受到的損傷提升」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'weak-spec',   label: '賦予敵方「遭特殊武裝攻擊時，受到的損傷提升」', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'critical-damage',   label: '自身爆擊損傷提升', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'debuff-phys',   label: '物理武裝POWER減少', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'debuff-laser',   label: '鐳射武裝POWER減少', pct: true, unit: '%', digits: 3, round1: true }, 
    { code: 'debuff-spec',   label: '特殊武裝POWER減少', pct: true, unit: '%', digits: 3, round1: true },
    { code: 'two-targets',   label: '最多可指定選擇2個地點', pct: false },
];
 
/* 使用限制類型 */
const WEAPON_LIMIT_TYPES = [
    { code: 'pre-move-only',   label: '僅限移動前使用', pct: false },
    { code: 'underwater-half', label: '對水下敵人的傷害減半', pct: false },
    { code: 'underwater-all', label: '對水下敵人沒有傷害', pct: false },    
    { code: 'no-underwater',   label: '不能在水下使用', pct: false },
    { code: 'mp-cost',         label: '消耗MP即可使用', pct: true, unit: 'MP', digits: 2 }
];
 
const WEAPON_EFFECT_TYPE_MAP = {};
WEAPON_EFFECT_TYPES.forEach(t => { WEAPON_EFFECT_TYPE_MAP[t.code] = t; });
const WEAPON_LIMIT_TYPE_MAP = {};
WEAPON_LIMIT_TYPES.forEach(t => { WEAPON_LIMIT_TYPE_MAP[t.code] = t; });
 
/* ---------- ★ 名稱對照表（要改名請編輯這裡） ---------- */
const WKIND_DEFAULT_EFFECT_NAMES = {
    'abs-hit':       '絕對命中',
    'attr-null':     '屬性減輕無效',
    'dist-power_high':    '距離POWER+(遠)',
    'dist-power_low':    '距離POWER+(近)',    
    'mp-power':      'MP POWER+',
    'def-cut-atk':   '破防攻擊',
    'hp-power_high': 'HP POWER+(高)',
    'hp-power_low':  'HP POWER+(低)',
    'mp-power_high':  'MP POWER+(高)',    
    'debuff-def':    '防禦力debuff',
    'debuff-atk':    '攻擊力debuff',
    'debuff-mob':    '機動力debuff',
    'debuff-hit':    '命中率debuff',
    'weak-phys':     '物理弱化',
    'weak-laser':    '鐳射弱化',
    'weak-spec':     '特殊弱化',
    'critical-damage':     '爆擊損傷提升',
    'debuff-phys':  '物理武裝debuff',
    'debuff-laser':  '鐳射武裝debuff',
    'debuff-spec':  '特殊武裝debuff',
    'two-targets':  '最多選擇2個地點'
};
const WKIND_DEFAULT_LIMIT_NAMES = {
    'pre-move-only':   '移動前限定',
    'underwater-half': '水下傷害減半',
    'underwater-all': '水下傷害歸零',    
    'no-underwater':   '水下不可',
    'mp-cost':         'MP消耗技'
};
 
function wkDefaultName(type, kind) {
    const map = kind === 'limits' ? WKIND_DEFAULT_LIMIT_NAMES : WKIND_DEFAULT_EFFECT_NAMES;
    return map[type] || '';
}
/* 顯示名稱唯一入口（目前＝預設對照表；保留函式形式以便日後擴充） */
function weaponKindName(type, kind) {
    return wkDefaultName(type, kind);
}
 
/* ---------- 顯示格式：名稱(數值)(1回合) ----------
 * 例：防禦力debuff(30%)(1回合)／MP消耗技(5MP)／絕對命中 */
function wdKindDisplay(e, kind) {
    if (!e || !e.type) return '';
    const tmap = kind === 'limits' ? WEAPON_LIMIT_TYPE_MAP : WEAPON_EFFECT_TYPE_MAP;
    const t = tmap[e.type];
    if (!t) return '';
    let s = weaponKindName(e.type, kind);
    if (t.pct && e.pct != null && e.pct !== '') s += '(' + e.pct + (t.unit || '%') + ')';
    if (t.round1) s += '(1回合)';
    return s;
}
function formatWeaponEffect(e) { return wdKindDisplay(e, 'effects'); }
function formatWeaponLimit(e)  { return wdKindDisplay(e, 'limits');  }
 
/* ---------- 資料清理（同步下載／匯入時用） ----------
 * 輸出 { type, pct }；舊格式項目自帶的 name 一律略過（名稱由本檔統一） */
function wdCleanStr(v, max) {
    return String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}
function normalizeWeaponKindList(arr, typeMap, kind) {
    /* kind 參數保留以相容 weapon-filters.js 的呼叫方式（本版未使用） */
    if (!Array.isArray(arr)) return [];
    const out = [];
    arr.forEach(e => {
        if (!e || typeof e !== 'object') return;
        const t = typeMap[String(e.type || '')];
        if (!t) return;                          // 無有效類型 → 捨棄
        let pct = null;
        if (t.pct) {
            const n = parseInt(e.pct, 10);
            if (!isNaN(n) && n >= 1 && n <= Math.pow(10, t.digits) - 1) pct = n;
        }
        out.push({ type: t.code, pct });
    });
    return out.slice(0, 10);   // 每把武裝最多 10 項，避免異常資料
}
 
/* 清除舊版遺留的 localStorage 名稱覆蓋（名稱已改由本檔統一管理） */
try { localStorage.removeItem('sdg-wkind-names'); } catch (_) {}