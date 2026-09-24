// admin.js - Secure Admin Mode with Server-Side Verification
// Dependencies: config.js (CONFIG.GOOGLE_APPS_SCRIPT_URL), render.js (renderQuestions)

// Admin mode state
let isAdminMode = false;

/**
 * Hash a string using SHA-256
 * Dependencies: None
 */
async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

/**
 * Verify password with Google Apps Script
 * Dependencies: config.js (CONFIG.GOOGLE_APPS_SCRIPT_URL)
 */
async function verifyPasswordWithServer(passwordHash) {
    try {
        const scriptUrl = CONFIG.GOOGLE_APPS_SCRIPT_URL;
        // Use POST instead of GET
        const response = await fetch(scriptUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'verify_admin',
                hash: passwordHash
            })
        });
        
        if (!response.ok) {
            throw new Error('Server verification failed');
        }
        
        const result = await response.json();
        return result.success;
        
    } catch (error) {
        console.error('Password verification error:', error);
        return false;
    }
}

/**
 * Toggle admin mode with password
 * Dependencies: render.js (renderQuestions)
 */
async function toggleAdminMode() {
    if (isAdminMode) {
        // If already in admin mode, turn it off
        isAdminMode = false;
        updateAdminUI();
        renderQuestions();
        showNotification('已退出管理員模式', 'info');
    } else {
        // Prompt for password
        const password = prompt('請輸入管理員密碼：');
        
        if (password === null) return; // User cancelled
        
        if (!password.trim()) {
            showNotification('密碼不能為空', 'error');
            return;
        }
        
        // Show loading
        showNotification('驗證中...', 'info');
        
        try {
            // Hash the password
            const passwordHash = await hashPassword(password);
            
            // Verify with server
            const isValid = await verifyPasswordWithServer(passwordHash);
            
            if (isValid) {
                isAdminMode = true;
                updateAdminUI();
                renderQuestions();
                showNotification('已進入管理員模式', 'success');
            } else {
                showNotification('密碼錯誤！', 'error');
            }
        } catch (error) {
            console.error('Admin mode error:', error);
            showNotification('驗證失敗，請稍後再試', 'error');
        }
    }
}

/**
 * Update UI based on admin mode state
 * Dependencies: None
 */
function updateAdminUI() {
    const statusElement = document.getElementById('admin-status');
    const toggleButton = document.querySelector('[onclick="toggleAdminMode()"]');
    const logoutButton = document.getElementById('logout-btn');
    
    if (!statusElement || !toggleButton) {
        console.warn('Admin UI elements not found');
        return;
    }
    
    // Update admin mode toggle button
    if (isAdminMode) {
        statusElement.textContent = '✓ 已啟用';
        statusElement.style.color = '#27ae60';
        statusElement.style.fontWeight = '600';
        toggleButton.style.opacity = '1';
        toggleButton.style.background = '#27ae60';
        toggleButton.style.color = 'white';
        toggleButton.style.borderColor = '#27ae60';
        toggleButton.innerHTML = '🔓 管理員模式';
        
        // Show logout button when admin mode is active
        if (logoutButton) {
            logoutButton.style.display = 'inline-flex';
        }
    } else {
        statusElement.textContent = '';
        toggleButton.style.opacity = '0.3';
        toggleButton.style.background = '';
        toggleButton.style.color = '';
        toggleButton.style.borderColor = '';
        toggleButton.innerHTML = '🔒 管理員模式';
        
        // Hide logout button when admin mode is not active
        if (logoutButton) {
            logoutButton.style.display = 'none';
        }
    }
    
    // Update admin-only buttons (Import/Export JSON, Add Question, Clear Database)
    const adminButtons = document.querySelectorAll('.btn-admin-only');
    adminButtons.forEach(button => {
        if (isAdminMode) {
            button.classList.add('admin-active');
        } else {
            button.classList.remove('admin-active');
        }
    });
}

/**
 * Show notification message
 * Dependencies: None
 */
function showNotification(message, type = 'info') {
    let notification = document.getElementById('admin-notification');
    
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'admin-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        document.body.appendChild(notification);
    }
    
    const colors = {
        success: '#27ae60',
        error: '#e74c3c',
        info: '#3498db',
        warning: '#f39c12'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

// Add CSS animations
// Dependencies: None
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize admin UI on page load
// Dependencies: None
document.addEventListener('DOMContentLoaded', () => {
    updateAdminUI();
});