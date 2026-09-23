/* =============================================================================
 * ui-messages.js — 訊息區渲染、訊息操作、滾動
 * 重繪守門：指紋沒變不動 DOM；「目前這個對話」正在生成時不整區重建
 *
 * v2.4.2 新增：
 *   • 失敗訊息的「↻ 重試」（原地替換）
 *   • 助理訊息也可「✏️ 編輯」（僅儲存，不觸發重生）
 *   • 文字附件的 ⤓ 下載鈕（stripped 的附件停用）
 *   • finishReason === 'length' 時，內容尾端顯示「⏩ 繼續生成」
 *   • 訊息書籤：操作列 🔖 切換 + 對話頂部書籤列 + Alt[/] 導航
 *
 * v2.4.3：
 *   • 圖片附件點擊開新視窗：限制只對點陣圖（png/jpg/gif/webp）開啟。
 *     image/svg+xml 在新視窗中可執行其中的 script（opaque origin 風險低但存在），
 *     改為下載而非直接瀏覽。
 *
 * v2.4.5（四向導航）：
 *   • 全域浮動「↑ 回到頂部」鈕（與既有「↓ 回到底部」同款式、垂直相鄰；
 *     向下捲超過 400px 後出現，接近頂部自動隱藏）
 *   • 每則訊息尾端的「⬇ 底部」sticky 懸浮鈕（與既有「⬆ 頂部」鏡像：
 *     包在訊息結尾、以 sticky bottom 釘在輸入區上緣）
 *   • onScroll 的顯示邏輯抽成 paintNavButtons()，同時管兩顆浮動鈕
 * ============================================================================= */
 
window.UIMessages = (() => {
 
  const R = UIState.R;
  const state = UIState.state;
 
  let bmChatId = null;                // 書籤列所屬對話；切換對話時重設游標
   /* 四向導航的「貼邊」狀態快取：只在跨越門檻的那一次才掃描／改類別，
     讓捲動中的大多數呼叫走快速路徑，不必對整個訊息區做 querySelectorAll */
  let navEdges = { top: null, bottom: null };

  /* ------------------------------ 滾動 ------------------------------- */
 
  /** 向下捲超過這個 px 後，才顯示全域「回頂」浮動鈕 */
  const SHOW_TOP_BTN_AT = 400;
 
  /**
   * 依目前捲動位置更新四向導航的顯示狀態：
   *   • 全域浮動鈕：回底（↓）＝距底 ≥ 200px 才出現；
   *                 回頂（↑）＝向下捲超過 400px 後出現。
   *   • 訊息級膠囊鈕：與浮動鈕同一組門檻——
   *     視角貼近對話頂部 ⇒ 整批隱藏「⬆ 頂部」；
   *     視角貼近對話底部 ⇒ 整批隱藏「⬇ 底部」。
   *     （貼邊時點它們本來就沒有意義，且功能與浮動鈕重複。）
   * 由 onScroll（節流 120ms）呼叫。
   */
  function paintNavButtons() {
    const el = R.scroll;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    state.autoScrollPinned = gap < 120;
 
    const nearBottom = gap < 200;                       // 與全域「回底」鈕同門檻
    const nearTop = el.scrollTop < SHOW_TOP_BTN_AT;     // 與全域「回頂」鈕同門檻
 
    R.scrollBtn.classList.toggle('hidden', nearBottom);
    if (R.scrollTopBtn) {
      R.scrollTopBtn.classList.toggle('hidden', nearTop);
    }
 
    /* 膠囊鈕：狀態沒變就直接返回（捲動中絕大多數呼叫走這條路） */
    if (navEdges.top === nearTop && navEdges.bottom === nearBottom) return;
    navEdges.top = nearTop;
    navEdges.bottom = nearBottom;
 
    /* ★ 選擇器陷阱：「.msg__jump」也會比對到 .msg__jump--end（兩個類別疊加），
       必須用 :not() 分開，否則隱藏「⬆ 頂部」時會連「⬇ 底部」一起藏掉。 */
    R.history.querySelectorAll('.msg__jump:not(.msg__jump--end)')
      .forEach(w => w.classList.toggle('hidden', nearTop));
    R.history.querySelectorAll('.msg__jump--end')
      .forEach(w => w.classList.toggle('hidden', nearBottom));
  }
 
  function scrollToBottom(force = false) {
    if (!force && !(Settings.get('autoScroll') && state.autoScrollPinned)) return;
    R.scroll.scrollTop = R.scroll.scrollHeight;
  }
 
  function onScroll() { paintNavButtons(); }
 
  /** 平滑捲到整個對話的最頂端（全域浮動「回頂」鈕用）。
      過程中 gap 變大 → autoScrollPinned 自然轉 false，串流不會把視角拉回去。 */
  function scrollToTop() {
    R.scroll.scrollTo({ top: 0, behavior: 'smooth' });
  }
 
  /** 平滑捲到某則訊息的開頭（offset = 頂列高度 + 一點呼吸空間） */
  function scrollToMessage(id, offset = 64) {
    const el = R.history.querySelector('.msg[data-id="' + id + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = R.scroll.getBoundingClientRect();
    const target = R.scroll.scrollTop + (r.top - c.top) - offset;
    R.scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
 
  /** 平滑捲到某則訊息的結尾（讓尾端落在視窗下緣上方約 offset 處，
      稍微露出後續內容，確認「這則到此為止」）。 */
  function scrollToMessageEnd(id, offset = 80) {
    const el = R.history.querySelector('.msg[data-id="' + id + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = R.scroll.getBoundingClientRect();
    const target = R.scroll.scrollTop + (r.bottom - c.bottom) + offset;
    R.scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
 
  /* ------------------------------ 整區渲染 --------------------------- */
 
  function renderMessages(force = false, opts = {}) {
    if (!R.scroll) return;
    const sig = UIState.msgSig();
    if (!force && sig === UIState.sig.msg) return;
    if (!force && UIState.isGenerating(Chats.currentIdOf())) return;
 
    const prevTop = R.scroll.scrollTop;
    const maxTop = () => Math.max(0, R.scroll.scrollHeight - R.scroll.clientHeight);
    const wasPinned = prevTop >= maxTop() - 120;
 
    UIState.sig.msg = sig;
 
    const chat = Chats.current();
    R.history.innerHTML = '';
    navEdges.top = navEdges.bottom = null;   // ★ DOM 已重建：強制下一次 paint 重套貼邊隱藏
 
    const msgs = Chats.visible(chat);
    if (!chat || !msgs.length) {
      renderWelcome();
      renderBookmarkBar(null);
      return;
    }
    msgs.forEach(m => R.history.appendChild(messageNode(m)));
    renderBookmarkBar(chat);
 
    if (opts.keepScroll && !wasPinned) {
      R.scroll.scrollTop = Math.min(prevTop, maxTop());
    } else {
      scrollToBottom(true);
    }
  }
 
  function renderWelcome() {
    const examples = [
      { t: '解釋概念', d: '用生活化比喻說明什麼是 Event Loop' },
      { t: '寫程式', d: '用 Python 寫一個檔案批次重命名工具' },
      { t: '數學推導', d: '用 LaTeX 說明大數法則與中央極限定理的關係' },
      { t: '翻譯與潤稿', d: '把這段中文改寫成專業英文郵件' },
    ];
    const chat = Chats.current();
    const box = U.el('div.welcome', {}, [
      U.el('h2', { text: chat?.temporary ? '\uD83D\uDD76\uFE0F 暫時對話' : '\uD83D\uDC4B 歡迎使用 ' + APP.name }),
      U.el('p', {
        text: chat?.temporary
          ? '這個對話不會被儲存，也不會同步；關閉分頁後就會消失。需要留下紀錄時，可按側邊欄的 \uD83D\uDCBE 轉為永久對話。'
          : '選擇供應商與模型後即可開始；也可以拖放檔案或圖片、輸入 / 使用指令。',
      }),
    ]);
    const cards = U.el('div.welcome__cards');
    examples.forEach(e => cards.appendChild(U.el('div.welcome__card', {
      html: '<b>' + e.t + '</b><span class="muted">' + U.escapeHtml(e.d) + '</span>',
      onclick: () => {
        R.input.value = e.d;
        UIComposer.autoGrow(); UIComposer.updateTokenCounter(); UIComposer.focusInput();
      },
    })));
    box.appendChild(cards);
    R.history.appendChild(box);
  }
 
  /* ------------------------------ 書籤列 ----------------------------- */
 
  function renderBookmarkBar(chat) {
    const bar = document.getElementById('bookmark-bar');
    if (!bar) return;
 
    if (!chat || chat.id !== bmChatId) {
      state.bookmarkIdx = -1;
      bmChatId = chat ? chat.id : null;
    }
 
    const bms = chat ? Chats.visible(chat).filter(m => m.bookmarked) : [];
    bar.classList.toggle('hidden', !bms.length);
    bar.innerHTML = '';
 
    bms.forEach((m, i) => {
      const preview = String(m.content || '').replace(/\s+/g, ' ').trim();
      const chip = U.el('button.bm-chip', {
        type: 'button',
        text: '\uD83D\uDD16 ' + (i + 1) + '\u3000' + U.truncate(preview, 18),
        title: U.formatStamp(m.createdAt) + '\n' + U.truncate(preview, 160),
        'aria-label': '跳到書籤 ' + (i + 1),
        onclick: () => {
          state.bookmarkIdx = i;
          scrollToMessage(m.id);
          paintActiveChip(bar, i);
        },
      });
      if (i === state.bookmarkIdx) chip.classList.add('is-active');
      bar.appendChild(chip);
    });
 
    if (bms.length) {
      bar.appendChild(U.el('span.bm-hint', { text: '共 ' + bms.length + ' 個書籤（Alt+[ / Alt+] 切換）' }));
    }
  }
 
  function paintActiveChip(bar, idx) {
    bar.querySelectorAll('.bm-chip').forEach((c, i) => c.classList.toggle('is-active', i === idx));
  }
 
  function jumpBookmark(dir) {
    const chat = Chats.current();
    const bms = chat ? Chats.visible(chat).filter(m => m.bookmarked) : [];
    if (!bms.length) {
      Toast.info('這個對話還沒有書籤；在訊息操作列按「\uD83D\uDD16 書籤」即可加入');
      return;
    }
    let i = state.bookmarkIdx;
    if (dir > 0) i = i < 0 ? 0 : (i + 1) % bms.length;
    else i = i <= 0 ? bms.length - 1 : i - 1;
    state.bookmarkIdx = i;
    scrollToMessage(bms[i].id);
    const bar = document.getElementById('bookmark-bar');
    if (bar) paintActiveChip(bar, i);
  }
 
  /* ------------------------------ 單則訊息 --------------------------- */
 
  function paintElapsed(msgId, t0) {
    const el = R.history.querySelector('.msg[data-id="' + msgId + '"] .msg__elapsed');
    if (el) el.textContent = '\u23F1 ' + U.formatDuration(Date.now() - t0);
  }
 
  /** 訊息開頭的「⬆ 頂部」sticky 懸浮鈕（v2.4.1） */
  function jumpTopNode(m) {
    const wrap = U.el('div.msg__jump');
    wrap.appendChild(U.el('button.msg__jump-btn', {
      type: 'button',
      text: '\u2B06 頂部',
      title: '回到這則訊息的開頭',
      'aria-label': '回到這則訊息的開頭',
      onclick: e => { e.stopPropagation(); scrollToMessage(m.id); },
    }));
    return wrap;
  }
 
  /** 訊息結尾的「⬇ 底部」sticky 懸浮鈕（v2.4.5；與 ⬆ 頂部鏡像）。
      必須 append 在 .msg__inner 之後（見 messageNode），wrapper 才會落在訊息尾端。 */
  function jumpEndNode(m) {
    const wrap = U.el('div.msg__jump.msg__jump--end');
    wrap.appendChild(U.el('button.msg__jump-btn', {
      type: 'button',
      text: '\u2B07 底部',
      title: '跳到這則訊息的結尾',
      'aria-label': '跳到這則訊息的結尾',
      onclick: e => { e.stopPropagation(); scrollToMessageEnd(m.id); },
    }));
    return wrap;
  }
 
  function continueNode(m) {
    const wrap = U.el('div.msg__continue-row');
    wrap.appendChild(U.el('button.btn.btn--outline.btn--sm.msg__continue', {
      type: 'button',
      text: '\u23E9 繼續生成',
      title: '這則回覆在長度上限被截斷；點擊從中斷處接著寫（可連續多次）',
      'aria-label': '從中斷處繼續生成這則回覆',
      onclick: e => { e.stopPropagation(); UIComposer.continueGeneration(Chats.current(), m.id); },
    }));
    return wrap;
  }
 
  function messageNode(m) {
    const chat = Chats.current();
    const s = Settings.all();
    const node = U.el('div.msg.msg--' + m.role + (m.error ? '.msg--error' : ''), { dataset: { id: m.id } });
    node.appendChild(jumpTopNode(m));
    const inner = U.el('div.msg__inner');
 
    inner.appendChild(U.el('div.msg__avatar', {
        text: m.role === 'user' ? '\uD83E\uDDD1' : (m.role === 'system' ? '\u2139\uFE0F' : '\uD83E\uDD16'),
    }));
 
    const body = U.el('div.msg__body');
 
    const meta = U.el('div.msg__meta');
    meta.appendChild(U.el('span.role', { text: m.role === 'user' ? '你' : (m.role === 'system' ? '系統' : '助理') }));
    if (s.showModelBadge && m.model) meta.appendChild(U.el('span.badge.badge--accent', { text: Models.nameOf(m.model) }));
    if (s.showTimestamps) meta.appendChild(U.el('span', {
      text: U.formatStamp(m.createdAt),
      title: U.formatDateTime(m.createdAt),
    }));
    if (m.role === 'assistant') {
      const live = !m.durationMs && m.startedAt && UIState.isGenerating(Chats.currentIdOf());
      if (m.durationMs || live) {
        const ms = m.durationMs || Math.max(0, Date.now() - Date.parse(m.startedAt));
        meta.appendChild(U.el('span.msg__elapsed', {
          text: '\u23F1 ' + U.formatDuration(ms),
          title: m.durationMs ? '模型產生這則回覆花費的時間' : '生成中\u2026',
        }));
      }
    }
    if (m.error) meta.appendChild(U.el('span.badge.badge--err', { text: '錯誤' }));
    body.appendChild(meta);
 
    if (m.reasoning && s.showReasoning) body.appendChild(reasoningNode(m.reasoning));
 
    const content = U.el('div.msg__content' + (s.renderMarkdown ? '.markdown' : '.is-plain'));
    content.innerHTML = renderContent(m);
    body.appendChild(content);
 
    if (m.role === 'assistant' && !m.error && m.finishReason === 'length') {
      body.appendChild(continueNode(m));
    }
 
    if (m.attachments?.length) body.appendChild(attachmentsNode(m.attachments));
 
    if (s.showTokenUsage && m.usage) {
      body.appendChild(U.el('div.msg__usage', {
        text: '\u2191 ' + U.formatNum(m.usage.prompt_tokens || 0) +
              ' \u00B7 \u2193 ' + U.formatNum(m.usage.completion_tokens || 0) + ' tokens' +
              (m.cost ? ' \u00B7 ' + U.formatCost(m.cost) : ''),
      }));
    }

     /* ⇪ 發佈：僅在目前對話解析得到輸出目的地時注入；
       匯出（Exporter）直接吃 MD.render 原始輸出，不含此動態節點 */
    if (m.role === 'assistant' && !m.error && window.Publisher?.resolve?.(chat)) {
      content.querySelectorAll('.code-block__head').forEach((head, i) => {
        head.appendChild(U.el('button', {
          text: '\u21EA 發佈',
          title: '將此程式碼區塊 commit 到本對話設定的 GitHub 目的地',
          'aria-label': '發佈此程式碼區塊到 GitHub',
          onclick: () => Publisher.commitOne(chat, m.id, i),
        }));
      });
    }
    body.appendChild(actionsNode(m));
    inner.appendChild(body);
    node.appendChild(inner);
    node.appendChild(jumpEndNode(m));   // ★ 放在 inner 之後＝訊息尾端（sticky bottom 生效的前提）
    return node;
  }
 
  function renderContent(m) {
    if (m.error) return '\u26D4 ' + U.escapeHtml(m.error);
    const text = m.content || '';
    if (!text) return '<span class="cursor-blink"></span>';
    return Settings.get('renderMarkdown') ? MD.render(text) : MD.plain(text);
  }
 
  function reasoningNode(text) {
    const d = U.el('details.reasoning');
    d.appendChild(U.el('summary', { text: '\uD83D\uDCAD 思考過程' }));
    d.appendChild(U.el('div.reasoning__body', { text }));
    return d;
  }
 
  /* v2.4.3：點陣圖才允許在新視窗中檢視。
     image/svg+xml 可在新視窗執行 script（opaque origin），改為下載。 */
  const BITMAP_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp|ico|avif))$/i;
 
  function attachmentsNode(atts) {
    const box = U.el('div.msg__attachments');
    atts.forEach(a => {
      if (a.kind === 'image' && a.dataUrl) {
        if (BITMAP_TYPES.test(a.type || '')) {
          box.appendChild(U.el('img', {
            src: a.dataUrl, alt: a.name, title: a.name,
            onclick: () => window.open(a.dataUrl, '_blank'),
          }));
        } else {
          // 非點陣圖（如 SVG）：顯示縮圖但點擊改為下載
          const img = U.el('img', { src: a.dataUrl, alt: a.name, title: a.name });
          img.style.cursor = 'pointer';
          img.addEventListener('click', () => {
            U.download(a.name || 'image.svg', a.dataUrl.split(',')[1] || '', a.type || 'image/svg+xml');
          });
          box.appendChild(img);
        }
        return;
      }
 
      const canSave = a.kind === 'text' && !a.stripped && typeof a.text === 'string';
      const chip = U.el('span.file-chip', { title: a.name });
      chip.appendChild(U.el('span', { text: '\uD83D\uDCCE' }));
      chip.appendChild(U.el('span.name', { text: a.name }));
      chip.appendChild(U.el('span.size', {
        text: U.formatBytes(a.size || 0) + (a.stripped ? ' \u00B7 內容未保存' : ''),
      }));
 
      const dlProps = {
        text: '\u2935',
        title: canSave ? '下載 ' + a.name : '附件內容未保存在此瀏覽器，無法下載',
        'aria-label': canSave ? '下載附件 ' + a.name : '附件 ' + a.name + ' 的內容未保存',
        onclick: canSave ? () => downloadAttachment(a) : undefined,
      };
      if (!canSave) dlProps.disabled = '';
      chip.appendChild(U.el('button.dl', dlProps));
 
      box.appendChild(chip);
    });
    return box;
  }
 
  function downloadAttachment(a) {
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(a.type || '') ? a.type : 'text/plain';
    U.download(a.name || 'attachment.txt', a.text || '', mime + ';charset=utf-8');
  }
 
  /* ------------------------------ 訊息操作 --------------------------- */
 
  function actionsNode(m) {
    const chat = Chats.current();
    const box = U.el('div.msg__actions');
    const add = (text, title, fn) =>
      box.appendChild(U.el('button', { text, title, 'aria-label': title, onclick: fn }));
 
    add('\u29C9 複製', '複製內容', async () => { await U.copy(m.content || ''); Toast.ok('已複製'); });
 
    if (m.role === 'user') {
      add('\u270F\uFE0F 編輯', '編輯並重新送出', () => startEdit(m, 'user'));
    } else if (m.error) {
      add('\u21BB 重試', '沿用原模型與上下文重送，成功後原地替換這則回覆', () => retryMessage(m));
    } else {
      add('\u21BB 重生', '重新生成這則回覆', () => regenerate(m));
      add('\u270F\uFE0F 編輯', '編輯內容（僅儲存，不會重新生成）', () => startEdit(m, 'assistant'));
      if (window.Publisher?.resolve?.(chat) && Publisher.blocksOf(m.content).length) {
        add('\u21EA 全部發佈', '把這則回覆的所有程式碼區塊 commit 到 GitHub',
          () => Publisher.commitAll(chat, m.id));
      }      
      if (Voice.ttsSupported()) add('\uD83D\uDD08 朗讀', '朗讀這則回覆', () => Voice.speak(m.content));
    }
 
    add(
      m.bookmarked ? '\uD83D\uDD16 取消書籤' : '\uD83D\uDD16 書籤',
      m.bookmarked ? '從書籤列移除這則訊息' : '加入書籤列（之後可用 Alt+[ / Alt+] 快速跳轉）',
      () => {
        Chats.toggleBookmark(chat.id, m.id);
        renderMessages(true, { keepScroll: true });
      }
    );
 
    add('\uD83C\uDF3F 分支', '從這裡開一個新對話', () => {
      const c = Chats.branch(chat.id, m.id);
      Toast.ok('已建立分支對話');
      UISidebar.selectChat(c.id);
    });
    add('\uD83D\uDDD1\uFE0F', '刪除這則訊息', async () => {
      if (await Modal.confirmDelete('刪除這則訊息？')) {
        Chats.removeMessage(chat.id, m.id);
        renderMessages(true, { keepScroll: true });
        UIHeader.renderHeader(); UISidebar.renderSidebar(true);
      }
    });
    if (Settings.get('developerMode')) {
      add('{ }', '檢視原始資料', () => appendSystemNote('json\n' + JSON.stringify(m, null, 2) + '\n'));
    }
    return box;
  }
 
  function retryMessage(m) {
    const chat = Chats.current();
    if (!chat) return;
    if (UIState.isGenerating(chat.id)) { Toast.warn('這個對話正在生成回覆，請先停止'); return; }
    UIComposer.runCompletion(chat, { model: Models.resolve(m.model), replaceMessageId: m.id });
  }
 
  function startEdit(m, mode = 'user') {
    const node = R.history.querySelector('.msg[data-id="' + m.id + '"]');
    if (!node) return;
    node.classList.add('is-editing');
    const contentEl = node.querySelector('.msg__content');
    const editor = U.el('div.msg__editor');
    const ta = U.el('textarea');
    ta.value = m.content;
    editor.appendChild(ta);
 
    const row = U.el('div.row');
 
    if (mode === 'user') {
      row.appendChild(U.el('button.btn.btn--primary.btn--sm', {
        text: '儲存並重新送出',
        onclick: () => {
          const chat = Chats.current();
          if (UIState.isGenerating(chat.id)) { Toast.warn('這個對話正在生成回覆，請先停止'); return; }
          Chats.updateMessage(chat.id, m.id, { content: ta.value.trim() });
          Chats.truncateAfter(chat.id, m.id);
          renderMessages(true, { keepScroll: true });
          scrollToMessage(m.id);
          UIComposer.runCompletion(chat);
        },
      }));
    }
 
    row.appendChild(U.el('button.btn.btn--sm ' +
      (mode === 'assistant' ? 'btn--primary' : 'btn--outline'), {
      text: '僅儲存',
      onclick: () => {
        Chats.updateMessage(Chats.currentIdOf(), m.id, { content: ta.value.trim() });
        renderMessages(true, { keepScroll: true });
        scrollToMessage(m.id);
      },
    }));
    row.appendChild(U.el('button.btn.btn--ghost.btn--sm', {
      text: '取消',
      onclick: () => renderMessages(true, { keepScroll: true }),
    }));
    editor.appendChild(row);
 
    contentEl.replaceWith(editor);
    ta.focus();
    ta.style.height = ta.scrollHeight + 'px';
  }
 
  function regenerate(m) {
    const chat = Chats.current();
    if (UIState.isGenerating(chat.id)) { Toast.warn('這個對話正在生成回覆，請先停止'); return; }
    Chats.truncateAfter(chat.id, m.id, true);
    renderMessages(true);
    UIComposer.runCompletion(chat, { model: Models.resolve(m.model) });
  }
 
  function appendSystemNote(text) {
    const node = messageNode({ id: U.uid('note'), role: 'system', content: text, createdAt: U.nowISO() });
    node.querySelector('.msg__actions')?.remove();
    node.querySelector('.msg__jump')?.remove();
    node.querySelector('.msg__jump--end')?.remove();   // v2.4.5：暫時性系統卡也不需要導航鈕
    R.history.appendChild(node);
    scrollToBottom();
  }
 
  return {
    renderMessages, renderWelcome, messageNode, renderContent, reasoningNode,
    paintElapsed, appendSystemNote, startEdit, regenerate,
    scrollToBottom, scrollToTop, scrollToMessage, scrollToMessageEnd, onScroll,
    renderBookmarkBar, jumpBookmark,
  };
})();