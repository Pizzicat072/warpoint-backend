// public/js/api.js

// ============================================
// ОРИГИНАЛЬНАЯ ФУНКЦИЯ API-ВЫЗОВОВ
// ============================================
async function originalApiCall(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token');
    
    // 🔥 ТАЙМАУТ 15 СЕКУНД
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const options = { 
        method, 
        headers: { 
            'Content-Type': 'application/json'
        },
        signal: controller.signal
    };
    
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    } else {
        console.warn('⚠️ Нет токена авторизации!');
    }
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    console.log(`📡 API Call: ${method} ${endpoint}`, body);
    
    try {
        const response = await fetch(`/api${endpoint}`, options);
        clearTimeout(timeoutId);
        console.log(`📡 Response status: ${response.status}`);
        
        if (response.status === 401) {
            console.log('🔐 Токен истёк или неверный');
            if (window.authLogout) window.authLogout();
            return null;
        }
        
        const data = await response.json();
        console.log(`📡 Response data:`, data);
        return data;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            console.error('❌ API timeout:', endpoint);
            showNotif('Сервер долго не отвечает. Попробуйте позже.', 'error');
            return { success: false, error: 'Таймаут запроса' };
        }
        console.error('❌ API error:', e);
        showNotif('Ошибка соединения с сервером', 'error');
        return null;
    }
}

// ============================================
// 🔥 ОБЁРТКА ДЛЯ ОБРАБОТКИ НОВЫХ ДОСТИЖЕНИЙ
// ============================================
async function apiCall(endpoint, method = 'GET', body = null) {
    const response = await originalApiCall(endpoint, method, body);
    
    // Если в ответе есть новые достижения - показываем уведомления
    if (response && response.newAchievements && response.newAchievements.length > 0) {
        console.log('🎁 Получены новые достижения:', response.newAchievements);
        
        // Показываем уведомления для каждого нового достижения
        for (const ach of response.newAchievements) {
            showNotif(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
        }
        
        // Обновляем достижения в фоне
        if (typeof loadAchievements === 'function') {
            setTimeout(() => loadAchievements(), 500);
        }
    }
    
    return response;
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================
async function loadEmployees() {
    const data = await apiCall('/data');
    if (data) {
        window.app.employees = data.employees || [];
        window.app.profiles = data.profiles || {};
        window.app.schedule = data.schedule || {};
        for (let emp of window.app.employees) {
            if (!window.app.profiles[emp]) {
                window.app.profiles[emp] = { 
                    avatar: '👤', 
                    name: emp, 
                    coins: 100, 
                    rating: 0, 
                    role: 'operator', 
                    hours: 0,
                    status: '💼 Работаю'
                };
            }
        }
    }
}

async function loadTasks() {
    const data = await apiCall('/tasks');
    if (data) window.app.tasks = data;
}

async function loadFines() {
    const data = await apiCall('/fines');
    if (data) window.app.fines = data;
}

async function loadSchedule() {
    try {
        const response = await apiCall('/schedule');
        if (response && Array.isArray(response)) {
            const scheduleByDate = {};
            for (const item of response) {
                const dateStr = item.date;
                if (!scheduleByDate[dateStr]) {
                    scheduleByDate[dateStr] = {};
                }
                scheduleByDate[dateStr][item.employee] = {
                    time: item.shift_time,
                    status: item.shift_status,
                    is_special: item.is_special,
                    special_end_time: item.special_end_time
                };
            }
            window.app.schedule = scheduleByDate;
            console.log('✅ Загружено расписание:', Object.keys(scheduleByDate).length, 'дней');
            return true;
        }
        return false;
    } catch (err) {
        console.error('❌ Ошибка загрузки расписания:', err);
        return false;
    }
}

async function loadLastActivity() {
    const data = await apiCall('/last-activity');
    if (data && data.success) {
        window.app.lastActivity = data.data || {};
        localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
        return true;
    }
    return false;
}

// ============================================
// ОБНОВЛЕНИЕ ДАННЫХ
// ============================================
async function updateEmployeeStatus(name, status) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { status });
    if (response && response.success) {
        if (window.app.profiles[name]) window.app.profiles[name].status = status;
        return true;
    }
    return false;
}

async function updateEmployeeAvatar(name, avatar) {
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar });
    if (response && response.success) {
        if (window.app.profiles[name]) window.app.profiles[name].avatar = avatar;
        return true;
    }
    return false;
}

async function updateEmployeeAvatarBase64(name, base64) {
    if (!base64 || !base64.startsWith('data:image')) {
        return false;
    }
    const response = await apiCall(`/profiles/${encodeURIComponent(name)}`, 'PUT', { avatar_url: base64 });
    if (response && response.success) {
        if (window.app.profiles[name]) {
            window.app.profiles[name].avatar_url = base64;
            window.app.profiles[name].avatar = null;
        }
        if (name === window.app.currentUser && typeof window.updateHeaderAvatar === 'function') {
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