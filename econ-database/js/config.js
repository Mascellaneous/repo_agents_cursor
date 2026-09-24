// Questions are loaded from a local JSON file instead of Google Sheets.
// Dependencies: storage-sync.js (QuestionJsonSource)

const CONFIG = {
    QUESTIONS_JSON_URL: 'data/database.json'
};

window.addEventListener('DOMContentLoaded', () => {
    window.questionJsonSource = new QuestionJsonSource(CONFIG.QUESTIONS_JSON_URL);
    console.log('✅ JSON question source initialized');
});
