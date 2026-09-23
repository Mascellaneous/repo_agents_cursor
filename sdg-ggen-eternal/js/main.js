/* =====================================================================
 * main.js — 進入點（HTML 中最後載入）
 * ---------------------------------------------------------------------
 * 本次改動：
 *   1. initApp() 開頭注入三分頁 HTML（injectTabUnits／Characters／Supports，
 *      模板定義於 js/tab-*.js；dataset.injected 防重複）。
 *   2. 注入後補呼叫 initWeaponFilters()：weapon-filters.js 的
 *      DOMContentLoaded 監聽比 initApp 先執行（當時分頁尚未注入，
 *      面板建構失敗），補呼叫後武裝七項篩選面板才會建成
 *      （內部 _wf 旗標防重複包裝）。
 *   3. initAutoSyncCheckbox()：還原 Auto-sync 核取方塊偏好（localStorage）。
 *   4. autoDownloadFromGitHub()：頁面載入完成後自動自 GitHub 下載並
 *      【完全取代】本地資料庫。
 *      ・本地有未上傳變更（dirty）→ 自動改為上傳／略過下載
 *      ・遠端較舊且本地有資料 → 自動略過
 *      （判斷邏輯見 GitHub-sync.js）
 * ===================================================================== */
 
document.addEventListener('DOMContentLoaded', initApp);
 
let _appInited = false;
 
/* 篩選面板的地形下拉（fu-tr_*）— 其他模組已填過則略過 */
function populateFilterTerrainSelects() {
    TERRAINS.forEach(([lab, k]) => {
        const sel = gi('fu-tr_' + k);
        if (!sel || sel.options.length) return;
        sel.innerHTML =
            `<option value="">全部</option>` +
            `<option value="O">O（良好）</option>` +
            `<option value="△">△（可）</option>` +
            `<option value="-">-（不可）</option>` +
            `<option value="yes">O 或 △</option>`;
    });
}
 
async function initApp() {
    if (_appInited) return;
    _appInited = true;
    try {

        injectTabUnits();
        injectTabCharacters();
        injectTabSupports();
        /* 武裝篩選面板依賴 #tab-units 內的 fu-wstate；weapon-filters.js 的
           DOMContentLoaded 監聽比 initApp 先執行（當時面板尚未注入），
           故注入後補呼叫（內部旗標防重複） */
        if (typeof initWeaponFilters === 'function') initWeaponFilters();
                
        /* 0. IndexedDB 就緒（storage.js 若提供 initDB() 則等待；否則略過） */
        if (typeof initDB === 'function') await initDB();
 
        /* 1. 表單：靜態下拉、武裝詳細、可搜尋下拉（變型／逃生）、submit 綁定 */
        initForms();
  
        /* 2. 篩選面板地形下拉 */
        populateFilterTerrainSelects();
 
        /* 3. 深色模式（utils.js / ui.js 若提供還原函式） */
        if (typeof initDarkMode === 'function') initDarkMode();
 
        /* 4. 自動完成建議池（autocomplete.js 若提供） */
        if (typeof initAutocomplete === 'function') initAutocomplete();
 
        /* 5. UI 事件（分頁／標籤視窗／卡片按鈕委派 — ui.js 若提供） */
        if (typeof initUI === 'function') initUI();
        if (typeof loadAbilityLib === 'function') await loadAbilityLib();
        if (typeof loadSkillLib === 'function') await loadSkillLib();
 
        /* 6. 首次渲染 */
        await getAll('units');
        await getAll('characters');
        await refreshSeriesOptions();
        RENDER.units();
        RENDER.characters();
        RENDER.supports();
        updateStorageStatus();
 
        /* 7. 載入完成 → 自動自 GitHub 下載（完全取代本地資料庫） */
        autoDownloadFromGitHub();
    } catch (err) {
        console.error('初始化失敗：', err);
        showToast('初始化失敗：' + err.message, true);
    }
}