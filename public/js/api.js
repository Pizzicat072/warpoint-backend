// public/js/api.js

// ============================================
// ЗАЩИТА ОТ БЕСКОНЕЧНЫХ ЗАПРОСОВ
// ============================================

let pendingRequests = new Map(); // Отслеживание повторяющихся запросов
let retryCount = 0;
const MAX_RETRIES = 3;

// Оригинальная функция API-вызовов
async function originalApiCall(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token');
    
    // 🔥 ПРОВЕРКА НА ПОВТОРЯЮЩИЕСЯ ЗАПРОСЫ
    const requestKey = `${method}:${endpoint}:${JSON.stringify(body)}`;
    if (pendingRequests.has(requestKey)) {
        console.log(`⏳ Запрос уже выполняется: ${requestKey}`);
        return pendingRequests.get(requestKey);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
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
            
            if (response.status === 401) {
                console.log('🔐 Токен истёк');
                if (window.authLogout) window.authLogout();
                return null;
            }
            
            const data = await response.json();
            retryCount = 0; // Сброс счётчика при успехе
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
            
            return null;
        } finally {
            pendingRequests.delete(requestKey);
        }
    })();
    
    pendingRequests.set(requestKey, requestPromise);
    return requestPromise;
}

// Обёртка для обработки новых достижений
async function apiCall(endpoint, method = 'GET', body = null) {
    const response = await originalApiCall(endpoint, method, body);
    
    if (response && response.newAchievements && response.newAchievements.length > 0) {
        console.log('🎁 Получены новые достижения:', response.newAchievements);
        
        for (const ach of response.newAchievements) {
            showNotif(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
        }
        
        if (typeof loadAchievements === 'function') {
            setTimeout(() => loadAchievements(), 500);
        }
        
        // 🔥 ВОТ СЮДА ДОБАВЬ ЭТИ СТРОКИ:
        if (typeof refreshAllBalanceDisplays === 'function') {
            setTimeout(() => refreshAllBalanceDisplays(), 300);
        }
    }
    
    return response;
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
        if (data) {
            window.app = window.app || {};
            window.app.employees = data.employees || [];
            window.app.profiles = data.profiles || {};
            window.app.schedule = data.schedule || {};
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
    } finally {
        isLoadingEmployees = false;
    }
}

async function loadTasks() {
    if (isLoadingTasks) return;
    isLoadingTasks = true;
    try {
        const data = await apiCall('/tasks');
        if (data) {
            window.app = window.app || {};
            window.app.tasks = data;
        }
    } finally {
        isLoadingTasks = false;
    }
}

async function loadFines() {
    if (isLoadingFines) return;
    isLoadingFines = true;
    try {
        const data = await apiCall('/fines');
        if (data) {
            window.app = window.app || {};
            window.app.fines = data;
        }
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
    } finally {
        isLoadingSchedule = false;
    }
}

async function loadLastActivity() {
    try {
        const data = await apiCall('/last-activity');
        if (data && data.success) {
            window.app = window.app || {};
            window.app.lastActivity = data.data || {};
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
        }
    } catch (e) {
        console.error('Ошибка загрузки активности:', e);
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
window.loadLastActivity = loadLastActivity;
window.updateEmployeeStatus = updateEmployeeStatus;
window.updateEmployeeAvatar = updateEmployeeAvatar;
window.updateEmployeeAvatarBase64 = updateEmployeeAvatarBase64;

console.log('✅ api.js загружен (с защитой от бесконечных запросов)');