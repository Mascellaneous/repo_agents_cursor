/* =============================================================================
 * prompts.js — 提示詞庫（人格預設）與 Slash 指令
 * ============================================================================= */

window.Prompts = (() => {

  const BUILTIN = [
    { id: 'p_default',  name: '通用助理',   icon: '🤖', builtin: true,
      content: '你是一位友善、精確的 AI 助理。請一律使用繁體中文（香港用語）回答，需要時使用 Markdown 條列與程式碼區塊，避免冗詞。' },
    { id: 'p_coder',    name: '程式導師',   icon: '👨‍💻', builtin: true,
      content: '你是資深軟體工程師。回答時：1) 先給可執行的完整程式碼；2) 標註語言與檔名；3) 解釋關鍵設計與時間複雜度；4) 主動指出邊界情況與安全性問題。使用繁體中文。' },
    { id: 'p_reviewer', name: '程式碼審查', icon: '🔍', builtin: true,
      content: '你是嚴格的程式碼審查者。依「嚴重問題 / 一般建議 / 風格細節」分類列出問題，附上修正後片段與理由。使用繁體中文。' },
    { id: 'p_writer',   name: '中文編輯',   icon: '✍️', builtin: true,
      content: '你是專業中文編輯。請潤飾使用者文字，使其流暢自然、語氣一致，並在最後以條列說明主要修改處。保留原意，使用繁體中文。' },
    { id: 'p_trans',    name: '翻譯專家',   icon: '🌐', builtin: true,
      content: '你是專業譯者。將輸入內容翻成繁體中文（若輸入為中文則翻成英文），保留術語與格式，必要時附上簡短譯註。' },
    { id: 'p_teacher',  name: '循序教學',   icon: '🎓', builtin: true,
      content: '你是耐心的導師。用由淺入深的方式解釋概念：先給生活比喻、再給正式定義、最後出一題小測驗。使用繁體中文。' },
    { id: 'p_analyst',  name: '資料分析',   icon: '📊', builtin: true,
      content: '你是資料分析師。收到資料時：說明資料結構、提出 3 個洞察、指出資料品質問題，並建議下一步分析或視覺化方式。使用繁體中文。' },
    { id: 'p_math',     name: '數學家教',   icon: '∑', builtin: true,
      content: '你是數學教師。所有數學符號一律使用 LaTeX：行內用 $...$、獨立方程式用 $$...$$。先給直覺解釋，再給嚴謹推導，最後總結。使用繁體中文。' },
    { id: 'p_socratic', name: '蘇格拉底式', icon: '🧐', builtin: true,
      content: '不要直接給答案。用一連串引導性問題協助使用者自己推導結論，每次只問一到兩個問題。使用繁體中文。' },
  ];

  let custom = [];                                    // 含墓碑

  const softMode = () => !!(window.GitHubSync && GitHubSync.everConfigured());

  const load = () => { custom = (Store.get(STORAGE_KEYS.prompts, []) || []).filter(Boolean); };
  const save = () => Store.set(STORAGE_KEYS.prompts, custom);

  const liveCustom = () => custom.filter(p => !p.deleted);
  const all = () => [...liveCustom(), ...BUILTIN];

  /* ------------------------------ CRUD -------------------------------- */

  function upsert(p) {
    if (!p.id) p.id = U.uid('p');
    const now = U.nowISO();
    const i = custom.findIndex(x => x.id === p.id);
    if (i > -1) custom[i] = { ...custom[i], ...p, deleted: false, deletedAt: null, updatedAt: now };
    else custom.unshift({ icon: '💡', createdAt: now, ...p, updatedAt: now });
    save();
    window.GitHubSync?.markDirty?.();
  }

  /** 刪除 → 墓碑（有設定同步時）或直接移除 */
  function remove(id) {
    const p = custom.find(x => x.id === id);
    if (softMode() && p) {
      Object.assign(p, { deleted: true, deletedAt: U.nowISO(), updatedAt: U.nowISO(), content: '', name: '' });
    } else {
      custom = custom.filter(x => x.id !== id);
    }
    save();
    window.GitHubSync?.markDirty?.();
  }

  const rawCustom = () => custom;

  /**
   * 其他分頁改了提示詞（Store 收到廣播後呼叫）：
   * 把 IDB 最新版本併回本分頁記憶體，不寫回 Store。
   */
  function absorbRemote() {
    const remote = Store.get(STORAGE_KEYS.prompts, []);
    if (!Array.isArray(remote)) return false;
    let changed = false;
    remote.forEach(r => {
      if (!r || !r.id) return;
      const local = custom.find(x => x.id === r.id);
      if (!local) { custom.push({ ...r }); changed = true; return; }
      const lt = local.updatedAt || local.createdAt || '';
      const rt = r.updatedAt || r.createdAt || '';
      if (rt > lt) { Object.assign(local, r); changed = true; }
    });
    if (!changed) return false;
    emitChange();
    return true;
  }
 
  function emitChange() { /* 提示詞庫是 Modal 內即時渲染的，不需要全域事件 */ }

  /**
   * 覆寫整份自訂清單
   * @param {Array} list
   * @param {boolean} remote true = 來自雲端（不觸發 markDirty）
   */
  const setCustom = (list, remote = false) => {
    custom = (list || []).filter(Boolean).map(p => ({ ...p, updatedAt: p.updatedAt || U.nowISO() }));
    save();
    if (!remote) window.GitHubSync?.markDirty?.();
  };

  /* ------------------------------ Modal UI ---------------------------- */

  function open() { Modal.open('modal-prompts'); render(); }

  function render() {
    const box = U.$('#prompt-list');
    if (!box) return;
    const q = (U.$('#prompt-search')?.value || '').trim().toLowerCase();
    box.innerHTML = '';

    const list = all().filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));

    if (!list.length) { box.appendChild(U.el('p.muted', { text: '沒有符合的提示詞。' })); return; }

    list.forEach(p => {
      const card = U.el('div.prompt-card');
      card.appendChild(U.el('div.prompt-card__head', {
        html: `<span>${U.escapeHtml(p.icon || '💡')}</span><b>${U.escapeHtml(p.name)}</b>` +
              (p.builtin ? '<span class="badge">內建</span>' : ''),
      }));
      card.appendChild(U.el('div.prompt-card__body', { text: p.content }));

      const actions = U.el('div.prompt-card__actions');
      actions.appendChild(U.el('button.btn.btn--primary.btn--sm', {
        text: '設為系統提示詞',
        onclick: () => {
          const chat = Chats.current();
          if (chat) { Chats.update(chat.id, { systemPrompt: p.content }); Toast.ok(`已套用「${p.name}」到本對話`); }
          Modal.close('modal-prompts');
          UI.renderHeader();
        },
      }));
      actions.appendChild(U.el('button.btn.btn--outline.btn--sm', {
        text: '插入輸入框',
        onclick: () => {
          const ta = U.$('#user-input');
          ta.value = (ta.value ? ta.value + '\n\n' : '') + p.content;
          Modal.close('modal-prompts');
          UI.focusInput();
          UI.updateTokenCounter();
        },
      }));
      actions.appendChild(U.el('button.btn.btn--ghost.btn--sm', {
        text: p.builtin ? '複製為自訂' : '編輯',
        onclick: () => edit(p.builtin ? { ...p, id: null, name: p.name + '（副本）', builtin: false } : p),
      }));
      if (!p.builtin) {
        actions.appendChild(U.el('button.btn.btn--ghost.btn--sm', {
          text: '🗑️',
          onclick: async () => {
            if (await Modal.confirmDelete(`確定刪除提示詞「${p.name}」？`)) { remove(p.id); render(); }
          },
        }));
      }
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  async function edit(p = {}) {
    const name = await Modal.ask({ title: '提示詞名稱', input: true, value: p.name || '', placeholder: '例如：SQL 專家' });
    if (!name) return;
    const content = await Modal.ask({ title: '提示詞內容', input: true, value: p.content || '', placeholder: '你是…' });
    if (!content) return;
    upsert({ id: p.id || null, name, content, icon: p.icon || '💡' });
    render();
    Toast.ok('已儲存提示詞');
  }

  /* ------------------------------ Slash 指令 -------------------------- */

  async function handleSlash(text) {
    if (!text.startsWith('/')) return false;
    const [cmd, ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(' ');
    const chat = Chats.current();

    switch (cmd) {
      case '/help':
        UI.appendSystemNote('可用指令：\n' + SLASH_COMMANDS.map(c => `• \`${c.cmd}\` — ${c.desc}`).join('\n'));
        return true;

      case '/clear':
        Chats.clearMessages(chat.id); UI.renderAll(true); Toast.ok('已清空訊息'); return true;

      case '/new':
        UI.newChat(); return true;

      case '/temporary':
      case '/temp-chat':
        UI.newChat({ temporary: true }); return true;

      case '/keep': {
        if (!chat) return true;
        if (!chat.temporary) { Toast.info('目前已經是永久對話'); return true; }
        Chats.makePermanent(chat.id);
        UI.renderAll(true);
        Toast.ok('已轉為永久對話，之後會正常儲存與同步');
        window.GitHubSync?.markDirty?.();
        return true;
      }

      case '/model':
        UI.openModelPicker(); return true;

      case '/provider': {
        const p = (arg || '').toLowerCase();
        if (!PROVIDERS[p]) {
          UI.appendSystemNote(`目前供應商：**${PROVIDERS[Settings.get('provider')].label}**\n可用：\`${Object.keys(PROVIDERS).join('`、`')}\``);
          return true;
        }
        Settings.set('provider', p); Settings.syncDom();
        Toast.ok(`已切換到 ${PROVIDERS[p].label}`);
        return true;
      }

      case '/system':
        if (!arg) { UI.appendSystemNote(`目前系統提示詞：\n${chat.systemPrompt || Settings.get('systemPrompt') || '（無）'}`); return true; }
        Chats.update(chat.id, { systemPrompt: arg });
        UI.renderHeader();
        Toast.ok('已更新本對話系統提示詞'); return true;

      case '/temp': {
        const v = parseFloat(arg);
        if (Number.isNaN(v)) { Toast.warn('用法：/temp 0.8'); return true; }
        Settings.set('temperature', U.clamp(v, 0, 2)); Settings.syncDom();
        Toast.ok(`Temperature 已設為 ${Settings.get('temperature')}`); return true;
      }

      case '/title':
        if (!arg) { Toast.warn('用法：/title 新標題'); return true; }
        Chats.update(chat.id, { title: arg, titleLocked: true });
        UI.renderSidebar(); UI.renderHeader(); return true;

      case '/autotitle': {
        const t = Toast.loading('產生標題中…');
        try {
          const model = Models.titleModel() || Models.resolve(chat.model);
          const title = await API.generateTitle(model, Chats.visible(chat));
          if (!title) throw new Error('沒有回傳標題');
          Chats.update(chat.id, { title, titleLocked: true });
          UI.renderSidebar(); UI.renderHeader();
          t.update('已更新標題：' + title, 'ok');
        } catch (e) { t.update('產生失敗：' + e.message, 'error'); }
        return true;
      }

      case '/prompts':
        open(); return true;

      case '/export':
        UI.exportMenu(); return true;

      case '/settings':
        UI.openSettings(); return true;

      case '/sync': {
        if (!GitHubSync.enabled) { Toast.info('尚未啟用 GitHub 同步'); UI.openSettings('sync'); return true; }
        const t = Toast.loading('同步中…');
        GitHubSync.sync({ force: true })
          .then(r => t.update(r.skipped ? '生成中，稍後會自動同步'
                                        : `同步完成（拉取 ${r.pulled}／推送 ${r.pushed}）`, 'ok'))
          .catch(e => t.update('同步失敗：' + e.message, 'error'));
        return true;
      }

      case '/summary': {
        const upto = chat?.summarizedUpTo || 0;
        UI.appendSystemNote(
          '📝 自動摘要狀態\n' +
          `• 已壓縮前 ${upto} 則訊息\n` +
          '• 送請求時會以「【先前對話摘要】」系統訊息插在歷史之前\n' +
          '• 可在 🎛️ 本對話設定中編輯或清除\n\n' +
          (chat?.summary || '（目前沒有摘要：尚未達門檻，或已被清除）'));
        return true;
      }

      case '/publish': {
        const last = [...(Chats.visible(chat) || [])].reverse().find(m => m.role === 'assistant');
        if (!last) { Toast.info('沒有可發佈的助理回覆'); return true; }
        window.Publisher?.commitAll(chat, last.id);
        return true;
      }

      case '/tokens': {
        const st = Chats.stats(chat);
        UI.appendSystemNote(
          `本對話統計：\n• 訊息 ${st.count} 則\n• 提示 ${U.formatNum(st.promptTokens)} tokens\n` +
          `• 輸出 ${U.formatNum(st.completionTokens)} tokens\n• 估算花費 ${U.formatCost(st.cost)}`);
        return true;
      }

      default:
        return false;
    }
  }

  function init() {
    load();
    U.$('#prompt-search')?.addEventListener('input', U.debounce(render, 120));
    const btn = U.$('#btn-new-prompt');
    if (btn) btn.onclick = () => edit({});
  }

  return { init, all, upsert, remove, open, render, handleSlash, BUILTIN,
           custom: liveCustom, rawCustom, setCustom, absorbRemote };
})();

