// Questions are loaded from a local JSON file instead of Google Sheets.
// Dependencies: storage-sync.js (QuestionJsonSource)

const CONFIG = {
    QUESTIONS_JSON_URL: 'data/database.json',
    // Apps Script web app (/exec) from econ-database/apps-script/README.md.
    // Leave empty until that deployment exists. This URL is not a secret.
    // The Poe API key and the allowlist stay in Apps Script properties.
    POE_PROXY_WEB_APP_URL: ''
};

window.addEventListener('DOMContentLoaded', () => {
    window.questionJsonSource = new QuestionJsonSource(CONFIG.QUESTIONS_JSON_URL);
    console.log('✅ JSON question source initialized');
});
