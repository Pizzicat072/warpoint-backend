// public/js/auth.js - БЕЗ ЗВУКОВ

async function login() {
    const loginName = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPassword').value;
    
    if (!loginName || !pass) {
        showNotif('Введите логин и пароль', 'error');
        return;
    }
    
    console.log('📤 Отправка запроса:', { username: loginName });
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginName, password: pass })
        });
        
        console.log('📥 Ответ получен, статус:', response.status);
        
        const data = await response.json();
        console.log('📦 Данные ответа:', data);
        
        if (data.success) {
            console.log('✅ Логин успешен!');
            
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
            
            await loadEmployees();
            await loadTasks();
            await loadFines();
            await loadSchedule();
            await loadLastActivity();
            
            startHeartbeat();
            initActivityTracker();
            
            renderMainMenu();
            
            showNotif(`Добро пожаловать, ${window.app.currentUser}!`, 'success');
        } else {
            console.error('❌ Ошибка входа:', data.error);
            showNotif(data.error || 'Неверный логин или пароль', 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка соединения:', err);
        showNotif('Ошибка соединения с сервером', 'error');
    }
}

function authLogout() {
    const userName = window.app.currentUser;
    
    window.app.currentUser = null;
    window.app.currentUserRole = null;
    window.app.currentUserPermissions = null;
    
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    localStorage.removeItem('lastActivity');
    
    if (window.heartbeatInterval) {
        clearInterval(window.heartbeatInterval);
        window.heartbeatInterval = null;
    }
    
    if (userName && window.app.lastActivity) {
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
            window.app.lastActivity = response.data || {};
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
        } else {
            const saved = localStorage.getItem('lastActivity');
            if (saved) window.app.lastActivity = JSON.parse(saved);
            else window.app.lastActivity = {};
        }
    } catch (e) { window.app.lastActivity = {}; }
    
    if (window.app.currentUser) {
        window.app.lastActivity[window.app.currentUser] = Date.now();
    }
    
    if (typeof renderEmployees === 'function') renderEmployees();
    if (typeof loadActivity === 'function') loadActivity();
}

async function sendHeartbeat() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const response = await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        if (response.ok && window.app && window.app.currentUser) {
            window.app.lastActivity[window.app.currentUser] = Date.now();
            localStorage.setItem('lastActivity', JSON.stringify(window.app.lastActivity));
            if (typeof renderEmployees === 'function') renderEmployees();
            if (typeof loadActivity === 'function') loadActivity();
        }
    } catch (e) { console.error('Heartbeat error:', e); }
}

function startHeartbeat(intervalMs = 30000) {
    sendHeartbeat();
    if (window.heartbeatInterval) clearInterval(window.heartbeatInterval);
    window.heartbeatInterval = setInterval(() => sendHeartbeat(), intervalMs);
}

function initActivityTracker() {
    const updateActivity = () => {
        if (window.app && window.app.currentUser) {
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
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateActivity(); });
    console.log('✅ Activity tracker инициализирован');
}

(function restoreLastActivity() {
    const saved = localStorage.getItem('lastActivity');
    if (saved) { try { window.app.lastActivity = JSON.parse(saved); } catch(e) {} }
})();

window.login = login;
window.authLogout = authLogout;
window.startHeartbeat = startHeartbeat;
window.sendHeartbeat = sendHeartbeat;
window.initActivityTracker = initActivityTracker;
window.loadLastActivity = loadLastActivity;