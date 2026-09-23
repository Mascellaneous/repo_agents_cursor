/* =============================================================================
 * db.js — IndexedDB 儲存引擎（window.IDB）
 * -----------------------------------------------------------------------------
 * 兩個 object store：
 *   kv    { k, v }   ← 設定、資料夾、提示詞、模型快取、同步狀態、目前對話…
 *   chats { id, … }  ← 一個對話一筆記錄，可獨立讀寫（不必整包重寫）
 *
 * 若瀏覽器不支援 IndexedDB（或被隱私模式擋住），自動退回 localStorage 後備驅動；
 * 後備格式與 v2.3 完全相同，功能不受影響（只是又回到 ~5 MB 限制）。
 *
 * 本模組只負責「存取」，不認識任何業務語意 —— 那是 storage.js 的工作。
 * ============================================================================= */

window.IDB = (() => {

  const CFG = window.DB_CONFIG || { name: 'orpc-db', version: 1 };
  const KV = 'kv';
  const CHATS = 'chats';

  let db = null;
  let driver = 'idb';          // 'idb' | 'fallback'
  let opening = null;

  /* localStorage 中以「原始字串」保存的鍵（機密與裝置碼）→ 後備驅動要跳過 */
  const rawKeys = () => new Set([
    STORAGE_KEYS.apiKey, STORAGE_KEYS.poeKey, STORAGE_KEYS.ghToken, STORAGE_KEYS.device,
  ]);

  /* ------------------------------ 開啟 -------------------------------- */

  function open() {
    if (db) return Promise.resolve(db);
    if (driver === 'fallback') return Promise.resolve(null);
    if (opening) return opening;

    opening = new Promise(resolve => {
      const fail = why => {
        if (driver !== 'fallback') {
          driver = 'fallback';
          console.warn('[IDB] 無法使用 IndexedDB，改用 localStorage 後備：', why);
        }
        resolve(null);
      };

      let req;
      try {
        if (!window.indexedDB) return fail('瀏覽器不支援');
        req = indexedDB.open(CFG.name, CFG.version);
      } catch (e) { return fail(e); }

      const guard = setTimeout(() => fail('開啟逾時'), 8000);

      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(KV))    d.createObjectStore(KV,    { keyPath: 'k' });
        if (!d.objectStoreNames.contains(CHATS)) d.createObjectStore(CHATS, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        clearTimeout(guard);
        if (driver === 'fallback') { try { req.result.close(); } catch {} return; }
        db = req.result;
        db.onversionchange = () => { try { db.close(); } catch {} db = null; };
        db.onclose = () => { db = null; };
        resolve(db);
      };
      req.onerror   = () => { clearTimeout(guard); fail(req.error); };
      req.onblocked = () => { clearTimeout(guard); fail('被其他分頁鎖住'); };
    });

    return opening;
  }

  const ready = async () => { await open(); return driver === 'idb' && !!db; };

  /* --------------------------- Promise 化 ------------------------------ */

  const reqP = r => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const txDone = t => new Promise((res, rej) => {
    t.oncomplete = () => res(true);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('transaction aborted'));
  });

  /** structuredClone 失敗（極少見）時退回 JSON 淨化 */
  function safePut(store, value) {
    try { store.put(value); }
    catch (e) {
      if (e && e.name === 'DataCloneError') store.put(JSON.parse(JSON.stringify(value)));
      else throw e;
    }
  }

  /* ------------------------------ KV ---------------------------------- */

  async function kvGetAll() {
    if (!(await ready())) return LS.kvGetAll();
    const t = db.transaction(KV, 'readonly');
    return (await reqP(t.objectStore(KV).getAll())) || [];
  }

  async function kvGet(k) {
    if (!(await ready())) return LS.kvGet(k);
    const t = db.transaction(KV, 'readonly');
    const row = await reqP(t.objectStore(KV).get(k));
    return row ? row.v : null;
  }

  /** @param {Array<[string,*]>} entries @param {string[]} deletes */
  async function kvWrite(entries = [], deletes = []) {
    if (!(await ready())) return LS.kvWrite(entries, deletes);
    const t = db.transaction(KV, 'readwrite');
    const s = t.objectStore(KV);
    entries.forEach(([k, v]) => safePut(s, { k, v }));
    deletes.forEach(k => s.delete(k));
    return txDone(t);
  }

  const kvDelete = k => kvWrite([], [k]);

  /* ----------------------------- CHATS -------------------------------- */

  async function chatsGetAll() {
    if (!(await ready())) return LS.chatsGetAll();
    const t = db.transaction(CHATS, 'readonly');
    return (await reqP(t.objectStore(CHATS).getAll())) || [];
  }

  async function chatsGet(id) {
    if (!(await ready())) return LS.chatsGetAll().then(l => l.find(c => c.id === id) || null);
    const t = db.transaction(CHATS, 'readonly');
    return (await reqP(t.objectStore(CHATS).get(id))) || null;
  }

  /** @param {object[]} puts @param {string[]} deletes */
  async function chatsWrite(puts = [], deletes = []) {
    if (!puts.length && !deletes.length) return true;
    if (!(await ready())) return LS.chatsWrite(puts, deletes);
    const t = db.transaction(CHATS, 'readwrite');
    const s = t.objectStore(CHATS);
    puts.forEach(c => safePut(s, c));
    deletes.forEach(id => s.delete(id));
    return txDone(t);
  }

  /* ------------------------------ 維運 -------------------------------- */

  async function clearAll() {
    if (!(await ready())) return LS.clearAll();
    const t = db.transaction([KV, CHATS], 'readwrite');
    t.objectStore(KV).clear();
    t.objectStore(CHATS).clear();
    return txDone(t);
  }

  /** 刪掉整個資料庫（僅供除錯／完全重置） */
  function destroy() {
    try { if (db) { db.close(); db = null; } } catch {}
    return new Promise(res => {
      const r = indexedDB.deleteDatabase(CFG.name);
      r.onsuccess = r.onerror = r.onblocked = () => res(true);
    });
  }

  /** 瀏覽器層級的用量／配額（可能為 null） */
  async function estimate() {
    try {
      if (navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage ?? null, quota: e.quota ?? null };
      }
    } catch {}
    return null;
  }

  /** 要求「持久性儲存」：避免瀏覽器在空間吃緊時自動清除我們的資料 */
  async function requestPersistence() {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted?.()) return true;
      return await navigator.storage.persist();
    } catch { return false; }
  }

  /* ===================== localStorage 後備驅動 ======================== */

  const LS = {
    async kvGetAll() {
      const skip = rawKeys();
      const out = [];
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith('orpc:') || k === STORAGE_KEYS.chats || skip.has(k)) continue;
        try { out.push({ k, v: JSON.parse(localStorage.getItem(k)) }); } catch {}
      }
      return out;
    },
    async kvGet(k) {
      try { const r = localStorage.getItem(k); return r == null ? null : JSON.parse(r); }
      catch { return null; }
    },
    async kvWrite(entries, deletes) {
      entries.forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
      (deletes || []).forEach(k => localStorage.removeItem(k));
      return true;
    },
    async chatsGetAll() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.chats) || '[]') || []; }
      catch { return []; }
    },
    async chatsWrite(puts, deletes) {
      const list = await LS.chatsGetAll();
      const map = new Map(list.map(c => [c.id, c]));
      (puts || []).forEach(c => map.set(c.id, c));
      (deletes || []).forEach(id => map.delete(id));
      localStorage.setItem(STORAGE_KEYS.chats, JSON.stringify([...map.values()]));
      return true;
    },
    async clearAll() {
      Object.keys(localStorage).filter(k => k.startsWith('orpc:')).forEach(k => localStorage.removeItem(k));
      return true;
    },
  };

  return {
    open, kvGetAll, kvGet, kvWrite, kvDelete,
    chatsGetAll, chatsGet, chatsWrite,
    clearAll, destroy, estimate, requestPersistence,
    driver: () => driver,
    isFallback: () => driver === 'fallback',
  };
})();