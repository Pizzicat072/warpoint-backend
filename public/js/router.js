// public/js/router.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.1
// Исправлено: очистка salary, vp, chat, reports, dashboard при смене страницы

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

// ============================================
// ЗАГРУЗКА СТРАНИЦЫ
// ============================================

async function loadPage(pageId, addToHistory = true) {
    if (currentPage === pageId) {
        console.log(`📄 Страница ${pageId} уже загружена`);
        return;
    }
    
    if (isLoadingPage) {
        console.log('⚠️ Страница уже загружается, подождите...');
        return;
    }
    
    console.log('📄 Загрузка страницы:', pageId);
    
    const container = document.getElementById('pageContainer');
    if (!container) {
        console.error('❌ pageContainer не найден');
        return;
    }
    
    isLoadingPage = true;
    
    showPageLoader(container);
    
    if (pageLoadTimeout) clearTimeout(pageLoadTimeout);
    pageLoadTimeout = setTimeout(() => {
        console.error('❌ Загрузка страницы зависла:', pageId);
        container.innerHTML = `
            <div class="empty-state" style="padding: 60px; text-align: center;">
                <div class="empty-state-icon">⚠️</div>
                <h3>Не удалось загрузить страницу</h3>
                <button class="btn-primary" onclick="location.reload()">🔄 Обновить</button>
                <button class="btn-secondary" onclick="window.loadPage('dashboard')">🏠 На главную</button>
            </div>
        `;
        isLoadingPage = false;
    }, 15000);
    
    // 🔥 ОЧИСТКА ПРЕДЫДУЩЕЙ СТРАНИЦЫ
    if (currentPage) {
        cleanupCurrentPage();
    }
    
    const url = routes[pageId];
    if (!url) {
        clearTimeout(pageLoadTimeout);
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Страница не найдена</h3></div>';
        isLoadingPage = false;
        hidePageLoader();
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
            const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
            window.history.pushState({ page: pageId }, '', newUrl);
        }
        
        updateActiveMenuItem(pageId);
        
        setTimeout(() => {
            initializePage(pageId);
        }, 100);
        
        clearTimeout(pageLoadTimeout);
        
    } catch (error) {
        clearTimeout(pageLoadTimeout);
        console.error('Error loading page:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Ошибка загрузки страницы</h3>
                <p>${error.message}</p>
                <button class="btn-primary" onclick="location.reload()">🔄 Обновить</button>
                <button class="btn-secondary" onclick="window.loadPage('dashboard')">🏠 На главную</button>
            </div>
        `;
    } finally {
        isLoadingPage = false;
        hidePageLoader();
    }
}

// ============================================
// ИНДИКАТОР ЗАГРУЗКИ
// ============================================

function showPageLoader(container) {
    hidePageLoader();
    
    const loader = document.createElement('div');
    loader.id = 'pageLoader';
    loader.className = 'page-loader';
    loader.innerHTML = `
        <div class="page-loader-content">
            <div class="page-loader-spinner"></div>
            <div class="page-loader-text">Загрузка страницы...</div>
        </div>
    `;
    
    if (!document.getElementById('pageLoaderStyles')) {
        const style = document.createElement('style');
        style.id = 'pageLoaderStyles';
        style.textContent = `
            .page-loader {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(10, 12, 18, 0.8);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100;
                animation: fadeIn 0.2s ease;
            }
            .page-loader-content {
                text-align: center;
                padding: 30px 40px;
                background: rgba(20, 25, 50, 0.9);
                border-radius: 20px;
                border: 1px solid rgba(99, 102, 241, 0.3);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            }
            .page-loader-spinner {
                width: 40px;
                height: 40px;
                margin: 0 auto 16px;
                border: 3px solid rgba(99, 102, 241, 0.2);
                border-top-color: #6366f1;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            .page-loader-text {
                color: #94a3b8;
                font-size: 14px;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    container.style.position = 'relative';
    container.appendChild(loader);
}

function hidePageLoader() {
    const loader = document.getElementById('pageLoader');
    if (loader) loader.remove();
}

// ============================================
// ОЧИСТКА СТРАНИЦЫ
// ============================================

function cleanupCurrentPage() {
    console.log(`🧹 Очистка страницы: ${currentPage}`);
    
    // 🔥 Очистка зарплаты
    if (currentPage === 'salary') {
        if (typeof window.resetSalaryState === 'function') {
            console.log('🧹 Вызов resetSalaryState');
            window.resetSalaryState();
        }
        if (typeof window.salaryInitialized !== 'undefined') {
            window.salaryInitialized = false;
        }
    }
    
    // 🔥 Очистка ВП
    if (currentPage === 'vp' && typeof window.resetVpState === 'function') {
        window.resetVpState();
    }
    
    // 🔥 Очистка чата
    if (currentPage === 'chat' && typeof window.cleanupChat === 'function') {
        window.cleanupChat();
    }
    
    // 🔥 Очистка отчётов
    if (currentPage === 'reports' && typeof window.cleanupReports === 'function') {
        window.cleanupReports();
    }
    
    // 🔥 Очистка дашборда
    if (currentPage === 'dashboard' && typeof window.cleanupDashboard === 'function') {
        window.cleanupDashboard();
    }
    
    // 🔥 Сброс флага initialized для ВП
    if (currentPage === 'vp') {
        window.vpInitialized = false;
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
// ============================================

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
        window[funcName]();
    } else {
        console.warn(`⚠️ Функция инициализации не найдена: ${funcName}`);
    }
}

// ============================================
// ОБНОВЛЕНИЕ АКТИВНОГО ПУНКТА МЕНЮ
// ============================================

function updateActiveMenuItem(pageId) {
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === pageId) {
            btn.classList.add('active');
        }
    });
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
    
    const urlParams = new URLSearchParams(window.location.search);
    const pageFromUrl = urlParams.get('page');
    const savedTab = localStorage.getItem('activeTab');
    const activeId = pageFromUrl || (savedTab && menuItems.some(i => i.id === savedTab) ? savedTab : 'dashboard');
    
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
            loadPage(tabId, true);
        });
    });
    
    loadPage(activeId, false);
}

// ============================================
// ПЕРЕКЛЮЧЕНИЕ ВКЛАДКИ
// ============================================

function switchToTab(tabId) {
    if (routes[tabId]) {
        loadPage(tabId, true);
    }
}

// ============================================
// ОБРАБОТКА ИСТОРИИ БРАУЗЕРА
// ============================================

function initRouter() {
    if (routerInitialized) return;
    routerInitialized = true;
    
    window.addEventListener('popstate', (event) => {
        const state = event.state;
        if (state && state.page) {
            console.log('🔄 Навигация по истории:', state.page);
            loadPage(state.page, false);
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            const pageFromUrl = urlParams.get('page');
            if (pageFromUrl && routes[pageFromUrl]) {
                loadPage(pageFromUrl, false);
            }
        }
    });
    
    console.log('✅ Роутер инициализирован');
}

// ============================================
// ПОЛУЧЕНИЕ ТЕКУЩЕЙ СТРАНИЦЫ
// ============================================

function getCurrentPage() {
    return currentPage;
}

// ============================================
// ЭКСПОРТ
// ============================================

window.loadPage = loadPage;
window.renderMainMenu = renderMainMenu;
window.switchToTab = switchToTab;
window.initRouter = initRouter;
window.routes = routes;
window.getCurrentPage = getCurrentPage;

setTimeout(initRouter, 100);

window.addEventListener('beforeunload', () => {
    cleanupCurrentPage();
});

console.log('✅ router.js загружен (v2.1)');