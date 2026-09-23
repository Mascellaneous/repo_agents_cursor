
/* =============================================================================
 * markdown.js — 極輕量 Markdown → HTML（零依賴、預設安全）
 * -----------------------------------------------------------------------------
 * 流程（★ 順序是安全與正確性的關鍵）：
 *   1. 逐行抽出圍籬程式碼       → \u0000C{n}\u0000
 *      （CommonMark 規則：開欄＝行首 3+ 個 ` 或 ~；關欄＝同字元、長度≥開欄、
 *        行內僅空白。內容中的 ``` 不會再誤判為關欄 ——
 *        例如 const md = "```"; 或巢狀 markdown 範例）
 *   2. 抽出行內程式碼           → \u0000I{n}\u0000（先雙反引號、後單反引號，
 *      因此 `a ` b` 這類含反引號的行內碼也能正確成對）
 *   3. 抽出並渲染數學（MathX）  → \u0000M{n}\u0000
 *   4. 全文 HTML escape          ← 之後不可能出現使用者注入的標籤
 *   5. 逐行處理區塊語法
 *   6. 行內語法
 *   7. 還原三種 placeholder
 * ============================================================================= */

window.MD = (() => {

  /* ---------------------------- 語法高亮 ------------------------------- */

  const KEYWORDS = ('abstract as async await break case catch class const continue debugger default delete do ' +
    'else enum export extends false finally for from function global if implements import in instanceof interface ' +
    'let new null package private protected public return static super switch this throw true try typeof var void ' +
    'while with yield def elif except lambda pass raise None True False and or not is print self struct impl fn ' +
    'match trait mut pub use where echo end module require include local then do begin select insert update delete ' +
    'from where group by order join on values table create alter drop int float double string bool byte char long ' +
    'short unsigned template typename namespace using virtual override final').split(' ');

  const KW_RE = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'g');

  function highlightCode(escaped, lang = '') {
    if (lang === 'text' || lang === 'plain') return escaped;

    const RE = new RegExp([
      /(&lt;!--[\s\S]*?--&gt;|\/\*[\s\S]*?\*\/|\/\/[^\n]*|(?:^|\s)#[^\n]*|--[^\n]*)/.source,
      /* 字串：單／雙引號與反引號模板字串皆不跨行（反引號原先允許跨行，會把
         多行著色成一個假字串，已修正為與引號一致） */
      /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`)/.source,
      /(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)/.source,
      /([A-Za-z_$][\w$]*)(?=\s*\()/.source,
    ].join('|'), 'gi');

    return escaped.replace(RE, (m, com, str, num, fn) => {
      if (com) return `<span class="tok-com">${com}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      if (fn) return `<span class="tok-fn">${fn}</span>`;
      return m;
    }).replace(KW_RE, (m, kw, offset, full) => {
      const before = full.slice(Math.max(0, offset - 60), offset);
      if (before.lastIndexOf('<span') > before.lastIndexOf('</span>')) return m;
      return `<span class="tok-kw">${kw}</span>`;
    });
  }

  function codeBlockHtml(code, lang) {
    const escaped = U.escapeHtml(code);
    const highlighted = highlightCode(escaped, lang.toLowerCase());
    const lines = highlighted.split('\n').map(l => `<span class="ln">${l || ' '}</span>`).join('\n');
    const wrapCls = Settings.get('codeWrap') ? ' is-wrap' : '';
    return (
      `<div class="code-block${wrapCls}">` +
        `<div class="code-block__head">` +
          `<span class="code-block__lang">${U.escapeHtml(lang || 'code')}</span>` +
          `<button data-act="wrap" title="切換自動換行">↩︎ 換行</button>` +
          `<button data-act="copy" title="複製程式碼">⧉ 複製</button>` +
          `<button data-act="download" title="下載為檔案">⤓</button>` +
        `</div>` +
        `<pre><code data-lang="${U.escapeAttr(lang)}">${lines}</code></pre>` +
      `</div>`
    );
  }

  /* --------------------- 圍籬抽取（逐行、CommonMark 風格） -------------- */

  /**
   * 逐行解析圍籬程式碼，把每個區塊換成 \u0000C{n}\u0000 placeholder。
   *
   * 規則（與 CommonMark / GitHub 一致）：
   *   • 開欄：行首至多 3 個空格 ＋ 3 個以上的 ` 或 ~ ＋ 資訊字串（語言等）。
   *     反引號圍欄的資訊字串不可再含反引號。
   *   • 關欄：同一字元、長度 ≥ 開欄，且該行其餘只有空白。
   *   • 掃描到結尾都沒等到關欄 → 視為「尚未關閉」，其餘全部是程式碼
   *     （與舊版相同的串流安全語意：串流中不會炸掉，下一幀自動補上）。
   *
   * 修掉的問題：
   *   • 內容中的 ```（如 const md = "```";、docstring、巢狀範例）
   *     只要不「獨占一行且長度足夠」，就不會再斷開區塊。
   *   • 支援長圍欄包短圍欄（```` 包 ```）—— AI 展示 markdown 時的標準寫法。
   *   • 開欄必須錨定行首；行文中夾帶的 ``` 依規格視為普通文字。
   *
   * @param {string} text   尚未抽出行內碼／數學的原文
   * @param {Array}  codes  收集器（{ lang, code }），呼叫端持有
   * @returns {string}       已替換 placeholder 的文字
   */
  function extractFences(text, codes) {
    const lines = text.split('\n');
    const out = [];
    const openRe = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

    for (let i = 0; i < lines.length; ) {
      const m = openRe.exec(lines[i]);
      const marker = m ? m[1] : null;
      const info = m ? m[2].trim() : '';
      /* 反引號圍欄的資訊字串含反引號 ⇒ 不是合法開欄（CommonMark 規則） */
      const usable = !!marker && !(marker[0] === '`' && info.includes('`'));

      if (!usable) { out.push(lines[i]); i++; continue; }

      const ch = marker[0];                       // '`' 或 '~'，皆非正則特殊字元
      const len = marker.length;
      const lang = info.split(/\s+/)[0] || '';    // 取資訊字串第一個欄位當語言
      const closeRe = new RegExp(`^ {0,3}${ch}{${len},}[ \\t]*$`);

      const body = [];
      i++;                                        // 跳過開欄行
      while (i < lines.length && !closeRe.test(lines[i])) { body.push(lines[i]); i++; }
      if (i < lines.length) i++;                  // 吃掉關欄行；掃完仍沒遇到 ⇒ 未閉合

      codes.push({ lang, code: body.join('\n') });
      out.push(`\u0000C${codes.length - 1}\u0000`);
    }
    return out.join('\n');
  }

  /* ---------------------------- 行內語法 ------------------------------ */

  function safeUrl(url = '') {
    const u = url.trim();
    return /^(https?:|mailto:|data:image\/|#|\/)/i.test(u) ? u : '#';
  }

  function inline(text) {
    return text
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        (m, alt, url) => `<img src="${U.escapeAttr(safeUrl(url))}" alt="${U.escapeAttr(alt)}" loading="lazy">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
        (m, txt, url) => `<a href="${U.escapeAttr(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${txt}</a>`)
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g,
        (m, pre, url) => `${pre}<a href="${U.escapeAttr(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${url}</a>`)
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  /* ---------------------------- 主要渲染 ------------------------------ */

  function render(src = '') {
    if (!src) return '';

    const codes = [];
    const inlines = [];
    let mathNodes = [];

    /* 移除 NUL：模型輸出若含字面 \u0000C99\u0000 這類序列，
       還原階段會查不到對應 placeholder 而讓整則渲染崩潰 */
    let text = String(src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');

    /* 1) 圍籬程式碼：逐行解析（見 extractFences 的說明） */
    text = extractFences(text, codes);

    /* 2) 行內程式碼：先雙反引號（內容可含單一反引號）、再單反引號；
          必須在數學之前，否則 `$x$` 會被當公式 */
    text = text.replace(/``([^`\n]+)``/g, (m, c) => {
      inlines.push(c.trim());
      return `\u0000I${inlines.length - 1}\u0000`;
    });
    text = text.replace(/`([^`\n]+)`/g, (m, c) => {
      inlines.push(c);
      return `\u0000I${inlines.length - 1}\u0000`;
    });

    /* 3) 數學（★ 必須在 escape 之前，因為 KaTeX 需要原始 \ 與 _） */
    if (window.MathX) {
      const r = MathX.extract(text);
      text = r.text;
      mathNodes = r.nodes;
    }

    /* 4) 轉義 */
    text = U.escapeHtml(text);

    /* 5) 逐行處理區塊 */
    const lines = text.split('\n');
    const out = [];
    let para = [], listType = null, quote = [];

    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
    const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join('<br>'))}</blockquote>`); quote = []; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (!line.trim()) { flushAll(); continue; }

      // 程式碼／區塊數學 placeholder 自成一塊
      if (/^\u0000[CM]\d+\u0000$/.test(line.trim())) { flushAll(); out.push(line.trim()); continue; }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

      const q = line.match(/^\s*&gt;\s?(.*)$/);
      if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
      flushQuote();

      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
        flushAll();
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line);
        i += 2;
        const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
        i--;
        out.push(
          '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
          body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>'
        );
        continue;
      }

      const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
      const ol = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const m = ul || ol;
        const want = ul ? 'ul' : 'ol';
        flushPara();
        if (listType !== want) { flushList(); out.push(`<${want}>`); listType = want; }
        const content = m[2].replace(/^\[([ xX])\]\s+/, (mm, c) =>
          `<input type="checkbox" disabled ${/[xX]/.test(c) ? 'checked' : ''}> `);
        out.push(`<li>${inline(content)}</li>`);
        continue;
      }
      flushList();

      para.push(line);
    }
    flushAll();

    let html = out.join('\n');

    /* 7) 還原 placeholder（數學要在最前，內容已是安全 HTML） */
    if (window.MathX) html = MathX.restore(html, mathNodes);
    html = html.replace(/\u0000C(\d+)\u0000/g, (m, i) => codeBlockHtml(codes[i].code, codes[i].lang || ''));
    html = html.replace(/\u0000I(\d+)\u0000/g, (m, i) => `<code>${U.escapeHtml(inlines[i])}</code>`);

    return html;
  }

  /** 純文字模式（關閉 Markdown 時），仍會渲染數學 */
  function plain(src = '') {
    if (!window.MathX || !Settings.get('mathEnabled')) return U.escapeHtml(src);
    const r = MathX.extract(String(src));
    return MathX.restore(U.escapeHtml(r.text), r.nodes);
  }

  function bindCodeActions() {
    document.addEventListener('click', async e => {
      const btn = e.target.closest('.code-block__head button');
      if (!btn) return;
      const block = btn.closest('.code-block');
      const codeEl = block.querySelector('code');
      const text = codeEl.innerText;

      if (btn.dataset.act === 'copy') {
        await U.copy(text);
        const old = btn.textContent;
        btn.textContent = '✓ 已複製';
        setTimeout(() => (btn.textContent = old), 1600);
      } else if (btn.dataset.act === 'wrap') {
        block.classList.toggle('is-wrap');
      } else if (btn.dataset.act === 'download') {
        const lang = codeEl.dataset.lang || 'txt';
        const extMap = { javascript: 'js', typescript: 'ts', python: 'py', markdown: 'md', bash: 'sh', shell: 'sh' };
        U.download(`snippet.${extMap[lang] || lang || 'txt'}`, text);
      }
    });
  }

  /** 抽出所有圍籬程式碼區塊（供發佈功能使用；不改變原文） */
  function extractCodeBlocks(src) {
    const codes = [];
    extractFences(String(src || ''), codes);
    /* 刻意「不」過濾空區塊：render() 對每個圍欄都產生一個 .code-block__head，
       若在這裡過濾，「DOM 第 N 個 head」會與「blocksOf()[N]」錯位，
       導致 ⇪ 發佈鈕把內容發佈到錯的檔案。空區塊由 publisher 端擋下。 */
    return codes;
  }
 
  return { render, plain, highlightCode, bindCodeActions, extractCodeBlocks };
})();
