/* =============================================================================
 * files.js — 附件處理
 * -----------------------------------------------------------------------------
 * 功能：
 *   • 拖放 / 選檔 / 剪貼簿貼上
 *   • 文字檔 → 讀成字串，於送出時包成 ```檔名 ... ``` 附在提示詞後
 *   • 圖片 → 轉 dataURL，若模型支援 vision 就以 image_url 送出
 *   • 大小 / 字數上限、預覽 chip、移除
 *   • 附件列可收合：摘要列永遠一行，檔案多時不再推擠聊天區
 * v2.4.3：
 *   • toApiContent() 跳過「stripped」的附件（關閉「保存附件內容」時被剝除），
 *     不再把字面 "undefined" 或 image_url: { url: undefined } 送給模型。
 *     編輯重送、重新生成、分支都會踩到，所以在這裡統一過濾。
 * 對外主要 API：Files.take() 取出並清空目前附件
 * ============================================================================= */
 
window.Files = (() => {
 
  let pending = [];                                  // 尚未送出的附件
 
  /* ---- 附件列收合狀態（僅本次工作階段；使用者手動切換過就尊重其選擇） ---- */
  let collapsed = false;
  let userToggled = false;
  const AUTO_COLLAPSE_AT = 9;                        // 超過此數量且尚未手動切換 → 自動收合
  const PEEK_COUNT = 3;                              // 收合時仍直接可見的前幾個
 
  /* ------------------------------ 判斷型別 ---------------------------- */
 
  const isImage = f => f.type.startsWith('image/');
  const isTextLike = f =>
    f.type.startsWith('text/') ||
    /json|xml|javascript|csv|yaml|x-sh|sql/.test(f.type) ||
    TEXT_EXTENSIONS.includes(U.extOf(f.name));
 
  /* ------------------------------ 加入檔案 ---------------------------- */
 
  /**
   * @param {FileList|File[]} fileList
   */
  async function add(fileList) {
    const s = Settings.all();
    const maxBytes = s.maxFileSizeMB * 1024 * 1024;
 
    for (const file of Array.from(fileList || [])) {
      if (file.size > maxBytes) {
        Toast.warn(`「${file.name}」超過 ${s.maxFileSizeMB} MB，已略過`);
        continue;
      }
      if (pending.some(a => a.name === file.name && a.size === file.size)) continue;   // 去重
 
      try {
        if (isImage(file)) {
          const dataUrl = await U.readAsDataURL(file);
          pending.push({ id: U.uid('att'), kind: 'image', name: file.name, size: file.size, type: file.type, dataUrl });
        } else if (isTextLike(file)) {
          let text = await U.readAsText(file);
          let truncated = false;
          if (text.length > s.maxTextChars) { text = text.slice(0, s.maxTextChars); truncated = true; }
          pending.push({ id: U.uid('att'), kind: 'text', name: file.name, size: file.size, type: file.type || 'text/plain', text, truncated });
        } else {
          Toast.warn(`不支援的檔案類型：${file.name}（僅支援文字與圖片）`);
        }
      } catch (e) {
        Toast.error(`讀取「${file.name}」失敗：${e.message}`);
      }
    }
    renderChips();
  }
 
  /* --------------------------- 預覽（可收合） -------------------------- */
 
  function renderChips() {
    const box = U.$('#attachment-list');
    if (!box) return;
    box.innerHTML = '';
    box.classList.toggle('hidden', pending.length === 0);
    if (!pending.length) { UI?.updateTokenCounter?.(); return; }
 
    if (pending.length >= AUTO_COLLAPSE_AT && !userToggled) collapsed = true;
 
    const total = pending.reduce((n, a) => n + (a.size || 0), 0);
 
    /* ---- 摘要列：永遠只有一行，點擊切換收合／展開 ---- */
    const head = U.el('button.attachments__head', {
      type: 'button',
      title: collapsed ? '展開附件清單' : '收合附件清單',
      'aria-expanded': String(!collapsed),
      'aria-label': `附件列：共 ${pending.length} 個附件，${U.formatBytes(total)}`,
      onclick: () => { userToggled = true; collapsed = !collapsed; renderChips(); },
    });
    head.appendChild(U.el('span', {
      text: `${collapsed ? '▸' : '▾'} 📎 ${pending.length} 個附件 · ${U.formatBytes(total)}`,
    }));
    head.appendChild(U.el('span.attachments__toggle-hint', { text: collapsed ? '展開' : '收合' }));
    box.appendChild(head);
 
    /* ---- 內容格：收合時只秀前幾個 +「+N」；展開時全部、超高可捲動 ---- */
    const grid = U.el('div.attachments__grid');
    const shown = collapsed ? pending.slice(0, PEEK_COUNT) : pending;
    shown.forEach(att => grid.appendChild(chipNode(att)));
    if (collapsed && pending.length > shown.length) {
      grid.appendChild(U.el('button.attachments__more', {
        type: 'button',
        text: `+${pending.length - shown.length}`,
        title: '展開全部附件',
        'aria-label': `展開其餘 ${pending.length - shown.length} 個附件`,
        onclick: () => { userToggled = true; collapsed = false; renderChips(); },
      }));
    }
    box.appendChild(grid);
 
    UI?.updateTokenCounter?.();
  }
 
  function chipNode(att) {
    const chip = U.el('div.file-chip', { title: att.name });
    if (att.kind === 'image') chip.appendChild(U.el('img', { src: att.dataUrl, alt: att.name }));
    else chip.appendChild(U.el('span', { text: iconFor(att.name) }));
 
    chip.appendChild(U.el('span.name', { text: att.name }));
    chip.appendChild(U.el('span.size', { text: U.formatBytes(att.size) + (att.truncated ? ' · 已截斷' : '') }));
    chip.appendChild(U.el('button.rm', {
      text: '✕', title: '移除', 'aria-label': `移除附件 ${att.name}`,
      onclick: () => remove(att.id),
    }));
    return chip;
  }
 
  const iconFor = name => {
    const e = U.extOf(name);
    if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rs','rb','php'].includes(e)) return '📜';
    if (['json','yml','yaml','xml','toml','ini'].includes(e)) return '🧾';
    if (['csv','tsv','xls','xlsx'].includes(e)) return '📊';
    if (['md','txt','log'].includes(e)) return '📄';
    return '📎';
  };
 
  function remove(id) {
    pending = pending.filter(a => a.id !== id);
    renderChips();
  }
 
  function clear() { collapsed = false; userToggled = false; pending = []; renderChips(); }
 
  /** 取出附件並清空（送出訊息時呼叫） */
  function take() {
    const out = pending;
    pending = [];
    renderChips();
    return out;
  }
 
  const list = () => pending;
 
  /** 附件的粗估 token 數（給輸入框計數器） */
  function estimateTokens() {
    return pending.reduce((n, a) =>
      n + (a.kind === 'text' ? U.estimateTokens(a.text) : 800), 0);       // 圖片粗估 800
  }
 
  /* --------------------------------------------------------------------
   * 把附件轉成 API 的 content
   * @param {string} text          使用者輸入
   * @param {Array}  attachments   附件
   * @param {boolean} allowVision  模型是否支援圖片
   * @returns {string|Array}       字串或 multi-part 陣列
   *
   * v2.4.3：「stripped」的附件（storeAttachments=false 時被剝除）沒有實際
   * 內容——文字範本的 ${a.text} 會輸出字面的 "undefined"、圖片會產生
   * image_url: { url: undefined } 讓整個請求失敗。一律過濾並附註說明。
   * ------------------------------------------------------------------ */
  function toApiContent(text, attachments = [], allowVision = true) {
    const texts  = attachments.filter(a => a.kind === 'text'  && !a.stripped && typeof a.text === 'string');
    const images = attachments.filter(a => a.kind === 'image' && !a.stripped && typeof a.dataUrl === 'string');
    const stripped = attachments.length - texts.length - images.length;
 
    let merged = text || '';
    if (stripped > 0) {
      merged += `\n\n（另有 ${stripped} 個附件的內容未保存在此瀏覽器，無法一併送出。）`;
    }
    if (texts.length) {
      merged += '\n\n' + texts.map(a =>
        `【附件：${a.name}${a.truncated ? '（內容已截斷）' : ''}】\n\`\`\`${U.extOf(a.name)}\n${a.text}\n\`\`\``
      ).join('\n\n');
    }
 
    const useVision = allowVision && Settings.get('visionEnabled') && images.length > 0;
    if (!useVision) {
      if (images.length) merged += `\n\n（附有 ${images.length} 張圖片，但目前模型或設定不支援影像輸入）`;
      return merged.trim();
    }
 
    return [
      { type: 'text', text: merged.trim() || '請描述這些圖片。' },
      ...images.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } })),
    ];
  }
 
  /* ------------------------------ 事件綁定 ---------------------------- */
 
  function init() {
    const dz = U.$('#drop-zone');
    let depth = 0;                                    // 處理子元素 dragleave 抖動
 
    window.addEventListener('dragenter', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault(); depth++; dz.classList.remove('hidden');
    });
    window.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    window.addEventListener('dragleave', e => {
      e.preventDefault();
      if (--depth <= 0) { depth = 0; dz.classList.add('hidden'); }
    });
    window.addEventListener('drop', e => {
      e.preventDefault(); depth = 0; dz.classList.add('hidden');
      if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
    });
 
    // 選檔按鈕
    U.$('#btn-attach').onclick = () => U.$('#input-file').click();
    U.$('#input-file').onchange = e => { add(e.target.files); e.target.value = ''; };
 
    // 剪貼簿貼上圖片
    U.$('#user-input').addEventListener('paste', e => {
      if (!Settings.get('pasteImage')) return;
      const items = Array.from(e.clipboardData?.items || []).filter(i => i.type.startsWith('image/'));
      if (!items.length) return;
      e.preventDefault();
      const files = items.map(i => i.getAsFile()).filter(Boolean)
        .map(f => new File([f], f.name || `貼上圖片-${Date.now()}.png`, { type: f.type }));
      add(files);
    });
  }
 
  return { init, add, remove, clear, take, list, estimateTokens, toApiContent };
})();