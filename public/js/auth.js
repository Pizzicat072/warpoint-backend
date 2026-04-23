// ============================================
// WARPOINT HUB — AUTHENTICATION MODULE v5.1
// ULTRA MEGA EDITION — ПОЛНОСТЬЮ ИСПРАВЛЕНО
// ============================================

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    
    const CONFIG = {
        TOKEN_KEY: 'warpoint_token',
        REFRESH_TOKEN_KEY: 'warpoint_refresh_token',
        USER_KEY: 'warpoint_user',
        TOKEN_EXPIRY_KEY: 'warpoint_token_expiry',
        TOKEN_EXPIRY_DAYS: 7,
        HEARTBEAT_INTERVAL_MS: 60000,
        TOKEN_CHECK_INTERVAL_MS: 300000,
        ACTIVITY_DEBOUNCE_MS: 5000,
        MAX_LOGIN_ATTEMPTS: 5,
        LOGIN_TIMEOUT_MS: 30000,
        PUSHER_KEY: '91e6eb7093c4b16a3275',
        PUSHER_CLUSTER: 'ap1',
        PUSHER_CHANNEL: 'private-warpoint-sync',
        INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
    };

    // ============================================
    // ГЛОБАЛЬНОЕ СОСТОЯНИЕ
    // ============================================
    
    const STATE = {
        isInitialized: false,
        isAuthenticated: false,
        isLoggingIn: false,
        isRefreshing: false,
        isLoggingOut: false,
        pusher: null,
        channel: null,
        privateChannel: null,
        pusherConnected: false,
        pusherReconnectAttempts: 0,
        maxPusherReconnectAttempts: 10,
        heartbeatTimer: null,
        tokenCheckTimer: null,
        pusherReconnectTimer: null,
        loginAttempts: 0,
        lastLoginAttempt: 0,
        lastActivity: Date.now(),
        lastHeartbeat: 0,
        cachedUser: null,
        eventListeners: new Map(),
        activityHandlers: [],
        offlineQueue: [],
        isOnline: navigator.onLine,
    };

    // ============================================
    // ЛОГГИРОВАНИЕ
    // ============================================
    
    const logger = {
        debug: (...args) => console.log('🔐 [AUTH]', ...args),
        info: (...args) => console.log('🔐 [AUTH]', ...args),
        warn: (...args) => console.warn('⚠️ [AUTH]', ...args),
        error: (...args) => console.error('❌ [AUTH]', ...args)
    };

    // ============================================
    // УТИЛИТЫ
    // ============================================
    
    function safeJSONParse(str, fallback = null) {
        if (!str) return fallback;
        try { return JSON.parse(str); } catch (e) { return fallback; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, m => map[m]);
    }

    function transliterate(name) {
        if (!name) return 'user';
        const ru = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
            'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
            'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
            'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
            'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
        };
        let result = '';
        for (let char of name.toLowerCase()) result += ru[char] || char;
        return result.replace(/[^a-z0-9]/g, '') || 'user';
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function showNotification(message, type = 'info') {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
        emitEvent('notification', { message, type });
    }

    // ============================================
    // СОБЫТИЙНАЯ СИСТЕМА
    // ============================================
    
    function on(event, callback) {
        if (!STATE.eventListeners.has(event)) STATE.eventListeners.set(event, new Set());
        STATE.eventListeners.get(event).add(callback);
        return () => off(event, callback);
    }

    function off(event, callback) {
        STATE.eventListeners.get(event)?.delete(callback);
    }

    function emitEvent(event, data) {
        STATE.eventListeners.get(event)?.forEach(cb => { try { cb(data); } catch (e) {} });
        window.dispatchEvent(new CustomEvent(`auth:${event}`, { detail: data }));
    }

    // ============================================
    // РАБОТА С ТОКЕНАМИ
    // ============================================
    
    function getToken() {
        return localStorage.getItem(CONFIG.TOKEN_KEY) || localStorage.getItem('token');
    }

    function getRefreshToken() {
        return localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY);
    }

    function saveTokens(token, refreshToken) {
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
        localStorage.setItem('token', token);
        if (refreshToken) localStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, refreshToken);
        localStorage.setItem(CONFIG.TOKEN_EXPIRY_KEY, Date.now() + CONFIG.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    }

    function clearTokens() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem('token');
        localStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
        localStorage.removeItem(CONFIG.TOKEN_EXPIRY_KEY);
    }

    function isTokenExpired() {
        const expiry = localStorage.getItem(CONFIG.TOKEN_EXPIRY_KEY);
        return expiry ? Date.now() > parseInt(expiry) : false;
    }

    function getStoredUser() {
        return safeJSONParse(localStorage.getItem(CONFIG.USER_KEY) || localStorage.getItem('currentUser'));
    }

    function saveUser(user) {
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
        localStorage.setItem('currentUser', JSON.stringify(user));
        STATE.cachedUser = user;
    }

    function clearUser() {
        localStorage.removeItem(CONFIG.USER_KEY);
        localStorage.removeItem('currentUser');
        STATE.cachedUser = null;
    }

    // ============================================
    // API ЗАПРОСЫ
    // ============================================
    
    async function apiRequest(endpoint, options = {}, retries = 3) {
        const token = getToken();
        
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
        
        let lastError = null;
        
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.LOGIN_TIMEOUT_MS);
                
                const response = await fetch(`/api${endpoint}`, {
                    method: options.method || 'GET',
                    headers: { ...headers, ...(options.headers || {}) },
                    body: options.body,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                const data = await response.json().catch(() => ({ success: false, error: 'Invalid JSON' }));
                
                if (!response.ok) {
                    if (response.status === 401 && !STATE.isRefreshing && endpoint !== '/auth/refresh') {
                        const refreshed = await refreshToken();
                        if (refreshed) { attempt--; continue; }
                    }
                    throw new Error(data.error || data.message || `HTTP ${response.status}`);
                }
                
                return data;
                
            } catch (err) {
                lastError = err;
                if (err.name === 'AbortError') throw new Error('Таймаут запроса');
                if (attempt < retries - 1) await sleep(Math.pow(2, attempt) * 1000);
            }
        }
        
        throw lastError;
    }

    // ============================================
    // ОБНОВЛЕНИЕ ТОКЕНА
    // ============================================
    
    async function refreshToken() {
        if (STATE.isRefreshing) return false;
        
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;
        
        STATE.isRefreshing = true;
        
        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
            
            const data = await response.json();
            
            if (data.success && data.token) {
                saveTokens(data.token, data.refreshToken);
                emitEvent('token_refreshed', { token: data.token });
                return true;
            }
            
            return false;
        } catch {
            return false;
        } finally {
            STATE.isRefreshing = false;
        }
    }

    // ============================================
    // ВХОД
    // ============================================
    
    async function login(username, password, options = {}) {
        const { rememberMe = false, silent = false } = options;
        
        if (!username || !password) {
            if (!silent) showNotification('Введите логин и пароль', 'error');
            return { success: false, error: 'Введите логин и пароль' };
        }
        
        const now = Date.now();
        if (STATE.loginAttempts >= CONFIG.MAX_LOGIN_ATTEMPTS) {
            const timeSince = now - STATE.lastLoginAttempt;
            if (timeSince < 60000) {
                const wait = Math.ceil((60000 - timeSince) / 1000);
                return { success: false, error: `Подождите ${wait} сек.` };
            }
            STATE.loginAttempts = 0;
        }
        
        if (STATE.isLoggingIn) {
            return { success: false, error: 'Вход уже выполняется' };
        }
        
        STATE.isLoggingIn = true;
        STATE.loginAttempts++;
        STATE.lastLoginAttempt = now;
        
        try {
            // Очищаем старую сессию
            clearTokens();
            clearUser();
            
            const response = await apiRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            
            if (!response.success) {
                throw new Error(response.error || 'Неверный логин или пароль');
            }
            
            saveTokens(response.token, response.refreshToken);
            saveUser(response.user);
            
            window.app = window.app || {};
            window.app.currentUser = response.user.name;
            window.app.currentUserRole = response.user.role;
            
            if (rememberMe) {
                localStorage.setItem('savedLogin', username);
            } else {
                localStorage.removeItem('savedLogin');
            }
            
            STATE.loginAttempts = 0;
            STATE.isAuthenticated = true;
            
            startHeartbeat();
            startTokenChecker();
            initActivityTracker();
            initPusher();
            
            hideLoginModal();
            updateHeaderUser(response.user);
            
            if (!silent) {
                showNotification(`👋 Добро пожаловать, ${response.user.name}!`, 'success');
            }
            
            emitEvent('login', { user: response.user });
            
            if (response.newAchievements?.length) {
                response.newAchievements.forEach(a => {
                    showNotification(`🏆 ${a.name} (+${a.coins} WP)`, 'success');
                });
            }
            
            logger.info(`✅ Успешный вход: ${username}`);
            
            return { success: true, user: response.user, token: response.token };
            
        } catch (err) {
            logger.error('Login error:', err.message);
            if (!silent) showNotification(err.message || 'Ошибка входа', 'error');
            emitEvent('login_error', { error: err.message });
            return { success: false, error: err.message };
        } finally {
            STATE.isLoggingIn = false;
        }
    }

    // ============================================
    // ВЫХОД
    // ============================================
    
    async function logout(options = {}) {
        const { silent = false, keepUI = false } = options;
        
        if (STATE.isLoggingOut) return { success: false };
        STATE.isLoggingOut = true;
        
        const token = getToken();
        const username = window.app?.currentUser;
        
        if (token) {
            try { await apiRequest('/auth/logout', { method: 'POST' }); } catch (e) {}
        }
        
        clearTokens();
        clearUser();
        
        window.app = {
            currentUser: null, currentUserRole: null,
            employees: [], profiles: {}, tasks: [], fines: [], schedule: {}
        };
        
        stopHeartbeat();
        stopTokenChecker();
        stopPusher();
        cleanupActivityTracker();
        
        STATE.isAuthenticated = false;
        
        if (!keepUI) showLoginModal();
        
        if (!silent && username) {
            showNotification(`👋 ${username}, вы вышли`, 'info');
        }
        
        emitEvent('logout', { username });
        
        STATE.isLoggingOut = false;
        return { success: true };
    }

    // ============================================
    // HEARTBEAT
    // ============================================
    
    function startHeartbeat() {
        stopHeartbeat();
        sendHeartbeat();
        STATE.heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (STATE.heartbeatTimer) {
            clearInterval(STATE.heartbeatTimer);
            STATE.heartbeatTimer = null;
        }
    }

    async function sendHeartbeat() {
        if (!STATE.isAuthenticated || !getToken()) return;
        
        const now = Date.now();
        if (now - STATE.lastHeartbeat < CONFIG.HEARTBEAT_INTERVAL_MS / 2) return;
        STATE.lastHeartbeat = now;
        
        try {
            await apiRequest('/heartbeat', { method: 'POST' });
            STATE.lastActivity = now;
            if (window.app?.currentUser) {
                window.app.lastActivity = window.app.lastActivity || {};
                window.app.lastActivity[window.app.currentUser] = now;
            }
        } catch (err) {
            if (err.message?.includes('401')) {
                await logout({ silent: true });
            }
        }
    }

    // ============================================
    // ПРОВЕРКА ТОКЕНА
    // ============================================
    
    function startTokenChecker() {
    stopTokenChecker();
    // Проверяем раз в 30 минут вместо 5
    STATE.tokenCheckTimer = setInterval(checkToken, 30 * 60 * 1000);
}

    function stopTokenChecker() {
        if (STATE.tokenCheckTimer) {
            clearInterval(STATE.tokenCheckTimer);
            STATE.tokenCheckTimer = null;
        }
    }

    async function checkToken() {
    if (!STATE.isAuthenticated) return;
    
    // Пробуем обновить токен если истек
    if (isTokenExpired()) {
        const refreshed = await refreshToken();
        if (!refreshed) {
            // НЕ ВЫХОДИМ автоматически, только показываем предупреждение
            logger.warn('Токен истек, требуется перелогин');
        }
    }
}
    
    // Проверяем валидность токена на сервере
    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const refreshed = await refreshToken();
            if (!refreshed) {
                await logout({ silent: true });
                showNotification('Сессия истекла. Войдите снова.', 'warning');
            }
        }
    } catch (e) {
        // Сеть недоступна - не разлогиниваем
        logger.warn('Сеть недоступна при проверке токена');
    }
}
    // ============================================
    // PUSHER
    // ============================================
    
    function initPusher() {
        if (!STATE.isAuthenticated || STATE.pusher) return;
        if (typeof Pusher === 'undefined') return;
        
        const token = getToken();
        if (!token) return;
        
        try {
            STATE.pusher = new Pusher(CONFIG.PUSHER_KEY, {
                cluster: CONFIG.PUSHER_CLUSTER,
                forceTLS: true,
                authEndpoint: '/api/pusher/auth',
                auth: { headers: { 'Authorization': `Bearer ${token}` } }
            });
            
            STATE.pusher.connection.bind('connected', () => {
                STATE.pusherConnected = true;
                STATE.pusherReconnectAttempts = 0;
                setSyncStatus('online');
            });
            
            STATE.pusher.connection.bind('disconnected', () => {
                STATE.pusherConnected = false;
                setSyncStatus('offline');
                schedulePusherReconnect();
            });
            
            STATE.pusher.connection.bind('connecting', () => setSyncStatus('connecting'));
            
            STATE.pusher.connection.bind('error', (err) => {
                STATE.pusherConnected = false;
                if (err?.error?.data?.code === 401) refreshToken().then(() => reconnectPusher());
            });
            
            STATE.channel = STATE.pusher.subscribe(CONFIG.PUSHER_CHANNEL);
            
            if (window.app?.currentUser) {
                STATE.privateChannel = STATE.pusher.subscribe(`private-user-${transliterate(window.app.currentUser)}`);
            }
            
        } catch (err) {
            logger.error('Pusher init error:', err.message);
        }
    }

    function stopPusher() {
        if (STATE.pusher) {
            try { STATE.pusher.disconnect(); } catch (e) {}
            STATE.pusher = null;
            STATE.channel = null;
            STATE.privateChannel = null;
            STATE.pusherConnected = false;
        }
        if (STATE.pusherReconnectTimer) {
            clearTimeout(STATE.pusherReconnectTimer);
            STATE.pusherReconnectTimer = null;
        }
    }

    function reconnectPusher() {
        stopPusher();
        initPusher();
    }

    function schedulePusherReconnect() {
        if (STATE.pusherReconnectTimer) clearTimeout(STATE.pusherReconnectTimer);
        STATE.pusherReconnectAttempts++;
        if (STATE.pusherReconnectAttempts <= STATE.maxPusherReconnectAttempts) {
            const delay = Math.min(30000, 1000 * Math.pow(2, STATE.pusherReconnectAttempts));
            STATE.pusherReconnectTimer = setTimeout(reconnectPusher, delay);
        }
    }

    function setSyncStatus(status) {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;
        indicator.classList.remove('online', 'offline', 'connecting');
        indicator.classList.add(status);
        const icon = indicator.querySelector('i');
        if (icon) {
            icon.style.color = status === 'online' ? '#10b981' : status === 'offline' ? '#ef4444' : '#f59e0b';
        }
    }

    // ============================================
    // ТРЕКЕР АКТИВНОСТИ
    // ============================================
    
    function initActivityTracker() {
        cleanupActivityTracker();
        
        let debounceTimer = null;
        const updateActivity = () => {
            STATE.lastActivity = Date.now();
            if (window.app?.currentUser) {
                window.app.lastActivity = window.app.lastActivity || {};
                window.app.lastActivity[window.app.currentUser] = STATE.lastActivity;
            }
        };
        
        const debouncedUpdate = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(updateActivity, CONFIG.ACTIVITY_DEBOUNCE_MS);
        };
        
        ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, debouncedUpdate, { passive: true });
            STATE.activityHandlers.push({ event: evt, handler: debouncedUpdate });
        });
        
        const visibilityHandler = () => {
            if (!document.hidden) { updateActivity(); sendHeartbeat(); }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        STATE.activityHandlers.push({ event: 'visibilitychange', handler: visibilityHandler });
    }

    function cleanupActivityTracker() {
        STATE.activityHandlers.forEach(({ event, handler }) => {
            document.removeEventListener(event, handler);
        });
        STATE.activityHandlers = [];
    }

    // ============================================
    // UI ФУНКЦИИ
    // ============================================
    
    function showLoginModal() {
        const modal = document.getElementById('loginModal');
        const container = document.getElementById('mainContainer');
        if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
        if (container) container.style.display = 'none';
        
        const savedLogin = localStorage.getItem('savedLogin');
        if (savedLogin) {
            const input = document.getElementById('loginName');
            if (input) input.value = savedLogin;
            const chk = document.getElementById('rememberMe');
            if (chk) chk.checked = true;
        }
    }

    function hideLoginModal() {
        const modal = document.getElementById('loginModal');
        const container = document.getElementById('mainContainer');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
        if (container) container.style.display = 'block';
    }

    function updateHeaderUser(user) {
        const nameEl = document.getElementById('headerName');
        const avatarEl = document.getElementById('headerAvatar');
        const statusEl = document.getElementById('headerStatus');
        
        if (nameEl) nameEl.textContent = user.name;
        if (avatarEl) {
            if (user.avatar_url) {
                avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" style="width:100%;height:100%;object-fit:cover;">`;
            } else {
                avatarEl.innerHTML = escapeHtml(user.avatar) || '👤';
            }
        }
        if (statusEl && user.status) statusEl.textContent = user.status;
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    
    function initAuth() {
        if (STATE.isInitialized) return;
        
        logger.info('Initializing auth module v5.1');
        
        const token = getToken();
        const user = getStoredUser();
        
        if (token && user) {
            STATE.isAuthenticated = true;
            window.app = window.app || {};
            window.app.currentUser = user.name;
            window.app.currentUserRole = user.role;
            hideLoginModal();
            updateHeaderUser(user);
            startHeartbeat();
            startTokenChecker();
            initActivityTracker();
            setTimeout(initPusher, 1000);
            logger.info(`Session restored: ${user.name}`);
        } else {
            showLoginModal();
        }
        
        setupLoginForm();
        setupNetworkListeners();
        
        STATE.isInitialized = true;
        emitEvent('initialized');
    }

    function setupLoginForm() {
        const form = document.getElementById('loginForm');
        if (!form) return;
        
        form.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('loginName')?.value?.trim();
            const password = document.getElementById('loginPassword')?.value;
            const rememberMe = document.getElementById('rememberMe')?.checked || false;
            
            if (!username || !password) {
                showNotification('Введите логин и пароль', 'error');
                return;
            }
            
            const btn = document.getElementById('loginSubmitBtn');
            const origText = btn?.innerHTML;
            if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...'; btn.disabled = true; }
            
            try {
                const result = await login(username, password, { rememberMe });
                if (!result.success && btn) { btn.innerHTML = origText; btn.disabled = false; }
            } catch {
                if (btn) { btn.innerHTML = origText; btn.disabled = false; }
            }
        };
    }

    function setupNetworkListeners() {
        window.addEventListener('online', () => {
            STATE.isOnline = true;
            logger.info('Network online');
        });
        window.addEventListener('offline', () => {
            STATE.isOnline = false;
            showNotification('📡 Нет соединения', 'warning');
        });
    }

    // ============================================
    // ПУБЛИЧНОЕ API
    // ============================================
    
    const AuthAPI = {
        init: initAuth,
        login,
        logout,
        refreshToken,
        isAuthenticated: () => STATE.isAuthenticated,
        getToken,
        getCurrentUser: () => window.app?.currentUser,
        initPusher,
        stopPusher,
        reconnectPusher,
        getPusher: () => STATE.pusher,
        getChannel: () => STATE.channel,
        getPrivateChannel: () => STATE.privateChannel,
        isPusherConnected: () => STATE.pusherConnected,
        showLoginModal,
        hideLoginModal,
        updateHeaderUser,
        on,
        off,
        sendHeartbeat,
        startHeartbeat,
        stopHeartbeat,
        reset: () => {
            clearTokens(); clearUser(); STATE.isAuthenticated = false;
            stopHeartbeat(); stopTokenChecker(); stopPusher(); cleanupActivityTracker();
            showLoginModal();
        }
    };

    // ============================================
    // ЭКСПОРТ
    // ============================================
    
    window.auth = AuthAPI;
    window.login = (u, p) => login(u, p);
    window.authLogout = () => logout();
    window.initPusher = initPusher;
    window.sendHeartbeat = sendHeartbeat;
    window.startHeartbeat = startHeartbeat;
    window.showLoginModal = showLoginModal;
    window.hideLoginModal = hideLoginModal;
    window.updateHeaderUser = updateHeaderUser;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        setTimeout(initAuth, 100);
    }

    console.log('✅ auth.js v5.1 ULTRA MEGA EDITION загружен');
})();