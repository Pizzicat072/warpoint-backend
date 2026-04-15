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
    
    // 🔥 ОЧИСТКА ПРЕДЫДУЩЕЙ СТРАНИЦЫ
    if (currentPage) {
        console.log(`🧹 Очистка страницы: ${currentPage}`);
        
        // Очистка отчётов (интервалы)
        if (currentPage === 'reports' && typeof cleanupReports === 'function') {
            cleanupReports();
        }
        
        // Очистка дашборда (интервалы)
        if (currentPage === 'dashboard' && typeof cleanupDashboard === 'function') {
            cleanupDashboard();
        }
        
        // Очистка чата (Pusher подписки)
        if (currentPage === 'chat' && typeof cleanupChat === 'function') {
            cleanupChat();
        }
        
        // Очистка задач (интервалы)
        if (currentPage === 'tasks' && typeof cleanupTasks === 'function') {
            cleanupTasks();
        }
    }
    
    // Показываем загрузку
    container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 60px;"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
    
    const url = routes[pageId];
    if (!url) {
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
        
        // 🔥 ИНИЦИАЛИЗАЦИЯ СТРАНИЦ
        if (pageId === 'dashboard' && typeof initDashboard === 'function') {
            setTimeout(() => initDashboard(), 100);
        }
        if (pageId === 'employees' && typeof initEmployees === 'function') {
            setTimeout(() => initEmployees(), 50);
        }
        if (pageId === 'schedule') {
            if (typeof loadScheduleData === 'function') await loadScheduleData();
            if (typeof initSchedule === 'function') setTimeout(() => initSchedule(), 50);
        }
        if (pageId === 'salary' && typeof initSalary === 'function') {
            setTimeout(() => initSalary(), 50);
        }
        if (pageId === 'tasks' && typeof initTasks === 'function') {
            setTimeout(() => initTasks(), 50);
        }
        if (pageId === 'knowledge' && typeof initKnowledge === 'function') {
            setTimeout(() => initKnowledge(), 100);
        }
        if (pageId === 'rating' && typeof initRating === 'function') {
            setTimeout(() => initRating(), 50);
        }
        if (pageId === 'fines' && typeof initFines === 'function') {
            setTimeout(() => initFines(), 50);
        }
        if (pageId === 'chat' && typeof initChat === 'function') {
            setTimeout(() => initChat(), 100);
        }
        if (pageId === 'shop' && typeof initShop === 'function') {
            setTimeout(() => initShop(), 50);
        }
        if (pageId === 'vp' && typeof initVp === 'function') {
            setTimeout(() => initVp(), 50);
        }
        if (pageId === 'admin' && typeof initAdmin === 'function') {
            setTimeout(() => initAdmin(), 100);
        }
        if (pageId === 'reports' && typeof initReports === 'function') {
            setTimeout(() => initReports(), 100);
        }
        
    } catch (error) {
        console.error('Error loading page:', error);
        container.innerHTML = '<div class="empty-state">Ошибка загрузки страницы</div>';
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