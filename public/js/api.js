// public/js/api.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.3
// Исправлены условные рендеры, загрузка сотрудников, офлайн-кэш

let pendingRequests = new Map();
let retryCount = 0;
const MAX_RETRIES = 3;
const API_TIMEOUT = 15000;

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

const OFFLINE_CACHE_KEY = 'warpoint_offline_data';
const OFFLINE_CACHE_TTL = 30 * 60 * 1000;

let apiInitialized = false;

function resetApiState() {
    console.log('🧹 Сброс состояния API');
    apiInitialized = false;
    pendingRequests.clear();
    retryCount = 0;
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

async function originalApiCall(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token');
    
    if (!token && !endpoint.includes('/auth/')) {
        console.log('🔐 Нет токена, требуется авторизация');
        if (typeof window.authLogout === 'function') window.authLogout();
        return { success: false, error: 'Требуется авторизация' };
    }
    
    const requestKey = `${method}:${endpoint}:${JSON.stringify(body)}`;
    if (pendingRequests.has(requestKey)) {
        console.log(`⏳ Запрос уже выполняется: ${requestKey}`);
        return pendingRequests.get(requestKey);
    }
    
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
    
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.body = JSON.stringify(body);
    
    console.log(`📡 API Call: ${method} ${endpoint}`);
    
    const requestPromise = (async () => {
        try {
            const response = await fetch(`/api${endpoint}`, options);
            clearTimeout(timeoutId);
            
            if (response.status === 401) {
                console.log('🔐 Токен истёк');
                if (typeof window.authLogout === 'function') window.authLogout();
                return { success: false, error: 'Сессия истекла' };
            }
            
            if (!response.ok) {
                console.error(`❌ API error: ${response.status} ${response.statusText}`);
                if (method === 'GET') {
                    const offlineData = loadFromOfflineCache(endpoint);
                    if (offlineData) {
                        console.log(`📡 Работаем офлайн: ${endpoint}`);
                        showSystemNotification('📡 Работаем офлайн. Данные могут быть устаревшими.', 'warning');
                        return offlineData;
                    }
                }
                return { success: false, error: `Ошибка сервера: ${response.status}` };
            }
            
            const data = await response.json();
            
            if (method === 'GET') {
                const cacheKey = endpoint.split('?')[0];
                if (CACHE_TTL[cacheKey]) {
                    apiCache.set(endpoint, { data: data, timestamp: Date.now() });
                }
                if (endpoint === '/employees' || endpoint === '/tasks' || endpoint === '/schedule') {
                    saveToOfflineCache(endpoint, data);
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
            
            if (method === 'GET') {
                const offlineData = loadFromOfflineCache(endpoint);
                if (offlineData) {
                    console.log(`📡 Работаем офлайн (сеть недоступна): ${endpoint}`);
                    showSystemNotification('📡 Нет соединения. Работаем офлайн.', 'warning');
                    return offlineData;
                }
            }
            
            retryCount++;
            if (retryCount <= MAX_RETRIES && method === 'GET') {
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

function saveToOfflineCache(endpoint, data) {
    try {
        const cache = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || '{}');
        cache[endpoint] = { data: data, timestamp: Date.now() };
        for (const key of Object.keys(cache)) {
            if (Date.now() - cache[key].timestamp > OFFLINE_CACHE_TTL) delete cache[key];
        }
        localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(cache));
        console.log(`💾 Офлайн-кэш сохранён: ${endpoint}`);
    } catch (e) {
        console.error('Ошибка сохранения офлайн-кэша:', e);
        if (e.name === 'QuotaExceededError') localStorage.removeItem(OFFLINE_CACHE_KEY);
    }
}

function loadFromOfflineCache(endpoint) {
    try {
        const cache = JSON.parse(localStorage.getItem(OFFLINE_CACHE_KEY) || '{}');
        const entry = cache[endpoint];
        if (entry && Date.now() - entry.timestamp < OFFLINE_CACHE_TTL) {
            console.log(`📦 Загружено из офлайн-кэша: ${endpoint}`);
            return entry.data;
        }
    } catch (e) {
        console.error('Ошибка загрузки офлайн-кэша:', e);
    }
    return null;
}

function clearOfflineCache() {
    localStorage.removeItem(OFFLINE_CACHE_KEY);
    console.log('🧹 Офлайн-кэш очищен');
}

async function apiCall(endpoint, method = 'GET', body = null) {
    const response = await originalApiCall(endpoint, method, body);
    
    if (response && response.newAchievements && response.newAchievements.length > 0) {
        console.log('🎁 Получены новые достижения:', response.newAchievements);
        for (const ach of response.newAchievements) {
            showSystemNotification(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
        }
        if (typeof loadAchievements === 'function') setTimeout(() => loadAchievements(), 500);
        if (typeof refreshAllBalanceDisplays === 'function') setTimeout(() => refreshAllBalanceDisplays(), 300);
        if (typeof renderEmployees === 'function' && document.getElementById('employeesGrid')) setTimeout(() => renderEmployees(), 300);
    }
    
    return response;
}

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function clearApiCache(endpoint = null) {
    if (endpoint) { apiCache.delete(endpoint); console.log(`🧹 Кэш очищен: ${endpoint}`); }
    else { apiCache.clear(); console.log('🧹 Весь кэш API очищен'); }
}

function invalidateCache(patterns) {
    for (const key of apiCache.keys()) {
        for (const pattern of patterns) {
            if (key.includes(pattern)) { apiCache.delete(key); console.log(`🧹 Кэш инвалидирован: ${key}`); break; }
        }
    }
}

let isLoadingEmployees = false;
let isLoadingTasks = false;
let isLoadingFines = false;
let isLoadingSchedule = false;

async function loadEmployees() {
    if (isLoadingEmployees) { console.log('⏳ Сотрудники уже загружаются'); return; }
    isLoadingEmployees = true;
    
    try {
        const data = await apiCall('/employees');
        
        if (data && data.success && data.employees) {
            window.app = window.app || {};
            window.app.employees = data.employees.map(emp => emp.name);
            window.app.profiles = {};
            data.employees.forEach(emp => {
                window.app.profiles[emp.name] = {
                    id: emp.id, name: emp.name, avatar: emp.avatar || '👤', avatar_url: emp.avatar_url || null,
                    status: emp.status || '💼 Работаю', active_status: emp.active_status || null,
                    coins: emp.coins || 100, rating: emp.rating || 0, role: emp.role || 'operator',
                    hours: emp.hours || 0, birthday: emp.birthday || null, phone: emp.phone || null,
                    last_active: emp.last_active || null, dashboard_style: emp.dashboard_style || 'standart',
                    bought_styles: emp.bought_styles || '["standart"]', can_edit_vp: emp.can_edit_vp || false,
                    bonus_streak: emp.bonus_streak || 1, total_shifts: emp.total_shifts || 0,
                    total_tasks_completed: emp.total_tasks_completed || 0, total_gifts_sent: emp.total_gifts_sent || 0,
                    total_gifts_received: emp.total_gifts_received || 0, is_active: emp.is_active !== false
                };
            });
            
            console.log(`👥 Загружено ${window.app.employees.length} сотрудников`);
            
            // 🔥 УСЛОВНЫЕ РЕНДЕРЫ — проверяем существование контейнеров
            if (typeof renderEmployees === 'function' && document.getElementById('employeesGrid')) {
                renderEmployees();
            }
            if (typeof renderRatingTable === 'function' && document.getElementById('ratingTableBody')) {
                renderRatingTable();
            }
            if (typeof updateDashboardStats === 'function') {
                updateDashboardStats();
            }
            if (typeof refreshAllBalanceDisplays === 'function') {
                refreshAllBalanceDisplays();
            }
            
            showSystemNotification(`👥 Загружено ${window.app.employees.length} сотрудников`, 'info');
        } else {
            console.error('❌ Ошибка загрузки сотрудников: неверный формат данных');
            const offlineData = loadFromOfflineCache('/employees');
            if (offlineData && offlineData.employees) {
                window.app = window.app || {};
                window.app.employees = offlineData.employees.map(emp => emp.name);
                window.app.profiles = {};
                offlineData.employees.forEach(emp => { window.app.profiles[emp.name] = emp; });
                showSystemNotification('📡 Загружены сохранённые данные', 'info');
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки сотрудников:', e);
        const offlineData = loadFromOfflineCache('/employees');
        if (offlineData && offlineData.employees) {
            window.app = window.app || {};
            window.app.employees = offlineData.employees.map(emp => emp.name);
            window.app.profiles = {};
            offlineData.employees.forEach(emp => { window.app.profiles[emp.name] = emp; });
            showSystemNotification('📡 Загружены сохранённые данные', 'info');
        }
    } finally {
        isLoadingEmployees = false;
    }
}

async function loadTasks() {
    if (isLoadingTasks) return;
    isLoadingTasks = true;
    try {
        const data = await apiCall('/tasks');
        if (data && Array.isArray(data)) { window.app = window.app || {}; window.app.tasks = data; saveToOfflineCache('/tasks', data); }
    } catch (e) { console.error('Ошибка загрузки задач:', e); }
    finally { isLoadingTasks = false; }
}

async function loadFines() {
    if (isLoadingFines) return;
    isLoadingFines = true;
    try {
        const data = await apiCall('/fines');
        if (data && Array.isArray(data)) { window.app = window.app || {}; window.app.fines = data; }
    } catch (e) { console.error('Ошибка загрузки штрафов:', e); }
    finally { isLoadingFines = false; }
}

async function loadSchedule() {
    if (isLoadingSchedule) return;
    isLoadingSchedule = true;
    try {
        const response = await apiCall('/schedule');
        if (response && Array.isArray(response)) {
            const scheduleByDate = {};
            for (const item of response) {
                if (!scheduleByDate[item.date]) scheduleByDate[item.date] = {};
                scheduleByDate[item.date][item.employee] = {
                    time: item.shift_time, status: item.shift_status,
                    is_special: item.is_special, special_end_time: item.special_end_time
                };
            }
            window.app = window.app || {};
            window.app.schedule = scheduleByDate;
            saveToOfflineCache('/schedule', scheduleByDate);
        }
    } catch (e) { console.error('Ошибка загрузки графика:', e); }
    finally { isLoadingSchedule = false; }
}

async function updateEmployeeStatus(name, status) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { status });
    if (response && response.success) { if (window.app?.profiles?.[name]) window.app.profiles[name].status = status; invalidateCache(['/employees']); return true; }
    return false;
}

async function updateEmployeeAvatar(name, avatar) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar });
    if (response && response.success) { if (window.app?.profiles?.[name]) { window.app.profiles[name].avatar = avatar; window.app.profiles[name].avatar_url = null; } invalidateCache(['/employees']); clearOfflineCache(); return true; }
    return false;
}

async function updateEmployeeAvatarBase64(name, base64) {
    if (!base64 || !base64.startsWith('data:image')) return false;
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar_url: base64 });
    if (response && response.success) { if (window.app?.profiles?.[name]) { window.app.profiles[name].avatar_url = base64; window.app.profiles[name].avatar = null; } if (name === window.app?.currentUser && typeof window.updateHeaderAvatar === 'function') window.updateHeaderAvatar(base64, null); invalidateCache(['/employees']); clearOfflineCache(); return true; }
    return false;
}

async function loadAllData() {
    console.log('🔄 Загрузка всех данных...');
    await Promise.all([loadEmployees(), loadTasks(), loadFines(), loadSchedule()]);
    console.log('✅ Все данные загружены');
}

window.originalApiCall = originalApiCall;
window.apiCall = apiCall;
window.loadEmployees = loadEmployees;
window.loadTasks = loadTasks;
window.loadFines = loadFines;
window.loadSchedule = loadSchedule;
window.loadAllData = loadAllData;
window.updateEmployeeStatus = updateEmployeeStatus;
window.updateEmployeeAvatar = updateEmployeeAvatar;
window.updateEmployeeAvatarBase64 = updateEmployeeAvatarBase64;
window.clearApiCache = clearApiCache;
window.invalidateCache = invalidateCache;
window.saveToOfflineCache = saveToOfflineCache;
window.loadFromOfflineCache = loadFromOfflineCache;
window.clearOfflineCache = clearOfflineCache;
window.resetApiState = resetApiState;

console.log('✅ api.js загружен (v2.3 — исправлены условные рендеры)');