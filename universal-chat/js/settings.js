/* =============================================================================
 * settings.js — 設定的儲存、讀取、與 DOM 自動雙向綁定
 * -----------------------------------------------------------------------------
 *   • 單一資料來源：DEFAULT_SETTINGS 決定所有 key 與型別。
 *   • HTML 只要寫 data-setting="temperature" 就會自動綁定。
 *   • data-type="array" 可把「a, b, c」字串轉成陣列。
 *   • SECRET_SETTINGS 列出的鍵改存在專用位置，永不寫進 orpc:settings。
 * v2.4.3：
 *   • persist 不再在這裡 debounce —— 直接寫進 Store cache（O(1)），
 *     pagehide 的 Store.flushNow() 才涵蓋得到最後一刻的設定變更。
 *   • bindDom() 會自動把 .field > label 與控制項用 for/id 關聯（無障礙）。
 *   • 新增 absorbRemote()：其他分頁改了設定時，把變更併回本分頁並觸發訂閱。
 * ============================================================================= */
 
window.Settings = (() => {
 
  let data = {};
  const listeners = { '*': [] };
 
  const secretKeys = () => Object.keys(SECRET_SETTINGS);
 
  /* ------------------------------ 載入 / 儲存 -------------------------- */
 
  function load() {
    const saved = Store.get(STORAGE_KEYS.settings, {});
    data = { ...U.deepClone(DEFAULT_SETTINGS), ...saved };
    secretKeys().forEach(k => { data[k] = Store.getSecret(SECRET_SETTINGS[k], data.keyStorage); });
    return data;
  }
 
  /** 直接寫進 Store（Store 自行 debounce 寫入 IndexedDB）。
      舊版這裡再 debounce 200ms，pagehide 的 flushNow 涵蓋不到，
      關閉分頁前最後一刻改的設定會直接消失。 */
  function persistNow() {
    const rest = { ...data };
    secretKeys().forEach(k => delete rest[k]);
    Store.set(STORAGE_KEYS.settings, rest);
  }
 
  /* ------------------------------ 讀 / 寫 ----------------------------- */
 
  const get = k => data[k];
  const all = () => data;
 
  function set(key, value, silent = false) {
    if (data[key] === value) return;
    data[key] = value;
 
    if (SECRET_SETTINGS[key]) Store.setSecret(SECRET_SETTINGS[key], value, data.keyStorage);
    if (key === 'keyStorage') {
      secretKeys().forEach(k => Store.setSecret(SECRET_SETTINGS[k], data[k], value));
    }
 
    persistNow();
    if (!silent) emit(key, value);
  }
 
  function patch(obj) { Object.entries(obj).forEach(([k, v]) => set(k, v)); }
 
  /** 重設為預設值（保留所有金鑰） */
  function reset() {
    const keep = {};
    secretKeys().forEach(k => (keep[k] = data[k]));
    data = { ...U.deepClone(DEFAULT_SETTINGS), ...keep };
    persistNow();
    emit('*', data);
    syncDom();
  }
 
  /* ------------------------------ 事件 -------------------------------- */
 
  function on(key, fn) { (listeners[key] ||= []).push(fn); return () => off(key, fn); }
  function off(key, fn) { listeners[key] = (listeners[key] || []).filter(f => f !== fn); }
  function emit(key, value) {
    (listeners[key] || []).forEach(f => { try { f(value, key); } catch (e) { console.error(e); } });
    if (key !== '*') listeners['*'].forEach(f => { try { f(value, key); } catch (e) { console.error(e); } });
  }
 
  /* --------------------- 多分頁一致性 ------------------------ */
 
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
 
  /**
   * 其他分頁改了設定（Store 收到廣播後呼叫）：把 IDB 最新值併回本分頁的
   * data 並逐鍵觸發訂閱（主題、供應商、渲染選項…會自動反應）。
   * 不寫回 Store —— IDB 已是最新版，寫回會讓兩個分頁互相觸發無限迴圈。
   *
   * 排除：
   *   • keyStorage：金鑰實體存放位置牽涉 sessionStorage／記憶體，不宜單方面跟隨。
   *   • _ 開頭的內部旗標（_modelMigrated 等）：避免無謂的遷移邏輯被觸發。
   */
  function absorbRemote() {
    const remote = Store.get(STORAGE_KEYS.settings, null);
    if (!remote || typeof remote !== 'object') return false;
    const changed = [];
    Object.entries(remote).forEach(([k, v]) => {
      if (k === 'keyStorage' || k.startsWith('_')) return;
      if (!same(data[k], v)) { data[k] = v; changed.push(k); }
    });
    if (!changed.length) return false;
    changed.forEach(k => emit(k, data[k]));
    syncDom();
    return true;
  }
 
  /* --------------------------- DOM 自動綁定 --------------------------- */
 
  /** 無障礙：把 .field > label 與其中的控制項自動用 for/id 關聯，
      螢幕閱讀器才唸得出欄位名稱（HTML 是靜態的，綁定前跑一次即可）。 */
  function associateLabels() {
    let seq = 0;
    U.$$('.field').forEach(field => {
      const label = field.querySelector(':scope > label');
      if (!label || label.htmlFor) return;
      const control = field.querySelector('input:not([type="hidden"]), select, textarea');
      if (!control) return;
      if (!control.id) control.id = `fld-auto-${++seq}`;
      label.htmlFor = control.id;
    });
  }
 
  function readInput(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.dataset.type === 'array') {
      return input.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    }
    if (input.type === 'number' || input.type === 'range') {
      if (input.value === '') return null;
      return Number(input.value);
    }
    return input.value;
  }
 
  function writeInput(input, value) {
    if (input.type === 'checkbox') input.checked = !!value;
    else if (input.dataset.type === 'array') input.value = Array.isArray(value) ? value.join(', ') : (value || '');
    else input.value = value ?? '';
  }
 
  function bindDom() {
    associateLabels();
    U.$$('[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      writeInput(input, data[key]);
      const evt = (input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'color' || input.type === 'range')
        ? 'input' : 'change';
      input.addEventListener(evt, () => { set(key, readInput(input)); updateOut(key); });
      if (input.tagName === 'TEXTAREA' || input.type === 'text' || input.type === 'password' || input.type === 'number') {
        input.addEventListener('input', U.debounce(() => { set(key, readInput(input)); updateOut(key); }, 400));
      }
    });
    syncDom();
  }
 
  function updateOut(key) {
    U.$$(`[data-out="${key}"]`).forEach(o => { o.textContent = data[key]; });
  }
 
  function syncDom() {
    U.$$('[data-setting]').forEach(input => writeInput(input, data[input.dataset.setting]));
    U.$$('[data-out]').forEach(o => { o.textContent = data[o.dataset.out]; });
  }
 
  return { load, get, all, set, patch, reset, on, off, absorbRemote, bindDom, syncDom };
})();