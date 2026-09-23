/* =====================================================================
 * utils.js — 共用小工具＋Toast 提示＋頁首儲存狀態
 * ---------------------------------------------------------------------
 * ★ 本次改動：updateStorageStatus() 排除系統記錄 __wkinds__
 *   （武裝效果名稱對照，存於 units 存放區），不計入單位數。
 * ===================================================================== */
function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function sanitizeText(t) {
    if (!t || typeof t !== 'string') return '';
    return t.replace(/[<>]/g, '').replace(/['"]/g, '')
            .replace(/javascript:/gi, '').replace(/on\w+\s*=/gi, '').trim();
}
/* spaceOk=true 時額外以空白（含全形空白）切分 —— 供「標籤」欄位使用；
 * 系列欄位維持只以逗號切分，避免英文系列名內含空格被拆開。 */
function splitTokens(str, spaceOk) {
    if (!str) return [];
    const seen = new Set(), out = [];
    str.split(spaceOk ? /[,，、\s]+/ : /[,，、]+/)
       .map(s => sanitizeText(s)).filter(Boolean).forEach(s => {
        if (!seen.has(s)) { seen.add(s); out.push(s); }
    });
    return out;
}
function fv(id)  { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function gi(id)  { return document.getElementById(id); }
function paginateArr(a, p, n) {
    if (n === -1) return a;
    const st = Math.max(0, (p - 1) * n);
    return a.slice(st, st + n);
}
function totalPagesOf(len, n) { return n === -1 ? 1 : Math.max(1, Math.ceil(len / n)); }
function encodeBase64(s){ return btoa(unescape(encodeURIComponent(s))); }
function decodeBase64(s){ return decodeURIComponent(escape(atob(s))); }
function scrollToTop(){ window.scrollTo({ top: 0, behavior: 'smooth' }); }
 
/* ---------- Toast 訊息 ----------
 * showToast(msg)              一般訊息（約 2.6 秒自動消失）
 * showToast(msg, true)        錯誤訊息（紅底）
 * showToast(msg, false, { label:'↩ 復原', fn })  附動作按鈕（約 6 秒） */
function showToast(msg, isErr, action) {
    const t = gi('toast');
    if (!t) { console.log('[toast]', msg); return; }
    t.textContent = '';
    const span = document.createElement('span');
    span.textContent = msg || '';
    t.appendChild(span);
    if (action && action.label && typeof action.fn === 'function') {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = action.label;
        b.style.cssText = 'margin-left:10px;background:#fff;color:#2c3e50;border:none;' +
                          'border-radius:4px;padding:3px 10px;font-weight:bold;cursor:pointer;';
        b.addEventListener('click', () => { hideToast(); action.fn(); });
        t.appendChild(b);
    }
    t.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;' +
        'align-items:center;z-index:3000;max-width:90vw;padding:10px 18px;border-radius:6px;' +
        'font-size:13px;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35);' +
        'background:' + (isErr ? '#c0392b' : '#2c3e50') + ';';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(hideToast, action ? 6000 : 2600);
}
function hideToast() {
    const t = gi('toast');
    if (t) { t.style.display = 'none'; t.textContent = ''; }
}
 
/* ---------- 頁首儲存狀態（資料筆數＋用量估計） ---------- */
async function updateStorageStatus() {
    const el = gi('storage-status');
    if (!el) return;
    try {
        const lists = await Promise.all(TYPES.map(t => getAll(t)));
        /* ★ 排除武裝效果名稱對照的系統記錄（id='__wkinds__'），不計入單位數 */
        const unitsCount = lists[0].filter(u => u && u.id !== '__wkinds__').length;
        const opN = (await getAll('optionalParts')).length;
        const stN = (await getAll('stages')).length;
        let txt = `目前資料：單位 ${unitsCount}・角色 ${lists[1].length}・支援單位 ${lists[2].length}・選擇性零件 ${opN}・關卡 ${stN}`;
        if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (est && typeof est.usage === 'number') {
                txt += `　·　已用約 ${(est.usage / 1048576).toFixed(2)} MB`;
                if (est.quota) txt += `（配額約 ${(est.quota / 1073741824).toFixed(1)} GB）`;
            }
        }
        el.textContent = txt;
    } catch (_) { /* 統計失敗不影響主流程 */ }
}