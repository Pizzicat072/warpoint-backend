// public/js/salary.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v5.4
// Добавлены все уведомления

// ============================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================

let currentEmployeeId = null;
let currentDayNumber = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let isDirector = false;
let salaryIsLoading = false;
let isSavingDay = false;
let isProcessingFund = false;
let monthlyTotalsCache = {};
let dayDataCache = {};
let salaryInitialized = false;
let originalDayData = null;
let hasUnsavedChanges = false;
let employeesList = [];
let currentEmployeeIndex = -1;
let daysInMonth = 31;
let dayInputHandlersInitialized = false;

const START_YEAR = 2026;
const START_MONTH = 3;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MAX_AMOUNT = 1000000;

// ============================================
// СБРОС СОСТОЯНИЯ ПРИ УХОДЕ СО СТРАНИЦЫ
// ============================================

function resetSalaryState() {
    console.log('🧹 Сброс состояния зарплаты');
    salaryInitialized = false;
    currentEmployeeId = null;
    currentDayNumber = null;
    monthlyTotalsCache = {};
    dayDataCache = {};
    employeesList = [];
    hasUnsavedChanges = false;
    currentEmployeeIndex = -1;
    dayInputHandlersInitialized = false;
    
    if (window.salaryAutoUpdateInterval) {
        clearInterval(window.salaryAutoUpdateInterval);
        window.salaryAutoUpdateInterval = null;
    }
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getTobolskNow() {
    if (typeof window.getTobolskNow === 'function' && window.getTobolskNow !== getTobolskNow) {
        return window.getTobolskNow();
    }
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function showSystemNotification(message, type) {
    if (typeof window.showSystemNotification === 'function') {
        window.showSystemNotification(message, type);
    } else if (typeof window.showNotif === 'function') {
        window.showNotif(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
}

async function apiCall(endpoint, method = 'GET', body = null) {
    if (typeof window.originalApiCall === 'function') {
        return window.originalApiCall(endpoint, method, body);
    }
    if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) {
        return window.apiCall(endpoint, method, body);
    }
    const token = localStorage.getItem('token');
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.body = JSON.stringify(body);
    try {
        const response = await fetch(`/api${endpoint}`, options);
        return await response.json();
    } catch (e) {
        console.error('Fetch error:', e);
        return { success: false, error: 'Ошибка соединения' };
    }
}

function getRoleName(role) {
    if (typeof window.roleNames !== 'undefined' && window.roleNames) {
        return window.roleNames[role] || role;
    }
    const fallback = { director: 'Директор', manager: 'Управляющий', admin: 'Админ', operator: 'Оператор' };
    return fallback[role] || role;
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initSalary() {
    console.log('💰 Вызов initSalary, initialized =', salaryInitialized);
    
    const container = document.getElementById('salaryTableContainer');
    if (!container) {
        console.warn('⚠️ salaryTableContainer не найден');
        salaryInitialized = false;
        setTimeout(initSalary, 100);
        return;
    }
    
    if (salaryInitialized) {
        console.log('💰 Зарплата уже инициализирована');
        const table = container.querySelector('.salary-table');
        if (!table) {
            console.warn('⚠️ Таблица не найдена, перезагружаем');
            salaryInitialized = false;
            loadSalaryData();
        }
        return;
    }
    
    console.log('💰 Инициализация зарплаты');
    
    const now = getTobolskNow();
    let todayYear = now.getFullYear();
    let todayMonth = now.getMonth() + 1;
    
    if (todayYear < START_YEAR || (todayYear === START_YEAR && todayMonth < START_MONTH)) {
        currentYear = START_YEAR;
        currentMonth = START_MONTH;
    } else {
        currentYear = todayYear;
        currentMonth = todayMonth;
    }
    
    daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    
    if (window.app && window.app.currentUserRole) {
        isDirector = window.app.currentUserRole === 'director';
        const roleText = document.getElementById('salaryRoleText');
        if (roleText) {
            roleText.innerHTML = isDirector ? '<i class="fas fa-edit"></i> Режим редактирования' : '<i class="fas fa-eye"></i> Режим просмотра';
        }
        const fundBtn = document.getElementById('fundManageBtn');
        if (fundBtn) fundBtn.style.display = isDirector ? 'flex' : 'none';
    }
    
    updateDisplay();
    loadFundForSalary();
    
    if (window.app && window.app.employees && window.app.employees.length > 0) {
        loadSalaryData();
    } else {
        waitForEmployees();
    }
    
    setupEventListeners();
    restoreFromUrl();
    setupDataUpdateListener();
    
    salaryInitialized = true;
}

function setupEventListeners() {
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    const todayBtn = document.getElementById('todayBtn');
    const searchInput = document.getElementById('salarySearch');
    const hideEmptyCheckbox = document.getElementById('hideEmptyDays');
    
    if (prevBtn) {
        prevBtn.replaceWith(prevBtn.cloneNode(true));
        document.getElementById('prevMonthBtn')?.addEventListener('click', prevMonth);
    }
    if (nextBtn) {
        nextBtn.replaceWith(nextBtn.cloneNode(true));
        document.getElementById('nextMonthBtn')?.addEventListener('click', nextMonth);
    }
    if (todayBtn) {
        todayBtn.replaceWith(todayBtn.cloneNode(true));
        document.getElementById('todayBtn')?.addEventListener('click', goToToday);
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = this.value ? 'flex' : 'none';
            filterSalaryTable(this.value);
        });
    }
    
    if (hideEmptyCheckbox) {
        hideEmptyCheckbox.addEventListener('change', () => filterSalaryTable());
    }
    
    document.addEventListener('keydown', handleGlobalKeydown);
}

function setupDataUpdateListener() {
    window.addEventListener('dataUpdate', (e) => {
        if (e.detail?.type === 'salary' || e.detail?.type === 'fund') {
            loadSalaryData();
            loadFundForSalary();
        }
    });
}

function handleGlobalKeydown(e) {
    const modal = document.getElementById('dayModal');
    if (!modal || !modal.classList.contains('active')) return;
    
    if (e.key === 'Escape') {
        closeDayModal();
    } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        if (isDirector) saveCurrentDay();
    } else if (e.key === 'ArrowLeft' && e.ctrlKey) {
        e.preventDefault();
        navigateEmployee(-1);
    } else if (e.key === 'ArrowRight' && e.ctrlKey) {
        e.preventDefault();
        navigateEmployee(1);
    }
}

function restoreFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const month = params.get('month');
    const year = params.get('year');
    if (month && year) {
        currentMonth = parseInt(month);
        currentYear = parseInt(year);
        daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
        updateDisplay();
    }
}

function updateUrl() {
    const url = new URL(window.location);
    url.searchParams.set('month', currentMonth);
    url.searchParams.set('year', currentYear);
    window.history.pushState({}, '', url);
}

function waitForEmployees(retries = 0) {
    if (window.app && window.app.employees && window.app.employees.length > 0) {
        loadSalaryData();
    } else if (retries < 30) {
        setTimeout(() => waitForEmployees(retries + 1), 300);
    } else {
        const container = document.getElementById('salaryTableContainer');
        if (container) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Не удалось загрузить сотрудников</h3><button class="btn-primary" onclick="location.reload()">🔄 Обновить</button></div>`;
        }
        showSystemNotification('❌ Не удалось загрузить сотрудников', 'error');
    }
}

// ============================================
// ФОНД
// ============================================

async function loadFundForSalary() {
    try {
        const response = await apiCall('/fund');
        if (response && response.amount !== undefined) {
            updateFundDisplay(response.amount);
            window.fundAmount = response.amount;
        }
    } catch (err) {
        console.error('Ошибка загрузки фонда:', err);
        showSystemNotification('⚠️ Не удалось загрузить фонд', 'warning');
    }
}

function updateFundDisplay(amount) {
    const fundEl = document.getElementById('salaryFundAmount');
    if (fundEl) fundEl.textContent = amount.toLocaleString() + ' ₽';
}

function openFundManagementModal() {
    if (!isDirector) {
        showSystemNotification('❌ Только директор может управлять фондом', 'error');
        return;
    }
    
    const existingModal = document.getElementById('fundManagementModal');
    if (existingModal) existingModal.remove();
    
    const currentFund = window.fundAmount || 0;
    
    const modalHtml = `
        <div id="fundManagementModal" class="modal active" onclick="closeFundManagementModal()">
            <div class="modal-window" style="max-width: 500px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <div class="modal-icon"><i class="fas fa-landmark"></i></div>
                    <div class="modal-title">
                        <h3>Управление фондом</h3>
                        <p>Корпоративный бюджет</p>
                    </div>
                    <button class="modal-close" onclick="closeFundManagementModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="fund-current-balance">
                        <span>Текущий баланс:</span>
                        <strong>${currentFund.toLocaleString()} ₽</strong>
                    </div>
                    
                    <div class="fund-action-section">
                        <h4><i class="fas fa-pen"></i> Установить точную сумму</h4>
                        <div class="fund-input-group">
                            <input type="number" id="fundSetAmount" class="form-input" placeholder="Сумма" value="0" min="0">
                            <button class="btn-primary" onclick="setFundAmount()">Установить</button>
                        </div>
                    </div>
                    
                    <div class="fund-divider"></div>
                    
                    <div class="fund-action-section">
                        <h4><i class="fas fa-plus-minus"></i> Добавить / Убавить</h4>
                        <div class="fund-input-group">
                            <input type="number" id="fundAddAmount" class="form-input" placeholder="Сумма" value="0" min="0">
                            <button class="btn-success" onclick="addToFund()"><i class="fas fa-plus"></i></button>
                            <button class="btn-danger" onclick="subtractFromFund()"><i class="fas fa-minus"></i></button>
                        </div>
                    </div>
                    
                    <button class="btn-danger btn-block" onclick="resetFund()">
                        <i class="fas fa-trash-alt"></i> Сбросить фонд
                    </button>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeFundManagementModal()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

function closeFundManagementModal() {
    const modal = document.getElementById('fundManagementModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

async function setFundAmount() {
    if (isProcessingFund) return;
    
    const amount = parseInt(document.getElementById('fundSetAmount')?.value) || 0;
    if (amount < 0) {
        showSystemNotification('❌ Сумма не может быть отрицательной', 'error');
        return;
    }
    if (!confirm(`Установить фонд в ${amount.toLocaleString()} ₽?`)) return;
    
    isProcessingFund = true;
    
    try {
        const response = await apiCall('/fund/update', 'POST', { amount, reset: false });
        if (response?.success) {
            showSystemNotification(`💰 Фонд установлен: ${amount.toLocaleString()} ₽`, 'success');
            updateFundDisplay(amount);
            window.fundAmount = amount;
            closeFundManagementModal();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    } finally {
        isProcessingFund = false;
    }
}

async function addToFund() {
    if (isProcessingFund) return;
    
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount <= 0) {
        showSystemNotification('⚠️ Введите сумму больше 0', 'warning');
        return;
    }
    
    isProcessingFund = true;
    
    try {
        const response = await apiCall('/fund/add', 'POST', { sum: amount });
        if (response?.success) {
            const newAmount = (window.fundAmount || 0) + amount;
            showSystemNotification(`💰 Добавлено в фонд: +${amount.toLocaleString()} ₽`, 'success');
            updateFundDisplay(newAmount);
            window.fundAmount = newAmount;
            document.getElementById('fundAddAmount').value = 0;
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    } finally {
        isProcessingFund = false;
    }
}

async function subtractFromFund() {
    if (isProcessingFund) return;
    
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount <= 0) {
        showSystemNotification('⚠️ Введите сумму больше 0', 'warning');
        return;
    }
    
    const currentFund = window.fundAmount || 0;
    if (amount > currentFund) {
        showSystemNotification(`❌ Недостаточно средств (доступно: ${currentFund.toLocaleString()} ₽)`, 'error');
        return;
    }
    
    isProcessingFund = true;
    
    try {
        const response = await apiCall('/fund/add', 'POST', { sum: -amount });
        if (response?.success) {
            const newAmount = currentFund - amount;
            showSystemNotification(`💰 Списано из фонда: -${amount.toLocaleString()} ₽`, 'warning');
            updateFundDisplay(newAmount);
            window.fundAmount = newAmount;
            document.getElementById('fundAddAmount').value = 0;
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    } finally {
        isProcessingFund = false;
    }
}

async function resetFund() {
    if (!confirm('Сбросить фонд в 0 ₽?')) return;
    
    isProcessingFund = true;
    
    try {
        const response = await apiCall('/fund/update', 'POST', { amount: 0, reset: true });
        if (response?.success) {
            showSystemNotification('💰 Фонд обнулён', 'warning');
            updateFundDisplay(0);
            window.fundAmount = 0;
            closeFundManagementModal();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    } finally {
        isProcessingFund = false;
    }
}

// ============================================
// НАВИГАЦИЯ ПО МЕСЯЦАМ
// ============================================

function prevMonth() {
    if (salaryIsLoading) return;
    
    const btn = document.getElementById('prevMonthBtn');
    if (btn) btn.classList.add('loading');
    
    let newMonth = currentMonth - 1;
    let newYear = currentYear;
    if (newMonth < 1) { newMonth = 12; newYear--; }
    
    if (newYear < START_YEAR || (newYear === START_YEAR && newMonth < START_MONTH)) {
        showSystemNotification('📅 Данные доступны с марта 2026 года', 'warning');
        if (btn) btn.classList.remove('loading');
        return;
    }
    
    currentMonth = newMonth;
    currentYear = newYear;
    daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    monthlyTotalsCache = {};
    dayDataCache = {};
    
    resetFilters();
    
    updateDisplay();
    updateUrl();
    showSystemNotification(`📅 ${MONTHS[currentMonth-1]} ${currentYear}`, 'info');
    loadSalaryData().finally(() => btn?.classList.remove('loading'));
}

function nextMonth() {
    if (salaryIsLoading) return;
    
    const btn = document.getElementById('nextMonthBtn');
    if (btn) btn.classList.add('loading');
    
    let newMonth = currentMonth + 1;
    let newYear = currentYear;
    if (newMonth > 12) { newMonth = 1; newYear++; }
    
    currentMonth = newMonth;
    currentYear = newYear;
    daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    monthlyTotalsCache = {};
    dayDataCache = {};
    
    resetFilters();
    
    updateDisplay();
    updateUrl();
    showSystemNotification(`📅 ${MONTHS[currentMonth-1]} ${currentYear}`, 'info');
    loadSalaryData().finally(() => btn?.classList.remove('loading'));
}

function goToToday() {
    const now = getTobolskNow();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth() + 1;
    
    if (currentYear < START_YEAR || (currentYear === START_YEAR && currentMonth < START_MONTH)) {
        currentYear = START_YEAR;
        currentMonth = START_MONTH;
    }
    
    daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    monthlyTotalsCache = {};
    dayDataCache = {};
    
    resetFilters();
    
    updateDisplay();
    updateUrl();
    showSystemNotification('📅 Переход к текущему месяцу', 'info');
    loadSalaryData();
}

function resetFilters() {
    const searchInput = document.getElementById('salarySearch');
    const hideEmptyCheckbox = document.getElementById('hideEmptyDays');
    const clearBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) searchInput.value = '';
    if (hideEmptyCheckbox) hideEmptyCheckbox.checked = false;
    if (clearBtn) clearBtn.style.display = 'none';
}

function updateDisplay() {
    const monthDisplay = document.getElementById('currentMonthDisplay');
    const yearDisplay = document.getElementById('currentYearDisplay');
    if (monthDisplay) monthDisplay.textContent = MONTHS[currentMonth - 1];
    if (yearDisplay) yearDisplay.textContent = currentYear;
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadSalaryData() {
    if (salaryIsLoading) return;
    
    salaryIsLoading = true;
    
    const container = document.getElementById('salaryTableContainer');
    if (container) {
        container.innerHTML = `<div class="loading-state"><div class="loading-ring"></div><div class="loading-text">Загрузка...</div></div>`;
    }
    
    try {
        const data = await apiCall(`/salary?month=${currentMonth}&year=${currentYear}`);
        if (data && data.employees) {
            employeesList = data.employees.filter(emp => emp.role !== 'director');
            renderTable(data);
            showSystemNotification(`📊 Загружены данные за ${MONTHS[currentMonth-1]} ${currentYear}`, 'info');
        } else {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💰</div><h3>Нет данных</h3><p>${data?.error || 'Попробуйте позже'}</p></div>`;
            showSystemNotification('❌ Не удалось загрузить данные зарплаты', 'error');
        }
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Ошибка</h3><p>${err.message}</p><button class="btn-primary" onclick="loadSalaryData()">🔄 Повторить</button></div>`;
        showSystemNotification('❌ Ошибка загрузки данных', 'error');
    } finally {
        salaryIsLoading = false;
    }
}

function filterSalaryTable(searchTerm = null) {
    const tbody = document.querySelector('.salary-table tbody');
    if (!tbody) return;
    
    const searchValue = searchTerm !== null ? searchTerm : document.getElementById('salarySearch')?.value.toLowerCase() || '';
    
    const rows = tbody.querySelectorAll('tr.salary-employee-row');
    let visibleCount = 0;
    let grandTotal = 0;
    
    rows.forEach(row => {
        const nameCell = row.querySelector('.salary-employee-name');
        const name = nameCell?.textContent.toLowerCase() || '';
        const matchesSearch = !searchValue || name.includes(searchValue);
        
        if (matchesSearch) {
            row.style.display = '';
            visibleCount++;
            
            const totalCell = row.querySelector('.salary-total-cell');
            if (totalCell) {
                const totalText = totalCell.textContent.replace(/[^\d]/g, '');
                grandTotal += parseInt(totalText) || 0;
            }
        } else {
            row.style.display = 'none';
        }
    });
    
    const totalRow = document.getElementById('salaryTotalRow');
    const grandTotalEl = document.getElementById('monthlyGrandTotal');
    if (totalRow && grandTotalEl) {
        totalRow.style.display = 'flex';
        grandTotalEl.textContent = grandTotal.toLocaleString() + ' ₽';
    }
    
    document.querySelectorAll('.salary-separator').forEach(sep => {
        const prevRow = sep.previousElementSibling;
        sep.style.display = prevRow && prevRow.style.display !== 'none' ? '' : 'none';
    });
}

function renderTable(data) {
    const container = document.getElementById('salaryTableContainer');
    if (!container) return;
    
    const employees = data.employees || [];
    
    if (employees.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><h3>Нет сотрудников</h3></div>`;
        return;
    }
    
    const dailyData = Array.isArray(data.dailyData) ? data.dailyData : [];
    const dataMap = {};
    dailyData.forEach(item => {
        dataMap[`${item.employee_id}_${item.day_number}`] = {
            oklad: item.oklad || 0,
            event: item.event || 0,
            turnover: item.turnover || 0,
            bonus35: item.bonus35 || 0,
            video: item.video || 0,
            extra_motivation: item.extra_motivation || 0
        };
    });
    
    const totals = {};
    const breakdowns = {};
    
    employees.forEach(emp => {
        let total = 0;
        let okladTotal = 0, eventTotal = 0, turnoverTotal = 0, bonus35Total = 0, videoTotal = 0, extraTotal = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            if (day) {
                const extra = day.extra_motivation || 0;
                total += day.oklad + day.event + day.turnover + day.bonus35 + day.video + extra;
                okladTotal += day.oklad;
                eventTotal += day.event;
                turnoverTotal += day.turnover;
                bonus35Total += day.bonus35;
                videoTotal += day.video;
                extraTotal += extra;
            }
        }
        totals[emp.id] = total;
        breakdowns[emp.id] = { oklad: okladTotal, event: eventTotal, turnover: turnoverTotal, bonus35: bonus35Total, video: videoTotal, extra: extraTotal, total };
    });
    
    monthlyTotalsCache = breakdowns;
    
    const today = getTobolskNow();
    const todayDate = today.getDate();
    const todayMonth = today.getMonth() + 1;
    const todayYear = today.getFullYear();
    const isCurrentMonth = (currentMonth === todayMonth && currentYear === todayYear);
    
    let dayHeaders = '';
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = isCurrentMonth && d === todayDate;
        dayHeaders += `<th style="min-width: 65px;" class="${isToday ? 'today-header' : ''}">${d}</th>`;
    }
    
    let html = `<table class="salary-table"><thead><tr><th style="min-width:180px;">Сотрудник</th>${dayHeaders}<th>ИТОГО</th></tr></thead><tbody>`;
    
    for (const emp of employees) {
        const avatarHtml = emp.avatar_url 
            ? `<img src="${escapeHtml(emp.avatar_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='${escapeHtml(emp.avatar || '👤')}'">`
            : (emp.avatar || '👤');
        
        html += `<tr class="salary-employee-row">`;
        html += `<td class="salary-employee-cell"><div class="salary-employee-content"><div class="salary-employee-avatar" onclick="openProfile('${escapeJsString(emp.name)}')">${avatarHtml}</div><div><div class="salary-employee-name">${escapeHtml(emp.name)}</div><div class="salary-employee-role">${getRoleName(emp.role)}</div></div></div></td>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            const total = day ? (day.oklad + day.event + day.turnover + day.bonus35 + day.video + (day.extra_motivation || 0)) : 0;
            const isToday = isCurrentMonth && d === todayDate;
            
            let tooltip = 'Нет начислений';
            if (day) {
                tooltip = `Оклад: ${day.oklad.toLocaleString()} ₽\nМероприятие: ${day.event.toLocaleString()} ₽\nПремия с оборота: ${day.turnover.toLocaleString()} ₽\nПремия 35к: ${day.bonus35.toLocaleString()} ₽\nВидео: ${day.video.toLocaleString()} ₽\nДоп. мотивация: ${(day.extra_motivation || 0).toLocaleString()} ₽`;
            }
            
            html += `<td class="day-cell ${total > 0 ? 'filled' : 'empty'} ${isToday ? 'today' : ''}" onclick="openDayModal(${emp.id}, ${d}, '${escapeJsString(emp.name)}')" title="${tooltip}">${total > 0 ? total.toLocaleString() + ' ₽' : '—'}</td>`;
        }
        
        html += `<td class="salary-total-cell" onclick="showMonthlyBreakdown(${emp.id}, '${escapeJsString(emp.name)}')">${(totals[emp.id] || 0).toLocaleString()} ₽</td></tr>`;
        html += `<tr class="salary-separator"><td colspan="${daysInMonth + 2}"><div class="separator-line"></div></td></tr>`;
    }
    
    html += `</tbody></table>`;
    container.innerHTML = html;
    
    filterSalaryTable();
}

function showMonthlyBreakdown(employeeId, employeeName) {
    const existingModal = document.getElementById('monthlyBreakdownModal');
    if (existingModal) existingModal.remove();
    
    const breakdown = monthlyTotalsCache[employeeId];
    if (!breakdown) {
        showSystemNotification('⚠️ Нет данных для отображения', 'warning');
        return;
    }
    
    const modalHtml = `
        <div id="monthlyBreakdownModal" class="modal active" onclick="closeMonthlyBreakdownModal()">
            <div class="modal-window" style="max-width: 500px;" onclick="event.stopPropagation()">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>📊 Детализация за ${MONTHS[currentMonth - 1]} ${currentYear}</h3>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">${escapeHtml(employeeName)}</p>
                </div>
                <div style="padding: 20px;">
                    <div class="breakdown-item"><span>💰 Оклад</span><strong>${breakdown.oklad.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-item"><span>🎉 Мероприятия</span><strong>${breakdown.event.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-item"><span>📈 Премия с оборота</span><strong>${breakdown.turnover.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-item"><span>🏆 Премия за 35 тыс.</span><strong>${breakdown.bonus35.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-item"><span>📹 Ролик/Отзыв</span><strong>${breakdown.video.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-item"><span>🎁 Доп. мотивация</span><strong>${breakdown.extra.toLocaleString()} ₽</strong></div>
                    <div class="breakdown-total"><span>ИТОГО</span><strong>${breakdown.total.toLocaleString()} ₽</strong></div>
                    <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn-small" onclick="copyBreakdownToClipboard()">📋 Копировать</button>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-secondary" onclick="closeMonthlyBreakdownModal()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
    showSystemNotification(`📊 Детализация за ${MONTHS[currentMonth-1]}`, 'info');
}

function closeMonthlyBreakdownModal() {
    const modal = document.getElementById('monthlyBreakdownModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

function copyBreakdownToClipboard() {
    const items = document.querySelectorAll('.breakdown-item');
    let text = `Детализация зарплаты за ${MONTHS[currentMonth - 1]} ${currentYear}\n\n`;
    items.forEach(item => {
        const label = item.querySelector('span')?.textContent || '';
        const value = item.querySelector('strong')?.textContent || '';
        text += `${label}: ${value}\n`;
    });
    const total = document.querySelector('.breakdown-total strong')?.textContent || '';
    text += `\nИТОГО: ${total}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showSystemNotification('📋 Детализация скопирована', 'success');
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showSystemNotification('📋 Скопировано в буфер обмена', 'success');
    } catch (e) {
        showSystemNotification('❌ Не удалось скопировать', 'error');
    }
    document.body.removeChild(textarea);
}

// ============================================
// МОДАЛКА РЕДАКТИРОВАНИЯ ДНЯ
// ============================================

function openDayModal(employeeId, dayNumber, employeeName) {
    const existingModal = document.getElementById('dayModal');
    if (existingModal) existingModal.remove();
    
    if (!employeesList.length) {
        showSystemNotification('⏳ Данные ещё загружаются...', 'warning');
        return;
    }
    
    if (dayNumber < 1 || dayNumber > daysInMonth) {
        showSystemNotification('❌ Некорректный день', 'error');
        return;
    }
    
    const emp = employeesList.find(e => e.id === employeeId);
    if (!emp) {
        showSystemNotification('❌ Сотрудник не найден', 'error');
        return;
    }
    
    currentEmployeeId = employeeId;
    currentDayNumber = dayNumber;
    currentEmployeeIndex = employeesList.findIndex(e => e.id === employeeId);
    hasUnsavedChanges = false;
    dayInputHandlersInitialized = false;
    
    const date = new Date(currentYear, currentMonth - 1, dayNumber);
    
    const modalHtml = `
        <div id="dayModal" class="modal active" onclick="closeDayModal()">
            <div class="modal-window day-modal" onclick="event.stopPropagation()">
                <div class="day-modal-header">
                    <div class="day-modal-header-left">
                        <div class="day-modal-icon">
                            <i class="fas fa-calendar-day"></i>
                        </div>
                        <div>
                            <div class="day-modal-date">${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                            <div class="day-modal-employee"><i class="fas fa-user"></i> ${escapeHtml(employeeName)}</div>
                        </div>
                    </div>
                    <button class="day-modal-close" onclick="closeDayModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="day-modal-body">
                    <div class="salary-field primary-field">
                        <div class="salary-field-label">
                            <i class="fas fa-money-bill-wave"></i>
                            <span>ОКЛАД</span>
                            <span class="field-badge">основная ставка</span>
                        </div>
                        <div class="salary-field-input">
                            <span class="currency-symbol">₽</span>
                            <input type="number" id="salaryOklad" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;">
                        </div>
                    </div>
                    <div class="salary-fields-grid">
                        <div class="salary-field">
                            <div class="salary-field-label"><i class="fas fa-calendar-star"></i><span>МЕРОПРИЯТИЕ</span></div>
                            <div class="salary-field-input"><span class="currency-symbol">₽</span><input type="number" id="salaryEvent" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;"></div>
                        </div>
                        <div class="salary-field">
                            <div class="salary-field-label"><i class="fas fa-chart-line"></i><span>ПРЕМИЯ С ОБОРОТА</span></div>
                            <div class="salary-field-input"><span class="currency-symbol">₽</span><input type="number" id="salaryTurnover" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;"></div>
                        </div>
                        <div class="salary-field">
                            <div class="salary-field-label" title="Премия при достижении оборота 35 000 ₽ за смену"><i class="fas fa-trophy"></i><span>ПРЕМИЯ ЗА 35 ТЫС.</span><i class="fas fa-question-circle" style="opacity:0.5;font-size:12px;"></i></div>
                            <div class="salary-field-input"><span class="currency-symbol">₽</span><input type="number" id="salaryBonus35" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;"></div>
                        </div>
                        <div class="salary-field">
                            <div class="salary-field-label"><i class="fas fa-video"></i><span>РОЛИК / ОТЗЫВ</span></div>
                            <div class="salary-field-input"><span class="currency-symbol">₽</span><input type="number" id="salaryVideo" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;"></div>
                        </div>
                        <div class="salary-field extra-field">
                            <div class="salary-field-label"><i class="fas fa-gift"></i><span>ДОП. МОТИВАЦИЯ</span></div>
                            <div class="salary-field-input"><span class="currency-symbol">₽</span><input type="number" id="salaryExtraMotivation" class="salary-number-input" placeholder="0" value="0" min="0" max="${MAX_AMOUNT}" ${!isDirector ? 'disabled' : ''} style="outline: none;"></div>
                        </div>
                    </div>
                    <div class="salary-total-day">
                        <div class="total-day-label"><i class="fas fa-calculator"></i><span>ИТОГО ЗА ДЕНЬ</span></div>
                        <div class="total-day-value" id="totalDayValue">0 ₽</div>
                    </div>
                    <div class="day-modal-nav">
                        <button class="nav-btn" id="prevEmployeeBtn" onclick="navigateEmployee(-1)" ${currentEmployeeIndex <= 0 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                        <span id="employeePosition">${currentEmployeeIndex + 1} / ${employeesList.length}</span>
                        <button class="nav-btn" id="nextEmployeeBtn" onclick="navigateEmployee(1)" ${currentEmployeeIndex >= employeesList.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
                <div class="day-modal-footer" id="modalFooter" style="display: ${isDirector ? 'flex' : 'none'};">
                    <button class="btn-clear" onclick="clearCurrentDay()"><i class="fas fa-eraser"></i><span>Очистить</span></button>
                    <button class="btn-apply-all" onclick="applyToAllOperators()"><i class="fas fa-users"></i><span>Всем операторам</span></button>
                    <button class="btn-save" onclick="saveCurrentDay()"><i class="fas fa-save"></i><span>Сохранить</span></button>
                    <button class="btn-close" onclick="closeDayModal()"><i class="fas fa-times"></i><span>Закрыть</span></button>
                </div>
                <div class="day-modal-footer" style="display: ${!isDirector ? 'flex' : 'none'};">
                    <button class="btn-close" onclick="closeDayModal()" style="width:100%;"><i class="fas fa-times"></i><span>Закрыть</span></button>
                </div>
                <div class="day-modal-hotkeys">
                    <span><kbd>Enter</kbd> — сохранить</span>
                    <span><kbd>Esc</kbd> — закрыть</span>
                    <span><kbd>←</kbd> <kbd>→</kbd> — сотрудники</span>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
    
    setupDayInputHandlers();
    loadDayData(employeeId, dayNumber);
    
    setTimeout(() => document.getElementById('salaryOklad')?.focus(), 100);
}

function setupDayInputHandlers() {
    if (dayInputHandlersInitialized) return;
    
    const inputs = ['salaryOklad', 'salaryEvent', 'salaryTurnover', 'salaryBonus35', 'salaryVideo', 'salaryExtraMotivation'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input && isDirector) {
            input.addEventListener('input', onDayInputChange);
            input.addEventListener('change', onDayInputChange);
        }
    });
    
    dayInputHandlersInitialized = true;
}

function onDayInputChange() {
    hasUnsavedChanges = true;
    updateDayTotal();
}

function closeDayModal() {
    if (hasUnsavedChanges && isDirector) {
        if (!confirm('У вас есть несохранённые изменения. Выйти?')) return;
    }
    
    const modal = document.getElementById('dayModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
    currentEmployeeId = null;
    currentDayNumber = null;
    originalDayData = null;
    hasUnsavedChanges = false;
    currentEmployeeIndex = -1;
    dayInputHandlersInitialized = false;
}

async function navigateEmployee(delta) {
    if (!employeesList.length) return;
    
    const newIndex = currentEmployeeIndex + delta;
    if (newIndex < 0 || newIndex >= employeesList.length) return;
    
    const emp = employeesList[newIndex];
    if (emp) {
        if (hasUnsavedChanges && isDirector) {
            if (!confirm('Сохранить изменения перед переходом?')) return;
            await saveCurrentDay();
        }
        openDayModal(emp.id, currentDayNumber, emp.name);
    }
}

async function loadDayData(employeeId, dayNumber) {
    const cacheKey = `${employeeId}_${dayNumber}_${currentMonth}_${currentYear}`;
    
    if (dayDataCache[cacheKey]) {
        const data = dayDataCache[cacheKey];
        fillDayDataFields(data);
        originalDayData = { ...data };
        return;
    }
    
    try {
        const data = await apiCall(`/salary/day?employee_id=${employeeId}&day=${dayNumber}&month=${currentMonth}&year=${currentYear}`);
        const normalizedData = {
            oklad: data?.oklad || 0,
            event: data?.event || 0,
            turnover: data?.turnover || 0,
            bonus35: data?.bonus35 || 0,
            video: data?.video || 0,
            extra_motivation: data?.extra_motivation || 0
        };
        dayDataCache[cacheKey] = normalizedData;
        fillDayDataFields(normalizedData);
        originalDayData = { ...normalizedData };
    } catch (err) {
        console.error(err);
        const emptyData = { oklad: 0, event: 0, turnover: 0, bonus35: 0, video: 0, extra_motivation: 0 };
        fillDayDataFields(emptyData);
        originalDayData = { ...emptyData };
    }
}

function fillDayDataFields(data) {
    document.getElementById('salaryOklad').value = data?.oklad || 0;
    document.getElementById('salaryEvent').value = data?.event || 0;
    document.getElementById('salaryTurnover').value = data?.turnover || 0;
    document.getElementById('salaryBonus35').value = data?.bonus35 || 0;
    document.getElementById('salaryVideo').value = data?.video || 0;
    document.getElementById('salaryExtraMotivation').value = data?.extra_motivation || 0;
    updateDayTotal();
}

function updateDayTotal() {
    const oklad = parseFloat(document.getElementById('salaryOklad')?.value) || 0;
    const event = parseFloat(document.getElementById('salaryEvent')?.value) || 0;
    const turnover = parseFloat(document.getElementById('salaryTurnover')?.value) || 0;
    const bonus35 = parseFloat(document.getElementById('salaryBonus35')?.value) || 0;
    const video = parseFloat(document.getElementById('salaryVideo')?.value) || 0;
    const extraMotivation = parseFloat(document.getElementById('salaryExtraMotivation')?.value) || 0;
    const total = oklad + event + turnover + bonus35 + video + extraMotivation;
    const totalEl = document.getElementById('totalDayValue');
    if (totalEl) totalEl.textContent = total.toLocaleString() + ' ₽';
}

function clearCurrentDay() {
    if (!isDirector) return;
    if (!confirm('Очистить все поля?')) return;
    
    const inputs = ['salaryOklad', 'salaryEvent', 'salaryTurnover', 'salaryBonus35', 'salaryVideo', 'salaryExtraMotivation'];
    inputs.forEach(id => { document.getElementById(id).value = 0; });
    updateDayTotal();
    hasUnsavedChanges = true;
    showSystemNotification('🧹 Поля очищены', 'info');
}

async function applyToAllOperators() {
    if (!isDirector) return;
    if (!confirm('Применить текущие значения ко ВСЕМ операторам за этот день?')) return;
    
    const loadingToast = showSystemNotification('⏳ Применение ко всем операторам...', 'loading');
    
    const oklad = parseFloat(document.getElementById('salaryOklad')?.value) || 0;
    const event = parseFloat(document.getElementById('salaryEvent')?.value) || 0;
    const turnover = parseFloat(document.getElementById('salaryTurnover')?.value) || 0;
    const bonus35 = parseFloat(document.getElementById('salaryBonus35')?.value) || 0;
    const video = parseFloat(document.getElementById('salaryVideo')?.value) || 0;
    const extraMotivation = parseFloat(document.getElementById('salaryExtraMotivation')?.value) || 0;
    
    const operators = employeesList.filter(e => e.role === 'operator');
    let successCount = 0;
    
    for (const op of operators) {
        const data = {
            employee_id: op.id,
            day_number: currentDayNumber,
            month: currentMonth,
            year: currentYear,
            oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation
        };
        
        try {
            const response = await apiCall('/salary/day/save', 'POST', data);
            if (response?.success) successCount++;
        } catch (e) {}
    }
    
    if (loadingToast) {
        updateLoadingToast(loadingToast, `✅ Применено для ${successCount} из ${operators.length} операторов`, 'success');
    } else {
        showSystemNotification(`✅ Применено для ${successCount} из ${operators.length} операторов`, 'success');
    }
    
    monthlyTotalsCache = {};
    dayDataCache = {};
    loadSalaryData();
}

async function saveCurrentDay() {
    if (!isDirector || isSavingDay) return;
    
    const oklad = parseFloat(document.getElementById('salaryOklad')?.value) || 0;
    const event = parseFloat(document.getElementById('salaryEvent')?.value) || 0;
    const turnover = parseFloat(document.getElementById('salaryTurnover')?.value) || 0;
    const bonus35 = parseFloat(document.getElementById('salaryBonus35')?.value) || 0;
    const video = parseFloat(document.getElementById('salaryVideo')?.value) || 0;
    const extraMotivation = parseFloat(document.getElementById('salaryExtraMotivation')?.value) || 0;
    
    if (oklad > MAX_AMOUNT || event > MAX_AMOUNT || turnover > MAX_AMOUNT || bonus35 > MAX_AMOUNT || video > MAX_AMOUNT || extraMotivation > MAX_AMOUNT) {
        showSystemNotification(`❌ Максимальная сумма: ${MAX_AMOUNT.toLocaleString()} ₽`, 'error');
        return;
    }
    
    const data = {
        employee_id: currentEmployeeId,
        day_number: currentDayNumber,
        month: currentMonth,
        year: currentYear,
        oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation
    };
    
    if (originalDayData && 
        originalDayData.oklad === oklad &&
        originalDayData.event === event &&
        originalDayData.turnover === turnover &&
        originalDayData.bonus35 === bonus35 &&
        originalDayData.video === video &&
        (originalDayData.extra_motivation || 0) === extraMotivation) {
        showSystemNotification('ℹ️ Нет изменений для сохранения', 'info');
        return;
    }
    
    isSavingDay = true;
    const saveBtn = document.getElementById('saveDayBtn');
    const originalText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        saveBtn.disabled = true;
    }
    
    try {
        const response = await apiCall('/salary/day/save', 'POST', data);
        if (response?.success) {
            showSystemNotification(`✅ Зарплата за ${currentDayNumber} ${MONTHS[currentMonth-1]} сохранена`, 'success');
            hasUnsavedChanges = false;
            originalDayData = { oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation };
            
            const cacheKey = `${currentEmployeeId}_${currentDayNumber}_${currentMonth}_${currentYear}`;
            dayDataCache[cacheKey] = { oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation };
            monthlyTotalsCache = {};
            
            closeDayModal();
            loadSalaryData();
            loadFundForSalary();
            window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'salary' } }));
        } else {
            showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        showSystemNotification('❌ Ошибка соединения', 'error');
    } finally {
        isSavingDay = false;
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initSalary = initSalary;
window.resetSalaryState = resetSalaryState;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.goToToday = goToToday;
window.openDayModal = openDayModal;
window.closeDayModal = closeDayModal;
window.saveCurrentDay = saveCurrentDay;
window.clearCurrentDay = clearCurrentDay;
window.applyToAllOperators = applyToAllOperators;
window.navigateEmployee = navigateEmployee;
window.loadFundForSalary = loadFundForSalary;
window.showMonthlyBreakdown = showMonthlyBreakdown;
window.closeMonthlyBreakdownModal = closeMonthlyBreakdownModal;
window.copyBreakdownToClipboard = copyBreakdownToClipboard;
window.openFundManagementModal = openFundManagementModal;
window.closeFundManagementModal = closeFundManagementModal;
window.setFundAmount = setFundAmount;
window.addToFund = addToFund;
window.subtractFromFund = subtractFromFund;
window.resetFund = resetFund;
window.filterSalaryTable = filterSalaryTable;
window.clearSalarySearch = function() {
    document.getElementById('salarySearch').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    filterSalaryTable('');
};

console.log('✅ salary.js загружен (v5.4 — с уведомлениями)');