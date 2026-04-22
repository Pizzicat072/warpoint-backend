// ============================================
// WARPOINT HUB — AUTHENTICATION MODULE v5.0
// ULTRA MEGA EDITION — ПОЛНОСТЬЮ ПЕРЕПИСАНО
// ============================================
// 
// ██╗    ██╗ █████╗ ██████╗ ██████╗  ██████╗ ██╗███╗   ██╗████████╗
// ██║    ██║██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝
// ██║ █╗ ██║███████║██████╔╝██████╔╝██║   ██║██║██╔██╗ ██║   ██║
// ██║███╗██║██╔══██║██╔══██╗██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║
// ╚███╔███╔╝██║  ██║██║  ██║██║     ╚██████╔╝██║██║ ╚████║   ██║
//  ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝
//
// АВТОРИЗАЦИЯ, СЕССИИ, ТОКЕНЫ, HEARTBEAT
// ============================================

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    
    const CONFIG = {
        // Токены
        TOKEN_KEY: 'warpoint_token',
        REFRESH_TOKEN_KEY: 'warpoint_refresh_token',
        USER_KEY: 'warpoint_user',
        TOKEN_EXPIRY_KEY: 'warpoint_token_expiry',
        
        // Время жизни
        TOKEN_EXPIRY_DAYS: 7,
        HEARTBEAT_INTERVAL_MS: 60000,        // 1 минута
        TOKEN_CHECK_INTERVAL_MS: 300000,      // 5 минут
        ACTIVITY_DEBOUNCE_MS: 5000,           // 5 секунд
        
        // Лимиты
        MAX_LOGIN_ATTEMPTS: 5,
        LOGIN_TIMEOUT_MS: 30000,              // 30 секунд
        
        // Pusher
        PUSHER_KEY: '91e6eb7093c4b16a3275',
        PUSHER_CLUSTER: 'ap1',
        PUSHER_CHANNEL: 'private-warpoint-sync',
        
        // Сессии
        SESSION_CHECK_INTERVAL_MS: 60000,     // 1 минута
        INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000, // 30 минут
    };

    // ============================================
    // ГЛОБАЛЬНОЕ СОСТОЯНИЕ
    // ============================================
    
    const STATE = {
        // Флаги
        isInitialized: false,
        isAuthenticated: false,
        isLoggingIn: false,
        isRefreshing: false,
        isLoggingOut: false,
        
        // Pusher
        pusher: null,
        channel: null,
        privateChannel: null,
        pusherConnected: false,
        pusherReconnectAttempts: 0,
        maxPusherReconnectAttempts: 10,
        
        // Таймеры
        heartbeatTimer: null,
        tokenCheckTimer: null,
        activityTimer: null,
        pusherReconnectTimer: null,
        sessionCheckTimer: null,
        
        // Кэш
        loginAttempts: 0,
        lastLoginAttempt: 0,
        lastActivity: Date.now(),
        lastHeartbeat: 0,
        lastTokenCheck: 0,
        cachedUser: null,
        
        // Обработчики событий
        eventListeners: new Map(),
        activityHandlers: [],
        
        // Очередь запросов (для офлайн-режима)
        offlineQueue: [],
        isOnline: navigator.onLine,
    };

    // ============================================
    // ЛОГГИРОВАНИЕ
    // ============================================
    
    const logger = {
        debug: (...args) => {
            if (window.DEBUG_MODE) console.log('🔐 [AUTH]', ...args);
        },
        info: (...args) => {
            console.log('🔐 [AUTH]', ...args);
        },
        warn: (...args) => {
            console.warn('⚠️ [AUTH]', ...args);
        },
        error: (...args) => {
            console.error('❌ [AUTH]', ...args);
        }
    };

    // ============================================
    // УТИЛИТЫ
    // ============================================
    
    /**
     * Безопасный парсинг JSON
     */
    function safeJSONParse(str, fallback = null) {
        if (!str) return fallback;
        try {
            return JSON.parse(str);
        } catch (e) {
            logger.error('JSON parse error:', e.message);
            return fallback;
        }
    }

    /**
     * Экранирование HTML
     */
    function escapeHtml(str) {
        if (!str) return '';
        const map = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', 
            '"': '&quot;', "'": '&#039;', '/': '&#x2F;'
        };
        return String(str).replace(/[&<>"'/]/g, m => map[m]);
    }

    /**
     * Транслитерация для Pusher каналов
     */
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
        for (let char of name.toLowerCase()) {
            result += ru[char] || char;
        }
        return result.replace(/[^a-z0-9]/g, '') || 'user';
    }

    /**
     * Задержка (sleep)
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Дебаунс
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Показать системное уведомление
     */
    function showNotification(message, type = 'info') {
        // Используем глобальную функцию, если есть
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
        
        // Отправляем событие
        emitEvent('notification', { message, type });
    }

    // ============================================
    // СОБЫТИЙНАЯ СИСТЕМА
    // ============================================
    
    /**
     * Подписка на события
     */
    function on(event, callback) {
        if (!STATE.eventListeners.has(event)) {
            STATE.eventListeners.set(event, new Set());
        }
        STATE.eventListeners.get(event).add(callback);
        
        // Возвращаем функцию отписки
        return () => off(event, callback);
    }

    /**
     * Отписка от события
     */
    function off(event, callback) {
        const listeners = STATE.eventListeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    /**
     * Отправка события
     */
    function emitEvent(event, data) {
        const listeners = STATE.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    logger.error(`Error in ${event} listener:`, e);
                }
            });
        }
        
        // Также отправляем через window.dispatchEvent
        window.dispatchEvent(new CustomEvent(`auth:${event}`, { detail: data }));
    }

    // ============================================
    // API ЗАПРОСЫ
    // ============================================
    
    /**
     * Универсальная функция API запроса с ретраями
     */
    async function apiRequest(endpoint, options = {}, retries = 3) {
        const token = getToken();
        
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            credentials: 'include'
        };
        
        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };
        
        let lastError = null;
        
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                // Если не в сети — сохраняем в офлайн-очередь
                if (!STATE.isOnline && options.method !== 'GET') {
                    STATE.offlineQueue.push({ endpoint, options });
                    logger.info('Request queued for offline mode:', endpoint);
                    throw new Error('OFFLINE_QUEUED');
                }
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.LOGIN_TIMEOUT_MS);
                
                const response = await fetch(`/api${endpoint}`, {
                    ...mergedOptions,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                // Обработка ответа
                const contentType = response.headers.get('content-type');
                let data;
                
                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    data = await response.text();
                }
                
                if (!response.ok) {
                    // Если токен истёк — пробуем обновить
                    if (response.status === 401 && !STATE.isRefreshing && endpoint !== '/auth/refresh') {
                        logger.info('Token expired, attempting refresh...');
                        const refreshed = await refreshToken();
                        if (refreshed) {
                            // Повторяем запрос с новым токеном
                            attempt--;
                            continue;
                        }
                    }
                    
                    throw new Error(data?.error || data || `HTTP ${response.status}`);
                }
                
                return data;
                
            } catch (err) {
                lastError = err;
                
                if (err.message === 'OFFLINE_QUEUED') {
                    throw err;
                }
                
                if (err.name === 'AbortError') {
                    logger.warn(`Request timeout: ${endpoint}`);
                    throw new Error('Таймаут запроса');
                }
                
                // Экспоненциальная задержка перед ретраем
                if (attempt < retries - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    logger.debug(`Retry ${attempt + 1}/${retries} in ${delay}ms`);
                    await sleep(delay);
                }
            }
        }
        
        throw lastError;
    }

    // ============================================
    // РАБОТА С ТОКЕНАМИ
    // ============================================
    
    /**
     * Получить токен
     */
    function getToken() {
        return localStorage.getItem(CONFIG.TOKEN_KEY);
    }

    /**
     * Получить refresh токен
     */
    function getRefreshToken() {
        return localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY);
    }

    /**
     * Сохранить токены
     */
    function saveTokens(token, refreshToken) {
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
        if (refreshToken) {
            localStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, refreshToken);
        }
        
        // Сохраняем время истечения
        const expiry = Date.now() + (CONFIG.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        localStorage.setItem(CONFIG.TOKEN_EXPIRY_KEY, expiry);
    }

    /**
     * Удалить токены
     */
    function clearTokens() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
        localStorage.removeItem(CONFIG.TOKEN_EXPIRY_KEY);
    }

    /**
     * Проверить, истёк ли токен
     */
    function isTokenExpired() {
        const expiry = localStorage.getItem(CONFIG.TOKEN_EXPIRY_KEY);
        if (!expiry) return false;
        return Date.now() > parseInt(expiry);
    }

    /**
     * Получить сохранённого пользователя
     */
    function getStoredUser() {
        const stored = localStorage.getItem(CONFIG.USER_KEY);
        return safeJSONParse(stored);
    }

    /**
     * Сохранить пользователя
     */
    function saveUser(user) {
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
        STATE.cachedUser = user;
    }

    /**
     * Удалить сохранённого пользователя
     */
    function clearUser() {
        localStorage.removeItem(CONFIG.USER_KEY);
        STATE.cachedUser = null;
    }

    // ============================================
    // ОБНОВЛЕНИЕ ТОКЕНА
    // ============================================
    
    /**
     * Обновить access token используя refresh token
     */
    async function refreshToken() {
        if (STATE.isRefreshing) {
            logger.debug('Token refresh already in progress');
            return false;
        }
        
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
            logger.debug('No refresh token available');
            return false;
        }
        
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
                logger.info('Token refreshed successfully');
                emitEvent('token_refreshed', { token: data.token });
                return true;
            }
            
            logger.warn('Token refresh failed:', data.error);
            return false;
            
        } catch (err) {
            logger.error('Token refresh error:', err.message);
            return false;
        } finally {
            STATE.isRefreshing = false;
        }
    }

    // ============================================
    // ВХОД
    // ============================================
    
    /**
     * Основная функция входа
     */
    async function login(username, password, options = {}) {
        const { rememberMe = false, silent = false } = options;
        
        // Проверка входных данных
        if (!username || !password) {
            if (!silent) showNotification('Введите логин и пароль', 'error');
            return { success: false, error: 'Введите логин и пароль' };
        }
        
        // Проверка на повторные попытки
        const now = Date.now();
        if (STATE.loginAttempts >= CONFIG.MAX_LOGIN_ATTEMPTS) {
            const timeSinceLastAttempt = now - STATE.lastLoginAttempt;
            if (timeSinceLastAttempt < 60000) {
                const waitTime = Math.ceil((60000 - timeSinceLastAttempt) / 1000);
                const error = `Слишком много попыток. Подождите ${waitTime} сек.`;
                if (!silent) showNotification(error, 'error');
                return { success: false, error };
            }
            STATE.loginAttempts = 0;
        }
        
        // Проверка, не выполняется ли уже вход
        if (STATE.isLoggingIn) {
            return { success: false, error: 'Вход уже выполняется' };
        }
        
        STATE.isLoggingIn = true;
        STATE.loginAttempts++;
        STATE.lastLoginAttempt = now;
        
        try {
            // Очищаем предыдущую сессию
            await logout({ silent: true, keepUI: true });
            
            // Отправляем запрос
            const response = await apiRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            
            if (!response.success) {
                throw new Error(response.error || 'Неверный логин или пароль');
            }
            
            // Сохраняем токены
            saveTokens(response.token, response.refreshToken);
            
            // Сохраняем пользователя
            const user = response.user;
            saveUser(user);
            
            // Обновляем глобальное состояние
            window.app = window.app || {};
            window.app.currentUser = user.name;
            window.app.currentUserRole = user.role;
            window.app.currentUserPermissions = window.rolesMap?.[user.role] || {};
            
            // Если есть профили в ответе
            if (response.profiles) {
                window.app.profiles = response.profiles;
            }
            
            // Сохраняем логин для "запомнить меня"
            if (rememberMe) {
                localStorage.setItem('savedLogin', username);
            } else {
                localStorage.removeItem('savedLogin');
            }
            
            // Сбрасываем счётчик попыток
            STATE.loginAttempts = 0;
            STATE.isAuthenticated = true;
            
            // Запускаем фоновые процессы
            startHeartbeat();
            startTokenChecker();
            initActivityTracker();
            initPusher();
            
            // Скрываем модалку входа
            hideLoginModal();
            
            // Обновляем UI
            updateHeaderUser(user);
            
            // Показываем приветствие
            if (!silent) {
                showNotification(`👋 Добро пожаловать, ${user.name}!`, 'success');
            }
            
            // Отправляем событие
            emitEvent('login', { user });
            
            // Показываем новые достижения
            if (response.newAchievements && response.newAchievements.length > 0) {
                response.newAchievements.forEach(ach => {
                    showNotification(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
                });
                emitEvent('achievements', response.newAchievements);
            }
            
            logger.info(`User logged in: ${username} (${user.role})`);
            
            return { success: true, user, token: response.token };
            
        } catch (err) {
            logger.error('Login error:', err.message);
            
            if (!silent) {
                showNotification(err.message || 'Ошибка входа', 'error');
            }
            
            emitEvent('login_error', { error: err.message });
            
            return { success: false, error: err.message };
            
        } finally {
            STATE.isLoggingIn = false;
        }
    }

    // ============================================
    // ВЫХОД
    // ============================================
    
    /**
     * Выход из системы
     */
    async function logout(options = {}) {
        const { silent = false, keepUI = false, redirect = true } = options;
        
        if (STATE.isLoggingOut) {
            return { success: false, error: 'Выход уже выполняется' };
        }
        
        STATE.isLoggingOut = true;
        
        try {
            const token = getToken();
            const username = window.app?.currentUser;
            
            // Отправляем запрос на сервер
            if (token) {
                try {
                    await apiRequest('/auth/logout', { method: 'POST' });
                } catch (e) {
                    logger.warn('Server logout error:', e.message);
                }
            }
            
            // Очищаем локальные данные
            clearTokens();
            clearUser();
            
            // Очищаем глобальное состояние
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
            
            // Останавливаем фоновые процессы
            stopHeartbeat();
            stopTokenChecker();
            stopPusher();
            cleanupActivityTracker();
            
            // Сбрасываем состояние
            STATE.isAuthenticated = false;
            
            // Показываем модалку входа
            if (!keepUI) {
                showLoginModal();
            }
            
            // Очищаем кэш API
            if (typeof window.clearApiCache === 'function') {
                window.clearApiCache();
            }
            
            // Очищаем офлайн-очередь
            STATE.offlineQueue = [];
            
            if (!silent && username) {
                showNotification(`👋 ${username}, вы вышли из системы`, 'info');
            }
            
            emitEvent('logout', { username });
            
            logger.info(`User logged out: ${username}`);
            
            return { success: true };
            
        } catch (err) {
            logger.error('Logout error:', err.message);
            
            // Всё равно очищаем локально
            clearTokens();
            clearUser();
            showLoginModal();
            
            return { success: false, error: err.message };
            
        } finally {
            STATE.isLoggingOut = false;
        }
    }

    // ============================================
    // HEARTBEAT
    // ============================================
    
    /**
     * Запуск heartbeat
     */
    function startHeartbeat() {
        if (STATE.heartbeatTimer) {
            clearInterval(STATE.heartbeatTimer);
        }
        
        // Первый запуск сразу
        sendHeartbeat();
        
        // Затем по интервалу
        STATE.heartbeatTimer = setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL_MS);
        
        logger.debug('Heartbeat started');
    }

    /**
     * Остановка heartbeat
     */
    function stopHeartbeat() {
        if (STATE.heartbeatTimer) {
            clearInterval(STATE.heartbeatTimer);
            STATE.heartbeatTimer = null;
            logger.debug('Heartbeat stopped');
        }
    }

    /**
     * Отправка heartbeat
     */
    async function sendHeartbeat() {
        if (!STATE.isAuthenticated || !getToken()) {
            return;
        }
        
        // Проверяем, не слишком ли часто
        const now = Date.now();
        if (now - STATE.lastHeartbeat < CONFIG.HEARTBEAT_INTERVAL_MS / 2) {
            return;
        }
        STATE.lastHeartbeat = now;
        
        try {
            const response = await apiRequest('/heartbeat', { method: 'POST' });
            
            if (response && response.success) {
                // Обновляем время последней активности
                STATE.lastActivity = now;
                
                if (window.app && window.app.currentUser) {
                    window.app.lastActivity = window.app.lastActivity || {};
                    window.app.lastActivity[window.app.currentUser] = now;
                }
                
                emitEvent('heartbeat', { timestamp: now });
            }
            
        } catch (err) {
            logger.debug('Heartbeat failed:', err.message);
            
            // Если ошибка авторизации — выходим
            if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
                logger.warn('Token invalid, logging out...');
                await logout({ silent: true });
            }
        }
    }

    // ============================================
    // ПРОВЕРКА ТОКЕНА
    // ============================================
    
    /**
     * Запуск проверки токена
     */
    function startTokenChecker() {
        if (STATE.tokenCheckTimer) {
            clearInterval(STATE.tokenCheckTimer);
        }
        
        STATE.tokenCheckTimer = setInterval(checkToken, CONFIG.TOKEN_CHECK_INTERVAL_MS);
        logger.debug('Token checker started');
    }

    /**
     * Остановка проверки токена
     */
    function stopTokenChecker() {
        if (STATE.tokenCheckTimer) {
            clearInterval(STATE.tokenCheckTimer);
            STATE.tokenCheckTimer = null;
            logger.debug('Token checker stopped');
        }
    }

    /**
     * Проверка токена
     */
    async function checkToken() {
        if (isTokenExpired()) {
            logger.info('Token expired, attempting refresh...');
            
            const refreshed = await refreshToken();
            if (!refreshed) {
                logger.warn('Token refresh failed, logging out...');
                await logout({ silent: true });
                showNotification('Сессия истекла. Пожалуйста, войдите снова.', 'warning');
            }
        }
    }

    // ============================================
    // PUSHER
    // ============================================
    
    /**
     * Инициализация Pusher
     */
    function initPusher() {
        if (!STATE.isAuthenticated) {
            logger.debug('Cannot init Pusher: not authenticated');
            return;
        }
        
        if (STATE.pusher) {
            logger.debug('Pusher already initialized');
            return;
        }
        
        // Проверяем, загружен ли Pusher
        if (typeof Pusher === 'undefined') {
            logger.error('Pusher library not loaded');
            return;
        }
        
        const token = getToken();
        if (!token) {
            logger.error('No token for Pusher auth');
            return;
        }
        
        try {
            STATE.pusher = new Pusher(CONFIG.PUSHER_KEY, {
                cluster: CONFIG.PUSHER_CLUSTER,
                forceTLS: true,
                authEndpoint: '/api/pusher/auth',
                auth: {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            });
            
            // Обработчики подключения
            STATE.pusher.connection.bind('connected', () => {
                logger.info('Pusher connected');
                STATE.pusherConnected = true;
                STATE.pusherReconnectAttempts = 0;
                setSyncStatus('online');
                emitEvent('pusher_connected');
            });
            
            STATE.pusher.connection.bind('disconnected', () => {
                logger.warn('Pusher disconnected');
                STATE.pusherConnected = false;
                setSyncStatus('offline');
                schedulePusherReconnect();
                emitEvent('pusher_disconnected');
            });
            
            STATE.pusher.connection.bind('connecting', () => {
                logger.debug('Pusher connecting...');
                setSyncStatus('connecting');
            });
            
            STATE.pusher.connection.bind('error', (err) => {
                logger.error('Pusher error:', err);
                STATE.pusherConnected = false;
                setSyncStatus('offline');
                
                if (err?.error?.data?.code === 401) {
                    logger.warn('Pusher auth failed, refreshing token...');
                    refreshToken().then(() => {
                        // Переподключаемся после обновления токена
                        reconnectPusher();
                    });
                }
            });
            
            // Подписываемся на каналы
            STATE.channel = STATE.pusher.subscribe(CONFIG.PUSHER_CHANNEL);
            
            const currentUser = window.app?.currentUser;
            if (currentUser) {
                const userChannel = `private-user-${transliterate(currentUser)}`;
                STATE.privateChannel = STATE.pusher.subscribe(userChannel);
            }
            
            // Привязываем события
            bindPusherEvents();
            
        } catch (err) {
            logger.error('Pusher init error:', err.message);
        }
    }

    /**
     * Привязка событий Pusher
     */
    function bindPusherEvents() {
        if (!STATE.channel) return;
        
        // Общие события
        STATE.channel.bind('schedule-updated', (data) => {
            emitEvent('schedule_updated', data);
            if (typeof window.loadScheduleData === 'function') {
                window.loadScheduleData();
            }
        });
        
        STATE.channel.bind('global-notification', (data) => {
            emitEvent('global_notification', data);
            if (typeof window.updateNotificationsBadge === 'function') {
                window.updateNotificationsBadge();
            }
        });
        
        // Личные уведомления
        if (STATE.privateChannel) {
            STATE.privateChannel.bind('personal-notification', (data) => {
                emitEvent('personal_notification', data);
                showNotification(data.title || data.message, data.type || 'info');
            });
        }
    }

    /**
     * Остановка Pusher
     */
    function stopPusher() {
        if (STATE.pusher) {
            try {
                STATE.pusher.disconnect();
            } catch (e) {
                logger.error('Pusher disconnect error:', e);
            }
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

    /**
     * Переподключение Pusher
     */
    function reconnectPusher() {
        stopPusher();
        initPusher();
    }

    /**
     * Планирование переподключения Pusher
     */
    function schedulePusherReconnect() {
        if (STATE.pusherReconnectTimer) {
            clearTimeout(STATE.pusherReconnectTimer);
        }
        
        STATE.pusherReconnectAttempts++;
        
        if (STATE.pusherReconnectAttempts <= STATE.maxPusherReconnectAttempts) {
            const delay = Math.min(30000, 1000 * Math.pow(2, STATE.pusherReconnectAttempts));
            logger.debug(`Scheduling Pusher reconnect in ${delay}ms (attempt ${STATE.pusherReconnectAttempts})`);
            
            STATE.pusherReconnectTimer = setTimeout(() => {
                reconnectPusher();
            }, delay);
        } else {
            logger.error('Max Pusher reconnect attempts reached');
        }
    }

    /**
     * Установка статуса синхронизации
     */
    function setSyncStatus(status) {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;
        
        indicator.classList.remove('online', 'offline', 'connecting');
        indicator.classList.add(status);
        
        // Обновляем иконку
        const icon = indicator.querySelector('i');
        if (icon) {
            if (status === 'online') {
                icon.className = 'fas fa-broadcast-tower';
                icon.style.color = '#10b981';
            } else if (status === 'offline') {
                icon.className = 'fas fa-broadcast-tower';
                icon.style.color = '#ef4444';
            } else {
                icon.className = 'fas fa-spinner fa-spin';
                icon.style.color = '#f59e0b';
            }
        }
    }

    // ============================================
    // ТРЕКЕР АКТИВНОСТИ
    // ============================================
    
    /**
     * Инициализация трекера активности
     */
    function initActivityTracker() {
        cleanupActivityTracker();
        
        const updateActivity = debounce(() => {
            STATE.lastActivity = Date.now();
            
            if (window.app && window.app.currentUser) {
                window.app.lastActivity = window.app.lastActivity || {};
                window.app.lastActivity[window.app.currentUser] = STATE.lastActivity;
            }
            
            emitEvent('activity', { timestamp: STATE.lastActivity });
        }, CONFIG.ACTIVITY_DEBOUNCE_MS);
        
        const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
        
        events.forEach(eventType => {
            document.addEventListener(eventType, updateActivity, { passive: true });
            STATE.activityHandlers.push({ event: eventType, handler: updateActivity });
        });
        
        // Отслеживание видимости страницы
        const visibilityHandler = () => {
            if (!document.hidden) {
                updateActivity();
                sendHeartbeat();
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        STATE.activityHandlers.push({ event: 'visibilitychange', handler: visibilityHandler });
        
        logger.debug('Activity tracker initialized');
    }

    /**
     * Очистка трекера активности
     */
    function cleanupActivityTracker() {
        STATE.activityHandlers.forEach(({ event, handler }) => {
            document.removeEventListener(event, handler);
        });
        STATE.activityHandlers = [];
    }

    // ============================================
    // UI ФУНКЦИИ
    // ============================================
    
    /**
     * Показать модалку входа
     */
    function showLoginModal() {
        const modal = document.getElementById('loginModal');
        const mainContainer = document.getElementById('mainContainer');
        
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
        }
        if (mainContainer) {
            mainContainer.style.display = 'none';
        }
        
        // Восстанавливаем сохранённый логин
        const savedLogin = localStorage.getItem('savedLogin');
        if (savedLogin) {
            const loginInput = document.getElementById('loginName');
            if (loginInput) loginInput.value = savedLogin;
            
            const rememberCheckbox = document.getElementById('rememberMe');
            if (rememberCheckbox) rememberCheckbox.checked = true;
        }
        
        emitEvent('login_modal_shown');
    }

    /**
     * Скрыть модалку входа
     */
    function hideLoginModal() {
        const modal = document.getElementById('loginModal');
        const mainContainer = document.getElementById('mainContainer');
        
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
        if (mainContainer) {
            mainContainer.style.display = 'block';
        }
        
        emitEvent('login_modal_hidden');
    }

    /**
     * Обновить данные пользователя в хедере
     */
    function updateHeaderUser(user) {
        const headerName = document.getElementById('headerName');
        const headerAvatar = document.getElementById('headerAvatar');
        const headerStatus = document.getElementById('headerStatus');
        
        if (headerName) {
            headerName.textContent = user.name;
        }
        
        if (headerAvatar) {
            if (user.avatar_url) {
                headerAvatar.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" style="width:100%;height:100%;object-fit:cover;">`;
            } else if (user.avatar) {
                headerAvatar.innerHTML = escapeHtml(user.avatar);
            } else {
                headerAvatar.innerHTML = '👤';
            }
        }
        
        if (headerStatus && user.status) {
            headerStatus.textContent = user.status;
        }
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    
    /**
     * Инициализация модуля авторизации
     */
    function initAuth() {
        if (STATE.isInitialized) {
            logger.debug('Auth already initialized');
            return;
        }
        
        logger.info('Initializing authentication module v5.0');
        
        // Проверяем сохранённую сессию
        const token = getToken();
        const user = getStoredUser();
        
        if (token && user) {
            STATE.isAuthenticated = true;
            
            // Восстанавливаем состояние
            window.app = window.app || {};
            window.app.currentUser = user.name;
            window.app.currentUserRole = user.role;
            
            // Скрываем модалку
            hideLoginModal();
            
            // Обновляем UI
            updateHeaderUser(user);
            
            // Запускаем фоновые процессы
            startHeartbeat();
            startTokenChecker();
            initActivityTracker();
            
            // Инициализируем Pusher с задержкой
            setTimeout(initPusher, 1000);
            
            logger.info(`Session restored: ${user.name}`);
        } else {
            showLoginModal();
        }
        
        // Настраиваем форму входа
        setupLoginForm();
        
        // Отслеживаем онлайн/офлайн
        setupNetworkListeners();
        
        STATE.isInitialized = true;
        emitEvent('initialized');
        
        logger.info('Auth module initialized');
    }

    /**
     * Настройка формы входа
     */
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
            
            const submitBtn = document.getElementById('loginSubmitBtn');
            const originalText = submitBtn?.innerHTML;
            
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
                submitBtn.disabled = true;
            }
            
            try {
                const result = await login(username, password, { rememberMe });
                
                if (!result.success) {
                    if (submitBtn) {
                        submitBtn.innerHTML = originalText;
                        submitBtn.disabled = false;
                    }
                }
            } catch (err) {
                if (submitBtn) {
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false;
                }
            }
        };
        
        // Показать/скрыть пароль
        const toggleBtn = document.getElementById('togglePassword');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                const input = document.getElementById('loginPassword');
                if (input) {
                    input.type = input.type === 'password' ? 'text' : 'password';
                    toggleBtn.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
                }
            };
        }
    }

    /**
     * Настройка слушателей сети
     */
    function setupNetworkListeners() {
        window.addEventListener('online', () => {
            STATE.isOnline = true;
            logger.info('Network online');
            
            // Отправляем накопившиеся запросы
            processOfflineQueue();
        });
        
        window.addEventListener('offline', () => {
            STATE.isOnline = false;
            logger.warn('Network offline');
            showNotification('📡 Нет соединения с интернетом', 'warning');
        });
    }

    /**
     * Обработка офлайн-очереди
     */
    async function processOfflineQueue() {
        if (STATE.offlineQueue.length === 0) return;
        
        logger.info(`Processing ${STATE.offlineQueue.length} offline requests`);
        
        const queue = [...STATE.offlineQueue];
        STATE.offlineQueue = [];
        
        for (const { endpoint, options } of queue) {
            try {
                await apiRequest(endpoint, options, 1);
                logger.debug(`Offline request succeeded: ${endpoint}`);
            } catch (err) {
                logger.error(`Offline request failed: ${endpoint}`, err.message);
                // Возвращаем в очередь для повторной попытки
                STATE.offlineQueue.push({ endpoint, options });
            }
        }
        
        if (STATE.offlineQueue.length > 0) {
            logger.warn(`${STATE.offlineQueue.length} requests still pending`);
        }
    }

    // ============================================
    // ПУБЛИЧНОЕ API
    // ============================================
    
    const AuthAPI = {
        // Инициализация
        init: initAuth,
        
        // Вход/выход
        login,
        logout,
        refreshToken,
        
        // Состояние
        isAuthenticated: () => STATE.isAuthenticated,
        getToken,
        getCurrentUser: () => window.app?.currentUser,
        getCurrentRole: () => window.app?.currentUserRole,
        
        // Pusher
        initPusher,
        stopPusher,
        reconnectPusher,
        getPusher: () => STATE.pusher,
        getChannel: () => STATE.channel,
        getPrivateChannel: () => STATE.privateChannel,
        isPusherConnected: () => STATE.pusherConnected,
        
        // UI
        showLoginModal,
        hideLoginModal,
        updateHeaderUser,
        
        // События
        on,
        off,
        
        // Heartbeat
        sendHeartbeat,
        startHeartbeat,
        stopHeartbeat,
        
        // Офлайн
        processOfflineQueue,
        getOfflineQueue: () => [...STATE.offlineQueue],
        
        // Сброс состояния (для тестов)
        reset: () => {
            clearTokens();
            clearUser();
            STATE.isAuthenticated = false;
            STATE.loginAttempts = 0;
            stopHeartbeat();
            stopTokenChecker();
            stopPusher();
            cleanupActivityTracker();
            showLoginModal();
        }
    };

    // ============================================
    // ЭКСПОРТ В WINDOW
    // ============================================
    
    window.auth = AuthAPI;
    
    // Для обратной совместимости
    window.login = (username, password) => login(username, password);
    window.authLogout = () => logout();
    window.initPusher = initPusher;
    window.sendHeartbeat = sendHeartbeat;
    window.startHeartbeat = startHeartbeat;
    window.showLoginModal = showLoginModal;
    window.hideLoginModal = hideLoginModal;
    window.updateHeaderUser = updateHeaderUser;
    window.checkTokenAndLogout = async () => {
        if (isTokenExpired()) {
            await logout({ silent: true });
            return true;
        }
        return false;
    };

    // ============================================
    // АВТОЗАПУСК
    // ============================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAuth);
    } else {
        setTimeout(initAuth, 100);
    }

    console.log('✅ auth.js v5.0 ULTRA MEGA EDITION загружен');

})();