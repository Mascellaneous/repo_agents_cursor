/* =====================================================================
 * GitHub-sync.js — 雲端同步
 * ---------------------------------------------------------------------
 * 功能：
 *  1. 頁面載入後自動自 GitHub 下載並【完全取代】本地資料庫。
 *  2. 任何編輯（儲存／刪除／復原／排序／匯入／還原／清空）完成後自動上傳。
 *  3. 「Auto-sync」核取方塊可暫時停用／啟用自動上傳（偏好存於 localStorage）。
 *  4. 下載時執行資料檢查：捨棄無 id 記錄、依 id 去除重複、正規化欄位格式；
 *     寫入前先清空各 store → 完全取代、絕不產生重複記錄。
 *  5. 本地有未上傳變更（dirty）時，自動下載會自動略過／改為上傳，保護較新資料。
 * ===================================================================== */
 
const AUTO_SYNC_PREF_KEY = 'sdg-autosync-enabled';
const AUTO_SYNC_DEBOUNCE_MS = 1500;
let _ghBusy = false;            // 上傳互斥鎖（避免手動＋自動同時 PUT 造成 SHA 衝突）
let _autoSyncTimer = null;
 
function ghValid() {
    return GitHub_Config.username && GitHub_Config.repo && GitHub_Config.path && GitHub_Config.token &&
           !['XXXXX', 'YYYYY', 'ZZZZZ'].includes(GitHub_Config.token);
}
function setSync(msg, isErr) {
    const el = gi('sync-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isErr ? '#dc3545' : '#666';
}
 
/* ================= 本地「有未同步變更」標記 ================= */
function markLocalDirty()  { try { db.putMeta('localDirty', true);  } catch (_) {} }
function clearLocalDirty() { try { db.putMeta('localDirty', false); } catch (_) {} }
 
/* ================= Auto-sync 開關 ================= */
function autoSyncEnabled() {
    const cb = gi('auto-sync');
    if (cb) return cb.checked;
    try { return localStorage.getItem(AUTO_SYNC_PREF_KEY) !== '0'; } catch (_) { return true; }
}
function initAutoSyncCheckbox() {
    const cb = gi('auto-sync');
    if (!cb || cb._autoInit) return;
    cb._autoInit = true;
    let pref = true;
    try { pref = localStorage.getItem(AUTO_SYNC_PREF_KEY) !== '0'; } catch (_) {}
    cb.checked = pref;
    cb.addEventListener('change', () => {
        try { localStorage.setItem(AUTO_SYNC_PREF_KEY, cb.checked ? '1' : '0'); } catch (_) {}
        setSync(cb.checked ? 'Auto-sync：開（編輯後自動上傳）' : 'Auto-sync：關（僅能手動上傳）');
    });
}
 
/* ================= 自動上傳（防抖） ================= */
function scheduleAutoSync(reason) {
    markLocalDirty();                       // 無論開關，先記錄「本地有未同步變更」
    if (!autoSyncEnabled()) return;
    if (!ghValid()) return;
    clearTimeout(_autoSyncTimer);
    _autoSyncTimer = setTimeout(() => autoPushToGitHub(reason), AUTO_SYNC_DEBOUNCE_MS);
}
async function autoPushToGitHub(reason) {
    if (_ghBusy) { scheduleAutoSync((reason || 'edit') + '-retry'); return; }  // 上傳中 → 稍後重試
    console.log('[Auto-sync] 自動上傳（' + (reason || 'edit') + '）');
    await pushToGitHub(true);
}
 
/* ================= Payload 組裝 ================= */
async function buildPayload() {
    const data = await gatherAll();
    const ts = Date.now();
    await db.putMeta('lastExportTime', ts);
    return {
        exportInfo: {
            exportDate: new Date(ts).toISOString(),
            source: APP_NAME + ' — GitHub Sync',
            counts: {
                units: data.units.length, characters: data.characters.length,
                supports: data.supports.length, optionalParts: (data.optionalParts || []).length,
                stages: (data.stages || []).length
            }
        },
        ...data
    };
}
 
/* ================= 上傳核心 ================= */
async function pushToGitHub(silent) {
    if (_ghBusy) {
        if (!silent) setSync('上傳作業進行中，請稍候…', true);
        return false;
    }
    if (!ghValid()) {
        if (silent) setSync('GitHub 設定不完整，略過自動上傳', true);
        else alert('GitHub 設定不完整，請修改 api.js 內的 GitHub_Config。');
        return false;
    }
    _ghBusy = true;
    const btn = gi('gh-up');
    const oldTxt = btn ? btn.textContent : '';
    if (!silent && btn) { btn.textContent = '上傳中…'; btn.disabled = true; }
    setSync(silent ? '正在自動上傳至 GitHub…' : '正在上傳至 GitHub…');
    try {
        const payload = await buildPayload();
        const body = {
            message: `Update ${APP_NAME} — ${new Date().toISOString()}`,
            content: encodeBase64(JSON.stringify(payload, null, 2)),
            branch: GitHub_Config.branch || 'main'
        };
        const sha = await ghSha();
        if (sha) body.sha = sha;
        const url = `https://api.github.com/repos/${GitHub_Config.username}/${GitHub_Config.repo}/contents/${GitHub_Config.path}`;
        const r = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GitHub_Config.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error((await r.json()).message || r.statusText);
        clearLocalDirty();
        setSync(`上次上傳：${new Date().toLocaleTimeString()}${silent ? '（自動）' : ''}`);
        return true;
    } catch (err) {
        console.error(err);
        setSync('上傳失敗：' + err.message, true);
        if (!silent) alert('上傳失敗：' + err.message);
        return false;
    } finally {
        _ghBusy = false;
        if (btn) { btn.textContent = oldTxt; btn.disabled = false; }
    }
}
async function syncToGitHub() {
    clearTimeout(_autoSyncTimer);           // 手動上傳時取消排程中的自動上傳（內容相同，避免浪費）
    return pushToGitHub(false);
}
 
/* ================= 取得遠端檔案 ================= */
async function ghSha() {
    const br = GitHub_Config.branch || 'main';
    const url = `https://api.github.com/repos/${GitHub_Config.username}/${GitHub_Config.repo}/contents/${GitHub_Config.path}?ref=${br}`;
    const r = await fetch(url, {
        headers: { 'Authorization': `token ${GitHub_Config.token}`, 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store'
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('無法取得遠端檔案資訊');
    return (await r.json()).sha;
}
 
async function fetchRemotePayload() {
    const br = GitHub_Config.branch || 'main';
    const url = `https://api.github.com/repos/${GitHub_Config.username}/${GitHub_Config.repo}/contents/${GitHub_Config.path}?ref=${br}`;
    const r = await fetch(url, {
        headers: { 'Authorization': `token ${GitHub_Config.token}`, 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store'
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GitHub API 錯誤：' + r.statusText);
    const meta = await r.json();
    let b64;
    const ONE_MB = 1000000;
    if (meta.size > ONE_MB || (meta.sha && !meta.content)) {
        const bu = meta.git_url ||
            `https://api.github.com/repos/${GitHub_Config.username}/${GitHub_Config.repo}/git/blobs/${meta.sha}`;
        const br2 = await fetch(bu, {
            headers: { 'Authorization': `token ${GitHub_Config.token}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!br2.ok) throw new Error('Blob API 錯誤：' + br2.statusText);
        b64 = (await br2.json()).content;
    } else b64 = meta.content;
    return JSON.parse(decodeBase64(b64));
}
 
/* ================= 資料檢查與正規化（★ 下載時雙重檢查） ================= */
 
/* 武裝項目正規化：相容舊格式（純字串等級）→ 統一為物件；不合法值歸「-」或未設定 */
function normalizeWeaponEntry(w) {
    if (w === '-' || w === undefined || w === null || w === '') return '-';
    if (typeof w === 'object') {
        const lv = String(w.level ?? '');
        if (!WEAPON_LEVELS.includes(lv)) return '-';
        return {
            level: lv,
            map: (w.map === 'Y' || w.map === 'N') ? w.map : '',
            range: WEAPON_RANGE_OPTS.includes(String(w.range)) ? String(w.range) : '',
            mp: WEAPON_MP_OPTS.includes(w.mp) ? w.mp : '',
            attrs: Array.isArray(w.attrs) ? w.attrs.filter(a => WEAPON_ATTRS.includes(a)) : []
        };
    }
    const lv = String(w);
    return WEAPON_LEVELS.includes(lv)
        ? { level: lv, map: '', range: '', mp: '', attrs: [] }
        : '-';
}
 
/* 單位記錄正規化 */
function normalizeUnitRecord(u) {
    const w = {};
    for (let i = 1; i <= 5; i++) w[i] = normalizeWeaponEntry(u.weapons ? u.weapons[i] : undefined);
    u.weapons = w;
    ['shield', 'size2x2', 'escape', 'sp', 'ssp', 'limited', 'transformable'].forEach(k => {
        u[k] = (u[k] === 'Y') ? 'Y' : 'N';
    });
    if (!Array.isArray(u.series)) u.series = [];
    if (!Array.isArray(u.tags))   u.tags = [];
    /* 變型目標 */
    if (typeof u.transformedId !== 'string' || !u.transformedId) u.transformedId = null;
    if (typeof u.transformedName !== 'string') u.transformedName = '';
    if (u.transformable !== 'Y') { u.transformedId = null; u.transformedName = ''; }
    /* ★ 逃生目標 */
    if (typeof u.escapedId !== 'string' || !u.escapedId) u.escapedId = null;
    if (typeof u.escapedName !== 'string') u.escapedName = '';
    if (u.escape !== 'Y') { u.escapedId = null; u.escapedName = ''; }
    /* 地形 */
    if (!u.terrain || typeof u.terrain !== 'object') u.terrain = {};
    TERRAINS.forEach(([_, k]) => {
        const v = u.terrain[k];
        u.terrain[k] = Object.prototype.hasOwnProperty.call(TERRAIN_OPTS, v) ? v : '-';
    });
    return u;
}
 
/* 記錄檢查：捨棄無 id／格式錯誤者；依 id 去除重複（僅保留第一筆）→ 絕不產生重複記錄 */
function sanitizeRecords(arr, kind) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of arr) {
        if (!raw || typeof raw !== 'object') continue;
        if (raw.id === undefined || raw.id === null || String(raw.id).trim() === '') continue;
        const id = String(raw.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const r = { ...raw, id };
        if (!r.name) r.name = '(未命名)';
        if (kind === 'units') normalizeUnitRecord(r);
        if (kind === 'supports') r.rarity = (typeof SUPPORT_RARITIES !== 'undefined' && SUPPORT_RARITIES.includes(r.rarity)) ? r.rarity : '';
        out.push(r);
    }
    return out;
}
 
/* ================= 套用遠端資料（完全取代本地） ================= */
async function applyRemoteData(obj, opts = {}) {
    const silent = !!opts.silent;
    if (!obj || typeof obj !== 'object') throw new Error('遠端資料格式不正確');
    const U = sanitizeRecords(obj.units, 'units');
    const C = sanitizeRecords(obj.characters, 'characters');
    const S = sanitizeRecords(obj.supports, 'supports');
    const hasOP = Object.prototype.hasOwnProperty.call(obj, 'optionalParts');
    const OP = (hasOP && typeof sanitizeOptionalParts === 'function') ? sanitizeOptionalParts(obj.optionalParts) : null;
    const hasST = Object.prototype.hasOwnProperty.call(obj, 'stages');
    const ST = (hasST && typeof sanitizeStages === 'function') ? sanitizeStages(obj.stages) : null;

    if (!silent) {
        const extra = (OP ? `、選擇性零件 ${OP.length}` : '') + (ST ? `、關卡 ${ST.length}` : '');
        const keep = [];
        if (!OP) keep.push('遠端沒有選擇性零件欄，本地零件會保留');
        if (!ST) keep.push('遠端沒有關卡資料欄，本地關卡會保留');
        const keepLine = keep.length ? `（${keep.join('；')}）` : '';
        const msg = `下載成功：單位 ${U.length}、角色 ${C.length}、支援單位 ${S.length}${extra}。${keepLine}\n\n` +
                    `⚠ 將【完全取代】本地資料庫：\n` +
                    `・相同 ID → 以雲端版本覆蓋\n` +
                    `・雲端已刪除的記錄 → 本地一併移除\n` +
                    `（已檢查並去除重複記錄）\n\n繼續？`;
        if (!confirm(msg)) { setSync('已取消下載'); return null; }
    }
 
    /* 完全取代：先清空三個 store，再寫入檢查過的資料 */
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
    if (ST) {
        await db.clearStore('stages');
        if (ST.length) await db.bulkPut('stages', ST);
        cache.stages = null;
        await getAll('stages');
        if (typeof renderStagesIfOpen === 'function') renderStagesIfOpen();
    }

    /* 本地「上次匯出時間」對齊遠端；下載後本地＝雲端，清除 dirty 標記 */
    const remoteTs = obj.exportInfo ? new Date(obj.exportInfo.exportDate).getTime() : Date.now();
    await db.putMeta('lastExportTime', Number.isNaN(remoteTs) ? Date.now() : remoteTs);
    clearLocalDirty();
 
    await Promise.all(TYPES.map(t => getAll(t)));
    await refreshSeriesOptions();
    TYPES.forEach(t => RENDER[t]());
    updateStorageStatus();
    return { units: U.length, characters: C.length, supports: S.length, optionalParts: OP ? OP.length : null, stages: ST ? ST.length : null };
}
 
/* ================= 手動：自 GitHub 下載 ================= */
async function syncFromGitHub() {
    if (!ghValid()) { alert('GitHub 設定不完整，請修改 api.js 內的 GitHub_Config。'); return; }
    const btn = gi('gh-dn'), oldTxt = btn.textContent;
    btn.textContent = '下載中…'; btn.disabled = true;
    setSync('正在自 GitHub 下載…');
    try {
        const obj = await fetchRemotePayload();
        if (!obj) { setSync('遠端尚無資料檔', true); alert('GitHub 上尚無資料檔。'); return; }
 
        /* ★ 邏輯雙重檢查：遠端比本地舊時提出警告 */
        const lastLocal = (await db.getMeta('lastExportTime')) || 0;
        const remoteTs = obj.exportInfo ? new Date(obj.exportInfo.exportDate).getTime() : 0;
        if (lastLocal && remoteTs && remoteTs < lastLocal) {
            const ok = confirm(`警告：GitHub 上的資料比本地上次匯出更舊。\n` +
                `本地：${new Date(lastLocal).toLocaleString()}\n雲端：${new Date(remoteTs).toLocaleString()}\n` +
                `仍要繼續（完全取代本地）嗎？`);
            if (!ok) { setSync('已取消下載'); return; }
        }
        const res = await applyRemoteData(obj, { silent: false });
        if (res) {
            setSync(`上次下載：${new Date().toLocaleTimeString()}`);
            alert(`同步完成！\n單位 ${res.units}\n角色 ${res.characters}\n支援單位 ${res.supports}` +
                (res.stages == null ? '' : `\n關卡 ${res.stages}`));
        }
    } catch (err) {
        console.error(err); setSync('下載失敗', true); alert('下載失敗：' + err.message);
    } finally { btn.textContent = oldTxt; btn.disabled = false; }
}
 
/* ================= 自動：頁面載入時下載 ================= */
async function autoDownloadFromGitHub() {
    if (!ghValid()) { setSync('未設定 GitHub — 無法自動同步'); return; }
    try {
        /* ★ 邏輯檢查：本地有未上傳的變更 → 不自動下載（避免洗掉較新的本地資料） */
        const dirty = await db.getMeta('localDirty');
        if (dirty) {
            if (autoSyncEnabled()) {
                setSync('偵測到未上傳的本地變更 — 改為自動上傳…');
                await autoPushToGitHub('startup-dirty');
            } else {
                setSync('本地有未上傳的變更 — 已略過自動下載（請手動上傳）', true);
            }
            return;
        }
 
        setSync('正在自動下載 GitHub 資料…');
        const obj = await fetchRemotePayload();
        if (!obj) { setSync('遠端尚無資料檔（略過自動下載）'); return; }
 
        /* ★ 邏輯檢查：本地有資料且遠端較舊 → 略過，避免覆蓋較新的本地資料 */
        const lastLocal = (await db.getMeta('lastExportTime')) || 0;
        const remoteTs = obj.exportInfo ? new Date(obj.exportInfo.exportDate).getTime() : 0;
        const locals = await Promise.all(TYPES.map(t => db.getAll(t)));
        const localEmpty = locals.every(a => !a || !a.length);
        if (!localEmpty && lastLocal && remoteTs && remoteTs < lastLocal) {
            setSync('遠端資料較本地舊，已略過自動下載', true);
            console.warn('[Auto-sync] 遠端資料比本地舊，略過自動下載');
            return;
        }
 
        const res = await applyRemoteData(obj, { silent: true });
        if (res) {
            setSync(`啟動自動下載完成：${new Date().toLocaleTimeString()}`);
            showToast(`已自 GitHub 下載並取代本地資料（單位 ${res.units}／角色 ${res.characters}／支援單位 ${res.supports}` +
                (res.stages == null ? '' : `／關卡 ${res.stages}`) + `）`, false);
        }
    } catch (err) {
        console.error(err);
        setSync('自動下載失敗：' + err.message, true);
    }
}