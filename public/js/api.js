// public/js/api.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

// ============================================
// ЗАЩИТА ОТ БЕСКОНЕЧНЫХ ЗАПРОСОВ
// ============================================

let pendingRequests = new Map();
let retryCount = 0;
const MAX_RETRIES = 3;
const API_TIMEOUT = 15000;

// Кэш для GET-запросов
const apiCache = new Map();
const CACHE_TTL = {
    '/employees': 60000,
    '/schedule': 30000,
    '/tasks': 30000,
    '/fines': 30000,
    '/achievements': 120000,
    '/knowledge/categories': 300000,
    '/knowledge/articles': 300000,
    '/fund': 60000,
    '/weather': 300000
};

// ============================================
// ОРИГИНАЛЬНАЯ ФУНКЦИЯ API-ВЫЗОВОВ
// ============================================

async function originalApiCall(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token');
    
    // 🔥 Проверка токена
    if (!token && !endpoint.includes('/auth/')) {
        console.log('🔐 Нет токена, требуется авторизация');
        if (typeof window.authLogout === 'function') {
            window.authLogout();
        }
        return { success: false, error: 'Требуется авторизация' };
    }
    
    // 🔥 ПРОВЕРКА НА ПОВТОРЯЮЩИЕСЯ ЗАПРОСЫ
    const requestKey = `${method}:${endpoint}:${JSON.stringify(body)}`;
    if (pendingRequests.has(requestKey)) {
        console.log(`⏳ Запрос уже выполняется: ${requestKey}`);
        return pendingRequests.get(requestKey);
    }
    
    // 🔥 ПРОВЕРКА КЭША ДЛЯ GET-ЗАПРОСОВ
    if (method === 'GET') {
        const cacheKey = endpoint.split('?')[0];
        const ttl = CACHE_TTL[cacheKey];
        if (ttl) {
            const cached = apiCache.get(endpoint);
            if (cached && Date.now() - cached.timestamp < ttl) {
                console.log(`📦 Кэш: ${endpoint}`);
                return cached.data;
            }
        }
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const options = { 
        method, 
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
    };
    
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    console.log(`📡 API Call: ${method} ${endpoint}`);
    
    const requestPromise = (async () => {
        try {
            const response = await fetch(`/api${endpoint}`, options);
            clearTimeout(timeoutId);
            
            // 🔥 ОБРАБОТКА 401
            if (response.status === 401) {
                console.log('🔐 Токен истёк');
                if (typeof window.authLogout === 'function') {
                    window.authLogout();
                }
                return { success: false, error: 'Сессия истекла' };
            }
            
            // 🔥 ОБРАБОТКА ДРУГИХ ОШИБОК
            if (!response.ok) {
                console.error(`❌ API error: ${response.status} ${response.statusText}`);
                return { success: false, error: `Ошибка сервера: ${response.status}` };
            }
            
            const data = await response.json();
            
            // 🔥 СОХРАНЯЕМ В КЭШ
            if (method === 'GET') {
                const cacheKey = endpoint.split('?')[0];
                if (CACHE_TTL[cacheKey]) {
                    apiCache.set(endpoint, {
                        data: data,
                        timestamp: Date.now()
                    });
                }
            }
            
            retryCount = 0;
            return data;
            
        } catch (e) {
            clearTimeout(timeoutId);
            
            if (e.name === 'AbortError') {
                console.error('❌ API timeout:', endpoint);
                return { success: false, error: 'Таймаут запроса' };
            }
            
            console.error('❌ API error:', e.message);
            
            // 🔥 ЭКСПОНЕНЦИАЛЬНАЯ ЗАДЕРЖКА ПРИ ОШИБКАХ
            retryCount++;
            if (retryCount <= MAX_RETRIES) {
                const delay = 1000 * Math.pow(2, retryCount);
                console.log(`🔄 Повторная попытка через ${delay}ms (${retryCount}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, delay));
                return originalApiCall(endpoint, method, body);
            }
            
            return { success: false, error: 'Ошибка соединения' };
        } finally {
            pendingRequests.delete(requestKey);
        }
    })();
    
    pendingRequests.set(requestKey, requestPromise);
    return requestPromise;
}

// ============================================
// ОБЁРТКА ДЛЯ ОБРАБОТКИ НОВЫХ ДОСТИЖЕНИЙ
// ============================================

async function apiCall(endpoint, method = 'GET', body = null) {
    const response = await originalApiCall(endpoint, method, body);
    
    if (response && response.newAchievements && response.newAchievements.length > 0) {
        console.log('🎁 Получены новые достижения:', response.newAchievements);
        
        for (const ach of response.newAchievements) {
            showNotif(`🏆 ${escapeHtml(ach.name)} (+${ach.coins} WP)`, 'success');
        }
        
        if (typeof loadAchievements === 'function') {
            setTimeout(() => loadAchievements(), 500);
        }
        
        if (typeof refreshAllBalanceDisplays === 'function') {
            setTimeout(() => refreshAllBalanceDisplays(), 300);
        }
    }
    
    return response;
}

// ============================================
// ОЧИСТКА КЭША
// ============================================

function clearApiCache(endpoint = null) {
    if (endpoint) {
        apiCache.delete(endpoint);
        console.log(`🧹 Кэш очищен: ${endpoint}`);
    } else {
        apiCache.clear();
        console.log('🧹 Весь кэш API очищен');
    }
}

function invalidateCache(patterns) {
    for (const key of apiCache.keys()) {
        for (const pattern of patterns) {
            if (key.includes(pattern)) {
                apiCache.delete(key);
                console.log(`🧹 Кэш инвалидирован: ${key}`);
                break;
            }
        }
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ (С ЗАЩИТОЙ)
// ============================================

let isLoadingEmployees = false;
let isLoadingTasks = false;
let isLoadingFines = false;
let isLoadingSchedule = false;

async function loadEmployees() {
    if (isLoadingEmployees) {
        console.log('⏳ Сотрудники уже загружаются');
        return;
    }
    isLoadingEmployees = true;
    try {
        const data = await apiCall('/data');
        if (data && !data.error) {
            window.app = window.app || {};
            window.app.employees = data.employees || [];
            window.app.profiles = data.profiles || {};
            window.app.schedule = data.schedule || {};
            window.app.tasks = data.tasks || [];
            window.app.fines = data.fines || [];
            
            for (let emp of window.app.employees) {
                if (!window.app.profiles[emp]) {
                    window.app.profiles[emp] = { 
                        avatar: '👤', name: emp, coins: 100, 
                        rating: 0, role: 'operator', hours: 0,
                        status: '💼 Работаю'
                    };
                }
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки сотрудников:', e);
    } finally {
        isLoadingEmployees = false;
    }
}

async function loadTasks() {
    if (isLoadingTasks) return;
    isLoadingTasks = true;
    try {
        const data = await apiCall('/tasks');
        if (data && !data.error) {
            window.app = window.app || {};
            window.app.tasks = data;
        }
    } catch (e) {
        console.error('Ошибка загрузки задач:', e);
    } finally {
        isLoadingTasks = false;
    }
}

async function loadFines() {
    if (isLoadingFines) return;
    isLoadingFines = true;
    try {
        const data = await apiCall('/fines');
        if (data && !data.error) {
            window.app = window.app || {};
            window.app.fines = data;
        }
    } catch (e) {
        console.error('Ошибка загрузки штрафов:', e);
    } finally {
        isLoadingFines = false;
    }
}

async function loadSchedule() {
    if (isLoadingSchedule) return;
    isLoadingSchedule = true;
    try {
        const response = await apiCall('/schedule');
        if (response && Array.isArray(response)) {
            const scheduleByDate = {};
            for (const item of response) {
                const dateStr = item.date;
                if (!scheduleByDate[dateStr]) scheduleByDate[dateStr] = {};
                scheduleByDate[dateStr][item.employee] = {
                    time: item.shift_time,
                    status: item.shift_status,
                    is_special: item.is_special,
                    special_end_time: item.special_end_time
                };
            }
            window.app = window.app || {};
            window.app.schedule = scheduleByDate;
        }
    } catch (e) {
        console.error('Ошибка загрузки графика:', e);
    } finally {
        isLoadingSchedule = false;
    }
}

// ============================================
// ОБНОВЛЕНИЕ ДАННЫХ
// ============================================

async function updateEmployeeStatus(name, status) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { status });
    if (response && response.success) {
        if (window.app?.profiles?.[name]) window.app.profiles[name].status = status;
        return true;
    }
    return false;
}

async function updateEmployeeAvatar(name, avatar) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar });
    if (response && response.success) {
        if (window.app?.profiles?.[name]) window.app.profiles[name].avatar = avatar;
        invalidateCache(['/employees', '/data']);
        return true;
    }
    return false;
}

async function updateEmployeeAvatarBase64(name, base64) {
    if (!base64 || !base64.startsWith('data:image')) return false;
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar_url: base64 });
    if (response && response.success) {
        if (window.app?.profiles?.[name]) {
            window.app.profiles[name].avatar_url = base64;
            window.app.profiles[name].avatar = null;
        }
        if (name === window.app?.currentUser && typeof window.updateHeaderAvatar === 'function') {
            window.updateHeaderAvatar(base64, null);
        }
        invalidateCache(['/employees', '/data']);
        return true;
    }
    return false;
}

// ============================================
// ЭКСПОРТ
// ============================================

window.originalApiCall = originalApiCall;
window.apiCall = apiCall;
window.loadEmployees = loadEmployees;
window.loadTasks = loadTasks;
window.loadFines = loadFines;
window.loadSchedule = loadSchedule;
window.updateEmployeeStatus = updateEmployeeStatus;
window.updateEmployeeAvatar = updateEmployeeAvatar;
window.updateEmployeeAvatarBase64 = updateEmployeeAvatarBase64;
window.clearApiCache = clearApiCache;
window.invalidateCache = invalidateCache;

console.log('✅ api.js загружен (с кэшированием и защитой)');