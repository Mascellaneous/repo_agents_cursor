/* =============================================================================
 * exporter.js — 匯出與匯入
 * 支援：單一對話 JSON / Markdown / TXT / 獨立 HTML / CSV；整體備份 JSON
 * ============================================================================= */
 
window.Exporter = (() => {
 
  const FORMATS = { json: toJson, md: toMarkdown, txt: toText, html: toHtml, csv: toCsv };
 
  /* ------------------------------ 單一對話 ---------------------------- */
 
  function exportChat(chat, format = 'md') {
    if (!chat) { Toast.warn('沒有可匯出的對話'); return; }
    const base = `chat-${U.safeFilename(chat.title)}-${new Date().toISOString().slice(0, 10)}`;
    const { content, mime, ext } = (FORMATS[format] || toMarkdown)(chat);
    U.download(`${base}.${ext}`, content, mime);
    Toast.ok(`已匯出 ${ext.toUpperCase()}`);
  }
 
  function toJson(chat) {
    const st = Chats.stats(chat);
    return {
      ext: 'json',
      mime: 'application/json;charset=utf-8',
      content: JSON.stringify({
        app: APP.name, version: APP.version, exportedAt: U.nowISO(),
        title: chat.title, model: chat.model, systemPrompt: chat.systemPrompt,
        stats: st, messages: Chats.visible(chat),
      }, null, 2),
    };
  }
 
  function toMarkdown(chat) {
    const st = Chats.stats(chat);
    const L = [
      `# ${chat.title}`, '',
      `> 匯出時間：${U.formatDateTime(U.nowISO())}`,
      `> 訊息數：${st.count}｜Tokens：${U.formatNum(st.promptTokens + st.completionTokens)}｜估算花費：${U.formatCost(st.cost)}`, '',
    ];
    if (chat.systemPrompt) L.push('## 系統提示詞', '', 'text', chat.systemPrompt, '', '');
    L.push('---', '');
    Chats.visible(chat).forEach(m => {
      const who = m.role === 'user' ? '🧑 使用者' : (m.role === 'assistant' ? '🤖 助理' : 'ℹ️ 系統');
      L.push(`### ${who}${m.model ? `　\`${m.model}\`` : ''}　<sub>${U.formatStamp(m.createdAt)}` +
             `${m.durationMs ? `　·　⏱ ${U.formatDuration(m.durationMs)}` : ''}</sub>`, '');
      if (m.attachments?.length) L.push(`附件：${m.attachments.map(a => a.name).join('、')}`, '');
      if (m.reasoning) L.push('<details><summary>思考過程</summary>', '', m.reasoning, '', '</details>', '');
      L.push(m.content || '（無內容）', '');
    });
    return { ext: 'md', mime: 'text/markdown;charset=utf-8', content: L.join('\n') };
  }
 
  function toText(chat) {
    const L = [`${chat.title}`, `匯出時間：${U.formatDateTime(U.nowISO())}`, '='.repeat(40), ''];
    Chats.visible(chat).forEach(m => {
      L.push(`[${m.role === 'user' ? '使用者' : '助理'}] ${U.formatDateTime(m.createdAt)}`);
      L.push(m.content || '', '-'.repeat(40), '');
    });
    return { ext: 'txt', mime: 'text/plain;charset=utf-8', content: L.join('\n') };
  }
 
  /** CSV（含 BOM，Excel 開啟不亂碼） */
  function toCsv(chat) {
    const rows = [['role', 'model', 'time', 'duration_ms', 'prompt_tokens', 'completion_tokens', 'cost_usd', 'content']];
    Chats.visible(chat).forEach(m => rows.push([
      m.role, m.model || '', m.createdAt, m.durationMs || 0,
      m.usage?.prompt_tokens || 0, m.usage?.completion_tokens || 0, m.cost || 0,
      m.content || '',
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    return { ext: 'csv', mime: 'text/csv;charset=utf-8', content: '\uFEFF' + csv };
  }
 
  /** 產生可離線瀏覽的單檔 HTML（含數學樣式） */
  function toHtml(chat) {
    const body = Chats.visible(chat).map(m => {
      const who = m.role === 'user' ? '🧑 使用者' : '🤖 助理';
      const html = Settings.get('renderMarkdown') ? MD.render(m.content || '') : `<pre>${U.escapeHtml(m.content || '')}</pre>`;
      return `<article class="m ${m.role}"><header>${who}${m.model ? ` · <code>${U.escapeHtml(m.model)}</code>` : ''}
        <time>${U.formatDateTime(m.createdAt)}</time></header><div class="c">${html}</div></article>`;
    }).join('\n');
 
    const content = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${U.escapeHtml(chat.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css">
<style>
body{font-family:system-ui,"Noto Sans TC",sans-serif;max-width:840px;margin:32px auto;padding:0 16px;background:#fff;color:#222;line-height:1.7}
h1{font-size:1.5rem} .m{border:1px solid #e5e5e5;border-radius:12px;padding:14px 16px;margin:14px 0}
.m.user{background:#f7fbff} .m.assistant{background:#fafafa}
.m header{font-size:.8rem;color:#666;display:flex;gap:8px;justify-content:space-between;margin-bottom:8px}
pre{background:#0d1117;color:#e6edf3;padding:12px;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,Consolas,monospace} table{border-collapse:collapse}
th,td{border:1px solid #ddd;padding:6px 10px} blockquote{border-left:3px solid #10a37f;margin:0;padding-left:12px;color:#555}
img{max-width:100%}
.code-block__head{display:none} .code-block pre{margin:0}
/* --- 數學：KaTeX 與內建 fallback --- */
.katex-display{margin:.8em 0;overflow-x:auto;overflow-y:hidden}
.mathx{font-family:"Cambria Math","STIX Two Math",Georgia,serif;white-space:nowrap}
.mathx--display{display:block;text-align:center;margin:.8em 0;overflow-x:auto}
.mathx sub,.mathx sup{font-size:.74em;line-height:0}
.mathx .mvar{font-style:italic} .mathx .mtext{font-style:normal;font-family:inherit}
.mathx .mfrac{display:inline-flex;flex-direction:column;vertical-align:-.52em;text-align:center;margin:0 .16em}
.mathx .mfrac>span:first-child{border-bottom:1px solid currentColor;padding:0 .3em}
.mathx .mfrac>span:last-child{padding:0 .3em}
.mathx .msqrt{border-top:1px solid currentColor;padding:0 .18em}
.mathx .macc{position:relative;display:inline-block}
.mathx .macc::before{content:attr(data-a);position:absolute;top:-.62em;left:50%;transform:translateX(-50%);font-size:.85em}
.mathx .mspace{display:inline-block;width:.5em}
.math-error{color:#c00;background:#fee;padding:0 .3em;border-radius:4px}
</style></head><body><h1>${U.escapeHtml(chat.title)}</h1>
<p style="color:#777;font-size:.85rem">匯出於 ${U.formatDateTime(U.nowISO())}　由 ${APP.name} v${APP.version} 產生</p>
${body}</body></html>`;
    return { ext: 'html', mime: 'text/html;charset=utf-8', content };
  }
 
  /* ------------------------------ 整體備份 ---------------------------- */
 
  function exportAll() {
    const data = Store.exportAll();
    data.chats = (data.chats || []).filter(c => !c.deleted);
    data.folders = (data.folders || []).filter(f => !f.deleted);
    data.prompts = (data.prompts || []).filter(p => !p.deleted);
    U.download(`universal-chat-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    Toast.ok(`已匯出 ${data.chats.length} 個對話的備份`);
  }
 
  async function importAll(file) {
    try {
      const json = JSON.parse(await U.readAsText(file));
      /* 第一步：選擇模式（合併 / 覆蓋 / 取消） */      
      const choice = await Modal.ask({
        title: '匯入備份',
        message: '檔案含 ' + (json.chats?.length || 0) + ' 個對話、' + (json.prompts?.length || 0) + ' 個提示詞。\n\n' +
                 '「合併」＝與現有資料三方合併（安全，推薦）\n' +
                 '「覆蓋」＝完全取代現有資料（需打字確認）',
        okText: '合併', cancelText: '取消',
        extra: { text: '覆蓋\u2026', onClick: async () => {
          const v = await Modal.ask({
            title: '以備份覆蓋所有資料',
            input: true, value: '',
            okText: '確認覆蓋', danger: true,
            message: '這會完全取代目前所有的對話、資料夾、提示詞與設定。\n此動作無法復原。\n\n請輸入 OVERWRITE 確認：',
          });
          if (v === 'OVERWRITE') {
            Store.importAll(json, 'replace');
            await Store.flush();
            Toast.ok('匯入完成，即將重新載入\u2026');
            setTimeout(() => location.reload(), 900);
          }
        }},
      });
 
      /* choice：true＝按了「合併」、false＝按了「取消」、null＝Esc／backdrop。
         三者之中只有 true 要繼續。 */
      if (choice !== true) return;
 
      Store.importAll(json, 'merge');
      await Store.flush();
      Toast.ok('匯入完成，即將重新載入\u2026');
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      Toast.error('匯入失敗：' + e.message);
    }
  }
 
  return { exportChat, exportAll, importAll, FORMATS };
})();