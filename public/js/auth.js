// public/js/auth.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.1
// Добавлены все уведомления

let isLoggingIn = false;
let heartbeatInterval = null;
let lastHeartbeat = 0;
const HEARTBEAT_INTERVAL = 60000;
const TOKEN_EXPIRY_CHECK_INTERVAL = 300000;
let authInitialized = false;

// ============================================
// СБРОС СОСТОЯНИЯ
// ============================================

function resetAuthState() {
    console.log('🧹 Сброс состояния авторизации');
    authInitialized = false;
    isLoggingIn = false;
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function showSystemNotification(message, type) {
    if (typeof window.showSystemNotification === 'function') {
        window.showSystemNotification(message, type);
    } else if (typeof window.showNotif === 'function') {
        window.showNotif(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

// ============================================
// ВХОД
// ============================================

async function login() {
    if (isLoggingIn) {
        console.log('⚠️ Вход уже выполняется');
        return;
    }
    
    if (typeof window.showGlobalLoader === 'function') {
        window.showGlobalLoader();
    }
    
    const loginName = document.getElementById('loginName')?.value.trim();
    const pass = document.getElementById('loginPassword')?.value;
    
    if (!loginName || !pass) {
        showSystemNotification('❌ Введите логин и пароль', 'error');
        return;
    }
    
    console.log('📤 Отправка запроса:', { username: loginName });
    
    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    const originalBtnText = loginBtn?.innerHTML || 'Войти';
    if (loginBtn) {
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
        loginBtn.disabled = true;
    }
    isLoggingIn = true;
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginName, password: pass })
        });
        
        console.log('📥 Ответ получен, статус:', response.status);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('❌ Сервер вернул не JSON:', text.substring(0, 200));
            throw new Error(`Ошибка сервера: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📦 Данные ответа:', data);
        
        if (data.success) {
            console.log('✅ Логин успешен!');
            
            window.app = window.app || {};
            window.app.currentUser = data.user.name;
            window.app.currentUserRole = data.user.role;
            window.app.currentUserPermissions = rolesMap[window.app.currentUserRole] || rolesMap.operator;
            
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            localStorage.setItem('tokenExpiry', JSON.stringify(Date.now() + 7 * 24 * 60 * 60 * 1000));
            
            const loginModal = document.getElementById('loginModal');
            const mainContainer = document.getElementById('mainContainer');
            
            if (loginModal) {
                loginModal.style.display = 'none';
                loginModal.classList.remove('active');
            }
            if (mainContainer) mainContainer.style.display = 'block';
            
            const headerName = document.getElementById('headerName');
            if (headerName) headerName.textContent = window.app.currentUser;
            
            const headerAvatar = document.getElementById('headerAvatar');
            if (headerAvatar) {
                if (data.user.avatar_url) {
                    headerAvatar.innerHTML = `<img src="${escapeHtml(data.user.avatar_url)}" style="width: 100%; height: 100%; object-fit: cover;">`;
                } else if (data.user.avatar) {
                    headerAvatar.innerHTML = escapeHtml(data.user.avatar);
                } else {
                    headerAvatar.innerHTML = '👤';
                }
            }
            
            if (data.newAchievements && data.newAchievements.length > 0) {
                for (const ach of data.newAchievements) {
                    showSystemNotification(`🏆 ${escapeHtml(ach.name)} (+${ach.coins} WP)`, 'success');
                }
            }
            
            await loadEmployees();
            await loadTasks();
            await loadFines();
            await loadSchedule();
            await loadLastActivity();
            
            startHeartbeat();
            initActivityTracker();
            
            if (typeof window.initPusher === 'function') {
                window.initPusher();
            }
            
            renderMainMenu();
            
            showSystemNotification(`👋 Добро пожаловать, ${escapeHtml(window.app.currentUser)}!`, 'success');
            
        } else {
            showSystemNotification('❌ ' + (data.error || 'Неверный логин или пароль'), 'error');
            hideGlobalLoaderOnError();
        }
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        showSystemNotification('❌ Ошибка соединения с сервером', 'error');
        hideGlobalLoaderOnError();
    } finally {
        if (loginBtn) {
            loginBtn.innerHTML = originalBtnText;
            loginBtn.disabled = false;
        }
        isLoggingIn = false;
    }
}

function hideGlobalLoaderOnError() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.classList.add('fade-out');
        setTimeout(() => {
            loader.style.display = 'none';
            loader.classList.remove('fade-out');
        }, 400);
    }
}

// ============================================
// ВЫХОД
// ============================================

function authLogout() {
    const userName = window.app?.currentUser;
    
    if (window.app) {
        window.app.currentUser = null;
        window.app.currentUserRole = null;
        window.app.currentUserPermissions = null;
    }
    
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    localStorage.removeItem('tokenExpiry');
    localStorage.removeItem('lastActivity');
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    if (userName && window.app?.lastActivity) {
        delete window.app.lastActivity[userName];
    }
    
    const loginModal = document.getElementById('loginModal');
    const mainContainer = document.getElementById('mainContainer');
    
    if (loginModal) {
        loginModal.style.display = 'flex';
        loginModal.classList.add('active');
    }
    if (mainContainer) mainContainer.style.display = 'none';
    
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof loadActivity === 'function') loadActivity();
    
    showSystemNotification('👋 Вы вышли из системы', 'info');
}

// ============================================
// ПРОВЕРКА ТОКЕНА
// ============================================

function isTokenExpired() {
    const expiry = localStorage.getItem('tokenExpiry');
    if (!expiry) return false;
    try {
        return Date.now() > JSON.parse(expiry);
    } catch(e) {
        return false;
    }
}

function checkTokenAndLogout() {
    if (isTokenExpired()) {
        console.log('🔐 Токен истёк, выполняем выход');
        authLogout();
        showSystemNotification('⏳ Сессия истекла. Пожалуйста, войдите снова.', 'warning');
        return true;
    }
    return false;
}

// ============================================
// ЗАГРУЗКА АКТИВНОСТИ
// ============================================

async function loadLastActivity() {
    try {
        const response = await apiCall('/last-activity');
        if (response && response.success) {
            window.app = window.app || {};
            window.app.lastActivity = response.data || {};
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
        } else {
            const saved = localStorage.getItem('lastActivity');
            window.app = window.app || {};
            if (saved) {
                try {
                    window.app.lastActivity = JSON.parse(saved);
                } catch(e) {
                    window.app.lastActivity = {};
                }
            } else {
                window.app.lastActivity = {};
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки активности:', e);
        window.app = window.app || {};
        window.app.lastActivity = {};
    }
    
    if (window.app?.currentUser) {
        window.app.lastActivity[window.app.currentUser] = Date.now();
    }
    
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof loadActivity === 'function') loadActivity();
}

// ============================================
// HEARTBEAT
// ============================================

let lastActivityRenderTime = 0;
const ACTIVITY_RENDER_DEBOUNCE = 5000;

async function sendHeartbeat() {
    if (checkTokenAndLogout()) return;
    
    const now = Date.now();
    if (now - lastHeartbeat < HEARTBEAT_INTERVAL / 2) return;
    lastHeartbeat = now;
    
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        const response = await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            }
        });
        
        if (response.ok && window.app && window.app.currentUser) {
            window.app.lastActivity = window.app.lastActivity || {};
            window.app.lastActivity[window.app.currentUser] = Date.now();
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
            
            if (now - lastActivityRenderTime > ACTIVITY_RENDER_DEBOUNCE) {
                lastActivityRenderTime = now;
                
                if (typeof renderEmployees === 'function') {
                    renderEmployees();
                }
                if (typeof loadActivity === 'function') {
                    loadActivity();
                }
                
                if (typeof window.dispatchDataUpdate === 'function') {
                    window.dispatchDataUpdate('heartbeat', { user: window.app.currentUser });
                }
            }
            
            if (typeof setSyncStatus === 'function') {
                setSyncStatus('online');
            }
        } else if (response.status === 401) {
            console.log('🔐 Токен истёк при heartbeat');
            authLogout();
        }
    } catch (e) {
        console.error('Heartbeat error:', e);
        if (typeof setSyncStatus === 'function') {
            setSyncStatus('offline');
        }
    }
}

function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    sendHeartbeat();
    
    heartbeatInterval = setInterval(() => sendHeartbeat(), intervalMs);
    
    console.log('💓 Heartbeat запущен (интервал: ' + intervalMs/1000 + 'с)');
}

// ============================================
// ТРЕКЕР АКТИВНОСТИ
// ============================================

function initActivityTracker() {
    const updateActivity = () => {
        if (window.app && window.app.currentUser) {
            window.app.lastActivity = window.app.lastActivity || {};
            window.app.lastActivity[window.app.currentUser] = Date.now();
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
            
            const now = Date.now();
            if (now - lastActivityRenderTime > ACTIVITY_RENDER_DEBOUNCE) {
                lastActivityRenderTime = now;
                
                if (typeof renderEmployees === 'function') {
                    renderEmployees();
                }
                if (typeof loadActivity === 'function') {
                    loadActivity();
                }
            }
        }
    };
    
    ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
    });
    
    document.addEventListener('visibilitychange', () => { 
        if (!document.hidden) {
            updateActivity();
            sendHeartbeat();
        }
    });
    
    console.log('✅ Activity tracker инициализирован');
}

// ============================================
// ВОССТАНОВЛЕНИЕ АКТИВНОСТИ
// ============================================

(function restoreLastActivity() {
    const saved = localStorage.getItem('lastActivity');
    if (saved) { 
        try { 
            window.app = window.app || {};
            window.app.lastActivity = JSON.parse(saved); 
        } catch(e) {
            window.app = window.app || {};
            window.app.lastActivity = {};
        }
    }
})();

// ============================================
// ЭКСПОРТ
// ============================================

window.login = login;
window.authLogout = authLogout;
window.startHeartbeat = startHeartbeat;
window.sendHeartbeat = sendHeartbeat;
window.initActivityTracker = initActivityTracker;
window.loadLastActivity = loadLastActivity;
window.checkTokenAndLogout = checkTokenAndLogout;
window.resetAuthState = resetAuthState;

console.log('✅ auth.js загружен (v2.1 — с уведомлениями)');