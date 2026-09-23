/* =============================================================================
 * math.js — LaTeX 數學公式渲染（window.MathX）
 * -----------------------------------------------------------------------------
 *   抽出數學 → 立刻渲染成 HTML → 用 placeholder 佔位 → 跑 Markdown → 還原
 * 支援語法：$...$、$$...$$、\(...\)、\[...\]、\begin{env}...\end{env}
 * 引擎：KaTeX（可動態載入）或內建輕量 fallback（零依賴、可離線）
 *
 * 版本管理：KaTeX 版本集中在 config.js 的 KATEX_VERSION；
 * CDN_SRI 以版本號為 key —— 升級版本時若忘了更新 SRI，
 * 載入失敗會以 Toast 明確告知原因，不再靜默退回內建渲染。
 * ============================================================================= */
 
window.MathX = (() => {
 
  let katexLoading = false;
  let katexFailed = false;
  let injected = [];
  const cache = new Map();                 // `${engine}|${display}|${tex}` → HTML
 
  /* ------------------------------ 引擎管理 ---------------------------- */
 
  const enabled = () => !!Settings.get('mathEnabled');
 
  function engine() {
    if (!enabled()) return 'off';
    const want = Settings.get('mathEngine') || 'auto';
    if (want === 'builtin') return 'builtin';
    if (window.katex) return 'katex';
    return want === 'katex' ? 'pending' : 'builtin';
  }
 
  const DEFAULT_CDN = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/`;
 
  /** SRI 依版本索引：換版本必須同步補上新的 hash */
  const CDN_SRI = {
    [KATEX_VERSION]: {
      css: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+',
      js:  'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg',
    },
  };
 
  /** 重繪所有訊息（強制，因為外觀引擎變了） */
  function repaint() {
    /* ★ 修復：KaTeX 若在 UI.init() 之前就載入完成（快取命中／網路極快），
       UIState.R 還是空物件，renderMessages 會在 R.scroll.scrollTop 上炸出
       TypeError。這裡直接不做——啟動流程最後的 UI.init() → renderAll(true)
       一定會補畫一次，屆時引擎狀態已是最新。 */
    if (!window.UIState?.R?.scroll) return;
    window.UI?.bumpRenderEpoch?.();
    window.UI?.renderMessages?.(true);
  }
 
  /** 動態載入 KaTeX；成功或失敗都會重繪一次 */
  function ensureKatex() {
    if (!enabled() || window.katex || katexLoading) return;
    const mode = Settings.get('mathEngine') || 'auto';
    if (mode === 'builtin') return;
 
    injected.forEach(n => n.remove());
    injected = [];
    katexLoading = true;
 
    const base = (Settings.get('katexBase') || DEFAULT_SETTINGS.katexBase).replace(/\/?$/, '/');
    const official = base === DEFAULT_CDN;
    const sri = official ? CDN_SRI[KATEX_VERSION] : null;
 
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'katex.min.css';
    if (sri) { css.integrity = sri.css; css.crossOrigin = 'anonymous'; }
    css.onerror = () => console.warn('[MathX] KaTeX CSS 載入失敗（樣式將退回內建 fallback）');
    document.head.appendChild(css);
 
    const js = document.createElement('script');
    js.src = base + 'katex.min.js';
    js.defer = true;
    if (sri) { js.integrity = sri.js; js.crossOrigin = 'anonymous'; }
    js.onload = () => {
      katexLoading = false; katexFailed = false; cache.clear();
      if (window.katex?.version && window.katex.version !== KATEX_VERSION) {
        console.warn(`[MathX] 實際載入的 KaTeX 版本（${window.katex.version}）與 KATEX_VERSION（${KATEX_VERSION}）不一致；` +
                     `若使用官方 CDN，請確認 SRI 是否需要更新。`);
      }
      console.info('[MathX] KaTeX 已載入');
      repaint();
    };
    js.onerror = () => {
      katexLoading = false; katexFailed = true; cache.clear();
      const why = official
        ? '可能是離線、CDN 無法連上，或 SRI 校驗不符（升級 KATEX_VERSION 時需同步更新 math.js 的 CDN_SRI）'
        : '可能是位址錯誤或離線';
      console.warn('[MathX] KaTeX 載入失敗，改用內建輕量渲染：' + why);
      window.Toast?.warn(`KaTeX 載入失敗（${why}），已改用內建輕量渲染。`, 8000);
      repaint();
    };
    document.head.appendChild(js);
    injected.push(css, js);
  }
 
  /* ------------------------------ 對外渲染 ---------------------------- */
 
  function renderTex(tex, display) {
    const eng = engine();
    const key = `${eng}|${display ? 'D' : 'I'}|${tex}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
 
    const html = renderTexRaw(tex, display, eng);
    if (cache.size > 800) cache.clear();
    cache.set(key, html);
    return html;
  }
 
  function renderTexRaw(tex, display, eng) {
    if (eng === 'katex' || (eng === 'pending' && window.katex)) {
      try {
        return katex.renderToString(tex, {
          displayMode: display,
          throwOnError: false,
          strict: 'ignore',
          trust: false,
          output: 'htmlAndMathml',
          macros: { ...MACROS },
        });
      } catch (e) {
        return errorHtml(tex, display, e.message);
      }
    }
    try {
      return `<span class="mathx${display ? ' mathx--display' : ''}" data-tex="${U.escapeAttr(tex)}">` +
             `${convert(expandMacros(tex), display)}</span>`;
    } catch (e) {
      return errorHtml(tex, display, e.message);
    }
  }
 
  const errorHtml = (tex, display, msg) =>
    `<code class="math-error" title="${U.escapeAttr(msg || '')}">${U.escapeHtml(display ? `$$${tex}$$` : `$${tex}$`)}</code>`;
 
  /**
   * 抽出數學 → placeholder（\u0000M{n}\u0000）
   * 未閉合的 $ 原樣保留 → 串流中不會炸掉
   */
  function extract(src) {
    const nodes = [];
    if (!enabled() || !src) return { text: src, nodes };
 
    let out = '', i = 0;
    const n = src.length;
    const atLineStart = () => /(^|\n)[ \t]*$/.test(out);
 
    const emit = (tex, display) => {
      const ls = display && atLineStart();
      nodes.push(renderTex(tex, display));
      const ph = `\u0000M${nodes.length - 1}\u0000`;
      out += ls ? `\n\n${ph}\n\n` : ph;
    };
 
    while (i < n) {
      const c = src[i];
 
      // \$ 轉義 → 輸出字面 $
      if (c === '\\' && src[i + 1] === '$') { out += '$'; i += 2; continue; }
 
      if (src.startsWith('$$', i)) {
        const close = src.indexOf('$$', i + 2);
        if (close > i + 1) { emit(src.slice(i + 2, close).trim(), true); i = close + 2; continue; }
      }
      if (src.startsWith('\\[', i)) {
        const close = src.indexOf('\\]', i + 2);
        if (close > -1) { emit(src.slice(i + 2, close).trim(), true); i = close + 2; continue; }
      }
      if (src.startsWith('\\(', i)) {
        const close = src.indexOf('\\)', i + 2);
        if (close > -1) { emit(src.slice(i + 2, close).trim(), false); i = close + 2; continue; }
      }
      if (src.startsWith('\\begin{', i)) {
        const m = /^\\begin\{([a-zA-Z*]+)\}/.exec(src.slice(i));
        if (m) {
          const endTag = `\\end{${m[1]}}`;
          const close = src.indexOf(endTag, i);
          if (close > -1) { emit(src.slice(i, close + endTag.length), true); i = close + endTag.length; continue; }
        }
      }
      if (c === '$') {
        let j = i + 1, found = -1;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '\n' && src[j + 1] === '\n') break;      // 不跨段落
          if (src[j] === '$') { found = j; break; }
          j++;
        }
        if (found > i + 1) {
          const body = src.slice(i + 1, found);
          const isMoney = /^[\s\d.,]+$/.test(body);               // 排除 "$5.00"
          if (!isMoney && body.trim()) { emit(body.trim(), false); i = found + 1; continue; }
        }
      }
 
      out += c; i++;
    }
    return { text: out, nodes };
  }
 
  const restore = (html, nodes) =>
    html.replace(/\u0000M(\d+)\u0000/g, (m, k) => nodes[+k] ?? '');
 
  /* ==========================================================================
   * 內建輕量 TeX → HTML（零依賴 fallback）
   * ======================================================================== */
 
  const MACROS = {
    '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}',
    '\\Q': '\\mathbb{Q}', '\\C': '\\mathbb{C}',
    '\\E': '\\mathbb{E}', '\\P': '\\mathbb{P}',
    '\\Var': '\\operatorname{Var}', '\\Cov': '\\operatorname{Cov}',
    '\\argmin': '\\operatorname{arg\\,min}', '\\argmax': '\\operatorname{arg\\,max}',
  };
 
  /** builtin 引擎也套用巨集（KaTeX 由 macros 選項處理） */
  function expandMacros(tex) {
    let out = tex;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      out = out.replace(/\\[A-Za-z]+/g, m => {
        if (MACROS[m]) { changed = true; return MACROS[m]; }
        return m;
      });
      if (!changed) break;
    }
    return out;
  }
 
  const SYM = {
    alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ϵ', varepsilon:'ε', zeta:'ζ',
    eta:'η', theta:'θ', vartheta:'ϑ', iota:'ι', kappa:'κ', lambda:'λ', mu:'μ', nu:'ν',
    xi:'ξ', pi:'π', rho:'ρ', varrho:'ϱ', sigma:'σ', varsigma:'ς', tau:'τ', upsilon:'υ',
    phi:'ϕ', varphi:'φ', chi:'χ', psi:'ψ', omega:'ω',
    Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ', Pi:'Π', Sigma:'Σ',
    Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
    to:'→', rightarrow:'→', longrightarrow:'⟶', leftarrow:'←', Rightarrow:'⇒',
    Leftarrow:'⇐', leftrightarrow:'↔', Leftrightarrow:'⇔', mapsto:'↦', implies:'⟹',
    infty:'∞', times:'×', div:'÷', pm:'±', mp:'∓', cdot:'·', cdots:'⋯', ldots:'…',
    dots:'…', vdots:'⋮', ddots:'⋱', ast:'∗', circ:'∘', bullet:'∙',
    leq:'≤', le:'≤', geq:'≥', ge:'≥', neq:'≠', ne:'≠', ll:'≪', gg:'≫',
    approx:'≈', equiv:'≡', sim:'∼', simeq:'≃', cong:'≅', propto:'∝',
    in:'∈', notin:'∉', ni:'∋', subset:'⊂', subseteq:'⊆', supset:'⊃', supseteq:'⊇',
    cup:'∪', cap:'∩', setminus:'∖', emptyset:'∅', varnothing:'∅',
    forall:'∀', exists:'∃', nexists:'∄', neg:'¬', lnot:'¬', land:'∧', lor:'∨',
    sum:'∑', prod:'∏', coprod:'∐', int:'∫', iint:'∬', iiint:'∭', oint:'∮',
    partial:'∂', nabla:'∇', ell:'ℓ', hbar:'ℏ', Re:'ℜ', Im:'ℑ',
    aleph:'ℵ', angle:'∠', perp:'⊥', parallel:'∥', therefore:'∴', because:'∵',
    oplus:'⊕', ominus:'⊖', otimes:'⊗', odot:'⊙',
    langle:'⟨', rangle:'⟩', lfloor:'⌊', rfloor:'⌋', lceil:'⌈', rceil:'⌉',
    prime:'′', deg:'°', star:'⋆', dagger:'†', top:'⊤', bot:'⊥',
    lim:'lim', max:'max', min:'min', sup:'sup', inf:'inf', log:'log', ln:'ln',
    exp:'exp', sin:'sin', cos:'cos', tan:'tan', det:'det', dim:'dim', gcd:'gcd',
  };
 
  const ACCENTS = { hat:'ˆ', widehat:'ˆ', bar:'‾', overline:'‾', tilde:'˜',
                    widetilde:'˜', vec:'→', dot:'˙', ddot:'¨', check:'ˇ', breve:'˘' };
 
  const BB = { R:'ℝ', N:'ℕ', Z:'ℤ', Q:'ℚ', C:'ℂ', E:'𝔼', P:'ℙ', H:'ℍ', F:'𝔽' };
 
  const SPACERS = { ',':'\u2009', ';':'\u2005', ':':'\u2005', '!':'', ' ':' ',
                    quad:'\u2003', qquad:'\u2003\u2003' };
 
  function convert(src, display) {
    let out = '', i = 0;
    const n = src.length;
 
    const readGroup = () => {
      let depth = 0; const start = ++i;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { if (!depth) break; depth--; }
        i++;
      }
      const body = src.slice(start, i);
      i++;
      return body;
    };
    const readArg = () => {
      while (src[i] === ' ' || src[i] === '*') i++;
      if (src[i] === '{') return readGroup();
      if (src[i] === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
        if (m) { i += m[0].length; return m[0]; }
      }
      return src[i++] ?? '';
    };
 
    while (i < n) {
      const c = src[i];
 
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
        if (!m) { i++; continue; }
        const cmd = m[1];
        i += m[0].length;
 
        if (cmd === '\\') { out += display ? '<br>' : ' '; continue; }
        if (SPACERS[cmd] !== undefined) { out += SPACERS[cmd]; continue; }
 
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
          const a = readArg(), b = readArg();
          out += `<span class="mfrac"><span>${convert(a)}</span><span>${convert(b)}</span></span>`;
          continue;
        }
        if (cmd === 'sqrt') {
          let idx = '';
          if (src[i] === '[') { const e = src.indexOf(']', i); idx = src.slice(i + 1, e); i = e + 1; }
          const a = readArg();
          out += `${idx ? `<sup>${convert(idx)}</sup>` : ''}√<span class="msqrt">${convert(a)}</span>`;
          continue;
        }
        if (['text', 'textrm', 'textbf', 'mbox', 'operatorname', 'mathrm', 'mathsf', 'mathtt'].includes(cmd)) {
          out += `<span class="mtext">${U.escapeHtml(readArg())}</span>`; continue;
        }
        if (cmd === 'mathbb') {
          const a = readArg();
          out += `<span class="mbb">${U.escapeHtml([...a].map(ch => BB[ch] || ch).join(''))}</span>`;
          continue;
        }
        if (cmd === 'mathbf' || cmd === 'boldsymbol' || cmd === 'bm') { out += `<b>${convert(readArg())}</b>`; continue; }
        if (cmd === 'mathcal' || cmd === 'mathscr' || cmd === 'mathit') { out += `<i>${convert(readArg())}</i>`; continue; }
        if (ACCENTS[cmd]) {
          out += `<span class="macc" data-a="${U.escapeAttr(ACCENTS[cmd])}">${convert(readArg())}</span>`;
          continue;
        }
        if (cmd === 'left' || cmd === 'right') {
          const d = readArg();
          out += U.escapeHtml(d === '.' ? '' : (SYM[d.replace(/^\\/, '')] || d.replace(/^\\/, '')));
          continue;
        }
        if (cmd === 'begin' || cmd === 'end') { readArg(); out += display ? '' : ' '; continue; }
        if (['limits', 'nolimits', 'displaystyle', 'textstyle', 'nonumber'].includes(cmd)) continue;
 
        if (SYM[cmd] !== undefined) {
          const isOp = /^(sum|prod|int|iint|iiint|oint|coprod|lim|max|min|sup|inf|log|ln|exp|sin|cos|tan|det|dim|gcd)$/.test(cmd);
          out += `<span class="${isOp ? 'mop mtext' : ''}">${U.escapeHtml(SYM[cmd])}</span>`;
          continue;
        }
        out += U.escapeHtml('\\' + cmd);
        continue;
      }
 
      if (c === '^' || c === '_') {
        i++;
        const a = readArg();
        out += c === '^' ? `<sup>${convert(a)}</sup>` : `<sub>${convert(a)}</sub>`;
        continue;
      }
      if (c === '{') { out += convert(readGroup(), display); continue; }
      if (c === '}') { i++; continue; }
      if (c === '&') { out += '<span class="mspace"></span>'; i++; continue; }
      if (c === '\n') { out += display ? '<br>' : ' '; i++; continue; }
      if (c === '~') { out += ' '; i++; continue; }
 
      if (/[A-Za-z]/.test(c)) {
        const word = /^[A-Za-z]+/.exec(src.slice(i))[0];
        i += word.length;
        out += `<span class="mvar">${U.escapeHtml(word)}</span>`;
        continue;
      }
      out += U.escapeHtml(c); i++;
    }
    return out;
  }
 
  /* ------------------------------ 複製友善 ---------------------------- */
 
  function bindCopyAsTex() {
    document.addEventListener('copy', e => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const frag = sel.getRangeAt(0).cloneContents();
      if (!frag.querySelector('.katex, .mathx')) return;
 
      frag.querySelectorAll('.katex').forEach(k => {
        const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if (tex) k.replaceWith(document.createTextNode(
          k.closest('.katex-display') ? `$$${tex}$$` : `$${tex}$`));
      });
      frag.querySelectorAll('.mathx').forEach(k => {
        const tex = k.dataset.tex;
        if (tex) k.replaceWith(document.createTextNode(
          k.classList.contains('mathx--display') ? `$$${tex}$$` : `$${tex}$`));
      });
 
      const div = document.createElement('div');
      div.appendChild(frag);
      e.clipboardData.setData('text/plain', div.textContent);
      e.preventDefault();
    });
  }
 
  function init() {
    ensureKatex();
    bindCopyAsTex();
    const onChange = U.debounce(() => {
      katexFailed = false; cache.clear();
      ensureKatex();
      repaint();
    }, 800);
    ['mathEnabled', 'mathEngine', 'katexBase'].forEach(k => Settings.on(k, onChange));
  }
 
  return { init, extract, restore, renderTex, engine, ensureKatex };
})();