/* =====================================================================
 * database.js — 快取與 CRUD
 * ===================================================================== */
const cache = { units: null, characters: null, supports: null };
const inv = t => cache[t] = null;
 
async function getAll(t) {
    if (!cache[t]) cache[t] = (await db.getAll(t)) || [];
    return cache[t];
}
async function saveItem(t, item) {
    item.date_modified = new Date().toISOString();
    await db.put(t, item);
    inv(t);
    scheduleAutoSync('save-' + t);        // ★ 編輯後自動上傳（防抖）
}
async function deleteItem(t, id) {
    await db.del(t, id); inv(t);
    scheduleAutoSync('delete-' + t);      // ★ 編輯後自動上傳（防抖）
}
 
function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}