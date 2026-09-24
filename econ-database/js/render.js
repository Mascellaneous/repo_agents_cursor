// Render questions
// Dependencies: storage-core.js (storage), storage-filters.js (applyFilters),
// globals.js (paginationState, triStateFilters, window.percentageFilter,
// window.marksFilter), pagination.js (updatePaginationInfo,
// generatePagination), admin.js (isAdminMode), utils.js (escapeHTML,
// copyToClipboard, toggleQuestionText), sort.js, constants.js
// (CURRICULUM_ORDER, CURRICULUM_DISPLAY, SECTION_DISPLAY_NAMES)
//
// SECURITY: every Sheet-sourced field interpolated into HTML goes through
// escapeHTML() — body text, attribute values, and tag labels alike.
// URL fields (imageChi / imageEng / AIExplanation) are additionally
// restricted to http(s) schemes to block javascript: URL injection.

// ==========================================
// Tag Visibility
// ==========================================
if (typeof window.showQuestionTags === 'undefined') {
    window.showQuestionTags = true;
}

window.toggleTags = function(checkbox) {
    window.showQuestionTags = checkbox.checked;
    renderQuestions(); // Re-render immediately
};
// ==========================================

// Only allow http/https URLs from the Sheet (blocks javascript: etc.)
function safeHttpUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

async function renderQuestions() {
    const filters = {
        search: document.getElementById('search').value,
        searchScope: window.searchScope || 'all',
        triState: triStateFilters,
        percentageFilter: window.percentageFilter,
        marksFilter: window.marksFilter
    };

    let questions = await storage.getQuestions(filters);

    // Get sort order and apply sorting
    const sortSelect = document.getElementById('sort-order');
    const sortBy = sortSelect ? sortSelect.value : 'default';
    questions = sortQuestions(questions, sortBy);

    const currentPage = paginationState.questions.page;
    const itemsPerPage = paginationState.questions.itemsPerPage;

    const totalPages = itemsPerPage === -1 ? 1 : Math.max(1, Math.ceil(questions.length / itemsPerPage));
    const paginatedQuestions = itemsPerPage === -1 ? questions : questions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    updatePaginationInfo(currentPage, questions.length, itemsPerPage);
    generatePagination(currentPage, totalPages);

    const renderImageButtons = (urls, lang) => {
        if (!urls || urls === '-' || typeof urls !== 'string') return '';

        // Split by comma, trim, drop empties AND drop non-http(s) URLs
        const urlArray = urls.split(',').map(u => u.trim()).map(safeHttpUrl).filter(u => u);
        if (urlArray.length === 0) return '';

        const label = lang === 'chi' ? 'ZH' : 'EN';
        const titlePrefix = lang === 'chi' ? '原題圖片 (中文)' : '原題圖片 (英文)';

        return urlArray.map((url, index) => {
            const displayLabel = urlArray.length > 1 ? `${label}${index + 1}` : label;
            const displayTitle = urlArray.length > 1 ? `${titlePrefix} - P.${index + 1}` : titlePrefix;

            return `
                <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="ai-btn" title="${escapeHTML(displayTitle)}" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 15px; background-color: #eff6ff; border: 1px solid #93c5fd; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1); margin-left: 8px; font-size: 0.85em; transition: all 0.2s; cursor: pointer; color: #2563eb; font-weight: bold;">
                    ${displayLabel}
                </a>
            `;
        }).join('');
    };

    document.getElementById('question-count').textContent = `總題目數: ${questions.length}`;

    const grid = document.getElementById('question-grid');

    if (questions.length === 0) {
        grid.innerHTML = '<p style="text-align: center; padding: 40px; color: #7f8c8d;">未找到題目</p>';
        return;
    }

    // Helper function to determine tag style based on filter state
    const getTagStyle = (category, value) => {
        const isChecked = triStateFilters[category] && triStateFilters[category][value] === 'checked';
        return isChecked
            ? 'cursor:pointer; background-color: #e3f2fd; border: 1px solid #2196f3; color: #1565c0; font-weight: 600;'
            : 'cursor:pointer; color:var(--secondary-color);';
    };

    // Helper function to render collapsible text sections (Answers/Reports)
    const renderCollapsibleSection = (label, content) => {
        if (!content || content.trim() === '' || content === '-') return '';

        const escapedContent = escapeHTML(content.trim());

        return `
            <div class="question-text">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
                    <button class="expand-btn" title="展開/收起">▶</button>
                    <strong style="flex: 1;">${label}</strong>
                    <button class="copy-btn" data-action="copy" title="複製" data-content="${escapedContent}">📋</button>
                </div>
                <div class="question-text-content collapsed">${escapedContent}</div>
            </div>
        `;
    };

    grid.innerHTML = paginatedQuestions.map(q => {

        // Sort curriculum classifications by CURRICULUM_ORDER
        const sortedCurriculum = q.curriculumClassification ?
            [...q.curriculumClassification].sort((a, b) => {
                const indexA = CURRICULUM_ORDER.findIndex(code => CURRICULUM_DISPLAY[code] === a);
                const indexB = CURRICULUM_ORDER.findIndex(code => CURRICULUM_DISPLAY[code] === b);
                const valA = indexA === -1 ? 999 : indexA;
                const valB = indexB === -1 ? 999 : indexB;
                return valA - valB;
            }) : [];

        // Sort chapter classifications numerically
        const sortedChapters = q.AristochapterClassification ?
            [...q.AristochapterClassification].sort((a, b) => {
                const getNum = (str) => {
                    const match = str.match(/(\d+)/);
                    return match ? parseInt(match[0], 10) : 9999;
                };
                return getNum(a) - getNum(b);
            }) : [];

        // --- PRE-GENERATE HTML FOR CLASSIFICATIONS TO GROUP THEM ---

        let classificationHtml = '';
        const hasClassifications = window.showQuestionTags && (
            sortedCurriculum.length > 0 ||
            sortedChapters.length > 0 ||
            (q.concepts && q.concepts.length > 0) ||
            (q.patterns && q.patterns.length > 0)
        );

        if (hasClassifications) {
            classificationHtml += `<div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #e0e0e0; display: flex; flex-wrap: wrap; gap: 15px; row-gap: 8px; align-items: baseline;">`;

            // 1. Curriculum
            if (sortedCurriculum.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">課程:</strong>
                        ${sortedCurriculum.map(c => `
                            <span class="tag clickable-tag" data-action="filter" data-type="curriculum" data-value="${escapeHTML(c)}" style="${getTagStyle('curriculum', c)}">
                                ${escapeHTML(c)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            // 2. Chapters
            if (sortedChapters.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">Chapter:</strong>
                        ${sortedChapters.map(c => {
                            const match = c.match(/(\d+)/);
                            const val = match ? match[0] : c;
                            const displayLabel = c.replace(/^(Ch|Chapter)\s*/i, '');
                            return `
                            <span class="tag clickable-tag" data-action="filter" data-type="chapter" data-value="${escapeHTML(val)}" style="${getTagStyle('chapter', val)}">
                                ${escapeHTML(displayLabel)}
                            </span>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            // 3. Concepts
            if (q.concepts && q.concepts.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">概念:</strong>
                        ${q.concepts.map(c => `
                            <span class="tag clickable-tag" data-action="filter" data-type="concepts" data-value="${escapeHTML(c)}" style="${getTagStyle('concepts', c)}">
                                ${escapeHTML(c)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            // 4. Patterns
            if (q.patterns && q.patterns.length > 0) {
                classificationHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <strong style="white-space: nowrap; font-size: 0.9em; color: #555;">題型:</strong>
                        ${q.patterns.map(p => `
                            <span class="tag clickable-tag" data-action="filter" data-type="patterns" data-value="${escapeHTML(p)}" style="${getTagStyle('patterns', p)}">
                                ${escapeHTML(p)}
                            </span>
                        `).join('')}
                    </div>
                `;
            }

            classificationHtml += `</div>`;
        }

        const sectionDisplay = typeof SECTION_DISPLAY_NAMES !== 'undefined' && SECTION_DISPLAY_NAMES[q.section]
            ? SECTION_DISPLAY_NAMES[q.section]
            : q.section;

        const aiUrl = safeHttpUrl(q.AIExplanation);

        return `
        <div class="question-card">
            <div class="question-header">
                <div class="question-title">
                    ${escapeHTML(q.id)}
                    ${renderImageButtons(q.imageChi, 'chi')}
                    ${renderImageButtons(q.imageEng, 'eng')}              
                    ${aiUrl ? `
                        <a href="${escapeHTML(aiUrl)}" target="_blank" rel="noopener noreferrer" class="ai-btn" title="AI 詳解" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background-color: #e3f2fd; border: 1px solid #90caf9; margin-left: 8px; font-size: 1.2em; transition: all 0.2s; cursor: pointer;">
                            🤖
                        </a>
                    ` : ''}                    
                    <button class="feedback-btn" data-action="feedback" data-id="${escapeHTML(q.id)}" title="回報問題" style="background: none; border: none; cursor: pointer; font-size: 1.2em; opacity: 0.6; transition: opacity 0.2s; padding: 0; margin-left: 8px;">
                        📢
                    </button>                   
                </div>
                <div class="question-badges">
                    ${q.reviewedByAI === 'Y' ? `<span class="badge" title="上次覆核 ${escapeHTML(q.lastReviewDate || '')}">AI已覆核</span>` : `<span class="badge" title="尚未人工覆核">未覆核</span>`}
                    ${q.year && q.year !== '-' ? `<span class="badge badge-year" style="cursor: pointer;" data-action="filter" data-type="year" data-value="${escapeHTML(q.year)}" title="點擊以篩選此年份">${escapeHTML(q.year)}</span>` : ''}
                    ${q.questionType && q.questionType !== '-' ? `<span class="badge badge-type" style="cursor: pointer;" data-action="filter" data-type="qtype" data-value="${escapeHTML(q.questionType)}" title="點擊以篩選此題型">${escapeHTML(q.questionType)}</span>` : ''}
                    ${q.marks > 0 ? `<span class="badge badge-marks" style="cursor: pointer;" data-action="filter-marks" data-value="${q.marks}" title="點擊以篩選此分數">${q.marks}分</span>` : ''}
                    ${q.section && q.section !== '-' ? `<span class="badge badge-section" style="cursor: pointer;" data-action="filter" data-type="section" data-value="${escapeHTML(q.section)}" title="點擊以篩選此部分">${escapeHTML(sectionDisplay)}</span>` : ''}
                </div>
            </div>
            
            <div class="question-content">
                ${(q.topic && q.topic !== '-') ? `
                    <div class="info-item" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <strong>課題：</strong>
                        <span class="tag">${escapeHTML(q.topic)}</span>
                    </div>
                ` : ''}
                ${renderCollapsibleSection('純文字：', q.plainText || q.questionTextChi)}
                ${renderCollapsibleSection('Question:', q.questionTextEng)}

                ${(q.answerMC && q.answerMC !== '-') ? `
                    <div class="info-item" style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                        <strong>答案：</strong> 
                        <span style="font-weight: bold; color: #2c3e50;">${escapeHTML(q.answerMC)}</span>
                    </div>
                ` : ''}

                ${renderCollapsibleSection('答案：', q.answerChi)}
                ${renderCollapsibleSection('Answer:', q.answerEng)}

                ${renderCollapsibleSection('評卷報告：', q.markersReportChi)}
                ${renderCollapsibleSection('Markers Report:', q.markersReportEng)}

                <div class="question-info">             
                    ${q.correctPercentage !== null && q.correctPercentage !== undefined ? `<div class="info-item"><strong>答對率：</strong> ${escapeHTML(q.correctPercentage)}%</div>` : ''}

                    ${(window.showQuestionTags && q.graphType && q.graphType !== '-') ? `
                        <div class="info-item">
                            <strong>圖表：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="graph" data-value="${escapeHTML(q.graphType)}" style="${getTagStyle('graph', q.graphType)}">
                                ${escapeHTML(q.graphType)}
                            </span>
                        </div>
                    ` : ''}
                    
                    ${(window.showQuestionTags && q.tableType && q.tableType !== '-') ? `
                        <div class="info-item">
                            <strong>表格：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="table" data-value="${escapeHTML(q.tableType)}" style="${getTagStyle('table', q.tableType)}">
                                ${escapeHTML(q.tableType)}
                            </span>
                        </div>
                    ` : ''}
                    
                    ${(window.showQuestionTags && q.calculationType && q.calculationType !== '-') ? `
                        <div class="info-item">
                            <strong>計算：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="calculation" data-value="${escapeHTML(q.calculationType)}" style="${getTagStyle('calculation', q.calculationType)}">
                                ${escapeHTML(q.calculationType)}
                            </span>
                        </div>
                    ` : ''}

                    ${(window.showQuestionTags && q.multipleSelectionType && q.multipleSelectionType !== '-') ? `
                        <div class="info-item">
                            <strong>複選：</strong> 
                            <span class="tag clickable-tag" data-action="filter" data-type="multipleSelection" data-value="${escapeHTML(q.multipleSelectionType)}" style="${getTagStyle('multipleSelection', q.multipleSelectionType)}">
                                ${escapeHTML(q.multipleSelectionType)}
                            </span>
                        </div>
                    ` : ''}                    
                </div>
                
                ${classificationHtml}
                
            </div>
            
            ${isAdminMode ? `
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button class="btn btn-warning" data-action="edit" data-id="${escapeHTML(q.id)}">編輯</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${escapeHTML(q.id)}">刪除</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('');
}