/* =============================================================================
 * utils.js — 與框架無關的工具函式集合（掛在 window.U）
 * ============================================================================= */

window.U = (() => {

  /* ------------------------------- DOM ---------------------------------- */

  /** querySelector 簡寫 */
  const $ = (sel, root = document) => root.querySelector(sel);

  /** querySelectorAll 簡寫（回傳真陣列） */
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * 建立元素
   * @param {string} tag        標籤名，可帶 class：'div.foo.bar'
   * @param {object} props      屬性（class / text / html / dataset / on* 事件）
   * @param {Array}  children   子節點
   */
  function el(tag, props = {}, children = []) {
    const [name, ...classes] = tag.split('.');
    const node = document.createElement(name);
    if (classes.length) node.className = classes.join(' ');

    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') node.className += (node.className ? ' ' : '') + v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** HTML 轉義（防 XSS，所有使用者/模型輸出都要經過） */
  function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** 轉義成可放進屬性的字串 */
  function escapeAttr(str = '') {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ------------------------------ 通用 ---------------------------------- */

  const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const nowISO = () => new Date().toISOString();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const deepClone = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

  /** 防抖 */
  function debounce(fn, wait = 250) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
  }

  /** 節流（保證最後一次會執行） */
  function throttle(fn, wait = 80) {
    let last = 0, timer = null, lastArgs = null;
    return (...a) => {
      lastArgs = a;
      const now = Date.now();
      if (now - last >= wait) { last = now; fn(...a); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, wait - (now - last));
      }
    };
  }

  /* ------------------------------ 格式化 -------------------------------- */

  /** 12:34 */
  const formatTime = iso => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

  /** 2024/01/01 12:34 */
  const formatDateTime = iso => new Date(iso).toLocaleString('zh-TW', { hour12: false });

  const p2 = n => String(n).padStart(2, '0');

  /** 2024/01/01 12:34（訊息列用：日期＋時間，跨時區安全） */
  function formatStamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ` +
           `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  /** 0.4 秒 / 42 秒 / 1 分 32 秒 / 1 小時 5 分 */
  function formatDuration(ms = 0) {
    ms = Math.max(0, Math.round(ms));
    if (ms < 1000) return `${(ms / 1000).toFixed(1)} 秒`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec} 秒`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分`;
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h} 小時 ${mm} 分` : `${h} 小時`;
  }

  /** 相對時間：剛剛 / 5 分鐘前 / 3 天前 */
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return '剛剛';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
    return new Date(iso).toLocaleDateString('zh-TW');
  }

  /** 位元組轉可讀字串 */
  function formatBytes(b = 0) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(2)} MB`;
  }

  /** 千分位 */
  const formatNum = n => (n ?? 0).toLocaleString('en-US');

  /** 美金金額（極小值用科學記號友善顯示） */
  function formatCost(usd) {
    if (!usd) return '$0';
    if (usd < 0.0001) return `$${usd.toExponential(2)}`;
    if (usd < 1) return `$${usd.toFixed(5)}`;
    return `$${usd.toFixed(3)}`;
  }

  /**
   * 粗略估算 token 數。
   * 中日韓字元約 1 token/字，其他語言約 4 字元/token。
   * 僅用於 UI 提示，實際數字以 API usage 為準。
   */
  function estimateTokens(text = '') {
    if (!text) return 0;
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
    const other = text.length - cjk;
    return Math.ceil(cjk * 1.1 + other / 4);
  }

  /** 截斷字串 */
  const truncate = (s = '', n = 60) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

  /* ------------------------------ 檔案 ---------------------------------- */

  const readAsText = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });

  const readAsDataURL = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  /** 下載一個 Blob */
  function download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** 選擇本機檔案（回傳 File 或 null） */
  function pickFile(accept = '*/*') {
    return new Promise(res => {
      const input = el('input', { type: 'file', accept, class: 'hidden' });
      input.onchange = () => { res(input.files[0] || null); input.remove(); };
      document.body.appendChild(input);
      input.click();
    });
  }

  /** 複製到剪貼簿（含舊瀏覽器 fallback） */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = el('textarea', { class: 'hidden' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  /** 檔名安全化 */
  const safeFilename = (s = 'file') => s.replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 80) || 'file';

  /** 取副檔名（小寫） */
  const extOf = name => (name.split('.').pop() || '').toLowerCase();

  /* ------------------------------ 其他 ---------------------------------- */

  /** 在文字中把關鍵字標成 <mark>（輸入需先轉義） */
  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const safe = escapeHtml(text);
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), m => `<mark>${m}</mark>`);
  }

  /** 用 WebAudio 播一聲簡短提示音（不需外部檔案） */
  function beep(freq = 660, ms = 120) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, ms);
    } catch { /* 忽略：部分瀏覽器需使用者互動後才可播音 */ }
  }

  /** 依 key 分組 */
  function groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
      const k = keyFn(item);
      (acc[k] ||= []).push(item);
      return acc;
    }, {});
  }

  return {
    $, $$, el, escapeHtml, escapeAttr,
    uid, nowISO, sleep, clamp, deepClone, debounce, throttle,
    formatTime, formatDateTime, formatStamp, formatDuration, timeAgo, formatBytes, formatNum, formatCost,
    estimateTokens, truncate,
    readAsText, readAsDataURL, download, pickFile, copy, safeFilename, extOf,
    highlight, beep, groupBy,
  };
})();