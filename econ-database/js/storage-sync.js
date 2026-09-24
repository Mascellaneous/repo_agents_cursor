// Dependencies: storage-core.js, auth.js

class GoogleSheetsSync {
    constructor(webAppUrl) {
        this.webAppUrl = webAppUrl;
        this.lastSyncTime = null;
        this.SEPARATOR = String.fromCharCode(30);
        this.ROW_SEPARATOR = String.fromCharCode(31);
        this.availableFields = new Set();
    }
    
    isValidValue(value) {
        if (!value) return false;
        const trimmed = value.trim();
        return trimmed !== '' && trimmed !== '-';
    }

    // Dependencies: auth.js (window.authManager)
    async fetchData() {
        const username = window.authManager?.currentUser || '';
        
        if (!username) {
            throw new Error('未驗證，無法載入資料');
        }
        
        const url = `${this.webAppUrl}?username=${encodeURIComponent(username)}`;
        console.log('📡 Fetching from Apps Script with user:', username);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: 無法讀取資料`);
        }
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.message || '驗證失敗');
        }
        
        if (result.userGroup && window.authManager) {
            window.authManager.userGroup = result.userGroup;
        }
        
        return result.data;
    }
    
    async parseAndValidate() {
        const textData = await this.fetchData();
        
        const lines = textData.split(this.ROW_SEPARATOR).filter(line => line.trim());
        
        if (lines.length < 1) {
            throw new Error('資料為空');
        }
        
        const headers = lines[0].split(this.SEPARATOR).map(h => h.trim());
        
        this.availableFields.clear();
        headers.forEach(header => {
            this.availableFields.add(header);
        });
        window.availableFields = this.availableFields;

        /**
        console.log('\n========================================');
        console.log('📊 可用欄位 (Available Fields)');
        console.log('========================================');
        console.log(Array.from(this.availableFields).join(', '));
        console.log('========================================\n');
        */
        
        const questions = [];
        let skippedCount = 0;
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(this.SEPARATOR);
            const question = {
                dateAdded: new Date().toISOString(),
                dateModified: new Date().toISOString()
            };
            
            headers.forEach((fieldName, index) => {
                let value = values[index] || '';
                
                if (!value) {
                    if (['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns'].includes(fieldName)) {
                        question[fieldName] = [];
                    }
                    return;
                }
                
                value = value.replace(/\\n/g, '\n');
                
                switch (fieldName) {
                    // Removed 'year' from here so it is treated as a string/mixed type
                    case 'marks':
                    case 'correctPercentage':
                        const trimmedNum = value.trim();
                        const num = parseFloat(trimmedNum);
                        if (!isNaN(num)) {
                            question[fieldName] = num;
                        }
                        break;
                        
                    case 'curriculumClassification':
                    case 'AristochapterClassification':
                    case 'concepts':
                    case 'patterns':
                        const trimmedValue = value.trim();
                        if (trimmedValue) {
                            question[fieldName] = trimmedValue.split(',').map(s => s.trim()).filter(s => s);
                        } else {
                            question[fieldName] = [];
                        }
                        break;
                        
                    case 'multipleSelectionType':
                    case 'graphType':
                    case 'tableType':
                    case 'calculationType':
                        question[fieldName] = value.trim() || '-';
                        break;
                    
                    default:
                        // 'year' will fall through here, preserving strings like "Sample Paper"
                        question[fieldName] = value.trim();
                }
            });
            
            ['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns'].forEach(field => {
                if (!question[field]) {
                    question[field] = [];
                }
            });
            
            if (this.isValidValue(question.examination) && this.isValidValue(question.id)) {
                questions.push(question);
            } else {
                skippedCount++;
                // console.log(`⚠️ Row ${i + 1} skipped - missing required fields`);
            }
        }
        
        if (skippedCount > 0) {
            // console.log(`\n⚠️ Total rows skipped: ${skippedCount}`);
        }
        
        return { questions };
    }
    
    // Dependencies: storage-core.js (window.storage)
    async syncOnLoad() {
        try {
            console.log('🔄 開始同步 Google Sheets...');
            
            const { questions } = await this.parseAndValidate();
            
            if (questions.length === 0) {
                console.log('⚠️  沒有找到有效的題目資料');
                return { success: false, count: 0 };
            }
            
            await window.storage.clear();
            
            let imported = 0;
            for (const question of questions) {
                try {
                    await window.storage.addQuestion(question);
                    imported++;
                } catch (error) {
                    console.error('Failed to import question:', question, error);
                }
            }
            
            this.lastSyncTime = new Date();
            localStorage.setItem('lastSyncTime', this.lastSyncTime.toISOString());
            
            console.log(`✅ 同步完成！成功匯入 ${imported} 題`);
            
            return { 
                success: true, 
                count: imported,
                lastSyncTime: this.lastSyncTime 
            };
            
        } catch (error) {
            console.error('❌ 同步失敗:', error);
            throw error;
        }
    }
    
    updateSyncStatus(result) {
        const statusElement = document.getElementById('sync-status');
        if (!statusElement) return;
        
        if (result.success) {
            statusElement.innerHTML = `
                ✅ 最後同步: ${new Date().toLocaleTimeString('zh-TW')} (${result.count} 題)
            `;
            statusElement.style.color = '#ffffff';
        } else {
            statusElement.innerHTML = `❌ 同步失敗: ${result.error || '未知錯誤'}`;
            statusElement.style.color = '#e74c3c';
        }
    }
}

window.googleSheetsSync = null;