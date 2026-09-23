/* =============================================================================
 * storage.js — 儲存層門面（window.Store）
 * -----------------------------------------------------------------------------
 * v2.4：資料改存 IndexedDB（見 db.js），容量不再受 localStorage ~5MB 限制。
 *
 * 設計重點：
 *   • 對外 API 仍為「同步」——真相放在記憶體 cache，開機時 await Store.init() 一次灌入。
 *   • 寫入為非同步：debounce 200ms、序列化執行；對話逐筆 diff（只寫真的變動的那幾筆）。
 *   • 機密（API Key / Poe Key / GitHub Token）仍存 localStorage / sessionStorage / 記憶體，
 *     以保留「僅本次工作階段」語意，且永不進 IndexedDB、永不進備份。
 *   • 首次啟動自動從 localStorage 遷移，成功後釋放舊空間。
 *
 * 多分頁一致性（v2.4.1 / v2.4.3）：
 *   • BroadcastChannel('orpc-sync')：任一分頁成功寫入後廣播變動的 key，
 *     其他分頁重讀 IndexedDB 更新 cache，再交由 UI 的指紋機制決定是否重繪。
 *   • v2.4.3：收到廣播後先 flush 本分頁待寫資料再拉遠端（避免排程中的舊快照
 *     在稍後 flush 時把遠端剛寫入的內容蓋掉），並呼叫 Chats / Prompts /
 *     Settings 的 absorbRemote() 把 IDB 最新內容併回各模組記憶體——
 *     否則業務模組的記憶體陣列永遠過期，下次寫入會吃掉其他分頁的變更。
 *   • localStorage 後備驅動走原生 storage 事件，語意相同。
 * ============================================================================= */
 
window.Store = (() => {
 
  const memory = {};                          // keyStorage === 'memory' 時的機密
  const cache = new Map();                    // ★ 同步讀取的唯一真相
  const dirty = new Set();                    // 待寫入的 key
  const chatSigs = new Map();                 // chatId → 上次寫入時的簽章
 
  let inited = false;
  let flushTimer = null;
  let chain = Promise.resolve();              // 序列化所有寫入
  let usageCache = { total: 0, detail: {}, quota: null, at: 0, pending: false };
 
  const FLAG_MIGRATED = '__migrated_v1';
 
  const clone = v => {
    if (v === null || typeof v !== 'object') return v;
    try { return structuredClone(v); }
    catch { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } }
  };
 
  const lsGet = k => {
    try { const r = localStorage.getItem(k); return r == null ? null : JSON.parse(r); }
    catch { return null; }
  };
 
  /* ======================== 多分頁廣播 ================================ */
 
  let bc = null;
  try { bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('orpc-sync') : null; }
  catch { bc = null; }
 
  const broadcast = keys => { try { bc?.postMessage({ type: 'orpc:changed', keys }); } catch {} };
 
  /** 把指定 key 從持久層重新灌回 cache（收到其他分頁的通知時呼叫） */
  async function refreshKeys(keys) {
    for (const k of keys) {
      if (!k || k === FLAG_MIGRATED) continue;
      if (k === STORAGE_KEYS.chats) {
        const chats = (await IDB.chatsGetAll()).filter(c => c && c.id);
        cache.set(STORAGE_KEYS.chats, chats);
        chatSigs.clear();
        chats.forEach(c => chatSigs.set(c.id, chatSig(c)));
      } else {
        const v = await IDB.kvGet(k);
        if (v == null) cache.delete(k); else cache.set(k, v);
      }
    }
    usageCache.at = 0;
  }
 
  /**
   * 把 IDB 的最新內容併回各業務模組的記憶體（多分頁一致性的第二半）。
   * 只在廣播真的包含該 key 時才呼叫，避免每次都做整包讀取。
   */
  function absorbFromStore(keys) {
    if (keys.includes(STORAGE_KEYS.chats) || keys.includes(STORAGE_KEYS.folders)) {
      try { window.Chats?.absorbRemote?.(); }
      catch (e) { console.warn('[Store] Chats.absorbRemote 失敗', e); }
    }
    if (keys.includes(STORAGE_KEYS.prompts)) {
      try { window.Prompts?.absorbRemote?.(); }
      catch (e) { console.warn('[Store] Prompts.absorbRemote 失敗', e); }
    }
    if (keys.includes(STORAGE_KEYS.settings)) {
      try { window.Settings?.absorbRemote?.(); }
      catch (e) { console.warn('[Store] Settings.absorbRemote 失敗', e); }
    }
  }
 
  function listenRemoteChanges() {
    if (bc) {
      bc.onmessage = async e => {
        if (!inited || e.data?.type !== 'orpc:changed' || !Array.isArray(e.data.keys)) return;
        const keys = e.data.keys;
        /* 先落盤本分頁待寫資料，再拉遠端——否則排程中的舊快照
           會在之後的 flush 把遠端剛寫入的內容蓋掉 */
        try { await flush(); } catch {}
        await refreshKeys(keys);
        absorbFromStore(keys);
        window.UI?.renderAll?.();               // 指紋沒變 → 不會真的重繪
      };
    }
    /* localStorage 後備驅動：原生 storage 事件（本分頁自己寫不會觸發） */
    window.addEventListener('storage', async e => {
      if (!inited || !e.key || !e.key.startsWith('orpc:')) return;
      try { await flush(); } catch {}
      await refreshKeys([e.key]);
      absorbFromStore([e.key]);
      window.UI?.renderAll?.();
    });
  }
 
  /* ============================ 初始化 ================================ */
 
  /** 必須在任何模組讀取設定之前 await（見 app.js） */
  async function init() {
    if (inited) return { migrated: 0, driver: IDB.driver() };
 
    await IDB.open();
    const migrated = await migrate();
 
    (await IDB.kvGetAll()).forEach(row => {
      if (row && row.k && !String(row.k).startsWith('__')) cache.set(row.k, row.v);
    });
 
    const chats = (await IDB.chatsGetAll()).filter(c => c && c.id);
    cache.set(STORAGE_KEYS.chats, chats);
    chats.forEach(c => chatSigs.set(c.id, chatSig(c)));
 
    inited = true;
    listenRemoteChanges();
    IDB.requestPersistence();
    refreshUsage();
 
    console.info(`[Store] 儲存引擎：${IDB.driver()}｜對話 ${chats.length} 筆`);
    return { migrated, driver: IDB.driver() };
  }
 
  /** 一次性：把舊的 localStorage 資料搬進 IndexedDB */
  async function migrate() {
    if (IDB.isFallback()) return 0;                       // 後備模式本來就是同一份資料
    if (await IDB.kvGet(FLAG_MIGRATED)) return 0;
 
    const kvKeys = [
      STORAGE_KEYS.settings, STORAGE_KEYS.folders, STORAGE_KEYS.prompts,
      STORAGE_KEYS.modelCache, STORAGE_KEYS.current, STORAGE_KEYS.github, STORAGE_KEYS.syncMeta,
    ];
 
    const puts = [];
    kvKeys.forEach(k => { const v = lsGet(k); if (v != null) puts.push([k, v]); });
 
    const legacyChats = lsGet(STORAGE_KEYS.chats);
    const chats = Array.isArray(legacyChats) ? legacyChats.filter(c => c && c.id) : [];
 
    if (puts.length) await IDB.kvWrite(puts);
    if (chats.length) await IDB.chatsWrite(chats, []);
    await IDB.kvWrite([[FLAG_MIGRATED, { at: new Date().toISOString(), chats: chats.length }]]);
 
    /* 釋放舊空間（金鑰 orpc:apiKey / orpc:poeKey / orpc:ghToken 與 orpc:deviceId 保留原處） */
    [...kvKeys, STORAGE_KEYS.chats].forEach(k => { try { localStorage.removeItem(k); } catch {} });
 
    const n = chats.length + puts.length;
    if (n) console.info(`[Store] 已從 localStorage 遷移 ${chats.length} 個對話、${puts.length} 組設定到 IndexedDB`);
    return n;
  }
 
  /* ============================ 基礎讀寫 ============================== */
 
  function get(key, fallback = null) {
    if (cache.has(key)) {
      const v = cache.get(key);
      return v == null ? fallback : clone(v);
    }
    if (!inited) {                                        // 極早期呼叫（如 GitHubSync 載入期）
      const v = lsGet(key);
      if (v != null) return v;
    }
    return fallback;
  }
 
  function set(key, value) {
    cache.set(key, value);
    dirty.add(key);
    schedule();
    return true;
  }
 
  function remove(key) {
    cache.delete(key);
    dirty.delete(key);
    chain = chain.then(() => IDB.kvDelete(key)).then(() => broadcast([key])).catch(onWriteError);
  }
 
  /* ============================ 寫入排程 ============================== */
  /* v2.4.3：IDB 寫入的 debounce 只留在這一層。
     Chats / Settings / Prompts 都改成「立即寫進 cache、標記 dirty」，
     因此 pagehide 的 flushNow() 一定有資料可刷，
     關閉分頁前最後幾百毫秒的變更不再消失。                            */
 
  function schedule() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 200);
  }
 
  /** 立刻把待寫資料排進佇列（回傳 Promise，可 await） */
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!inited || !dirty.size) return chain;
    const keys = [...dirty];
    dirty.clear();
    chain = chain.then(() => write(keys)).catch(onWriteError);
    return chain;
  }
 
  /** 不等待完成（beforeunload / pagehide 用） */
  const flushNow = () => { flush(); };
 
  async function write(keys) {
    const kv = [];
    for (const k of keys) {
      if (k === STORAGE_KEYS.chats) { await writeChats(); continue; }
      kv.push([k, cache.get(k)]);
    }
    if (kv.length) await IDB.kvWrite(kv);
    broadcast(keys);                                      // 通知其他分頁
    usageCache.at = 0;                                    // 用量統計標記為過期
  }
 
  /** 對話簽章：任何一項改變就代表這筆需要重寫 */
  function chatSig(c) {
    const msgs = c.messages || [];
    const last = msgs[msgs.length - 1];
    return [
      c.rev | 0, c.updatedAt || '', msgs.length,
      c.deleted ? 1 : 0, c._offloaded ? 1 : 0, c.temporary ? 1 : 0,
      c.title || '', c.folderId || '', c.pinned ? 1 : 0, c.archived ? 1 : 0,
      c.titleLocked ? 1 : 0, c.model || '',
      (c.draft || '').length, (c.summary || '').length, (c.systemPrompt || '').length,
      last ? `${(last.content || '').length}:${(last.reasoning || '').length}:${last.editedAt || last.createdAt || ''}` : '',
    ].join('|');
  }
 
  /** ★ 逐筆 diff：只寫真的變動的對話，刪除已消失的記錄 */
  async function writeChats() {
    const list = cache.get(STORAGE_KEYS.chats) || [];
    const puts = [];
    const seen = new Set();
 
    for (const c of list) {
      if (!c || !c.id) continue;
      seen.add(c.id);
      const sig = chatSig(c);
      if (chatSigs.get(c.id) !== sig) { puts.push(c); chatSigs.set(c.id, sig); }
    }
    const dels = [...chatSigs.keys()].filter(id => !seen.has(id));
    dels.forEach(id => chatSigs.delete(id));
 
    if (puts.length || dels.length) await IDB.chatsWrite(puts, dels);
  }
 
  function onWriteError(e) {
    console.error('[Store] 寫入失敗', e);
    const txt = `${e?.name || ''} ${e?.message || ''}`;
    if (/quota|space/i.test(txt)) {
      window.Toast?.error('瀏覽器儲存配額已滿。請到「設定 → 資料」刪除舊對話，或在「設定 → 檔案」關閉「保存附件內容」。', 9000);
    }
  }
 
  /* ============================ 機密（金鑰） ========================== */
  /* 刻意留在 localStorage / sessionStorage：保留「僅本次工作階段」語意，
     且絕不進入 IndexedDB 與任何備份檔。                                     */
 
  function getSecret(name, mode = 'local') {
    if (mode === 'memory') return memory[name] || '';
    try { return (mode === 'session' ? sessionStorage : localStorage).getItem(name) || ''; }
    catch { return ''; }
  }
 
  function setSecret(name, value, mode = 'local') {
    memory[name] = value || '';
    try {
      localStorage.removeItem(name);
      sessionStorage.removeItem(name);
      if (mode === 'local' && value) localStorage.setItem(name, value);
      if (mode === 'session' && value) sessionStorage.setItem(name, value);
    } catch (e) { console.warn('[Store] 金鑰儲存失敗', name, e); }
  }
 
  const getApiKey = (mode = 'local') => getSecret(STORAGE_KEYS.apiKey, mode);
  const setApiKey = (key, mode = 'local') => setSecret(STORAGE_KEYS.apiKey, key, mode);
 
  /* ============================ 容量統計 ============================== */
 
  const roughSize = v => { try { return JSON.stringify(v).length * 2; } catch { return 0; } };
 
  /** 對話陣列用字串長度累加，避免對數十 MB 的資料做 JSON.stringify */
  function chatsSize(list = []) {
    let n = 0;
    for (const c of list) {
      n += (c.title || '').length + (c.systemPrompt || '').length + (c.summary || '').length + (c.draft || '').length + 120;
      for (const m of c.messages || []) {
        n += (m.content || '').length + (m.reasoning || '').length + 160;
        for (const a of m.attachments || []) n += (a.dataUrl || '').length + (a.text || '').length + 80;
      }
    }
    return n * 2;
  }
 
  /** 同步回傳最近一次統計（>4 秒會在背景刷新） */
  function usage() {
    if (!usageCache.pending && Date.now() - usageCache.at > 4000) refreshUsage();
    return { total: usageCache.total, detail: usageCache.detail, quota: usageCache.quota };
  }
 
  async function refreshUsage() {
    usageCache.pending = true;
    try {
      const detail = {};
      let total = 0;
      for (const [k, v] of cache) {
        const size = k === STORAGE_KEYS.chats ? chatsSize(v) : roughSize(v);
        detail[k] = size;
        total += size;
      }
      const est = await IDB.estimate();
      usageCache = {
        total, detail,
        quota: est?.quota ?? null,
        originUsage: est?.usage ?? null,
        at: Date.now(), pending: false,
      };
    } catch {
      usageCache.pending = false;
      usageCache.at = Date.now();
    }
    return usageCache;
  }
 
  /* ============================ 備份 / 還原 =========================== */
 
  /** 匯出全部資料（絕不含任何金鑰） */
  function exportAll() {
    const settings = { ...get(STORAGE_KEYS.settings, {}) };
    Object.keys(SECRET_SETTINGS).forEach(k => delete settings[k]);
    return {
      app: APP.name,
      version: APP.version,
      exportedAt: U.nowISO(),
      settings,
      chats: get(STORAGE_KEYS.chats, []),
      folders: get(STORAGE_KEYS.folders, []),
      prompts: get(STORAGE_KEYS.prompts, []),
    };
  }
 
  /**
   * 匯入備份
   * @param {object} data   exportAll() 的輸出
   * @param {'merge'|'replace'} mode
   */
  function importAll(data, mode = 'merge') {
    if (!data || typeof data !== 'object') throw new Error('備份檔格式不正確');
 
    const stripSecrets = s => {
      const o = { ...(s || {}) };
      Object.keys(SECRET_SETTINGS).forEach(k => delete o[k]);
      return o;
    };
 
    if (mode === 'replace') {
      if (data.settings) set(STORAGE_KEYS.settings, stripSecrets(data.settings));
      set(STORAGE_KEYS.chats, data.chats || []);
      set(STORAGE_KEYS.folders, data.folders || []);
      set(STORAGE_KEYS.prompts, data.prompts || []);
      return { chats: (data.chats || []).length };
    }
 
    /* merge：對話走三方合併（不硬蓋較新的本機資料） */
    const localChats = get(STORAGE_KEYS.chats, []) || [];
    const map = new Map(localChats.map(c => [c.id, c]));
    (data.chats || []).forEach(inc => {
      if (!inc || !inc.id) return;
      const cur = map.get(inc.id);
      if (!cur) { map.set(inc.id, inc); return; }
      map.set(inc.id, window.GitHubSync
        ? GitHubSync.mergeChat(Chats.normalize(cur), Chats.normalize(inc))
        : (String(inc.updatedAt || '') > String(cur.updatedAt || '') ? inc : cur));
    });
    set(STORAGE_KEYS.chats, Array.from(map.values()));
 
    const mergeById = (a = [], b = []) => {
      const m = new Map(a.map(x => [x.id, x]));
      b.forEach(x => {
        if (!x || !x.id) return;
        const cur = m.get(x.id);
        if (!cur || String(x.updatedAt || '') > String(cur.updatedAt || '')) m.set(x.id, x);
      });
      return Array.from(m.values());
    };
    set(STORAGE_KEYS.folders, mergeById(get(STORAGE_KEYS.folders, []), data.folders || []));
    set(STORAGE_KEYS.prompts, mergeById(get(STORAGE_KEYS.prompts, []), data.prompts || []));
 
    if (data.settings) {
      set(STORAGE_KEYS.settings, { ...get(STORAGE_KEYS.settings, {}), ...stripSecrets(data.settings) });
    }
    return { chats: (data.chats || []).length };
  }
 
  /** 清除本 App 的所有資料（IndexedDB + localStorage + 所有金鑰） */
  async function clearAll() {
    clearTimeout(flushTimer);
    flushTimer = null;
    dirty.clear();
    cache.clear();
    chatSigs.clear();
 
    try { await IDB.clearAll(); } catch (e) { console.warn('[Store] 清除 IndexedDB 失敗', e); }
 
    Object.keys(localStorage)
      .filter(k => k.startsWith('orpc:'))
      .forEach(k => localStorage.removeItem(k));
    [STORAGE_KEYS.apiKey, STORAGE_KEYS.poeKey, STORAGE_KEYS.ghToken]
      .forEach(k => { try { sessionStorage.removeItem(k); } catch {} });
    Object.keys(memory).forEach(k => delete memory[k]);
    return true;
  }
 
  return {
    init, flush, flushNow,
    get, set, remove,
    getSecret, setSecret, getApiKey, setApiKey,
    usage, refreshUsage,
    exportAll, importAll, clearAll,
    isReady: () => inited,
    driver: () => IDB.driver(),
  };
})();