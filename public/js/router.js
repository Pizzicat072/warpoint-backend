// public/js/router.js — ПЕРЕПИСАН v3.0
// Кэширование страниц, защита от бесконечной загрузки, сброс состояния при уходе

var routes = {
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

// КЭШ СТРАНИЦ — загружаем один раз, храним в памяти
var pageCache = {};

var currentPage = null;
var isLoading = false;
var loadTimeout = null;
var LOAD_TIMEOUT_MS = 10000; // 10 секунд максимум на загрузку

async function loadPage(pageId, addToHistory) {
    // Если не передали — по умолчанию true
    if (addToHistory === undefined) {
        addToHistory = true;
    }

    // Уже на этой странице — ничего не делаем
    if (currentPage === pageId) {
        console.log('📄 Страница "' + pageId + '" уже активна');
        return;
    }

    // Предотвращаем одновременные загрузки
    if (isLoading) {
        console.warn('⚠️ Загрузка уже выполняется, ждём...');
        return;
    }

    console.log('📄 Загрузка страницы: ' + pageId);

    var container = document.getElementById('pageContainer');
    if (!container) {
        console.error('❌ pageContainer не найден');
        return;
    }

    var url = routes[pageId];
    if (!url) {
        container.innerHTML = '<div style="padding:60px;text-align:center;"><h3>Страница не найдена</h3></div>';
        return;
    }

    isLoading = true;

    // Таймаут защиты от бесконечной загрузки
    if (loadTimeout) {
        clearTimeout(loadTimeout);
    }
    loadTimeout = setTimeout(function() {
        console.error('❌ Таймаут загрузки страницы');
        isLoading = false;
        container.innerHTML = '<div style="padding:60px;text-align:center;"><h3>⚠️ Превышено время загрузки</h3><button onclick="location.reload()">Обновить страницу</button></div>';
    }, LOAD_TIMEOUT_MS);

    // Сбрасываем состояние предыдущей страницы
    if (currentPage) {
        resetPageState(currentPage);
    }

    // Показываем скелетон загрузки
    container.innerHTML = '<div style="padding:40px;text-align:center;"><div style="width:50px;height:50px;border:3px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div><p style="color:#64748b;">Загрузка...</p></div><style>@keyframes spin{to{transform:rotate(360deg);}}</style>';

    try {
        var html;

        // Используем кэш если страница уже загружалась
        if (pageCache[pageId]) {
            console.log('📦 Страница "' + pageId + '" из кэша');
            html = pageCache[pageId];
        } else {
            var response = await fetch(url);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            html = await response.text();
            pageCache[pageId] = html;
            console.log('💾 Страница "' + pageId + '" загружена и закэширована');
        }

        // Вставляем HTML в контейнер
        container.innerHTML = html;

        currentPage = pageId;
        localStorage.setItem('activeTab', pageId);

        // Обновляем URL в браузере
        if (addToHistory) {
            var urlParams = new URLSearchParams();
            urlParams.set('page', pageId);
            window.history.pushState({ page: pageId }, '', window.location.pathname + '?' + urlParams);
        }

        // Подсвечиваем активный пункт меню
        updateActiveMenuItem(pageId);

        // Инициализируем страницу с небольшой задержкой
        setTimeout(function() {
            initializePage(pageId);
        }, 100);

    } catch (error) {
        console.error('❌ Ошибка загрузки:', error);
        container.innerHTML = '<div style="padding:60px;text-align:center;"><h3>Ошибка загрузки</h3><p style="color:#64748b;">' + error.message + '</p><button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:30px;color:white;cursor:pointer;">Обновить страницу</button></div>';
    } finally {
        clearTimeout(loadTimeout);
        loadTimeout = null;
        isLoading = false;
        console.log('✅ Страница "' + pageId + '" загружена');
    }
}
// ============================================
// СБРОС СОСТОЯНИЯ СТРАНИЦЫ
// ============================================
function resetPageState(pageId) {
    // Сбрасываем флаги инициализации
    var resetFlags = {
        'salary': 'salaryInitialized',
        'vp': 'vpInitialized',
        'employees': 'employeesInitialized',
        'schedule': 'scheduleInitialized',
        'tasks': 'tasksInitialized',
        'fines': 'finesInitialized',
        'chat': 'chatInitialized',
        'knowledge': 'knowledgeInitialized',
        'rating': 'ratingInitialized',
        'shop': 'shopInitialized',
        'admin': 'adminInitialized',
        'dashboard': 'dashboardInitialized',
        'reports': 'reportsInitialized'
    };

    var flagName = resetFlags[pageId];
    if (flagName) {
        window[flagName] = false;
    }

    // Вызываем функцию сброса если она есть
    var resetFunctions = {
        'salary': 'resetSalaryState',
        'vp': 'resetVpState',
        'employees': 'resetEmployeesState',
        'schedule': 'resetScheduleState',
        'tasks': 'resetTasksState',
        'fines': 'resetFinesState',
        'chat': 'resetChatState',
        'knowledge': 'resetKnowledgeState',
        'rating': 'resetRatingState',
        'shop': 'resetShopState',
        'admin': 'resetAdminState',
        'dashboard': 'resetDashboardState',
        'reports': 'resetReportsState'
    };

    var resetFuncName = resetFunctions[pageId];
    if (resetFuncName && typeof window[resetFuncName] === 'function') {
        window[resetFuncName]();
    }

    console.log('🧹 Состояние "' + pageId + '" сброшено');
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ
// ============================================
function initializePage(pageId) {
    var initFunctions = {
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

    var funcName = initFunctions[pageId];
    if (funcName && typeof window[funcName] === 'function') {
        console.log('🚀 Инициализация: ' + funcName + '()');
        window[funcName]();
    } else {
        console.warn('⚠️ Функция ' + funcName + ' не найдена');
    }
}

// ============================================
// ОБНОВЛЕНИЕ АКТИВНОГО ПУНКТА МЕНЮ
// ============================================
function updateActiveMenuItem(pageId) {
    document.querySelectorAll('.menu-item').forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.dataset.tab === pageId) {
            btn.classList.add('active');
        }
    });
}

// ============================================
// РЕНДЕР МЕНЮ
// ============================================
function renderMainMenu() {
    var menu = document.getElementById('mainMenu');
    if (!menu) {
        return;
    }

    var menuItems = [
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

    // Админка только для директора
    if (window.app && window.app.currentUserRole === 'director') {
        menuItems.push({ id: 'admin', name: 'Управление', icon: 'cogs' });
    }

    var activeId = localStorage.getItem('activeTab') || 'dashboard';

    var html = '<div class="menu-container">';
    menuItems.forEach(function(item) {
        var isActive = item.id === activeId ? ' active' : '';
        html += '<button class="menu-item' + isActive + '" data-tab="' + item.id + '">';
        html += '<i class="fas fa-' + item.icon + '"></i>';
        html += '<span class="menu-tooltip">' + item.name + '</span>';
        html += '</button>';
    });
    html += '</div>';

    menu.innerHTML = html;

    // Вешаем обработчики кликов
    document.querySelectorAll('.menu-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.dataset.tab;
            if (tabId) {
                loadPage(tabId, true);
            }
        });
    });

    // Загружаем сохранённую или первую страницу
    if (!currentPage) {
        loadPage(activeId, false);
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ РОУТЕРА
// ============================================
function initRouter() {
    window.addEventListener('popstate', function(event) {
        if (event.state && event.state.page) {
            loadPage(event.state.page, false);
        }
    });
    console.log('✅ Роутер инициализирован');
}

// ============================================
// ЭКСПОРТ В ГЛОБАЛЬНУЮ ОБЛАСТЬ
// ============================================
window.loadPage = loadPage;
window.renderMainMenu = renderMainMenu;
window.initRouter = initRouter;
window.routes = routes;
window.getCurrentPage = function() {
    return currentPage;
};

// Автозапуск
setTimeout(initRouter, 100);

console.log('✅ router.js v3.0 загружен (кэширование, сброс состояния, защита от бесконечной загрузки)');