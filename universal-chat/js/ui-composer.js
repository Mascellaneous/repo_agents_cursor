/* =============================================================================
 * ui-composer.js — 輸入框、送出流程、並行生成
 * -----------------------------------------------------------------------------
 * v2.4.3：
 *   • saveDraft 不再 debounce —— 立即寫進 Store cache（O(1)），
 *     pagehide 的 flushNow() 才涵蓋得到關閉分頁前的最後一個字。
 *   • runCompletion 支援 opts.replaceMessageId：失敗重試時原地重用同一則訊息。
 *   • API.chat 的 onReset 鉤子：自動重試前清空已累積的部分串流，
 *     否則第二輪 delta 接在第一輪後面造成文字重複。
 * ============================================================================= */
 
window.UIComposer = (() => {
 
  const R = UIState.R;
  const state = UIState.state;
 
  /* ------------------------------ 輸入框 ----------------------------- */
 
  function autoGrow() {
    const ta = R.input;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  }
 
  function updateTokenCounter() {
    const text = R.input.value;
    const tk = U.estimateTokens(text) + Files.estimateTokens();
    R.tokenCounter.textContent = text.length + ' 字 / 約 ' + U.formatNum(tk) + ' tokens';
  }
 
  /**
   * v2.4.3：不再 debounce。直接把草稿寫進 chat 物件並呼叫 Chats.save(true)
   * → Store.set（cache 寫入 O(1)，IDB 由 Store 統一 debounce）。
   * pagehide 時 Store.flushNow() 就能刷到最新的草稿內容。
   * 舊版這裡 debounce 500ms，beforeunload 只觸發了再排一個新的 debounce，
   * 什麼都沒刷出去——關閉分頁前打的字直接消失。
   */
  function saveDraft() {
    if (!Settings.get('saveDraft')) return;
    const chat = Chats.current();
    if (!chat || chat._offloaded) return;
    if (chat.draft === R.input.value) return;          // 內容沒變就不寫
    chat.draft = R.input.value;
    Chats.save(true);                                  // remote=true：不觸發 GitHub 同步
  }
 
  function loadDraft() {
    const chat = Chats.current();
    R.input.value = (Settings.get('saveDraft') && chat?.draft) || '';
    autoGrow();
    updateTokenCounter();
  }
 
  const focusInput = () => R.input.focus();
 
  /* --------------------- 狀態列 / 送出停止切換 ----------------------- */
 
  function syncComposerState() {
    const on = UIState.isGenerating(Chats.currentIdOf());
    R.sendBtn.classList.toggle('hidden', on);
    R.stopBtn.classList.toggle('hidden', !on);
    R.input.disabled = false;
    setStatus(null);
  }
 
  function setStatus(text = null, chatId = null) {
    if (chatId) {
      const j = UIState.jobOf(chatId);
      if (j) j.status = text || '';
      if (chatId !== Chats.currentIdOf()) return;
    }
    const t = (text != null ? text : (UIState.jobOf(Chats.currentIdOf())?.status || '')) || '';
    R.status.textContent = t;
    R.composerStatus.innerHTML = t ? '<span class="spinner"></span> ' + U.escapeHtml(t) : '';
  }
 
  function stopGeneration(chatId = Chats.currentIdOf()) {
    const job = UIState.jobOf(chatId);
    if (!job) return false;
    job.aborter.abort(new Error('user-abort'));
    job.status = '已停止';
    setStatus(null);
    return true;
  }
 
  /* ------------------------------ 送出 ------------------------------- */
 
  async function handleSend() {
    const chat = Chats.current();
    if (chat && UIState.isGenerating(chat.id)) {
      Toast.warn('這個對話正在生成回覆，請先等待完成或按 Esc 停止');
      return;
    }
 
    const text = R.input.value.trim();
    const atts = Files.list();
    if (!text && !atts.length) return;
 
    if (text.startsWith('/') && await Prompts.handleSlash(text)) {
      R.input.value = ''; autoGrow(); updateTokenCounter(); saveDraft(); return;
    }
 
    if (!API.hasKey()) { Toast.warn(API.keyHint()); UIModals.openSettings('api'); return; }
    if (!chat) return;
    if (!Chats.addMessage(chat.id, { role: 'user', content: text, attachments: Files.take() })) return;
 
    R.input.value = '';
    autoGrow();
    saveDraft();
    updateTokenCounter();
    UIMessages.renderMessages(true);
    UISidebar.renderSidebar(true);
 
    await runCompletion(chat);
  }
 
  async function runCompletion(chat, opts = {}) {
    const s = Settings.all();
    const chatId = chat.id;
    if (UIState.isGenerating(chatId)) { Toast.warn('這個對話正在生成回覆'); return; }
 
    const cmpList = (s.compareModels || []).filter(id => Models.find(id));
    const targets = opts.model ? [opts.model]
      : (s.compareEnabled && cmpList.length ? cmpList : [Models.resolve(chat.model)]);
    if (!targets[0]) { Toast.warn('尚未選擇模型'); UIModals.openModelPicker(); return; }
 
    const replacing = !!opts.replaceMessageId;
 
    const job = { aborter: new AbortController(), status: '', startedAt: Date.now() };
    state.jobs.set(chatId, job);
    syncComposerState();
    UISidebar.renderSidebar(true);
 
    const onScreen = () => Chats.currentIdOf() === chatId;
    const nodeOf = id => (onScreen() ? R.history.querySelector('.msg[data-id="' + id + '"]') : null);
 
    try {
      for (let mi = 0; mi < targets.length; mi++) {
        const model = targets[mi];
        let placeholder;
 
        if (replacing) {
          placeholder = Chats.findRaw(chatId)?.messages.find(x => x.id === opts.replaceMessageId) || null;
          if (!placeholder) { Toast.warn('找不到要重試的訊息'); break; }
          Chats.updateMessage(chatId, placeholder.id, {
            error: null, content: '', reasoning: '',
            usage: null, cost: 0, finishReason: null,
            startedAt: U.nowISO(),
          });
          placeholder = Chats.findRaw(chatId).messages.find(x => x.id === opts.replaceMessageId);
        } else {
          placeholder = Chats.addMessage(chatId, {
            role: 'assistant', content: '', model, startedAt: U.nowISO(),
          });
        }
        if (!placeholder) break;
 
        if (onScreen()) {
          const old = R.history.querySelector('.msg[data-id="' + placeholder.id + '"]');
          const node = UIMessages.messageNode(placeholder);
          old ? old.replaceWith(node) : R.history.appendChild(node);
          UIState.markMessagesRendered();
          UIMessages.scrollToBottom();
        }
 
        const t0 = Date.now();
        const ticker = setInterval(() => UIMessages.paintElapsed(placeholder.id, t0), 1000);
 
        const paint = U.throttle(() => {
          if (placeholder.durationMs) return;
          if (!UIState.isGenerating(chatId)) return;
          const el = nodeOf(placeholder.id)?.querySelector('.msg__content');
          if (!el) return;
          el.innerHTML = UIMessages.renderContent(placeholder) + '<span class="cursor-blink"></span>';
          UIMessages.scrollToBottom();
        }, 60);
 
        const paintReasoning = U.throttle(() => {
          if (!Settings.get('showReasoning')) return;
          if (placeholder.durationMs) return;
          if (!UIState.isGenerating(chatId)) return;
          const node = nodeOf(placeholder.id);
          if (!node) return;
          let box = node.querySelector('.reasoning');
          if (!box) {
            box = UIMessages.reasoningNode('');
            box.open = true;
            node.querySelector('.msg__content').before(box);
          }
          box.querySelector('.reasoning__body').textContent = placeholder.reasoning;
          UIMessages.scrollToBottom();
        }, 80);
 
        setStatus(targets.length > 1
          ? '正在詢問第 ' + (mi + 1) + '/' + targets.length + ' 個模型：' + Models.nameOf(model) + '\u2026'
          : Models.nameOf(model) + ' 正在思考\u2026', chatId);
 
        try {
          const live = Chats.find(chatId) || chat;
          const messages = Chats.buildApiMessages(live, { excludeId: placeholder.id, modelId: model });
          if (s.developerMode && onScreen()) {
            UIMessages.appendSystemNote('json\n' + JSON.stringify(messages, null, 2) + '\n');
          }
 
          const res = await API.chat({
            model, messages, stream: s.stream,
            signal: job.aborter.signal,
            params: live.overrides || {},
            onDelta: chunk => { placeholder.content += chunk; paint(); },
            onReasoning: chunk => { placeholder.reasoning += chunk; paintReasoning(); },
            onMeta: meta => { if (meta.model) placeholder.model = meta.model; },
            /* v2.4.3：API 自動重試前呼叫 → 清空部分串流避免文字重複 */
            onReset: () => {
              placeholder.content = '';
              placeholder.reasoning = '';
              paint();
            },
          });
 
          Chats.updateMessage(chatId, placeholder.id, {
            content: res.content || placeholder.content,
            reasoning: res.reasoning || placeholder.reasoning,
            usage: res.usage || null,
            cost: res.usage ? Models.costOf(model, res.usage) : 0,
            model: res.model || model,
            durationMs: Date.now() - t0,
            finishReason: res.finish_reason || null,
          });
 
          window.Publisher?.maybeAutoCommit?.(chat, placeholder.id);          
          if (s.ttsAutoPlay && res.content && onScreen()) Voice.speak(res.content);
          if (s.soundOnDone) U.beep();
 
        } catch (e) {
          Chats.updateMessage(chatId, placeholder.id, {
            error: e.message, content: placeholder.content, durationMs: Date.now() - t0,
          });
          if (!e.aborted) Toast.error(e.message);
        } finally {
          clearInterval(ticker);
          const fresh = Chats.find(chatId)?.messages.find(x => x.id === placeholder.id);
          const node = nodeOf(placeholder.id);
          if (fresh && node) { node.replaceWith(UIMessages.messageNode(fresh)); UIState.markMessagesRendered(); }
          UIMessages.scrollToBottom();
        }
 
        if (job.aborter.signal.aborted) break;
      }
    } finally {
      state.jobs.delete(chatId);
      syncComposerState();
      UIHeader.renderHeader();
      UISidebar.renderSidebar(true);
    }
 
    const fresh = Chats.find(chatId);
    if (fresh) {
      await maybeAutoTitle(fresh);
      await maybeAutoSummarize(fresh);
      if (!fresh.temporary) window.GitHubSync?.markDirty?.();
    }
  }
 
  /* ------------------------------ 繼續生成 ---------------------------- */
 
  const CONTINUE_PROMPT =
    '[延續指示] 你上面的回覆在輸出長度上限處被截斷。請從中斷的地方「直接接著寫下去」：' +
    '不要重複任何已輸出的內容、不要重新開場、不要道歉或解釋；語言與格式沿用原本的回覆。';
 
  function mergeUsage(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return {
      prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
      completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
      total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
    };
  }
 
  async function continueGeneration(chat, messageId) {
    if (!chat) return;
    if (UIState.isGenerating(chat.id)) {
      Toast.warn('這個對話正在生成回覆，請先等待完成或按 Esc 停止');
      return;
    }
 
    const s = Settings.all();
    const chatId = chat.id;
    const target = Chats.findRaw(chatId)?.messages.find(x => x.id === messageId);
    if (!target || target.error) { Toast.warn('找不到可續寫的訊息'); return; }
 
    const model = Models.resolve(target.model);
    if (!model) { Toast.warn('尚未選擇模型'); UIModals.openModelPicker(); return; }
 
    const job = { aborter: new AbortController(), status: '', startedAt: Date.now() };
    state.jobs.set(chatId, job);
    syncComposerState();
    UISidebar.renderSidebar(true);
 
    const onScreen = () => Chats.currentIdOf() === chatId;
    const nodeOf = id => (onScreen() ? R.history.querySelector('.msg[data-id="' + id + '"]') : null);
 
    const baseContent = target.content || '';
    const baseDuration = target.durationMs || 0;
    let streamed = '';
 
    try {
      const t0 = Date.now();
      const ticker = setInterval(() => UIMessages.paintElapsed(target.id, t0), 1000);
 
      const paint = U.throttle(() => {
        if (!UIState.isGenerating(chatId)) return;
        const el = nodeOf(target.id)?.querySelector('.msg__content');
        if (!el) return;
        el.innerHTML = UIMessages.renderContent(target) + '<span class="cursor-blink"></span>';
        UIMessages.scrollToBottom();
      }, 60);
 
      setStatus(Models.nameOf(model) + ' 正在續寫\u2026', chatId);
 
      try {
        const live = Chats.find(chatId) || chat;
        const messages = Chats.buildApiMessages(live, { upToId: target.id, modelId: model });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });
 
        const res = await API.chat({
          model, messages, stream: s.stream,
          signal: job.aborter.signal,
          params: live.overrides || {},
          onDelta: chunk => { streamed += chunk; target.content = baseContent + streamed; paint(); },
          onMeta: () => {},
          onReset: () => { streamed = ''; target.content = baseContent; paint(); },
        });
 
        const addition = streamed || res.content || '';
        const usage = mergeUsage(target.usage, res.usage);
        Chats.updateMessage(chatId, target.id, {
          content: baseContent + addition,
          finishReason: res.finish_reason || null,
          usage,
          cost: usage ? Models.costOf(model, usage) : target.cost || 0,
          durationMs: baseDuration + (Date.now() - t0),
        });
 
        if (s.soundOnDone) U.beep();
 
      } catch (e) {
        if (!e.aborted) Toast.error('續寫失敗：' + e.message);
        if (streamed) Chats.updateMessage(chatId, target.id, { content: baseContent + streamed });
      } finally {
        clearInterval(ticker);
        const fresh = Chats.find(chatId)?.messages.find(x => x.id === target.id);
        const node = nodeOf(target.id);
        if (fresh && node) { node.replaceWith(UIMessages.messageNode(fresh)); UIState.markMessagesRendered(); }
        UIMessages.scrollToBottom();
      }
    } finally {
      state.jobs.delete(chatId);
      syncComposerState();
      UIHeader.renderHeader();
      UISidebar.renderSidebar(true);
    }
 
    const freshChat = Chats.find(chatId);
    if (freshChat && !freshChat.temporary) window.GitHubSync?.markDirty?.();
  }
 
  /* ------------------------------ 自動標題 / 摘要 -------------------- */
 
  async function maybeAutoTitle(chat) {
    if (!Settings.get('autoTitle')) return;
    const fresh = Chats.find(chat.id);
    if (!fresh || fresh.titleLocked) return;
    if (fresh.title !== '新對話' && fresh.title !== '暫時對話') return;
    const usable = Chats.visible(fresh).filter(m => !m.error && m.content);
    if (usable.length < 2) return;
 
    Chats.update(fresh.id, { title: U.truncate(usable[0].content.replace(/\s+/g, ' '), 24) });
    UISidebar.renderSidebar(); UIHeader.renderHeader();
 
    try {
      const model = Models.titleModel() || Models.resolve(fresh.model);
      const title = await API.generateTitle(model, usable);
      if (title) { Chats.update(fresh.id, { title }); UISidebar.renderSidebar(); UIHeader.renderHeader(); }
    } catch (e) { console.warn('[UI] 自動標題失敗', e); }
  }
 
  /**
   * 自動摘要舊訊息。
   * @param {{force?:boolean}} opts  force=true 時忽略門檻（供「立即重新摘要」按鈕）
   */
  async function maybeAutoSummarize(chat, opts = {}) {
    const s = Settings.all();
    if (!s.autoSummarize && !opts.force) return;
    const fresh = Chats.find(chat.id);
    if (!fresh) return;
    const msgs = Chats.visible(fresh);
    const pending = msgs.length - (fresh.summarizedUpTo || 0);
    if (!opts.force && pending < s.summarizeThreshold) return;
 
    const keep = 8;
    const slice = msgs.slice(fresh.summarizedUpTo || 0, msgs.length - keep);
    if (!slice.length) { if (opts.force) Toast.info('沒有可摘要的舊訊息（最後 8 則永遠保留原文）'); return; }
    if (slice.length < 4 && !opts.force) return;
 
    const t = Toast.loading('正在摘要較舊的對話以節省 tokens\u2026');
    try {
      const sum = await API.summarize(Models.resolve(fresh.model), slice);
      if (sum) {
        Chats.update(fresh.id, {
          summary: (fresh.summary ? fresh.summary + '\n' : '') + sum,
          summarizedUpTo: msgs.length - keep,
        });
        t.update(`已摘要 ${slice.length} 則舊訊息（🎛️ 本對話設定可檢視／編輯）`, 'ok');
 
        /* 監看（開發者模式）：把新摘要攤在訊息流尾端。
           appendSystemNote 只是暫時性 DOM 節點——不寫入資料、
           不會進 API 上下文，下次整區重繪即自然消失。 */
        if (s.developerMode && Chats.currentIdOf() === fresh.id) {
          UIMessages.appendSystemNote(
            '【自動摘要已更新】\n' +
            `本次壓縮：${slice.length} 則（累計至第 ${msgs.length - keep} 則）\n\n` + sum);
        }
      } else t.close();
    } catch (e) { t.update('摘要失敗：' + e.message, 'error'); }
  }
 
  return {
    autoGrow, updateTokenCounter, saveDraft, loadDraft, focusInput,
    syncComposerState, setStatus, stopGeneration,
    handleSend, runCompletion, continueGeneration, maybeAutoTitle, maybeAutoSummarize,
  };
})();