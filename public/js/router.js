// public/js/router.js - ПОЛНАЯ ВЕРСИЯ С CLEANUP

const routes = {
    dashboard: '/pages/dashboard.html',
    employees: '/pages/employees.html',
    schedule: '/pages/schedule.html',
    tasks: '/pages/tasks.html',
    shop: '/pages/shop.html',
    rating: '/pages/rating.html',
    fines: '/pages/fines.html',
    chat: '/pages/chat.html',
    reports: '/pages/reports.html',
    knowledge: '/pages/knowledge.html',
    vp: '/pages/vp.html',
    salary: '/pages/salary.html',
    admin: '/pages/admin.html'
};

let currentPage = null;

// ============================================
// ЗАГРУЗКА СТРАНИЦЫ
// ============================================
async function loadPage(pageId) {
    console.log('📄 Загрузка страницы:', pageId);
    
    const container = document.getElementById('pageContainer');
    if (!container) return;
    
    // 🔥 ТАЙМАУТ НА СЛУЧАЙ ЗАВИСАНИЯ
    const loadingTimeout = setTimeout(() => {
        console.error('❌ Загрузка страницы зависла:', pageId);
        container.innerHTML = `
            <div class="empty-state" style="padding: 60px; text-align: center;">
                <div class="empty-state-icon">⚠️</div>
                <h3>Не удалось загрузить страницу</h3>
                <p style="margin-bottom: 20px;">Проверьте соединение или обновите страницу</p>
                <button class="btn-primary" onclick="location.reload()" style="margin-right: 10px;">
                    <i class="fas fa-sync-alt"></i> Обновить
                </button>
                <button class="btn-secondary" onclick="window.loadPage('dashboard')">
                    <i class="fas fa-home"></i> На главную
                </button>
            </div>
        `;
    }, 15000);
    
    // Очистка предыдущей страницы
    if (currentPage) {
        console.log(`🧹 Очистка страницы: ${currentPage}`);
        if (currentPage === 'reports' && typeof cleanupReports === 'function') {
            cleanupReports();
        }
        if (currentPage === 'dashboard' && typeof cleanupDashboard === 'function') {
            cleanupDashboard();
        }
        if (currentPage === 'chat' && typeof cleanupChat === 'function') {
            cleanupChat();
        }
        if (currentPage === 'tasks' && typeof cleanupTasks === 'function') {
            cleanupTasks();
        }
    }
    
    // Показываем загрузку
    container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 60px;"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
    
    const url = routes[pageId];
    if (!url) {
        clearTimeout(loadingTimeout);
        container.innerHTML = '<div class="empty-state">Страница не найдена</div>';
        return;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Page not found');
        
        const html = await response.text();
        container.innerHTML = html;
        
        currentPage = pageId;
        localStorage.setItem('activeTab', pageId);
        
        // Инициализация страниц
        setTimeout(() => {
            if (pageId === 'dashboard' && typeof initDashboard === 'function') initDashboard();
            if (pageId === 'employees' && typeof initEmployees === 'function') initEmployees();
            if (pageId === 'schedule') {
                if (typeof loadScheduleData === 'function') loadScheduleData();
                if (typeof initSchedule === 'function') setTimeout(() => initSchedule(), 50);
            }
            if (pageId === 'salary' && typeof initSalary === 'function') initSalary();
            if (pageId === 'tasks' && typeof initTasks === 'function') initTasks();
            if (pageId === 'knowledge' && typeof initKnowledge === 'function') initKnowledge();
            if (pageId === 'rating' && typeof initRating === 'function') initRating();
            if (pageId === 'fines' && typeof initFines === 'function') initFines();
            if (pageId === 'chat' && typeof initChat === 'function') initChat();
            if (pageId === 'shop' && typeof initShop === 'function') initShop();
            if (pageId === 'vp' && typeof initVp === 'function') initVp();
            if (pageId === 'admin' && typeof initAdmin === 'function') initAdmin();
            if (pageId === 'reports' && typeof initReports === 'function') initReports();
        }, 100);
        
        clearTimeout(loadingTimeout);
        
    } catch (error) {
        clearTimeout(loadingTimeout);
        console.error('Error loading page:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Ошибка загрузки страницы</h3>
                <p>${error.message}</p>
                <button class="btn-primary" onclick="location.reload()">🔄 Обновить</button>
            </div>
        `;
    }
}

// ============================================
// РЕНДЕР ГЛАВНОГО МЕНЮ
// ============================================
function renderMainMenu() {
    const menu = document.getElementById('mainMenu');
    if (!menu) return;
    
    const menuItems = [
        { id: 'dashboard', name: 'Дашборд', icon: 'chart-line' },
        { id: 'employees', name: 'Команда', icon: 'users' },
        { id: 'schedule', name: 'График', icon: 'calendar-alt' },
        { id: 'tasks', name: 'Задачи', icon: 'tasks' },
        { id: 'shop', name: 'Магазин', icon: 'gift' },
        { id: 'rating', name: 'Рейтинг', icon: 'trophy' },
        { id: 'fines', name: 'Нарушения', icon: 'exclamation-triangle' },
        { id: 'chat', name: 'Чат', icon: 'comments' },
        { id: 'reports', name: 'Отчёты', icon: 'chart-bar' },
        { id: 'knowledge', name: 'База знаний', icon: 'book' },
        { id: 'vp', name: 'ВП', icon: 'gamepad' },
        { id: 'salary', name: 'Зарплата', icon: 'ruble-sign' }
    ];
    
    if (window.app && window.app.currentUserRole === 'director') {
        menuItems.push({ id: 'admin', name: 'Управление', icon: 'cogs' });
    }
    
    const savedTab = localStorage.getItem('activeTab');
    const activeId = savedTab && menuItems.some(i => i.id === savedTab) ? savedTab : 'dashboard';
    
    menu.innerHTML = `
        <div class="menu-container">
            ${menuItems.map(item => `
                <button class="menu-item ${item.id === activeId ? 'active' : ''}" data-tab="${item.id}" title="${item.name}">
                    <i class="fas fa-${item.icon}"></i>
                    <span class="menu-tooltip">${item.name}</span>
                </button>
            `).join('')}
        </div>
    `;
    
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            btn.classList.add('active');
            loadPage(tabId);
        });
    });
    
    loadPage(activeId);
}

// ============================================
// ПЕРЕКЛЮЧЕНИЕ НА ВКЛАДКУ (для вызова из других модулей)
// ============================================
function switchToTab(tabId) {
    if (routes[tabId]) {
        // Обновляем активную кнопку в меню
        document.querySelectorAll('.menu-item').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabId) {
                btn.classList.add('active');
            }
        });
        loadPage(tabId);
    }
}

// ============================================
// ЭКСПОРТ
// ============================================
window.loadPage = loadPage;
window.renderMainMenu = renderMainMenu;
window.switchToTab = switchToTab;
window.routes = routes;
window.getCurrentPage = () => currentPage;

// ============================================
// ОБРАБОТЧИК ЗАКРЫТИЯ/ОБНОВЛЕНИЯ СТРАНИЦЫ
// ============================================
window.addEventListener('beforeunload', () => {
    if (currentPage === 'reports' && typeof cleanupReports === 'function') {
        cleanupReports();
    }
    if (currentPage === 'dashboard' && typeof cleanupDashboard === 'function') {
        cleanupDashboard();
    }
    if (currentPage === 'chat' && typeof cleanupChat === 'function') {
        cleanupChat();
    }
});