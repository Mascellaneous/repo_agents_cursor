/* =============================================================================
 * app.js — 應用程式啟動流程
 * 順序：Settings → Theme → Modal/Math/Markdown → GitHubSync 設定 → Chats
 *       → 靜態 UI → Models（非同步）→ UI → Shortcuts → GitHubSync 啟動
 * ============================================================================= */

(function boot() {

  /** 舊版預設模型 → 換成新預設（只跑一次，使用者自己選過的不會被動到） */
  function migrateModel() {
    if ((Settings.get('_modelMigrated') || 0) >= 1) return;
    const m = Settings.get('model');
    if (!m || LEGACY_DEFAULT_MODELS.includes(m)) {
      Settings.set('model', DEFAULT_SETTINGS.model, true);
    }
    if (Settings.get('titleModel') == null) Settings.set('titleModel', DEFAULT_SETTINGS.titleModel, true);
    if (!Settings.get('provider')) Settings.set('provider', 'openrouter', true);
    if (!Array.isArray(Settings.get('poeModels')) || !Settings.get('poeModels').length) {
      Settings.set('poeModels', [...POE_DEFAULT_MODELS], true);
    }
    Settings.set('_modelMigrated', 1, true);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      /* 0. 儲存層（IndexedDB）—— 必須最先完成：其餘模組全部是同步讀取 */
      const store = await Store.init();

      /* 1. 設定 */
      Settings.load();
      migrateModel();

      /* 2. 外觀 */
      Theme.init();

      /* 3. 基礎 UI 服務 */
      Modal.init();
      MathX.init();
      MD.bindCodeActions();

      /* 4. 資料層（先讀 GitHub 設定，Chats.softMode() 才會正確） */
      GitHubSync.loadCfg();
      Chats.load();

      /* 5. 靜態 UI 綁定 */
      Settings.bindDom();
      Files.init();
      Models.init();
      Prompts.init();
      Voice.init();

      /* 6. 模型清單（Poe 為本地清單，會立即完成） */
      await Models.load();

      /* 7. 主視圖與快捷鍵 */
      UI.init();
      Shortcuts.init();

      /* 8. GitHub 同步（未啟用時完全不動作） */
      GitHubSync.init();
      Publisher.init();
      
      /* 9. 首次使用引導 */
      if (!API.hasKey()) {
        Toast.info('第一次使用？請先到「設定 → API」選擇供應商並填入 API Key。', 8000);
        setTimeout(() => UI.openSettings('api'), 700);
      }

      if (store.migrated) {
        Toast.ok(`已把 ${store.migrated} 筆資料搬進 IndexedDB，儲存空間不再受 5 MB 限制`, 6000);
      }
      if (store.driver === 'fallback') {
        Toast.warn('此瀏覽器無法使用 IndexedDB（可能是隱私模式），暫時改用 localStorage，仍有約 5 MB 限制。', 8000);
      }

      console.info(`%c${APP.name} v${APP.version} 已啟動（${PROVIDERS[Settings.get('provider')].label}）`,
        'color:#10a37f;font-weight:bold');

    } catch (e) {
      console.error('[App] 啟動失敗', e);
      document.body.innerHTML =
        `<div style="padding:40px;font-family:sans-serif">
           <h2>😵 應用程式啟動失敗</h2>
           <p>${(e && e.message) || e}</p>
           <p>可嘗試清除瀏覽器本機資料後重新載入。</p>
           <button onclick="localStorage.clear();location.reload()">清除資料並重載</button>
         </div>`;
    }
  });

  /* 離開／切到背景時把待寫資料立刻排入 IndexedDB */
  const flushStore = () => { try { window.Store?.flushNow?.(); } catch {} };
  window.addEventListener('pagehide', flushStore);
  window.addEventListener('beforeunload', flushStore);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStore();
  });

  window.addEventListener('error', e => {
    /* 「Script error.」＝跨域腳本（KaTeX CDN、瀏覽器擴充功能注入的程式碼）
       拋錯時被同源政策遮蔽的訊息：沒有檔名、沒有堆疊、無法處理，
       記錄它只是噪音。判準：filename 為空且訊息恰為「Script error.」→ 略過；
       自家程式碼的錯誤必帶 filename／error 物件，照常完整記錄。 */
    const msg = String(e.message || '');
    if (!e.filename && /^script error\.?$/i.test(msg)) return;
    console.error('[GlobalError]', e.error || msg);
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[UnhandledRejection]', e.reason);
    if (window.Toast && e.reason?.message && !e.reason.aborted) {
      Toast.error('發生錯誤：' + e.reason.message);
    }
  });
})();