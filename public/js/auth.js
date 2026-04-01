// public/js/auth.js

async function login() {
    const loginName = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPassword').value;
    
    if (!loginName || !pass) {
        showNotif('Введите логин и пароль', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: loginName, password: pass })
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.app.currentUser = data.user.name;
            window.app.currentUserRole = data.user.role;
            window.app.currentUserPermissions = rolesMap[window.app.currentUserRole] || rolesMap.operator;
            
            localStorage.setItem('token', data.token);
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            
            // Скрыть модалку логина
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('loginModal').classList.remove('active');
            
            // Показать главный контейнер
            document.getElementById('mainContainer').style.display = 'block';
            
            // Обновить шапку
            document.getElementById('headerName').textContent = window.app.currentUser;
            document.getElementById('headerAvatar').innerHTML = data.user.avatar || '👤';
            
            // Загрузить начальные данные
            await loadEmployees();
            await loadTasks();
            await loadFines();
            await loadSchedule();
            
            // Загрузить первую вкладку (Команда)
            loadPage('employees');
            
            showNotif(`Добро пожаловать, ${window.app.currentUser}!`, 'success');
        } else {
            showNotif('Неверный логин или пароль', 'error');
        }
    } catch (err) {
        showNotif('Ошибка соединения с сервером', 'error');
    }
}

function logout() {
    window.app.currentUser = null;
    window.app.currentUserRole = null;
    window.app.currentUserPermissions = null;
    
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('mainContainer').style.display = 'none';
    
    showNotif('Вы вышли из системы', 'info');
}