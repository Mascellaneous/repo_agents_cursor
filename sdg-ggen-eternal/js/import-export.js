/* =====================================================================
 * import-export.js — 匯出／匯入 JSON、整庫 .db 備份／還原、清空資料庫
 * ---------------------------------------------------------------------
 * ★ 本次改動：
 *   1. 匯入／還原／清空等「編輯性操作」完成後呼叫 scheduleAutoSync()
 *      → Auto-sync 開啟時約 1.5 秒後自動上傳至 GitHub。
 *   2. 匯入／還原沿用 GitHub-sync.js 的 sanitizeRecords()：
 *      捨棄無 id 記錄、依 id 去除重複 → 絕不產生重複記錄；
 *      寫入前先清空各 store → 完全取代本地資料庫。
 *   3. 不更動 lastExportTime / localDirty（交給 scheduleAutoSync →
 *      上傳成功後一併處理），避免干擾自動下載的新舊判斷。
 * ===================================================================== */
 
/* ---------- 收集全部資料（GitHub-sync.js 的 buildPayload 也使用） ---------- */
async function gatherAll() {
    return {
        units:          await getAll('units'),
        characters:     await getAll('characters'),
        supports:       await getAll('supports'),
        optionalParts:  await getAll('optionalParts')
    };
}
 
/* ---------- 檔案下載共用 ---------- */
function downloadBlobFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fileStamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
 
/* ---------- 匯出 JSON ---------- */
async function exportData() {
    const data = await gatherAll();
    const payload = {
        exportInfo: {
            exportDate: new Date().toISOString(),
            source: APP_NAME + ' — JSON 匯出',
            counts: {
                units: data.units.length, characters: data.characters.length,
                supports: data.supports.length, optionalParts: data.optionalParts.length
            }
        },
        ...data
    };
    downloadBlobFile(JSON.stringify(payload, null, 2), `sdg-ggen-export_${fileStamp()}.json`);
    showToast(`已匯出：單位 ${data.units.length}、角色 ${data.characters.length}、支援單位 ${data.supports.length}、選擇性零件 ${data.optionalParts.length}`);
}
 
/* ---------- 整庫下載 (.db) ---------- */
async function saveDbFile() {
    const data = await gatherAll();
    const payload = {
        exportInfo: {
            exportDate: new Date().toISOString(),
            source: APP_NAME + ' — 整庫備份 (.db)',
            kind: 'fulldb',
            counts: {
                units: data.units.length, characters: data.characters.length,
                supports: data.supports.length, optionalParts: data.optionalParts.length
            }
        },
        ...data
    };
    downloadBlobFile(JSON.stringify(payload, null, 2), `sdg-ggen-db_${fileStamp()}.db`);
    showToast('整庫備份已下載（.db）');
}
 
/* ---------- 檔案選擇與讀取共用 ---------- */
function pickAndReadFile(accept, cb) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => cb(r.result, f.name);
        r.onerror = () => showToast('檔案讀取失敗', true);
        r.readAsText(f);
    });
    inp.click();
}
 
/* ---------- 套用外部資料（完全取代本地；含檢查與去重） ---------- */
async function applyExternalData(obj, label, reason) {
    if (!obj || typeof obj !== 'object') { showToast('檔案格式不正確', true); return false; }
 
    /* ★ 檢查：捨棄無 id／格式錯誤記錄、依 id 去除重複（sanitizeRecords 來自 GitHub-sync.js） */
    const U = sanitizeRecords(obj.units, 'units');
    const C = sanitizeRecords(obj.characters, 'characters');
    const S = sanitizeRecords(obj.supports, 'supports');
    const hasOP = Object.prototype.hasOwnProperty.call(obj, 'optionalParts');
    const OP = (hasOP && typeof sanitizeOptionalParts === 'function') ? sanitizeOptionalParts(obj.optionalParts) : null;
    if (!U.length && !C.length && !S.length && !(OP && OP.length)) {
        showToast('檔案中沒有任何有效記錄（無 id 或重複的記錄已被略過）', true);
        return false;
    }

    const opLine = OP
        ? `、選擇性零件 ${OP.length}`
        : '（此檔沒有選擇性零件欄，本地零件會保留）';
    const ok = confirm(
        `${label} 內容檢查完成：\n單位 ${U.length}、角色 ${C.length}、支援單位 ${S.length}${opLine}\n\n` +
        `⚠ 將【完全取代】本地資料庫：\n` +
        `・相同 ID → 以檔案版本覆蓋\n` +
        `・檔案中已刪除的記錄 → 本地一併移除\n\n繼續？`);
    if (!ok) return false;
 
    /* ★ 完全取代：先清空三個 store，再寫入檢查過的資料 */
    await Promise.all(TYPES.map(t => db.clearStore(t)));
    if (U.length) await db.bulkPut('units', U);
    if (C.length) await db.bulkPut('characters', C);
    if (S.length) await db.bulkPut('supports', S);
    if (OP) {
        await db.clearStore('optionalParts');
        if (OP.length) await db.bulkPut('optionalParts', OP);
        cache.optionalParts = null;
        await getAll('optionalParts');
        if (typeof renderOptionalPartsIfOpen === 'function') renderOptionalPartsIfOpen();
    }

    await Promise.all(TYPES.map(t => getAll(t)));   // 重填快取
    await refreshSeriesOptions();
    TYPES.forEach(t => RENDER[t]());
    updateStorageStatus();
    showToast(`已套用${label}：單位 ${U.length}、角色 ${C.length}、支援單位 ${S.length}` +
        (OP ? `、選擇性零件 ${OP.length}` : ''));
 
    /* ★ 編輯性操作 → 自動上傳（Auto-sync 關閉時僅標記 dirty，下次載入會提示） */
    scheduleAutoSync(reason);
    return true;
}
 
/* ---------- 匯入 JSON ---------- */
function importData() {
    pickAndReadFile('.json,application/json', async (text, name) => {
        try {
            const obj = JSON.parse(text);
            await applyExternalData(obj, `「${name}」`, 'import-json');
        } catch (e) {
            console.error(e);
            showToast('JSON 解析失敗：' + e.message, true);
        }
    });
}
 
/* ---------- 還原整庫 (.db) ---------- */
function loadDbFile() {
    pickAndReadFile('.db,.json', async (text, name) => {
        try {
            const obj = JSON.parse(text);
            await applyExternalData(obj, `整庫備份「${name}」`, 'restore-db');
        } catch (e) {
            console.error(e);
            showToast('備份檔解析失敗：' + e.message, true);
        }
    });
}
 
/* ---------- 清空資料庫 ---------- */
async function clearAllData() {
    if (!confirm('確定要清空資料庫嗎？\n單位／角色／支援單位／選擇性零件的所有資料都會被刪除！')) return;
    if (!confirm('再次確認：真的要刪除全部資料？此操作無法復原（除非有備份）。\n' +
                 '注意：Auto-sync 開啟時，清空後約 1.5 秒會自動上傳「空資料庫」至 GitHub。')) return;
 
    await Promise.all(TYPES.map(t => db.clearStore(t)));
    await db.clearStore('optionalParts');
    cache.optionalParts = null;
    await Promise.all(TYPES.map(t => getAll(t)));   // 清空後重填（空陣列）
    await getAll('optionalParts');
    if (typeof renderOptionalPartsIfOpen === 'function') renderOptionalPartsIfOpen();
    await refreshSeriesOptions();                   // 清空後系列/標籤/能力需求下拉應同步變空
    TYPES.forEach(t => RENDER[t]());
    updateStorageStatus();
    showToast('資料庫已清空');
 
    scheduleAutoSync('clear-all');   // ★ 編輯性操作 → 自動上傳（含空庫覆蓋遠端）
}