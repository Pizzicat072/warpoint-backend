// public/js/auth.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

let isLoggingIn = false;
let heartbeatInterval = null;
let lastHeartbeat = 0;
const HEARTBEAT_INTERVAL = 60000;

async function login() {
    if (isLoggingIn) {
        console.log('⚠️ Вход уже выполняется');
        return;
    }
    
    const loginName = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPassword').value;
    
    if (!loginName || !pass) {
        showNotif('Введите логин и пароль', 'error');
        return;
    }
    
    console.log('📤 Отправка запроса:', { username: loginName });
    
    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    const originalBtnText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Вход...';
    loginBtn.disabled = true;
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
            if (response.status === 404) throw new Error('API не найден (404)');
            else if (response.status === 500) throw new Error('Внутренняя ошибка сервера (500)');
            else throw new Error(`Ошибка сервера: ${response.status}`);
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
            
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('loginModal').classList.remove('active');
            document.getElementById('mainContainer').style.display = 'block';
            document.getElementById('headerName').textContent = window.app.currentUser;
            
            const headerAvatar = document.getElementById('headerAvatar');
            if (headerAvatar) {
                if (data.user.avatar_url) {
                    headerAvatar.innerHTML = `<img src="${data.user.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;">`;
                } else if (data.user.avatar) {
                    headerAvatar.innerHTML = data.user.avatar;
                } else {
                    headerAvatar.innerHTML = '👤';
                }
            }
            
            if (data.newAchievements && data.newAchievements.length > 0) {
                for (const ach of data.newAchievements) {
                    showNotif(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
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
            
            showNotif(`Добро пожаловать, ${window.app.currentUser}!`, 'success');
            
        } else {
            showNotif(data.error || 'Неверный логин или пароль', 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        if (err.message.includes('API не найден')) {
            showNotif('🚫 Сервер API не отвечает. Попробуйте позже.', 'error');
        } else if (err.message.includes('Внутренняя ошибка')) {
            showNotif('⚠️ Ошибка на сервере.', 'error');
        } else {
            showNotif('Ошибка соединения с сервером.', 'error');
        }
    } finally {
        loginBtn.innerHTML = originalBtnText;
        loginBtn.disabled = false;
        isLoggingIn = false;
    }
}

function authLogout() {
    const userName = window.app?.currentUser;
    
    if (window.app) {
        window.app.currentUser = null;
        window.app.currentUserRole = null;
        window.app.currentUserPermissions = null;
    }
    
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    localStorage.removeItem('lastActivity');
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    if (userName && window.app?.lastActivity) {
        delete window.app.lastActivity[userName];
    }
    
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('mainContainer').style.display = 'none';
    
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof loadActivity === 'function') loadActivity();
    
    showNotif('Вы вышли из системы', 'info');
}

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
            if (saved) window.app.lastActivity = JSON.parse(saved);
            else window.app.lastActivity = {};
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

async function sendHeartbeat() {
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
            
            if (!window._lastActivityRender || Date.now() - window._lastActivityRender > 5000) {
                window._lastActivityRender = Date.now();
                if (typeof renderEmployees === 'function') renderEmployees();
                if (typeof loadActivity === 'function') loadActivity();
            }
        }
    } catch (e) {
        console.error('Heartbeat error:', e);
    }
}

function startHeartbeat(intervalMs = 60000) {
    sendHeartbeat();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => sendHeartbeat(), intervalMs);
}

function initActivityTracker() {
    const updateActivity = () => {
        if (window.app && window.app.currentUser) {
            window.app.lastActivity = window.app.lastActivity || {};
            window.app.lastActivity[window.app.currentUser] = Date.now();
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
            
            if (!window._lastActivityRender || Date.now() - window._lastActivityRender > 5000) {
                window._lastActivityRender = Date.now();
                if (typeof renderEmployees === 'function') renderEmployees();
                if (typeof loadActivity === 'function') loadActivity();
            }
        }
    };
    
    ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
    });
    
    document.addEventListener('visibilitychange', () => { 
        if (!document.hidden) updateActivity(); 
    });
    
    console.log('✅ Activity tracker инициализирован');
}

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

window.login = login;
window.authLogout = authLogout;
window.startHeartbeat = startHeartbeat;
window.sendHeartbeat = sendHeartbeat;
window.initActivityTracker = initActivityTracker;
window.loadLastActivity = loadLastActivity;