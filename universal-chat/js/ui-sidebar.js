/* =============================================================================
 * ui-sidebar.js — 側邊欄：對話清單、資料單、資料夾（可排序）、暫時對話、寬度把手
 * -----------------------------------------------------------------------------
 * 無障礙：
 *   • 所有動態建立的圖示按鈕一律帶 aria-label。
 *   • 寬度把手支援 ← → 方向鍵微調、Home 還原預設。
 * v2.4.3：
 *   • 對話項目加上 tabindex="0" + role="button" + Enter/Space 處理，
 *     鍵盤使用者可以 Tab 到任一對話後按 Enter 切換（舊版完全無法操作）。
 * ============================================================================= */
 
window.UISidebar = (() => {
 
  const R = UIState.R;
  const state = UIState.state;
 
  function ensureExtraDom() {
    const top = U.$('.sidebar__top');
    if (top && !U.$('#btn-new-temp-chat')) {
      const btn = U.el('button.btn.btn--outline.btn--icon', {
        id: 'btn-new-temp-chat', text: '\uD83D\uDD76\uFE0F',
        title: '開新的暫時對話：不儲存、不同步（Alt+T）',
        'aria-label': '開新的暫時對話（不儲存、不同步）',
        onclick: () => UI.newChat({ temporary: true }),
      });
      const folderBtn = U.$('#btn-new-folder');
      folderBtn ? top.insertBefore(btn, folderBtn) : top.appendChild(btn);
    }
    initSidebarResizer();
  }
 
  function initSidebarResizer() {
    if (!R.sidebar || U.$('#sidebar-resizer')) return;
    const handle = U.el('div', {
      id: 'sidebar-resizer', class: 'sidebar-resizer',
      role: 'separator', 'aria-orientation': 'vertical', tabindex: '0',
      title: '拖曳調整側邊欄寬度（雙擊還原預設）',
      'aria-label': '調整側邊欄寬度（← → 微調，Home 或雙擊還原預設）',
    });
    R.sidebar.appendChild(handle);
 
    const maxW = () => Math.min(SIDEBAR_W.max, window.innerWidth - 160);
    let startX = 0, startW = 0, dragging = false;
 
    const onMove = e => {
      if (!dragging) return;
      const w = U.clamp(startW + (e.clientX - startX), SIDEBAR_W.min, maxW());
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
      Settings.set('sidebarWidth', U.clamp(w || SIDEBAR_W.default, SIDEBAR_W.min, maxW()));
    };
 
    handle.addEventListener('pointerdown', e => {
      if (window.innerWidth <= 820) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = R.sidebar.getBoundingClientRect().width;
      document.body.classList.add('is-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });
 
    handle.addEventListener('keydown', e => {
      if (window.innerWidth <= 820) return;
      const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10)
                  || SIDEBAR_W.default;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        Settings.set('sidebarWidth', U.clamp(cur - 16, SIDEBAR_W.min, maxW()));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        Settings.set('sidebarWidth', U.clamp(cur + 16, SIDEBAR_W.min, maxW()));
      } else if (e.key === 'Home') {
        e.preventDefault();
        Settings.set('sidebarWidth', SIDEBAR_W.default);
      }
    });
 
    handle.addEventListener('dblclick', () => Settings.set('sidebarWidth', SIDEBAR_W.default));
  }
 
  /* ------------------------------ 清單渲染 --------------------------- */
 
  function renderSidebar(force = false) {
    UIHeader.updateStorageBadge();
 
    const sig = UIState.sideSig();
    if (!force && sig === UIState.sig.side) return;
    UIState.sig.side = sig;
 
    const box = R.chatList;
    box.innerHTML = '';
 
    const q = state.sidebarQuery.toLowerCase();
    let items = Chats.sorted(state.filter);
    if (q) items = items.filter(c => c.title.toLowerCase().includes(q));
 
    if (!items.length) {
      box.appendChild(U.el('p.muted', { text: q ? '沒有符合的對話' : '尚無對話', style: 'padding:10px' }));
      return;
    }
 
    const folders = Chats.foldersList();
    const noFolder = items.filter(c => !c.folderId || !folders.some(f => f.id === c.folderId));
 
    folders.forEach((f, i) => {
      const inside = items.filter(c => c.folderId === f.id);
      if (!inside.length && q) return;
      box.appendChild(folderNode(f, inside, i, folders.length));
    });
    noFolder.forEach(c => box.appendChild(chatNode(c)));
  }
 
  function folderNode(folder, children, index = 0, total = 1) {
    const wrap = U.el('div.folder' + (folder.collapsed ? '.is-collapsed' : ''), { dataset: { folder: folder.id } });
 
    const head = U.el('div.folder__head', { draggable: 'true' }, [
      U.el('span', { text: folder.collapsed ? '\u25B8' : '\u25BE' }),
      U.el('span.grow', { text: '\uD83D\uDCC1 ' + folder.name }),
      U.el('span.muted', { text: String(children.length) }),
    ]);
 
    const acts = U.el('div.folder__actions');
    const mv = (label, dir, title, disabled) => {
      const b = U.el('button', {
        text: label, title, 'aria-label': title,
        onclick: e => { e.stopPropagation(); if (Chats.moveFolder(folder.id, dir)) renderSidebar(true); },
      });
      if (disabled) b.disabled = true;
      return b;
    };
    acts.appendChild(mv('\u2191', -1, '上移資料夾', index === 0));
    acts.appendChild(mv('\u2193', +1, '下移資料夾', index === total - 1));
    head.appendChild(acts);
 
    head.onclick = () => { Chats.updateFolder(folder.id, { collapsed: !folder.collapsed }); renderSidebar(true); };
    head.oncontextmenu = async e => {
      e.preventDefault();
      const name = await Modal.ask({ title: '重新命名資料夾（清空名稱＝刪除）', input: true, value: folder.name });
      if (name === null) return;
      name ? Chats.updateFolder(folder.id, { name }) : Chats.removeFolder(folder.id);
      renderSidebar(true);
    };
 
    head.ondragstart = e => {
      e.dataTransfer.setData('text/folder-id', folder.id);
      e.dataTransfer.effectAllowed = 'move';
    };
    head.ondragover = e => {
      e.preventDefault();
      wrap.classList.add(e.dataTransfer.types.includes('text/folder-id') ? 'drop-before' : 'drag-over');
    };
    head.ondragleave = () => wrap.classList.remove('drag-over', 'drop-before');
    head.ondrop = e => {
      e.preventDefault();
      wrap.classList.remove('drag-over', 'drop-before');
      const fid = e.dataTransfer.getData('text/folder-id');
      if (fid) { if (Chats.reorderFolders(fid, folder.id)) renderSidebar(true); return; }
      const id = e.dataTransfer.getData('text/chat-id');
      if (id) { Chats.moveToFolder(id, folder.id); renderSidebar(true); }
    };
 
    wrap.appendChild(head);
    const body = U.el('div.folder__body');
    children.forEach(c => body.appendChild(chatNode(c)));
    wrap.appendChild(body);
    return wrap;
  }
 
  const iconBtn = (text, title, onclick) =>
    U.el('button', { text, title, 'aria-label': title, onclick });
 
  function chatNode(chat) {
    const active = chat.id === Chats.currentIdOf();
    const gen = UIState.isGenerating(chat.id);
    const cls = 'div.chat-item' +
      (active ? '.is-active' : '') +
      (chat.pinned ? '.is-pinned' : '') +
      (chat.archived ? '.is-archived' : '') +
      (chat.temporary ? '.is-temp' : '') +
      (gen ? '.is-generating' : '');
 
    /* v2.4.3：tabindex="0" + role="button" 讓鍵盤使用者可以 Tab 到此項目，
       再按 Enter 或 Space 切換對話（配合 keydown 監聽）。 */
    const node = U.el(cls, {
      draggable: 'true',
      tabindex: '0',
      role: 'button',
      'aria-selected': String(active),
      title: chat.title + '\n' + U.timeAgo(chat.updatedAt) +
             (chat.temporary ? '\n\uD83D\uDD76\uFE0F 暫時對話：不會儲存／同步' : '') +
             (gen ? '\n\u231B 正在生成回覆\u2026' : '') +
             (chat._offloaded ? '\n（內容在雲端，點擊下載）' : ''),
    });
 
    node.appendChild(gen
      ? U.el('span.chat-item__spin', { html: '<span class="spinner"></span>' })
      : U.el('span', { text: chat.temporary ? '🕶️' : (chat._offloaded ? '☁️' : (chat.pinned ? '📌' : '💬')) }));
 
    node.appendChild(U.el('span.chat-item__title', { text: chat.title }));
    const n = Chats.visible(chat).length;
    if (n) node.appendChild(U.el('span.chat-item__count', { text: String(n) }));
 
    const acts = U.el('div.chat-item__actions');
    acts.appendChild(iconBtn(chat.pinned ? '\uD83D\uDCCD' : '\uD83D\uDCCC', '釘選/取消釘選', e => {
      e.stopPropagation(); Chats.togglePin(chat.id); renderSidebar(true);
    }));
    acts.appendChild(iconBtn('\u270F\uFE0F', '重新命名', async e => { e.stopPropagation(); await renameChat(chat); }));
    acts.appendChild(iconBtn(
      chat.temporary ? '\uD83D\uDCBE' : '\uD83D\uDD76\uFE0F',
      chat.temporary ? '轉為永久對話（開始儲存／同步）' : '轉為暫時對話（不儲存）',
      async e => { e.stopPropagation(); await toggleTemporary(chat); }));
    acts.appendChild(iconBtn(chat.archived ? '\uD83D\uDCE4' : '\uD83D\uDCE5', chat.archived ? '取消封存' : '封存', e => {
      e.stopPropagation(); Chats.toggleArchive(chat.id); renderSidebar(true);
    }));
    acts.appendChild(iconBtn('\uD83D\uDDD1\uFE0F', '刪除', async e => {
      e.stopPropagation();
      const tail = chat.temporary ? '（暫時對話沒有備份，刪除後無法復原）' : '此動作無法復原。';
      if (await Modal.confirmDelete('確定刪除對話「' + chat.title + '」？' + tail)) {
        UIComposer.stopGeneration(chat.id);
        Chats.remove(chat.id);
        UI.renderAll(true);
      }
    }));
    node.appendChild(acts);
 
    node.onclick = () => selectChat(chat.id);
 
    /* v2.4.3：Enter / Space 觸發切換 */
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectChat(chat.id);
      }
    });
 
    node.ondragstart = e => e.dataTransfer.setData('text/chat-id', chat.id);
    return node;
  }
 
  async function selectChat(id) {
    if (id === Chats.currentIdOf()) { UIComposer.focusInput(); return; }
    UIComposer.saveDraft();
 
    const raw = Chats.findRaw(id);
    if (raw?._offloaded) {
      const t = Toast.loading('從 GitHub 下載對話內容\u2026');
      try { await GitHubSync.ensureLoaded(id); t.close(); }
      catch (e) { t.update('下載失敗：' + e.message, 'error'); return; }
    }
 
    Chats.switchTo(id);
    UI.renderAll(true);
    if (window.innerWidth <= 820) R.app.classList.remove('sidebar-open');
    UIComposer.loadDraft();
    UIComposer.syncComposerState();
    UIComposer.focusInput();
  }
 
  async function renameChat(chat) {
    const t = await Modal.ask({
      title: '重新命名對話',
      input: true,
      value: chat.title,
      placeholder: '輸入標題，或按「\u2728 AI 產生」',
      extra: { text: '\u2728 AI 產生', onClick: (input, btn) => UIModals.aiTitleInto(chat, input, btn) },
    });
    if (t) {
      Chats.update(chat.id, { title: t, titleLocked: true });
      renderSidebar(true); UIHeader.renderHeader();
    }
  }
 
  async function toggleTemporary(chat) {
    if (chat.temporary) {
      if (!Chats.makePermanent(chat.id)) return;
      UI.renderAll(true);
      Toast.ok('已轉為永久對話，之後會正常儲存與同步');
      window.GitHubSync?.markDirty?.();
      return;
    }
    const cloud = window.GitHubSync?.everConfigured?.() ? '與雲端' : '';
    const ok = await Modal.ask({
      title: '轉為暫時對話',
      message: '「' + chat.title + '」將變成暫時對話：內容只留在這個分頁，' +
               '關閉或重新載入後就會消失，並且會從本機' + cloud + '的儲存中移除。要繼續嗎？',
      okText: '轉為暫時', danger: true,
    });
    if (!ok) return;
    if (Chats.makeTemporary(chat.id)) {
      UI.renderAll(true);
      Toast.warn('已轉為暫時對話：關閉分頁後內容將消失', 6000);
    }
  }
 
  function toggleSidebar() {
    if (window.innerWidth <= 820) R.app.classList.toggle('sidebar-open');
    else Settings.set('sidebarCollapsed', !Settings.get('sidebarCollapsed'));
  }
 
  return {
    ensureExtraDom, initSidebarResizer, renderSidebar, folderNode, chatNode,
    selectChat, renameChat, toggleTemporary, toggleSidebar,
  };
})();