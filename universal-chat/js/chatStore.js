/* =============================================================================
 * chatStore.js — 對話資料層（Model）
 * -----------------------------------------------------------------------------
 * v2.3：
 *   • 暫時對話 temporary：不寫入 IndexedDB、不同步、關閉分頁即消失
 *   • 訊息 startedAt / durationMs：生成耗時
 *   • 資料夾 order：可手動排序（會同步）
 *   • 其餘沿用 v2.2：穩定 msg id / seq / 軟刪除 / rev / 墓碑 / 渲染指紋
 * v2.4.2：
 *   • 訊息新增 bookmarked（書籤）與 finishReason（'length' ⇒ 可續寫），
 *     兩者皆納入 messagesSignature，外觀變化能正確觸發重繪
 * v2.4.3：
 *   • persist 不再在本層 debounce —— 直接寫進 Store cache（O(1)），
 *     IDB 的 debounce／合併寫入統一由 Store 负责；pagehide 的 flushNow
 *     才真的有資料可刷（修復關閉分頁前最後幾百毫秒變更遺失）
 *   • 新增 absorbRemote()：收到其他分頁的寫入廣播時，把 IDB 最新版本
 *     併回記憶體（mergeChat 聯集合併），修復「過期陣列整包蓋回」的
 *     跨分頁 lost update
 * 此層只負責資料，不碰 DOM。
 * ============================================================================= */
 
window.Chats = (() => {
 
  let chats = [];            // 含 tombstone
  let folders = [];          // 含 tombstone
  let currentId = null;
 
  /* ------------------------------ 裝置識別 ---------------------------- */
 
  const DEVICE_ID = (() => {
    let d = null;
    try { d = localStorage.getItem(STORAGE_KEYS.device); } catch {}
    if (!d) { d = U.uid('dev'); try { localStorage.setItem(STORAGE_KEYS.device, d); } catch {} }
    return d;
  })();
 
  /** djb2：跨裝置結果一致 */
  function hash32(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const stableMsgId = (chatId, i, m) =>
    'msg_' + hash32(`${chatId}|${i}|${m.role || ''}|${String(m.content ?? '').slice(0, 2000)}`);
 
  /** 需要軟刪除嗎？（曾設定過 GitHub 才需要） */
  const softMode = () => !!(window.GitHubSync && GitHubSync.everConfigured());
 
  /* ------------------------------ 正規化 ------------------------------ */
 
  function normalizeMessage(chatId, m, i) {
    return {
      id: m.id || stableMsgId(chatId, i, m),
      role: m.role || 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      attachments: m.attachments || [],
      model: m.model || null,
      reasoning: m.reasoning || '',
      usage: m.usage || null,
      cost: m.cost || 0,
      error: m.error || null,
      deleted: !!m.deleted,
      bookmarked: !!m.bookmarked,               // v2.4.2：書籤
      seq: typeof m.seq === 'number' ? m.seq : i + 1,
      createdAt: m.createdAt || m.timestamp || m.ts || U.nowISO(),
      editedAt: m.editedAt || null,
      /* 只在存在時寫入，避免改動舊資料的同步指紋 */
      ...(m.startedAt ? { startedAt: m.startedAt } : {}),
      ...(m.durationMs ? { durationMs: m.durationMs } : {}),
      ...(m.finishReason ? { finishReason: m.finishReason } : {}),   // v2.4.2：'length' ⇒ 可續寫
    };
  }
 
  function normalize(c) {
    const id = c.id || U.uid('chat');
    const created = c.createdAt || U.nowISO();
    const out = {
      id, schema: 2,
      title: c.title || '新對話',
      titleLocked: !!c.titleLocked,
      folderId: c.folderId || null,
      pinned: !!c.pinned,
      archived: !!c.archived,
      deleted: !!c.deleted,
      deletedAt: c.deletedAt || null,
      model: c.model || null,
      systemPrompt: c.systemPrompt || '',
      overrides: c.overrides || null,
      summary: c.summary || '',
      summarizedUpTo: c.summarizedUpTo || 0,
      draft: c.draft || '',
      rev: c.rev || 1,
      lastEditBy: c.lastEditBy || DEVICE_ID,
      createdAt: created,
      updatedAt: c.updatedAt || created,
      messages: (c.messages || []).map((m, i) => normalizeMessage(id, m, i)),
    };
    if (c.temporary) out.temporary = true;
    if (c._offloaded) out._offloaded = true;
    const outCfg = normalizeOut(c.out);
    if (outCfg) out.out = outCfg;
    return out;
  }
 
  function normalizeOut(o) {
    if (!o || typeof o !== 'object' || o.mode !== 'custom') return null;
    const owner = String(o.owner || '').trim();
    const repo  = String(o.repo  || '').trim().replace(/^.*\//, '');
    if (!owner || !repo) return null;
    return { mode: 'custom', owner, repo,
             branch: String(o.branch || '').trim(),
             dir: String(o.dir || '').trim().replace(/^\/+|\/+$/g, ''),
             auto: !!o.auto };
  }
 

  function normalizeFolder(f) {
    const created = f.createdAt || U.nowISO();
    return {
      id: f.id || U.uid('fld'),
      name: f.name || '資料夾',
      collapsed: !!f.collapsed,
      deleted: !!f.deleted,
      deletedAt: f.deletedAt || null,
      createdAt: created,
      updatedAt: f.updatedAt || created,
      ...(Number.isFinite(f.order) ? { order: f.order } : {}),   // v2.3：手動排序
    };
  }
 
  function touch(c) {
    c.updatedAt = U.nowISO();
    c.rev = (c.rev || 0) + 1;
    c.lastEditBy = DEVICE_ID;
    return c;
  }
 
  /* ------------------------------ 持久化 ------------------------------ */
  /**
   * v2.4.3：這一層不再 debounce。直接把最新狀態寫進 Store 的記憶體 cache
   * （Store.set 只是 cache.set + 標記 dirty，O(1)），IndexedDB 的合併寫入
   * 與 200ms debounce 統一由 Store 负责。
   *
   * 舊版「Chats debounce 350ms → Store debounce 200ms」疊在一起，
   * pagehide 只呼叫 Store.flushNow()——如果 persist 還沒跑，
   * Store 根本沒有 dirty 資料可刷，關閉分頁前最後幾百毫秒的
   * 訊息與草稿會直接消失。
   */
  function persistToStore() {
    const keepAtt = Settings.get('storeAttachments');
    const persistable = chats.filter(c => !c.temporary);        // ★ 暫時對話永不落地
    const slim = keepAtt ? persistable : persistable.map(c => ({
      ...c,
      messages: (c.messages || []).map(m => ({
        ...m,
        attachments: (m.attachments || []).map(a => ({ ...a, dataUrl: undefined, text: undefined, stripped: true })),
      })),
    }));
    Store.set(STORAGE_KEYS.chats, slim);
    Store.set(STORAGE_KEYS.folders, folders);
    Store.set(STORAGE_KEYS.current, currentId);
  }
 
  /**
   * 所有寫入統一走這裡。
   * @param {boolean} remote true = 這筆寫入來自雲端／其他分頁（不視為本機變更，不觸發同步）
   */
  function save(remote = false) {
    persistToStore();
    if (!remote) window.GitHubSync?.notifyLocalChange?.();
  }
 
  /** 針對某個對話的寫入：暫時對話不算「需要同步的本機變更」 */
  const commit = (chat, remote = false) => save(remote || !!chat?.temporary);
 
  /* ---------------------- 多分頁一致性（v2.4.3） ---------------------- */
 
  /** 指紋用：移除本機專屬欄位（與 github.js 的 publicChat 同一組規則） */
  const publicOf = c => {
    const { draft, _offloaded, temporary, ...pub } = c;
    return pub;
  };
 
  const publicEq = (a, b) => {
    const fp = window.GitHubSync?.fingerprint;
    if (fp) return fp(publicOf(a)) === fp(publicOf(b));
    return JSON.stringify(publicOf(a)) === JSON.stringify(publicOf(b));
  };
 
  /**
   * 把 Store cache 裡（另一個分頁寫入 IndexedDB 的）最新版本併回本分頁的
   * 記憶體陣列。由 storage.js 在收到 BroadcastChannel／storage 事件時呼叫。
   *
   * 舊版只更新 Store 的 cache，本模組的記憶體陣列完全不知道：
   *   1. 畫面永遠讀到過期資料；
   *   2. 下次 persist 會用過期陣列「整包蓋回」，把對方剛寫入的變更吃掉。
   *
   * 合併規則與 GitHub 同步同一套哲學：
   *   • 有 GitHubSync.mergeChat → 訊息以 id 聯集合併（可交換、可收斂）；
   *     沒有 → 退回「updatedAt 較新者勝」的 LWW。
   *   • 合併結果與 IDB 內容相同 → 只更新記憶體、**不寫回**
   *     （否則 rev / draft 的微小差異會讓兩個分頁無限互相觸發寫入）。
   *   • 合併結果包含 IDB 沒有的內容 → 寫回（remote=true，不觸發 GitHub 同步）。
   *   • 本分頁正在生成的對話一律保留本機物件——串流中的 placeholder
   *     還握著訊息物件的參考，不能被替換；完成後的自然寫入會傳播出去。
   *
   * @returns {boolean} 記憶體是否有更新（呼叫端可據此決定是否重繪）
   */
  function absorbRemote() {
    const remoteChats = (Store.get(STORAGE_KEYS.chats, []) || []).filter(c => c && c.id);
    const remoteFolders = (Store.get(STORAGE_KEYS.folders, []) || []).filter(Boolean);
    if (!remoteChats.length && !remoteFolders.length) return false;
 
    const mergeChat = window.GitHubSync?.mergeChat;
    const mergeList = window.GitHubSync?.mergeList;
 
    let changed = false;      // 記憶體被更新 → 需要重繪
    let needWrite = false;    // IDB 缺少本端內容 → 需要寫回
 
    /* ---------------------------- chats ---------------------------- */
    const localById = new Map(chats.map(c => [c.id, c]));
    const nextChats = [];
 
    for (const rr of remoteChats) {
      const remote = normalize(rr);
      const localRaw = localById.get(remote.id);
      localById.delete(remote.id);
 
      if (!localRaw) {                                   // 本端沒有 → 直接採用
        nextChats.push(remote);
        changed = true;
        continue;
      }
 
      /* 本端正在生成 → 保留本機物件與內容（完成後的自然寫入會傳播） */
      if (window.UIState?.isGenerating?.(remote.id)) {
        nextChats.push(localRaw);
        continue;
      }
 
      if (publicEq(localRaw, remote)) {
        /* 內容相同 → 完全保留本機物件。刻意不動 rev：
           Store 的 chatSig 含 rev，改了反而觸發一次多餘的 IDB 重寫；
           同步指紋不含 rev，之後合併時取 max(rev)+1 即可。 */
        nextChats.push(localRaw);
        continue;
      }
 
      let m;
      if (mergeChat) {
        const wasOffloaded = !!localRaw._offloaded;
        const local = wasOffloaded ? null : normalize(localRaw);
        m = local ? normalize(mergeChat(local, remote)) : remote;
      } else {
        m = String(remote.updatedAt || '') >= String(localRaw.updatedAt || '') ? remote : localRaw;
      }
 
      if (m === localRaw) {                              // 本機較新 → IDB 需要這份
        needWrite = true;
        nextChats.push(m);
        continue;
      }
      if (!publicEq(m, remote)) needWrite = true;        // 合併結果含 IDB 沒有的內容
      nextChats.push(m);
      changed = true;
    }
 
    /* 只存在本端的對話（暫時對話、剛建立還沒 flush 的對話）原樣保留 */
    localById.forEach(c => nextChats.push(c));
 
    /* --------------------------- folders --------------------------- */
    let nextFolders = folders;
    if (remoteFolders.length || folders.length) {
      if (mergeList) {
        nextFolders = mergeList(folders, remoteFolders);
      } else {
        const rById = new Map(remoteFolders.map(f => [f.id, f]));
        const localIds = new Set(folders.map(f => f.id));
        nextFolders = folders.map(f => {
          const r = rById.get(f.id);
          return r && String(r.updatedAt || '') >= String(f.updatedAt || '') ? r : f;
        });
        remoteFolders.forEach(r => { if (!localIds.has(r.id)) nextFolders.push(r); });
      }
 
      const foldersChanged = nextFolders.length !== folders.length ||
                             nextFolders.some(f => !folders.includes(f));
      if (foldersChanged) {
        changed = true;
        /* IDB 沒有的資料夾、或本端較新的資料夾 → 需要寫回 */
        const rById = new Map(remoteFolders.map(f => [f.id, f]));
        if (nextFolders.some(f => {
          const r = rById.get(f.id);
          return !r || String(f.deletedAt || f.updatedAt || '') > String(r.deletedAt || r.updatedAt || '');
        })) needWrite = true;
      }
    }
 
    if (!changed && !needWrite) return false;
 
    if (changed) {
      chats = nextChats;
      folders = nextFolders;
      ensureCurrentValid();          // 目前對話可能在另一個分頁被刪掉了
    }
    if (needWrite) persistToStore(); // remote 語意：不觸發 GitHub markDirty
    return true;
  }
 
  /* ------------------------------ 查詢 -------------------------------- */
 
  function load() {
    chats = (Store.get(STORAGE_KEYS.chats, []) || []).filter(Boolean).map(normalize);
    folders = (Store.get(STORAGE_KEYS.folders, []) || []).filter(Boolean).map(normalizeFolder);
    currentId = Store.get(STORAGE_KEYS.current, null);
 
    purgeTombstones();
 
    if (!list().length) create();
    ensureCurrentValid();
    return chats;
  }
 
  /** 清掉過期墓碑（未同步：30 天；有同步：180 天） */
  function purgeTombstones() {
    const days = softMode() ? 180 : 30;
    const cut = Date.now() - days * 86400000;
    const dead = x => x.deleted && Date.parse(x.deletedAt || x.updatedAt || 0) < cut;
    chats = chats.filter(c => !dead(c));
    folders = folders.filter(f => !dead(f));
  }
 
  /* ------------------------------ 查詢 -------------------------------- */
 
  const raw = () => chats;
  const list = () => chats.filter(c => !c.deleted);
  const current = () => chats.find(c => c.id === currentId && !c.deleted) || null;
  const currentIdOf = () => currentId;
  const find = id => chats.find(c => c.id === id && !c.deleted) || null;
  const findRaw = id => chats.find(c => c.id === id) || null;
 
  /** UI 用：已依 order 排序（沒有 order 的排在後面，再依建立時間） */
  const foldersList = () => folders
    .filter(f => !f.deleted)
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) ||
                    String(a.createdAt).localeCompare(String(b.createdAt)));
 
  const foldersAll = () => folders;                            // 同步用（含墓碑）
  const setFolders = (l, remote = false) => {
    folders = (l || []).filter(Boolean).map(normalizeFolder);
    save(remote);
  };
 
  const visible = c => ((c && c.messages) || []).filter(m => !m.deleted);
 
  function ensureCurrentValid() {
    if (!chats.some(c => c.id === currentId && !c.deleted)) currentId = sorted()[0]?.id || list()[0]?.id || null;
    if (!currentId && !list().length) create();
  }
 
  function sorted(filter = 'all') {
    return list()
      .filter(c => filter === 'archived' ? c.archived : (filter === 'pinned' ? (c.pinned && !c.archived) : !c.archived))
      .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updatedAt) - new Date(a.updatedAt)));
  }
 
  /* ---------------------- 渲染簽章（避免無謂重繪） -------------------- */
 
  function messagesSignature(chat) {
    const c = chat || current();
    if (!c) return 'none';
    const parts = visible(c).map(m =>
      `${m.id}~${m.editedAt || m.createdAt}~${(m.content || '').length}~${(m.reasoning || '').length}` +
      `~${m.error ? 1 : 0}~${m.model || ''}~${m.usage ? (m.usage.completion_tokens || 0) : 0}` +
      `~${(m.attachments || []).length}~${m.durationMs || 0}` +
      `~${m.bookmarked ? 1 : 0}~${m.finishReason || ''}`);
    return `${c.id}#${parts.length}#${hash32(parts.join('|'))}`;
  }
 
  function sidebarSignature() {
    const cs = list().map(c =>
      `${c.id}~${c.title}~${c.pinned ? 1 : 0}~${c.archived ? 1 : 0}~${c.folderId || ''}` +
      `~${c.updatedAt}~${visible(c).length}~${c._offloaded ? 1 : 0}~${c.temporary ? 1 : 0}`);
    const fs = foldersList().map(f => `${f.id}~${f.name}~${f.collapsed ? 1 : 0}`);   // 已排序
    return hash32(`${currentId}|${cs.join('|')}||${fs.join('|')}`);
  }
 
  /* ------------------------------ 對話 CRUD --------------------------- */
 
  function create(init = {}) {
    const chat = normalize({
      id: U.uid('chat'),
      title: init.title || (init.temporary ? '暫時對話' : '新對話'),
      folderId: init.folderId ?? null,
      model: init.model || null,
      systemPrompt: init.systemPrompt || '',
      messages: init.messages || [],
      temporary: !!init.temporary,
      createdAt: U.nowISO(),
      updatedAt: U.nowISO(),
    });
    chats.unshift(chat);
    currentId = chat.id;
    commit(chat);
    return chat;
  }
 
  function update(id, patch) {
    const c = findRaw(id);
    if (!c) return null;
    if (c._offloaded) {
      window.Toast?.warn('此對話內容存在雲端，請先點開載入後再修改');
      return null;
    }
    Object.assign(c, patch);
    touch(c);
    commit(c);
    return c;
  }
 
  function remove(id) {
    const c = findRaw(id);
    if (!c) return;
    const wasTemp = !!c.temporary;
    if (softMode() && !wasTemp) {                  // 暫時對話不需要墓碑
      /* ★ v2.4.5：墓碑保留原標題。
         舊版清成 '' → normalize 補成「新對話」，導致 GitHub 的
         刪除 commit 顯示 "chat: delete 新對話"，無法辨識刪的是哪個對話。
         標題保留後，commit 自動變成 "chat: delete <原標題>"。
         （隱私面：git 歷史本來就永久保留完整訊息內容，
           多留一個標題沒有增加任何暴露面。） */
      const tomb = normalize({
        id: c.id, title: c.title || '', createdAt: c.createdAt, rev: c.rev,
        deleted: true, deletedAt: U.nowISO(), messages: [],
      });
      touch(tomb);
      chats = chats.map(x => (x.id === id ? tomb : x));
    } else {
      chats = chats.filter(x => x.id !== id);
    }
    if (currentId === id) currentId = null;
    if (!list().length) create();
    ensureCurrentValid();
    save(wasTemp);
  }
 
  /**
   * 供同步模組寫回（不改 updatedAt / rev）
   * @param {boolean} remote true = 來自雲端
   */
  function upsertRaw(chat, remote = false) {
    const i = chats.findIndex(c => c.id === chat.id);
    i >= 0 ? (chats[i] = chat) : chats.push(chat);
    save(remote);
    return chat;
  }
 
  const switchTo = id => { if (find(id)) { currentId = id; save(true); } };
 
  function duplicate(id) {
    const c = find(id);
    if (!c) return null;
    const copy = normalize(U.deepClone(c));
    copy.id = U.uid('chat');
    copy.title = c.title + '（副本）';
    copy.createdAt = copy.updatedAt = U.nowISO();
    copy.rev = 1;
    copy.messages.forEach((m, i) => { m.id = U.uid('msg'); m.seq = i + 1; });
    chats.unshift(copy);
    currentId = copy.id;
    commit(copy);
    return copy;
  }
 
  const togglePin = id => update(id, { pinned: !findRaw(id)?.pinned });
  const toggleArchive = id => update(id, { archived: !findRaw(id)?.archived });
 
  function clearMessages(id) {
    const c = findRaw(id);
    if (!c || c._offloaded) return;
    if (softMode() && !c.temporary) {
      c.messages.forEach(m => {
        if (!m.deleted) {
          m.deleted = true; m.content = ''; m.reasoning = ''; m.attachments = [];
          m.editedAt = U.nowISO();
        }
      });
    } else {
      c.messages = [];
    }
    Object.assign(c, { summary: '', summarizedUpTo: 0 });
    touch(c);
    commit(c);
  }
 
  function branch(chatId, messageId) {
    const c = find(chatId);
    if (!c) return null;
    const vis = visible(c);
    const idx = vis.findIndex(m => m.id === messageId);
    const kept = U.deepClone(vis.slice(0, idx + 1));
    kept.forEach((m, i) => { m.id = U.uid('msg'); m.seq = i + 1; });
    return create({
      title: c.title + '（分支）',
      folderId: c.folderId, model: c.model, systemPrompt: c.systemPrompt,
      temporary: !!c.temporary,                    // 暫時對話的分支也是暫時的
      messages: kept,
    });
  }
 
  /* ------------------------- 暫時對話 ↔ 永久對話 ---------------------- */
 
  const temporaryList = () => list().filter(c => c.temporary);
  const hasTemporaryContent = () => temporaryList().some(c => visible(c).length > 0);
 
  /** 暫時 → 永久：保留同一個 id，之後會正常儲存與同步 */
  function makePermanent(id) {
    const c = findRaw(id);
    if (!c || !c.temporary) return null;
    delete c.temporary;
    if (c.title === '暫時對話') c.titleLocked = false;
    touch(c);
    save();                                        // 真正的本機變更
    return c;
  }
 
  /**
   * 永久 → 暫時：以新 id 複製成暫時對話，原本那個走正常刪除流程
   * （本機與雲端的舊副本都會被清掉，不會留下孤兒檔案）
   */
  function makeTemporary(id) {
    const c = find(id);
    if (!c) return null;
    if (c.temporary) return c;
    if (c._offloaded) { window.Toast?.warn('請先點開載入內容再轉換'); return null; }
 
    const copy = normalize(U.deepClone(c));
    copy.id = U.uid('chat');
    copy.temporary = true;
    copy.rev = 1;
    copy.draft = c.draft || '';
    copy.updatedAt = U.nowISO();
    chats.unshift(copy);
    currentId = copy.id;                           // 先切換，remove 才不會動到它
    remove(id);
    commit(copy);
    return copy;
  }
 
  /* ------------------------------ 訊息 CRUD --------------------------- */
 
  function addMessage(chatId, msg) {
    const c = findRaw(chatId);
    if (!c || c._offloaded) return null;
    const maxSeq = c.messages.reduce((a, m) => Math.max(a, m.seq || 0), 0);
    const m = normalizeMessage(chatId, {
      id: U.uid('msg'), role: 'user', content: '', createdAt: U.nowISO(), seq: maxSeq + 1, ...msg,
    }, c.messages.length);
    c.messages.push(m);
    touch(c);
    commit(c);
    return m;
  }
 
  function updateMessage(chatId, msgId, patch) {
    const c = findRaw(chatId);
    const m = c?.messages.find(x => x.id === msgId);
    if (!m) return null;
    Object.assign(m, patch, { editedAt: U.nowISO() });
    touch(c);
    commit(c);
    return m;
  }
 
  /** 書籤：切換某則訊息的 bookmarked 旗標（進渲染指紋與同步指紋） */
  function toggleBookmark(chatId, msgId) {
    const m = findRaw(chatId)?.messages.find(x => x.id === msgId);
    if (!m) return null;
    return updateMessage(chatId, msgId, { bookmarked: !m.bookmarked });
  }
 
  function removeMessage(chatId, msgId) {
    const c = findRaw(chatId);
    if (!c) return;
    if (softMode() && !c.temporary) {
      const m = c.messages.find(x => x.id === msgId);
      if (m) { m.deleted = true; m.content = ''; m.reasoning = ''; m.attachments = []; m.editedAt = U.nowISO(); }
    } else {
      c.messages = c.messages.filter(m => m.id !== msgId);
    }
    touch(c);
    commit(c);
  }
 
  function truncateAfter(chatId, msgId, inclusive = false) {
    const c = findRaw(chatId);
    if (!c) return;
    const vis = visible(c);
    const idx = vis.findIndex(m => m.id === msgId);
    if (idx < 0) return;
    const kill = new Set(vis.slice(inclusive ? idx : idx + 1).map(m => m.id));
    if (softMode() && !c.temporary) {
      c.messages.forEach(m => {
        if (kill.has(m.id)) { m.deleted = true; m.content = ''; m.reasoning = ''; m.attachments = []; m.editedAt = U.nowISO(); }
      });
    } else {
      c.messages = c.messages.filter(m => !kill.has(m.id));
    }
    touch(c);
    commit(c);
  }
 
  /* ------------------------------ 資料夾 ------------------------------ */
 
  function createFolder(name) {
    const maxOrder = folders.reduce((a, f) => Math.max(a, Number.isFinite(f.order) ? f.order : -1), -1);
    const f = normalizeFolder({ id: U.uid('fld'), name: name || '新資料夾', order: maxOrder + 1 });
    folders.push(f);
    save();
    return f;
  }
 
  function updateFolder(id, patch) {
    const f = folders.find(x => x.id === id && !x.deleted);
    if (f) { Object.assign(f, patch, { updatedAt: U.nowISO() }); save(); }
    return f;
  }
 
  function removeFolder(id) {
    const f = folders.find(x => x.id === id);
    if (softMode() && f) {
      Object.assign(f, { deleted: true, deletedAt: U.nowISO(), updatedAt: U.nowISO(), name: '' });
    } else {
      folders = folders.filter(x => x.id !== id);
    }
    chats.forEach(c => { if (c.folderId === id && !c._offloaded) { c.folderId = null; touch(c); } });
    save();
  }
 
  const moveToFolder = (chatId, folderId) => update(chatId, { folderId: folderId || null });
 
  /* ---------------------- 資料夾排序（v2.3） -------------------------- */
 
  /** 把 order 補成 0..n-1 */
  function normalizeFolderOrder() {
    let changed = false;
    foldersList().forEach((f, i) => {
      if (f.order !== i) { f.order = i; f.updatedAt = U.nowISO(); changed = true; }
    });
    return changed;
  }
 
  /** 上移 / 下移一格：dir = -1 | +1 */
  function moveFolder(id, dir) {
    normalizeFolderOrder();
    const live = foldersList();
    const i = live.findIndex(f => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= live.length) return false;
    const a = live[i], b = live[j];
    const t = a.order; a.order = b.order; b.order = t;
    a.updatedAt = b.updatedAt = U.nowISO();
    save();
    return true;
  }
 
  /** 拖放排序：把 dragId 插到 targetId 之前 */
  function reorderFolders(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return false;
    normalizeFolderOrder();
    const arr = foldersList();
    const from = arr.findIndex(f => f.id === dragId);
    if (from < 0) return false;
    const [moved] = arr.splice(from, 1);
    const to = arr.findIndex(f => f.id === targetId);
    if (to < 0) return false;
    arr.splice(to, 0, moved);
    arr.forEach((f, i) => { f.order = i; f.updatedAt = U.nowISO(); });
    save();
    return true;
  }
 
  /* ------------------------------ 搜尋 / 統計 ------------------------- */
 
  function search(query, limit = 80) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const c of list()) {
      if (c.title.toLowerCase().includes(q)) out.push({ chat: c, message: null, snippet: c.title });
      for (const m of visible(c)) {
        const text = String(m.content || '');
        const i = text.toLowerCase().indexOf(q);
        if (i > -1) {
          out.push({ chat: c, message: m, snippet: text.slice(Math.max(0, i - 60), i + 120) });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
 
  function stats(chat) {
    const c = chat || current();
    if (!c) return { count: 0, promptTokens: 0, completionTokens: 0, cost: 0, estTokens: 0 };
    let p = 0, comp = 0, cost = 0, est = 0;
    visible(c).forEach(m => {
      p += m.usage?.prompt_tokens || 0;
      comp += m.usage?.completion_tokens || 0;
      cost += m.cost || 0;
      est += U.estimateTokens(String(m.content || ''));
    });
    return { count: visible(c).length, promptTokens: p, completionTokens: comp, cost, estTokens: est };
  }
 
  function globalStats() {
    return list().reduce((acc, c) => {
      const s = stats(c);
      acc.chats++; acc.messages += s.count; acc.cost += s.cost;
      acc.tokens += s.promptTokens + s.completionTokens;
      return acc;
    }, { chats: 0, messages: 0, tokens: 0, cost: 0 });
  }
 
  /* ------------------------------ API messages ------------------------ */
 
  function buildApiMessages(chat, opts = {}) {
    const s = Settings.all();
    const out = [];
 
    let sys = (chat.systemPrompt || s.systemPrompt || '').trim();
    if (s.sendChatMetadata) {
      sys += `\n\n[環境資訊] 現在時間：${U.formatDateTime(U.nowISO())}；使用者語言：繁體中文。`;
    }
    if (s.mathEnabled && s.mathPromptHint) {
      sys += '\n\n[格式要求] 數學一律用 LaTeX：行內用 $...$（例如 $\\mu$、$\\sigma^2/n$），' +
             '獨立方程式用 $$...$$ 並自成一行；不要使用 \\(...\\)、\\[...\\] 或 Unicode 數學符號（σ² μ ∞）代替。';
    }
    if (sys.trim()) out.push({ role: 'system', content: sys.trim() });
 
    if (chat.summary) out.push({ role: 'system', content: `【先前對話摘要】\n${chat.summary}` });
 
    let msgs = visible(chat).filter(m => !m.error && (m.role === 'user' || m.role === 'assistant'));
    if (opts.upToId) {
      const i = msgs.findIndex(m => m.id === opts.upToId);
      if (i > -1) msgs = msgs.slice(0, i + 1);
    }
    if (opts.excludeId) msgs = msgs.filter(m => m.id !== opts.excludeId);
    if (chat.summarizedUpTo) msgs = msgs.slice(chat.summarizedUpTo);
    if (s.historyLimit > 0) msgs = msgs.slice(-s.historyLimit);
 
    const allowVision = Models.supportsVision(opts.modelId || Models.resolve(chat.model));
 
    msgs.forEach(m => {
      const content = (m.attachments?.length)
        ? Files.toApiContent(m.content, m.attachments, allowVision)
        : m.content;
      if (typeof content === 'string' && !content.trim()) return;
      out.push({ role: m.role, content });
    });
 
    return out;
  }
 
  /* ------------------------------ 匯出 API ---------------------------- */
 
  return {
    load, save, raw, list, current, currentIdOf, find, findRaw, sorted,
    foldersList, foldersAll, setFolders,
    visible, normalize, normalizeFolder, upsertRaw, ensureCurrentValid, purgeTombstones,
    absorbRemote,
    messagesSignature, sidebarSignature,
    create, update, remove, switchTo, duplicate, togglePin, toggleArchive, clearMessages, branch,
    addMessage, updateMessage, removeMessage, truncateAfter, toggleBookmark,
    createFolder, updateFolder, removeFolder, moveToFolder,
    moveFolder, reorderFolders, normalizeFolderOrder,
    makePermanent, makeTemporary, temporaryList, hasTemporaryContent,
    search, stats, globalStats, buildApiMessages,
    hash32, deviceId: () => DEVICE_ID, softMode,
  };
})();