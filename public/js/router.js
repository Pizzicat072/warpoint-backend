// public/js/router.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.2

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
let isLoadingPage = false;
let pageLoadTimeout = null;
let routerInitialized = false;

async function loadPage(pageId, addToHistory = true) {
    if (currentPage === pageId) return;
    if (isLoadingPage) return;
    
    console.log('📄 Загрузка страницы:', pageId);
    
    const container = document.getElementById('pageContainer');
    if (!container) return;
    
    isLoadingPage = true;
    
    if (currentPage) {
        cleanupCurrentPage();
    }
    
    const url = routes[pageId];
    if (!url) {
        container.innerHTML = '<div class="empty-state"><h3>Страница не найдена</h3></div>';
        isLoadingPage = false;
        return;
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        container.innerHTML = html;
        
        currentPage = pageId;
        localStorage.setItem('activeTab', pageId);
        
        if (addToHistory) {
            const urlParams = new URLSearchParams();
            urlParams.set('page', pageId);
            window.history.pushState({ page: pageId }, '', `${window.location.pathname}?${urlParams}`);
        }
        
        updateActiveMenuItem(pageId);
        initializePage(pageId);
        
    } catch (error) {
        console.error('Error loading page:', error);
        container.innerHTML = `<div class="empty-state"><h3>Ошибка загрузки</h3><p>${error.message}</p></div>`;
    } finally {
        isLoadingPage = false;
    }
}

function cleanupCurrentPage() {
    console.log(`🧹 Очистка страницы: ${currentPage}`);
    // Сбрасываем флаги инициализации
    if (currentPage === 'salary') window.salaryInitialized = false;
    if (currentPage === 'vp') window.vpInitialized = false;
    if (currentPage === 'employees') window.employeesInitialized = false;
}

function initializePage(pageId) {
    const initFunctions = {
        'dashboard': 'initDashboard',
        'employees': 'initEmployees',
        'schedule': 'initSchedule',
        'salary': 'initSalary',
        'tasks': 'initTasks',
        'knowledge': 'initKnowledge',
        'rating': 'initRating',
        'fines': 'initFines',
        'chat': 'initChat',
        'shop': 'initShop',
        'vp': 'initVp',
        'admin': 'initAdmin',
        'reports': 'initReports'
    };
    
    const funcName = initFunctions[pageId];
    if (funcName && typeof window[funcName] === 'function') {
        console.log(`🚀 Инициализация: ${funcName}`);
        setTimeout(() => window[funcName](), 50);
    }
}

function updateActiveMenuItem(pageId) {
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === pageId) btn.classList.add('active');
    });
}

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
    
    if (window.app?.currentUserRole === 'director') {
        menuItems.push({ id: 'admin', name: 'Управление', icon: 'cogs' });
    }
    
    const activeId = localStorage.getItem('activeTab') || 'dashboard';
    
    menu.innerHTML = `
        <div class="menu-container">
            ${menuItems.map(item => `
                <button class="menu-item ${item.id === activeId ? 'active' : ''}" data-tab="${item.id}">
                    <i class="fas fa-${item.icon}"></i>
                    <span class="menu-tooltip">${item.name}</span>
                </button>
            `).join('')}
        </div>
    `;
    
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.addEventListener('click', () => loadPage(btn.dataset.tab, true));
    });
    
    if (!currentPage) loadPage(activeId, false);
}

function initRouter() {
    if (routerInitialized) return;
    routerInitialized = true;
    
    window.addEventListener('popstate', (event) => {
        if (event.state?.page) loadPage(event.state.page, false);
    });
    
    console.log('✅ Роутер инициализирован');
}

window.loadPage = loadPage;
window.renderMainMenu = renderMainMenu;
window.initRouter = initRouter;
window.routes = routes;
window.getCurrentPage = () => currentPage;

setTimeout(initRouter, 100);

console.log('✅ router.js загружен (v2.2)');