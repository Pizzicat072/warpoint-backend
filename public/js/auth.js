// public/js/auth.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v3.0
// Исправлены все баги: очистка window.app, проверки, Pusher, обработчики

let isLoggingIn = false;
let heartbeatInterval = null;
let lastHeartbeat = 0;
const HEARTBEAT_INTERVAL = 60000;
const TOKEN_EXPIRY_CHECK_INTERVAL = 300000;
let authInitialized = false;
let activityHandlers = [];

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
    if (typeof window.showSystemNotification === 'function' && window.showSystemNotification !== showSystemNotification) {
        window.showSystemNotification(message, type);
        return;
    }
    if (typeof window.showNotif === 'function' && window.showNotif !== showSystemNotification) {
        window.showNotif(message, type);
        return;
    }
    console.log(`[${type}] ${message}`);
}

function showLoginModal() {
    const loginModal = document.getElementById('loginModal');
    const mainContainer = document.getElementById('mainContainer');
    if (loginModal) {
        loginModal.style.display = 'flex';
        loginModal.classList.add('active');
    }
    if (mainContainer) mainContainer.style.display = 'none';
}

function hideLoginModal() {
    const loginModal = document.getElementById('loginModal');
    const mainContainer = document.getElementById('mainContainer');
    if (loginModal) {
        loginModal.style.display = 'none';
        loginModal.classList.remove('active');
    }
    if (mainContainer) mainContainer.style.display = 'block';
}

// ============================================
// ВХОД
// ============================================

async function login() {
    if (isLoggingIn) {
        console.log('⚠️ Вход уже выполняется');
        return;
    }
    
    // Проверка, не вошёл ли уже пользователь
    if (window.app?.currentUser) {
        showSystemNotification('⚠️ Вы уже вошли в систему', 'warning');
        return;
    }
    
    // Проверка интернета
    if (!navigator.onLine) {
        showSystemNotification('❌ Нет подключения к интернету', 'error');
        const errorEl = document.getElementById('loginErrorMessage');
        if (errorEl) errorEl.textContent = '❌ Нет подключения к интернету';
        return;
    }
    
    const loginName = document.getElementById('loginName')?.value.trim();
    const pass = document.getElementById('loginPassword')?.value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;
    
    // Очистка предыдущей ошибки
    const errorEl = document.getElementById('loginErrorMessage');
    if (errorEl) errorEl.textContent = '';
    
    // Убираем класс error с полей
    document.getElementById('loginName')?.classList.remove('error');
    document.getElementById('loginPassword')?.classList.remove('error');
    
    if (!loginName || !pass) {
        if (!loginName) document.getElementById('loginName')?.classList.add('error');
        if (!pass) document.getElementById('loginPassword')?.classList.add('error');
        showSystemNotification('❌ Введите логин и пароль', 'error');
        if (errorEl) errorEl.textContent = '❌ Введите логин и пароль';
        document.getElementById('loginPassword')?.focus();
        return;
    }
    
    console.log('📤 Отправка запроса:', { username: loginName });
    
    const loginBtn = document.getElementById('loginSubmitBtn');
    const originalBtnText = loginBtn?.innerHTML || 'Войти';
    if (loginBtn) {
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
        loginBtn.disabled = true;
    }
    isLoggingIn = true;
    
    // Показываем прелоадер если есть
    if (typeof window.showGlobalLoader === 'function') {
        window.showGlobalLoader();
    }
    
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
        
        if (data.success && data.token && data.user) {
            console.log('✅ Логин успешен!');
            
            // Запоминаем логин если нужно
            if (rememberMe) {
                localStorage.setItem('savedLogin', loginName);
            } else {
                localStorage.removeItem('savedLogin');
            }
            
            // 🔥 ПОЛНОСТЬЮ ОЧИЩАЕМ window.app перед установкой новых данных
            window.app = {
                currentUser: data.user.name,
                currentUserRole: data.user.role,
                currentUserPermissions: (window.rolesMap && window.rolesMap[data.user.role]) || (window.rolesMap && window.rolesMap.operator) || {},
                employees: [],
                profiles: {},
                tasks: [],
                fines: [],
                schedule: {},
                lastActivity: {},
                stickers: {},
                achievements: {},
                messages: {}
            };
            
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            localStorage.setItem('tokenExpiry', JSON.stringify(Date.now() + 7 * 24 * 60 * 60 * 1000));
            
            hideLoginModal();
            
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
            
            // Достижения при входе
            if (data.newAchievements && data.newAchievements.length > 0) {
                for (const ach of data.newAchievements) {
                    showSystemNotification(`🏆 ${escapeHtml(ach.name)} (+${ach.coins} WP)`, 'success');
                }
            }
            
            // Загружаем данные
            if (typeof loadEmployees === 'function') await loadEmployees();
            if (typeof loadTasks === 'function') await loadTasks();
            if (typeof loadFines === 'function') await loadFines();
            if (typeof loadSchedule === 'function') await loadSchedule();
            if (typeof loadLastActivity === 'function') await loadLastActivity();
            
            startHeartbeat();
            initActivityTracker();
            
            if (typeof window.initPusher === 'function') {
                window.initPusher();
            }
            
            if (typeof renderMainMenu === 'function') renderMainMenu();
            
            // Скрываем скелетон
            const skeleton = document.getElementById('pageSkeleton');
            if (skeleton) skeleton.style.display = 'none';
            
            showSystemNotification(`👋 Добро пожаловать, ${escapeHtml(window.app.currentUser)}!`, 'success');
            
        } else {
            // Ошибка от сервера
            const errorMsg = data.error || 'Неверный логин или пароль';
            if (errorEl) errorEl.textContent = '❌ ' + errorMsg;
            document.getElementById('loginName')?.classList.add('error');
            document.getElementById('loginPassword')?.classList.add('error');
            showSystemNotification('❌ ' + errorMsg, 'error');
            document.getElementById('loginPassword')?.focus();
            
            if (typeof window.hideGlobalLoader === 'function') {
                window.hideGlobalLoader();
            }
        }
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        const errorMsg = err.message === 'Failed to fetch' ? 'Нет соединения с сервером' : 'Ошибка соединения с сервером';
        if (errorEl) errorEl.textContent = '❌ ' + errorMsg;
        showSystemNotification('❌ ' + errorMsg, 'error');
        
        if (typeof window.hideGlobalLoader === 'function') {
            window.hideGlobalLoader();
        }
    } finally {
        if (loginBtn) {
            loginBtn.innerHTML = originalBtnText;
            loginBtn.disabled = false;
        }
        isLoggingIn = false;
    }
}

// ============================================
// ВЫХОД
// ============================================

function authLogout() {
    const userName = window.app?.currentUser;
    
    // 🔥 Очистка обработчиков активности
    cleanupActivityTracker();
    
    // 🔥 Отключение Pusher
    if (window.pusher) {
        window.pusher.disconnect();
        window.pusher = null;
    }
    window.channel = null;
    window.privateChannel = null;
    
    // 🔥 ПОЛНАЯ ОЧИСТКА window.app
    window.app = {
        currentUser: null,
        currentUserRole: null,
        currentUserPermissions: null,
        employees: [],
        profiles: {},
        tasks: [],
        fines: [],
        schedule: {},
        lastActivity: {},
        stickers: {},
        achievements: {}
    };
    
    // 🔥 Очистка localStorage (все ключи WARPOINT)
    const keysToRemove = [
        'currentUser', 'token', 'tokenExpiry', 'lastActivity',
        'warpoint_notifications', 'warpoint_offline_data',
        'activeTab', 'savedLogin'
    ];
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Не очищаем настройки интерфейса (тему, скрытые блоки)
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    showLoginModal();
    
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof loadActivity === 'function') loadActivity();
    
    if (userName) {
        showSystemNotification(`👋 ${userName}, вы вышли из системы`, 'info');
    }
    
    // Проверка, что модалка входа показалась
    setTimeout(() => {
        const loginModal = document.getElementById('loginModal');
        if (loginModal && loginModal.style.display !== 'flex') {
            console.warn('⚠️ Модалка входа не найдена, перезагружаем');
            window.location.reload();
        }
    }, 100);
}

// ============================================
// ПРОВЕРКА ТОКЕНА
// ============================================

function isTokenExpired() {
    try {
        const expiry = localStorage.getItem('tokenExpiry');
        if (!expiry) return false;
        return Date.now() > JSON.parse(expiry);
    } catch (e) {
        console.error('Ошибка проверки токена:', e);
        return false;
    }
}

function checkTokenAndLogout() {
    if (isTokenExpired()) {
        console.log('🔐 Токен истёк, выполняем выход');
        if (typeof authLogout === 'function') {
            authLogout();
        }
        showSystemNotification('⏳ Сессия истекла. Пожалуйста, войдите снова.', 'warning');
        return true;
    }
    return false;
}

// ============================================
// ЗАГРУЗКА АКТИВНОСТИ
// ============================================

async function loadLastActivity() {
    if (typeof apiCall !== 'function') {
        console.error('apiCall не загружен');
        return;
    }
    
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
    
    // Проверка, что пользователь вошёл
    if (!window.app?.currentUser) {
        console.log('⚠️ Heartbeat: пользователь не авторизован');
        return;
    }
    
    // Проверка интернета
    if (!navigator.onLine) {
        console.log('⚠️ Heartbeat: нет интернета');
        if (typeof setSyncStatus === 'function') setSyncStatus('offline');
        return;
    }
    
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
            
            if (typeof window.setSyncStatus === 'function') {
                window.setSyncStatus('online');
            }
        } else if (response.status === 401 || response.status === 403) {
            console.log('🔐 Токен истёк при heartbeat');
            authLogout();
        }
    } catch (e) {
        console.error('Heartbeat error:', e);
        if (typeof window.setSyncStatus === 'function') {
            window.setSyncStatus('offline');
        }
    }
}

function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL) {
    if (!window.app?.currentUser) {
        console.warn('⚠️ Heartbeat не запущен: нет пользователя');
        return;
    }
    
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    sendHeartbeat();
    
    heartbeatInterval = setInterval(() => sendHeartbeat(), intervalMs);
    
    console.log('💓 Heartbeat запущен (интервал: ' + intervalMs/1000 + 'с)');
}

// ============================================
// ТРЕКЕР АКТИВНОСТИ
// ============================================

function initActivityTracker() {
    if (!window.app?.currentUser) return;
    
    // Очищаем старые обработчики
    cleanupActivityTracker();
    
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
    
    // Throttle для mousemove
    let throttleTimer = null;
    const throttledUpdate = () => {
        if (throttleTimer) return;
        throttleTimer = setTimeout(() => {
            updateActivity();
            throttleTimer = null;
        }, 1000);
    };
    
    const events = ['click', 'keydown', 'scroll', 'touchstart'];
    const moveEvents = ['mousemove'];
    
    events.forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
        activityHandlers.push({ event, handler: updateActivity });
    });
    
    moveEvents.forEach(event => {
        document.addEventListener(event, throttledUpdate, { passive: true });
        activityHandlers.push({ event, handler: throttledUpdate });
    });
    
    const visibilityHandler = () => { 
        if (!document.hidden) {
            updateActivity();
            sendHeartbeat();
        }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    activityHandlers.push({ event: 'visibilitychange', handler: visibilityHandler });
    
    console.log('✅ Activity tracker инициализирован');
}

function cleanupActivityTracker() {
    activityHandlers.forEach(({ event, handler }) => {
        document.removeEventListener(event, handler);
    });
    activityHandlers = [];
    console.log('🧹 Activity tracker очищен');
}

// ============================================
// ВОССТАНОВЛЕНИЕ АКТИВНОСТИ (ФИЛЬТР СТАРЫХ ДАННЫХ)
// ============================================

(function restoreLastActivity() {
    const saved = localStorage.getItem('lastActivity');
    if (saved) { 
        try { 
            const data = JSON.parse(saved);
            // 🔥 Фильтруем старые данные (старше 5 минут)
            const now = Date.now();
            const filtered = {};
            for (const [user, timestamp] of Object.entries(data)) {
                if (now - timestamp < 5 * 60 * 1000) {
                    filtered[user] = timestamp;
                }
            }
            window.app = window.app || {};
            window.app.lastActivity = filtered;
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
window.cleanupActivityTracker = cleanupActivityTracker;
window.loadLastActivity = loadLastActivity;
window.checkTokenAndLogout = checkTokenAndLogout;
window.resetAuthState = resetAuthState;
window.showLoginModal = showLoginModal;
window.hideLoginModal = hideLoginModal;

console.log('✅ auth.js загружен (v3.0 — все баги исправлены)');