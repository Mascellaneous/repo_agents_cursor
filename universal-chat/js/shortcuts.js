/* =============================================================================
 * shortcuts.js — 全域鍵盤快捷鍵 + 說明表格
 * -----------------------------------------------------------------------------
 * v2.4.3：
 *   • Esc 的優先序調整為：退出專注模式 → 關閉 Modal → 停止朗讀 → 停止生成。
 *     舊版「停止生成」排在第一位，使用者想退出專注模式卻誤停了正在生成的回覆。
 * ============================================================================= */
 
window.Shortcuts = (() => {
 
  const inField = t =>
    t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
 
  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
 
    if (e.key === 'Escape') {
      /* v2.4.3 優先序（由高到低）：
         1. 退出專注模式（最無害的操作，且是使用者按 Esc 最常見的意圖）
         2. 關閉最上層 Modal
         3. 停止朗讀
         4. 停止生成（最後才嘗試——避免誤停正在生成的回覆） */
      if (UI.exitFocusMode()) return;
      if (Modal.closeTop()) return;
      if (Voice.isSpeaking()) { Voice.stopSpeaking(); return; }
      UI.stopGeneration();
      return;
    }
 
    if (!mod) {
      if (e.altKey && key === 't' && !inField(e.target)) {
        e.preventDefault(); UI.newChat({ temporary: true }); return;
      }
      if (e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        UI.jumpBookmark(e.key === ']' ? 1 : -1);
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const list = Chats.sorted('all');
        const i = list.findIndex(c => c.id === Chats.currentIdOf());
        const next = list[U.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, list.length - 1)];
        if (next && next.id !== Chats.currentIdOf()) UI.selectChat(next.id);
      }
      return;
    }
 
    switch (key) {
      case 'k': e.preventDefault(); UI.openSearch(); break;
      case 'm': e.preventDefault(); UI.openModelPicker(); break;
      case 'p': e.preventDefault(); Prompts.open(); break;
      case 'b': e.preventDefault(); UI.toggleSidebar(); break;
      case ',': e.preventDefault(); UI.openSettings(); break;
      case '/': e.preventDefault(); Modal.open('modal-shortcuts'); break;
 
      case 'f':
        if (e.shiftKey) { e.preventDefault(); UI.toggleFocusMode(); }
        break;
 
      case 'o':
        if (e.shiftKey) { e.preventDefault(); UI.newChat(); }
        break;
 
      case 's': {
        e.preventDefault();
        if (!e.shiftKey) break;
        if (!GitHubSync.enabled) { Toast.info('尚未啟用 GitHub 同步'); UI.openSettings('sync'); break; }
        const t = Toast.loading('同步中\u2026');
        GitHubSync.sync({ force: true })
          .then(r => t.update('同步完成（拉取 ' + r.pulled + '\uff0f推送 ' + r.pushed + '）', 'ok'))
          .catch(err => t.update('同步失敗：' + err.message, 'error'));
        break;
      }
 
      case 'r':
        if (e.shiftKey) {
          e.preventDefault();
          const chat = Chats.current();
          const last = [...Chats.visible(chat)].reverse().find(m => m.role === 'assistant');
          if (last) U.$('.msg[data-id="' + last.id + '"] .msg__actions button[title="重新生成這則回覆"]')?.click();
          else Toast.info('沒有可重新生成的回覆');
        }
        break;
 
      case 'c':
        if (e.shiftKey && !inField(e.target)) {
          e.preventDefault();
          const chat = Chats.current();
          const last = [...Chats.visible(chat)].reverse().find(m => m.role === 'assistant');
          if (last) { U.copy(last.content); Toast.ok('已複製最後一則回覆'); }
        }
        break;
 
      case 'e':
        if (e.shiftKey) { e.preventDefault(); Exporter.exportChat(Chats.current(), 'md'); }
        break;
 
      case 'enter':
        if (inField(e.target) && e.target.id === 'user-input') { e.preventDefault(); UI.handleSend(); }
        break;
    }
  }
 
  function renderTable() {
    const t = U.$('#shortcuts-table');
    if (!t) return;
    t.innerHTML = SHORTCUTS.map(s =>
      '<tr><td>' + s.keys.map(k => '<kbd>' + U.escapeHtml(k) + '</kbd>').join(' + ') +
      '</td><td>' + U.escapeHtml(s.desc) + '</td></tr>'
    ).join('') +
    '<tr><td colspan="2" style="padding-top:14px"><b>Slash 指令</b></td></tr>' +
    SLASH_COMMANDS.map(c =>
      '<tr><td><kbd>' + U.escapeHtml(c.cmd) + '</kbd></td><td>' + U.escapeHtml(c.desc) + '</td></tr>'
    ).join('');
  }
 
  function init() {
    document.addEventListener('keydown', onKeyDown);
    renderTable();
  }
 
  return { init, renderTable };
})();