// Form functions
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), main.js (refreshViews), constants.js (DEFAULT_PUBLISHER)

// Dependencies: globals.js (window.editingId), constants.js (DEFAULT_PUBLISHER)
function toggleForm() {
    const form = document.getElementById('form-section');
    const isHidden = form.classList.contains('hidden');
    
    if (isHidden) {
        form.classList.remove('hidden');
        document.getElementById('form-title').textContent = '新增題目';
        window.editingId = null;
        clearForm();
    } else {
        form.classList.add('hidden');
    }
}

// Dependencies: constants.js (DEFAULT_PUBLISHER)
function clearForm() {
    document.getElementById('question-form').reset();
    const publisherField = document.getElementById('publisher');
    if (publisherField) {
        publisherField.value = DEFAULT_PUBLISHER;
    }
}

// Dependencies: globals.js (window.editingId)
function cancelEdit() {
    document.getElementById('form-section').classList.add('hidden');
    window.editingId = null;
    clearForm();
}

// Check for duplicate questions
// Dependencies: storage-core.js (window.storage)
async function checkDuplicate(formData) {
    const questions = await window.storage.getQuestions();
    return questions.some(q => 
        q.examination === formData.examination &&
        q.year === formData.year &&
        q.section === formData.section &&
        q.questionNumber === formData.questionNumber &&
        q.id !== window.editingId // Don't count self when editing
    );
}

// Save question
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), main.js (refreshViews)
function setupFormHandler() {
    const form = document.getElementById('question-form');
    if (!form) return;
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Auto-fill '-' for empty fields
        const multipleSelectionType = document.getElementById('multiple-selection-type').value.trim() || '-';
        const graphType = document.getElementById('graph-type').value.trim() || '-';
        const tableType = document.getElementById('table-type').value.trim() || '-';

        // Safely get AI Explanation value if the input exists in the DOM
        const aiExplanationInput = document.getElementById('ai-explanation');
        const aiExplanationValue = aiExplanationInput ? aiExplanationInput.value.trim() : '';

        const question = {
            id: window.editingId || document.getElementById('question-id').value.trim(),
            publisher: document.getElementById('publisher').value.trim(),
            examination: document.getElementById('examination').value,
            year: parseInt(document.getElementById('year').value),
            paper: document.getElementById('paper').value.trim(),
            questionType: document.getElementById('question-type').value,
            marks: parseFloat(document.getElementById('marks').value) || 0,
            section: document.getElementById('section').value.trim(),
            questionNumber: document.getElementById('question-number').value.trim(),
            questionTextChi: document.getElementById('question-text-chi').value.trim(),
            questionTextEng: document.getElementById('question-text-eng').value.trim(),
            multipleSelectionType: multipleSelectionType,
            graphType: graphType,
            tableType: tableType,
            calculationType: document.getElementById('calculation-type').value.trim() || '-',            
            answerMC: document.getElementById('answer-mc').value.trim(),
            answerChi: document.getElementById('answer-chi').value.trim(),
            answerEng: document.getElementById('answer-eng').value.trim(),
            correctPercentage: parseFloat(document.getElementById('correct-percentage').value) || null,
            markersReportChi: document.getElementById('markers-report-chi').value.trim(),
            markersReportEng: document.getElementById('markers-report-eng').value.trim(),
            curriculumClassification: document.getElementById('curriculum-classification').value.split(',').map(s => s.trim()).filter(s => s),
            AristochapterClassification: document.getElementById('chapter-classification').value.split(',').map(s => s.trim()).filter(s => s),
            concepts: document.getElementById('concepts').value.split(',').map(s => s.trim()).filter(s => s),
            patterns: document.getElementById('patterns').value.split(',').map(s => s.trim()).filter(s => s),
            optionDesign: document.getElementById('option-design').value.trim(),
            AIExplanation: aiExplanationValue,
            remarks: document.getElementById('remarks').value.trim(),
            dateAdded: window.editingId ? null : new Date().toISOString(),
            dateModified: new Date().toISOString()
        };
        
        if (!question.id) {
            alert('請輸入題目 ID');
            return;
        }

        // Check for duplicates (only when adding new questions)
        if (!window.editingId) {
            const isDuplicate = await checkDuplicate(question);
            if (isDuplicate) {
                const confirmMsg = `已存在相同的題目：\n\n` +
                                 `考試: ${question.examination}\n` +
                                 `年份: ${question.year}\n` +
                                 `Section: ${question.section}\n` +
                                 `題號: ${question.questionNumber}\n\n` +
                                 `確定要新增嗎？`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }
            // Use addQuestion for new items
            await window.storage.addQuestion(question);
        } else {
            // Use updateQuestion for existing items
            await window.storage.updateQuestion(question);
        }       

        await refreshViews();
        
        document.getElementById('form-section').classList.add('hidden');
        clearForm();
        window.editingId = null;
    });
}




// Edit question
// Dependencies: globals.js (window.editingId), storage-core.js (window.storage), constants.js (DEFAULT_PUBLISHER), main.js (scrollToTop)
async function editQuestion(id) {

    scrollToTop();

    const questions = await window.storage.getQuestions();
    const question = questions.find(q => q.id === id);
    
    if (!question) {
        alert('找不到題目');
        return;
    }
    
    window.editingId = id;
    
    document.getElementById('question-id').value = question.id;
    document.getElementById('publisher').value = question.publisher || DEFAULT_PUBLISHER;
    document.getElementById('examination').value = question.examination;
    document.getElementById('year').value = question.year;
    document.getElementById('paper').value = question.paper || '';
    document.getElementById('question-type').value = question.questionType;
    document.getElementById('marks').value = question.marks || '';
    document.getElementById('section').value = question.section || '';
    document.getElementById('question-number').value = question.questionNumber || '';
    document.getElementById('question-text-chi').value = question.questionTextChi || '';
    document.getElementById('question-text-eng').value = question.questionTextEng || '';
    // Don't show '-' in the form, leave it empty
    document.getElementById('multiple-selection-type').value = question.multipleSelectionType === '-' ? '' : (question.multipleSelectionType || '');
    document.getElementById('graph-type').value = question.graphType === '-' ? '' : (question.graphType || '');
    document.getElementById('table-type').value = question.tableType === '-' ? '' : (question.tableType || '');
    document.getElementById('calculation-type').value = question.calculationType === '-' ? '' : (question.calculationType || '');
    document.getElementById('correct-percentage').value = question.correctPercentage || '';
    document.getElementById('answer-mc').value = question.answerMC || '';
    document.getElementById('answer-chi').value = question.answerChi || '';    
    document.getElementById('answer-eng').value = question.answerEng || '';    
    document.getElementById('markers-report-chi').value = question.markersReportChi || '';
    document.getElementById('markers-report-eng').value = question.markersReportEng || '';

    document.getElementById('curriculum-classification').value = (question.curriculumClassification || []).join(', ');
    document.getElementById('chapter-classification').value = (question.AristochapterClassification || []).join(', ');
    document.getElementById('concepts').value = (question.concepts || []).join(', ');
    document.getElementById('patterns').value = (question.patterns || []).join(', ');
    document.getElementById('option-design').value = question.optionDesign || '';
    // Safely populate AI Explanation if input exists
    const aiExplanationInput = document.getElementById('ai-explanation');
    if (aiExplanationInput) {
        aiExplanationInput.value = question.AIExplanation || '';
    }
    document.getElementById('remarks').value = question.remarks || '';
    
    document.getElementById('form-section').classList.remove('hidden');
    document.getElementById('form-title').textContent = '編輯題目';
}

// Delete question
// Dependencies: storage-core.js (window.storage), main.js (refreshViews)
async function deleteQuestion(id) {
    if (confirm('確定要刪除此題目？')) {
        await window.storage.deleteQuestion(id);
        await refreshViews();
    }
}

// Feedback Form Logic

// Open the feedback modal
function openFeedbackModal(questionId) {
    const modal = document.getElementById('feedback-modal');
    const idSpan = document.getElementById('feedback-question-id');
    const textArea = document.getElementById('feedback-text');
    
    if (modal && idSpan) {
        idSpan.textContent = questionId;
        textArea.value = ''; // Clear previous text
        
        // Remove 'hidden' class to ensure visibility
        modal.classList.remove('hidden');
        modal.style.display = 'flex'; // Ensure flex layout for centering
        
        textArea.focus();
    } else {
        console.error('Feedback modal elements not found in DOM');
    }
}

// Close the feedback modal
function closeFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (modal) {
        // Add 'hidden' class back
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

// Submit feedback to Google Sheets via Apps Script
async function submitFeedback() {
    const questionId = document.getElementById('feedback-question-id').textContent;
    const feedbackText = document.getElementById('feedback-text').value.trim();
    const username = window.authManager ? window.authManager.currentUser : 'Anonymous';
    
    if (!feedbackText) {
        alert('請輸入回報內容');
        return;
    }
    
    // Show loading state on button
    const submitBtn = document.querySelector('#feedback-modal button[onclick="submitFeedback()"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '傳送中...';
    submitBtn.disabled = true;
    
    try {
        // Construct the URL for the Google Apps Script
        const scriptUrl = window.googleSheetsSync ? window.googleSheetsSync.webAppUrl : CONFIG.GOOGLE_APPS_SCRIPT_URL;
        
        // We no longer send targetSheetId; the backend handles it via config.gs
        const url = `${scriptUrl}?action=feedback&questionId=${encodeURIComponent(questionId)}&username=${encodeURIComponent(username)}&comment=${encodeURIComponent(feedbackText)}`;
        
        const response = await fetch(url);
        
        if (response.ok) {
            alert('✅ 感謝您的回報！我們已收到您的建議。');
            closeFeedbackModal();
        } else {
            throw new Error('Server response not ok');
        }
    } catch (error) {
        console.error('Feedback error:', error);
        alert('❌ 傳送失敗，請稍後再試。');
    } finally {
        if (submitBtn) {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    }
}


// Close modal when clicking outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('feedback-modal');
    if (event.target === modal) {
        closeFeedbackModal();
    }
});