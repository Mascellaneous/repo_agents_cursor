/* =============================================================================
 * api.js — 對話 API 客戶端（OpenRouter / Poe，兩者皆為 OpenAI 相容格式）
 * -----------------------------------------------------------------------------
 * v2.4.3：新增 onReset 重試鉤子——自動重試前呼叫，讓呼叫端清空已累積的
 * 部分串流內容。否則第二輪的 delta 會接在第一輪後面，造成文字重複。
 * ============================================================================= */
 
window.API = (() => {
 
  /* ------------------------------ 供應商 ------------------------------ */
 
  const provider = () => Settings.get('provider') || 'openrouter';
  const isPoe = () => provider() === 'poe';
 
  /** 目前供應商的連線資訊 */
  function conn() {
    const s = Settings.all();
    return isPoe()
      ? { name: 'poe',        baseUrl: (s.poeBaseUrl || PROVIDERS.poe.baseUrl).replace(/\/+$/, ''), key: s.poeApiKey }
      : { name: 'openrouter', baseUrl: (s.baseUrl || PROVIDERS.openrouter.baseUrl).replace(/\/+$/, ''), key: s.apiKey };
  }
 
  const hasKey = () => !!conn().key;
  const keyHint = () => isPoe() ? '請先到「設定 → API」填入 Poe API Key' : '請先到「設定 → API」填入 OpenRouter API Key';
 
  function headers() {
    const s = Settings.all();
    const c = conn();
    const h = {
      'Authorization': `Bearer ${c.key}`,
      'Content-Type': 'application/json',
    };
    if (!isPoe()) {                       // OpenRouter 專屬的排行榜標頭
      h['HTTP-Referer'] = s.referer || location.origin || 'http://localhost';
      h['X-Title'] = s.appTitle || APP.name;
    }
    return h;
  }
 
  /* ------------------------------ 參數 -------------------------------- */
 
  function buildParams(o = {}) {
    const s = Settings.all();
    const pick = (a, b) => (a === undefined || a === null || a === '' ? b : a);
 
    const p = {
      temperature: pick(o.temperature, s.temperature),
      top_p: pick(o.topP, s.topP),
    };
    const topK = pick(o.topK, s.topK);
    const maxTokens = pick(o.maxTokens, s.maxTokens);
    const fp = pick(o.frequencyPenalty, s.frequencyPenalty);
    const pp = pick(o.presencePenalty, s.presencePenalty);
    const rp = pick(o.repetitionPenalty, s.repetitionPenalty);
    const seed = pick(o.seed, s.seed);
    const stop = pick(o.stopSequences, s.stopSequences);
    // reasoningEffort === null → 明確關閉（不 fallback 到全域設定）
    const effort = o.reasoningEffort === null ? '' : pick(o.reasoningEffort, s.reasoningEffort);
 
    if (maxTokens > 0) p.max_tokens = maxTokens;
    if (stop?.length) p.stop = stop;
 
    if (isPoe()) return p;                 // Poe 只吃基本參數
 
    if (topK > 0) p.top_k = topK;
    if (fp) p.frequency_penalty = fp;
    if (pp) p.presence_penalty = pp;
    if (rp && rp !== 1) p.repetition_penalty = rp;
    if (seed != null && seed !== '' && !Number.isNaN(seed)) p.seed = Number(seed);
    if (effort) p.reasoning = { effort };
    return p;
  }
 
  /* ------------------------------ 主要方法 ---------------------------- */
 
  async function chat(o) {
    const s = Settings.all();
    const c = conn();
    if (!c.key) throw new Error(`尚未設定 ${PROVIDERS[c.name].label} API Key`);
 
    const stream = o.stream ?? s.stream;
    const body = {
      model: o.model,
      messages: o.messages,
      stream,
      ...buildParams(o.params || {}),
      ...(stream && !isPoe() ? { stream_options: { include_usage: true } } : {}),
    };
 
    if (s.developerMode) console.log(`[API:${c.name}] request →`, U.deepClone(body));
 
    const maxRetries = Math.max(0, s.maxRetries);
    let lastErr;
 
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(new Error('timeout')), s.timeoutSec * 1000);
      const onAbort = () => timeoutCtrl.abort(o.signal?.reason ?? new Error('aborted'));
      o.signal?.addEventListener('abort', onAbort, { once: true });
 
      try {
        const res = await fetch(`${c.baseUrl}/chat/completions`, {
          method: 'POST', headers: headers(), body: JSON.stringify(body), signal: timeoutCtrl.signal,
        });
 
        if (!res.ok) {
          const errText = await res.text();
          const err = new Error(extractError(errText, res.status, o.model));
          err.status = res.status;
          if (res.status < 500 && ![408, 429].includes(res.status)) throw err;
          throw Object.assign(err, { retryable: true });
        }
 
        const result = stream ? await readStream(res, o) : await readJson(res, o);
        if (s.developerMode) console.log(`[API:${c.name}] response →`, result);
        return result;
 
      } catch (e) {
        lastErr = normalizeError(e, o.signal);
        if (lastErr.aborted) throw lastErr;
        if (attempt < maxRetries && (lastErr.retryable ?? true)) {
          const wait = s.retryDelayMs * Math.pow(2, attempt);
          console.warn(`[API] 第 ${attempt + 1} 次失敗，${wait}ms 後重試：`, lastErr.message);
          /* ★ 重試前通知呼叫端清空已累積的部分串流，
             否則第二輪 onDelta 會接在第一輪後面造成文字重複 */
          o.onReset?.();
          await U.sleep(wait);
          continue;
        }
        throw lastErr;
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr;
  }
 
  /* ------------------------------ 讀取回應 ---------------------------- */
 
  async function readJson(res, o) {
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'API 錯誤');
    const msg = json.choices?.[0]?.message || {};
    o.onMeta?.({ model: json.model, id: json.id });
    const content = typeof msg.content === 'string'
      ? msg.content
      : (Array.isArray(msg.content) ? msg.content.map(p => p.text || '').join('') : '');
    o.onDelta?.(content);
    return {
      content,
      reasoning: msg.reasoning || msg.reasoning_content || '',
      usage: json.usage || null,
      model: json.model || o.model,
      finish_reason: json.choices?.[0]?.finish_reason || 'stop',
    };
  }
 
  async function readStream(res, o) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', reasoning = '', usage = null;
    let model = o.model, finish = 'stop', metaSent = false;
 
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
 
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
 
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
 
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json.error) throw new Error(json.error.message || '串流錯誤');
 
        if (!metaSent && json.model) { model = json.model; o.onMeta?.({ model, id: json.id }); metaSent = true; }
        if (json.usage) usage = json.usage;
 
        const d = json.choices?.[0];
        if (!d) continue;
        if (d.finish_reason) finish = d.finish_reason;
 
        const delta = d.delta || {};
        const r = delta.reasoning ?? delta.reasoning_content;
        if (r) { reasoning += r; o.onReasoning?.(r); }
 
        let c = delta.content;
        if (Array.isArray(c)) c = c.map(p => p.text || '').join('');
        if (c) { content += c; o.onDelta?.(c); }
      }
    }
    return { content, reasoning, usage, model, finish_reason: finish };
  }
 
  /* ------------------------------ 錯誤處理 ---------------------------- */
 
  function extractError(text, status, model) {
    try {
      const j = JSON.parse(text);
      const m = j.error?.message || j.message;
      if (m) return `${m}（HTTP ${status}）`;
    } catch { /* 非 JSON */ }
    const label = PROVIDERS[provider()]?.label || '服務';
    const hints = {
      400: `請求被拒（可能是此模型不支援某個參數）`,
      401: `${label} API Key 無效或已過期`,
      402: '額度不足，請到供應商後台儲值',
      403: '此模型不允許存取（可能需要開啟資料政策設定）',
      404: `找不到模型${model ? `「${model}」` : ''}，名稱可能已變更，請重新從清單選擇`,
      408: '請求逾時',
      429: '已達速率／每日上限，請稍後再試或換一個模型',
      502: '上游模型暫時無法使用',
      503: '服務暫時不可用',
    };
    return hints[status] ? `${hints[status]}（HTTP ${status}）` : `請求失敗（HTTP ${status}）`;
  }
 
  function normalizeError(e, signal) {
    if (signal?.aborted) return Object.assign(new Error('已停止生成'), { aborted: true });
    if (e?.name === 'AbortError' || /timeout/i.test(e?.message || '')) {
      return Object.assign(new Error(`回應逾時（超過 ${Settings.get('timeoutSec')} 秒）`), { retryable: true, timeout: true });
    }
    if (e instanceof TypeError) {
      return Object.assign(new Error('網路連線失敗，請確認網路或 Base URL 設定'), { retryable: true });
    }
    return e;
  }
 
  /* ------------------------------ 輔助端點 ---------------------------- */
 
  /** 驗證金鑰（依供應商採用不同做法） */
  async function verifyKey() {
    const c = conn();
    if (!c.key) throw new Error(`尚未填入 ${PROVIDERS[c.name].label} API Key`);
 
    if (c.name === 'openrouter') {
      const res = await fetch(`${c.baseUrl}/key`, { headers: headers() });
      if (!res.ok) throw new Error(extractError(await res.text(), res.status));
      return (await res.json()).data;
    }
 
    /* Poe：先試 /models，不支援就送一個極小的 chat 請求 */
    try {
      const res = await fetch(`${c.baseUrl}/models`, { headers: headers() });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        return { label: `可用模型 ${(j.data || []).length || '—'} 個` };
      }
      if (res.status === 401) throw new Error('Poe API Key 無效或已過期');
    } catch (e) {
      if (/無效/.test(e.message)) throw e;
    }
    const r = await chat({
      model: Models.defaultModel(),
      stream: false,
      params: { temperature: 0, maxTokens: 4, reasoningEffort: null },
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { label: `已連線（${r.model || Models.defaultModel()}）` };
  }
 
  /* ------------------------------ 測試單一 Poe 模型 --------------------- */

  const POE_TEST_PROMPT = '請只用兩個字回覆：收到';
  const POE_TEST_TIMEOUT_MS = 60000;
  const POE_TEST_MAX_TOKENS = 256;

  function messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(p => (p && p.text) || '').join('');
    return '';
  }

  /**
   * 對單一 Poe bot 送一句極短提問，確認金鑰能呼叫它、而且有文字回來。
   * 不走 chat()：避免套用使用者的長逾時、自動重試，以及目前供應商（這支永遠打 Poe）。
   * @returns {Promise<{reply:string, fromReasoning:boolean, model:string, elapsedMs:number}>}
   */
  async function testPoeModel(model, opts = {}) {
    const name = String(model || '').trim();
    if (!name) throw new Error('請先填入模型名稱');

    const baseUrl = (Settings.get('poeBaseUrl') || PROVIDERS.poe.baseUrl).replace(/\/+$/, '');
    const key = Settings.get('poeApiKey');
    if (!key) throw new Error('請先填入 Poe API Key');

    const timeoutCtrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; timeoutCtrl.abort(); }, POE_TEST_TIMEOUT_MS);
    const onAbort = () => timeoutCtrl.abort(opts.signal?.reason ?? new Error('aborted'));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: name,
          messages: [{ role: 'user', content: POE_TEST_PROMPT }],
          stream: false,
          temperature: 0,
          max_tokens: POE_TEST_MAX_TOKENS,
        }),
        signal: timeoutCtrl.signal,
      });

      if (!res.ok) {
        const err = new Error(extractError(await res.text(), res.status, name));
        err.status = res.status;
        throw err;
      }

      const json = await res.json();
      if (json.error) throw new Error(json.error.message || 'API 錯誤');

      const msg = json.choices?.[0]?.message || {};
      const content = messageText(msg.content).trim();
      const reasoning = messageText(msg.reasoning || msg.reasoning_content).trim();
      const reply = content || reasoning;
      if (!reply) {
        const finish = json.choices?.[0]?.finish_reason;
        throw new Error(finish ? `模型沒有文字回覆（finish: ${finish}）` : '模型沒有文字回覆');
      }

      const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
      return {
        reply,
        fromReasoning: !content && !!reasoning,
        model: json.model || name,
        elapsedMs,
      };
    } catch (e) {
      if (opts.signal?.aborted) throw Object.assign(new Error('已取消測試'), { aborted: true });
      if (timedOut || e?.name === 'AbortError') {
        throw Object.assign(new Error('測試逾時（超過 60 秒），此模型可能無法使用或回應過慢'), { timeout: true });
      }
      if (e instanceof TypeError) throw new Error('網路連線失敗，請確認網路或 Poe Base URL');
      throw e;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** 查詢額度（僅 OpenRouter 支援） */
  async function credits() {
    if (isPoe()) throw new Error('Poe 未提供額度查詢 API，請到 poe.com 查看');
    const c = conn();
    for (const path of ['/credits', '/key']) {
      try {
        const res = await fetch(`${c.baseUrl}${path}`, { headers: headers() });
        if (!res.ok) continue;
        const d = (await res.json()).data || {};
        const total = d.total_credits ?? d.limit ?? null;
        const used = d.total_usage ?? d.usage ?? 0;
        return { total, used, remaining: total == null ? null : total - used, raw: d };
      } catch { /* 試下一個 */ }
    }
    throw new Error('無法取得額度資訊');
  }
 
  /* ======================= 標題產生 ================================== */
 
  /* 用字串拼接避免某些編輯器/工具誤判 */
  const THINK_TAG_RE = new RegExp(
    '<' + 'think' + '>' + '[\\s\\S]*?' + '</' + 'think' + '>', 'gi'
  );
  const THINK_PREFIX_RE = new RegExp(
    '^[\\s\\S]*?' + '</' + 'think' + '>', 'i'
  );
 
  /** 清洗模型輸出成合格標題 */
  function sanitizeTitle(raw) {
    let t = String(raw ?? '');
 
    // 移除思考標籤（reasoning 模型常見）
    t = t.replace(THINK_TAG_RE, '');
    t = t.replace(THINK_PREFIX_RE, '');
 
    // 移除程式碼區塊
    t = t.replace(/```[\s\S]*?```/g, ' ');
 
    // 取最後一行非空行
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    t = lines.length ? lines[lines.length - 1] : '';
 
    // 去掉常見前綴
    t = t.replace(/^(標題|title)\s*[:：]\s*/i, '');
 
    // 去掉首尾引號與括號
    const QUOTE_CHARS = '"\'\u201c\u201d\u300c\u300e\u300a\uff08([\\-\\*\\s';
    const re1 = new RegExp('^[' + QUOTE_CHARS + ']+');
    const re2 = new RegExp('["\'\u201c\u201d\u300d\u300f\u300b\uff09)\\]\\s]+$');
    t = t.replace(re1, '').replace(re2, '');
 
    // 正規化空白
    t = t.replace(/\s+/g, ' ').trim();
 
    // 去掉句尾標點
    t = t.replace(/[。\uFF0E.,\uFF0C\u3001!\uFF01?\uFF1F;\uFF1B:\uFF1A]+$/g, '');
 
    // 限長
    const arr = [...t];
    if (arr.length > 24) t = arr.slice(0, 24).join('') + '\u2026';
 
    return t;
  }
 
  const TITLE_SYSTEM =
'You generate a SHORT title for a chat conversation.\n' +
'Rules:\n' +
'- Output ONLY the title. No quotes, no trailing punctuation, no explanation.\n' +
'- Use the SAME language as the conversation (if Chinese, use Traditional Chinese).\n' +
'- Be concise and specific about the topic. The title has to be short.\n' +
'- Return ONLY the new title. Give only ONE title. Do not return "The user want....".';
 
  function buildTitleContext(messages = []) {
    const msgs = messages.filter(m => m.role !== 'system' && !m.deleted && m.content);
    const head = msgs.slice(0, 4);
    const tail = msgs.length > 6 ? msgs.slice(-2) : [];
    return [...head, ...tail]
      .map(m => (m.role === 'user' ? 'User' : 'Assistant') + ': ' +
        String(m.content).replace(/\s+/g, ' ').slice(0, 600))
      .join('\n').slice(0, 4000);
  }
 
  async function generateTitle(model, messages, opts = {}) {
    const context = buildTitleContext(messages);
    if (!context.trim()) throw new Error('對話還沒有內容，無法產生標題');
 
    const r = await chat({
      model,
      stream: false,
      signal: opts.signal,
      params: { temperature: 0.2, maxTokens: 200, reasoningEffort: null },
      messages: [
        { role: 'system', content: TITLE_SYSTEM },
        { role: 'user', content: 'Conversation:\n"""\n' + context + '\n"""\n\nTitle:' },
      ],
    });
 
    let title = sanitizeTitle(r.content || r.reasoning || '');
    if (!title || /^(對話|聊天|chat|untitled|新對話)$/i.test(title)) {
      const first = messages.find(m => m.role === 'user' && m.content);
      title = sanitizeTitle(String(first?.content || '').slice(0, 40));
    }
    return title;
  }
 
  /** 摘要舊訊息，壓縮上下文 */
  async function summarize(model, messages) {
    const r = await chat({
      model,
      stream: false,
      params: { temperature: 0.3, maxTokens: 400, reasoningEffort: null },
      messages: [
        { role: 'system', content: '請用繁體中文以條列方式摘要以下對話的重點、已達成的結論與尚待處理的事項，控制在 250 字內。' },
        { role: 'user', content: messages.map(m => m.role + ': ' + String(m.content).slice(0, 1200)).join('\n\n').slice(0, 12000) },
      ],
    });
    return (r.content || '').replace(THINK_TAG_RE, '').trim();
  }
 
  return {
    chat, verifyKey, testPoeModel, credits, generateTitle, summarize, buildParams, sanitizeTitle,
    provider, isPoe, conn, hasKey, keyHint,
  };
})();