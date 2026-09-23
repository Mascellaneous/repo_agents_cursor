/* =============================================================================
 * voice.js — 語音輸入（SpeechRecognition）與朗讀（SpeechSynthesis）
 * 兩者皆為瀏覽器原生 API：不支援時自動停用相關按鈕。
 * ============================================================================= */

window.Voice = (() => {

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let voices = [];

  /* ------------------------------ 語音輸入 ---------------------------- */

  const sttSupported = () => !!SR;

  function startListening(onResult, onEnd) {
    if (!SR) { Toast.warn('此瀏覽器不支援語音輸入（建議使用 Chrome / Edge）'); return false; }
    stopListening();

    recognition = new SR();
    recognition.lang = Settings.get('sttLang') || 'zh-TW';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalText = '';
    recognition.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        e.results[i].isFinal ? (finalText += t) : (interim += t);
      }
      onResult?.(finalText, interim);
    };
    recognition.onerror = e => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') Toast.error('語音辨識錯誤：' + e.error);
    };
    recognition.onend = () => { listening = false; onEnd?.(finalText); };

    try { recognition.start(); listening = true; return true; }
    catch (e) { Toast.error('無法啟動麥克風：' + e.message); return false; }
  }

  function stopListening() {
    try { recognition?.stop(); } catch { /* ignore */ }
    listening = false;
  }

  const isListening = () => listening;

  /* ------------------------------ 朗讀 -------------------------------- */

  const ttsSupported = () => 'speechSynthesis' in window;

  /** 載入語音清單並填入設定的 <select> */
  function loadVoices() {
    if (!ttsSupported()) return;
    voices = speechSynthesis.getVoices();
    const sel = U.$('#tts-voice');
    if (!sel) return;
    const cur = Settings.get('ttsVoice');
    sel.innerHTML = '<option value="">（系統預設）</option>';
    voices.forEach(v => {
      const o = U.el('option', { value: v.name, text: `${v.name}（${v.lang}）` });
      if (v.name === cur) o.selected = true;
      sel.appendChild(o);
    });
  }

  /** 朗讀文字（自動去除 Markdown 記號與程式碼區塊） */
  function speak(text) {
    if (!ttsSupported() || !text) return;
    stopSpeaking();
    const clean = String(text)
      .replace(/```[\s\S]*?```/g, '（程式碼區塊略過）')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\$\$[\s\S]*?\$\$/g, '（數學式略過）')
      .replace(/\$([^$\n]+)\$/g, '$1')
      .replace(/[*_#>|]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 4000);                                   // 避免過長

    const u = new SpeechSynthesisUtterance(clean);
    u.rate = Settings.get('ttsRate') || 1;
    u.pitch = Settings.get('ttsPitch') || 1;
    const vName = Settings.get('ttsVoice');
    const v = voices.find(x => x.name === vName);
    if (v) u.voice = v;
    else u.lang = Settings.get('sttLang') || 'zh-TW';
    speechSynthesis.speak(u);
  }

  const stopSpeaking = () => { if (ttsSupported()) speechSynthesis.cancel(); };
  const isSpeaking = () => ttsSupported() && speechSynthesis.speaking;

  function init() {
    if (ttsSupported()) {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    if (!sttSupported()) U.$('#btn-mic')?.classList.add('hidden');
    const test = U.$('#btn-tts-test');
    if (test) test.onclick = () => speak('你好，這是語音朗讀測試。');
  }

  return { init, sttSupported, startListening, stopListening, isListening, ttsSupported, speak, stopSpeaking, isSpeaking, loadVoices };
})();