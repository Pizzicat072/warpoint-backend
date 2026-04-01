// public/js/router.js

const routes = {
    dashboard: '/pages/dashboard.html',
    employees: '/pages/employees.html',
    schedule: '/pages/schedule.html',
    tasks: '/pages/tasks.html',
    shop: '/pages/shop.html',
    rating: '/pages/rating.html',
    fines: '/pages/fines.html',
    chat: '/pages/chat.html',
    reports: '/reports.html',
    knowledge: '/pages/knowledge.html',
    vp: '/pages/vp.html',
    admin: '/pages/admin.html',
    salary: '/pages/salary.html'
};

let currentPage = null;

async function loadPage(pageId) {
    const container = document.getElementById('pageContainer');
    if (!container) return;
    
    // Показываем загрузку
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
    
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
        
        // Инициализируем скрипты для загруженной страницы
        if (pageId === 'employees' && window.initEmployees) {
            window.initEmployees();
        }
        // Добавим другие страницы позже
        
    } catch (error) {
        console.error('Error loading page:', error);
        container.innerHTML = '<div class="empty-state">Ошибка загрузки страницы</div>';
    }
}

function renderMainMenu() {
    const menu = document.getElementById('mainMenu');
    if (!menu) return;
    
    const menuItems = [
        { id: 'employees', name: 'Команда', icon: 'users' },
        { id: 'schedule', name: 'График', icon: 'calendar-alt' },
        { id: 'tasks', name: 'Задачи', icon: 'tasks' },
        { id: 'shop', name: 'Магазин', icon: 'gift' },
        { id: 'rating', name: 'Рейтинг', icon: 'trophy' },
        { id: 'fines', name: 'Нарушения', icon: 'exclamation-triangle' },
        { id: 'chat', name: 'Чат', icon: 'comments' },
        { id: 'reports', name: 'Отчёты', icon: 'chart-bar' },
        { id: 'knowledge', name: 'База знаний', icon: 'book' },
        { id: 'vp', name: 'ВП', icon: 'gamepad' }
    ];
    
    // Добавляем админку для директора
    if (window.app.currentUserRole === 'director') {
        menuItems.push({ id: 'admin', name: 'Управление', icon: 'cogs' });
        menuItems.push({ id: 'salary', name: 'Зарплата', icon: 'ruble-sign' });
    }
    
    const savedTab = localStorage.getItem('activeTab');
    const activeId = savedTab && menuItems.some(i => i.id === savedTab) ? savedTab : 'employees';
    
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
    
    // Навешиваем обработчики
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            // Обновляем активный класс
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            btn.classList.add('active');
            
            // Загружаем страницу
            loadPage(tabId);
        });
    });
    
    // Загружаем сохранённую или первую страницу
    if (!currentPage) {
        loadPage(activeId);
    }
}