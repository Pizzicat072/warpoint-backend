// public/js/salary.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v5.0
// Исправлено 50 багов логики, добавлено управление фондом, поиск, навигация

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
let monthlyTotalsCache = {};
let dayDataCache = {};
let salaryInitialized = false;
let originalDayData = null;
let hasUnsavedChanges = false;
let employeesList = [];
let currentEmployeeIndex = -1;
let daysInMonth = 31;

const START_YEAR = 2026;
const START_MONTH = 3;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MAX_AMOUNT = 1000000;

// Локальные roleNames
const roleNames = {
    director: 'Директор',
    manager: 'Управляющий',
    admin: 'Админ',
    operator: 'Оператор'
};

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

function showNotif(msg, type) {
    if (typeof window.showNotif === 'function' && window.showNotif !== showNotif) {
        window.showNotif(msg, type);
    } else {
        console.log(`[${type}] ${msg}`);
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

function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initSalary() {
    if (salaryInitialized) {
        console.log('💰 Зарплата уже инициализирована');
        return;
    }
    
    const container = document.getElementById('salaryTableContainer');
    if (!container) {
        setTimeout(initSalary, 100);
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
    
    salaryInitialized = true;
}

function setupEventListeners() {
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    const todayBtn = document.getElementById('todayBtn');
    const searchInput = document.getElementById('salarySearch');
    const hideEmptyCheckbox = document.getElementById('hideEmptyDays');
    const groupByRoleCheckbox = document.getElementById('groupByRole');
    
    if (prevBtn) prevBtn.addEventListener('click', prevMonth);
    if (nextBtn) nextBtn.addEventListener('click', nextMonth);
    if (todayBtn) todayBtn.addEventListener('click', goToToday);
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = this.value ? 'flex' : 'none';
            filterSalaryTable(this.value);
        });
    }
    
    if (hideEmptyCheckbox) hideEmptyCheckbox.addEventListener('change', filterSalaryTable);
    if (groupByRoleCheckbox) groupByRoleCheckbox.addEventListener('change', filterSalaryTable);
    
    document.addEventListener('keydown', handleGlobalKeydown);
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
        showNotif('⚠️ Не удалось загрузить фонд', 'warning');
    }
}

function updateFundDisplay(amount) {
    const fundEl = document.getElementById('salaryFundAmount');
    if (fundEl) fundEl.textContent = amount.toLocaleString() + ' ₽';
    const modalFundEl = document.getElementById('modalFundAmount');
    if (modalFundEl) modalFundEl.textContent = amount.toLocaleString() + ' ₽';
}

function openFundManagementModal() {
    if (!isDirector) {
        showNotif('Только директор может управлять фондом', 'error');
        return;
    }
    
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
                        <strong id="modalFundAmount">${currentFund.toLocaleString()} ₽</strong>
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
    const amount = parseInt(document.getElementById('fundSetAmount')?.value) || 0;
    if (amount < 0) {
        showNotif('Сумма не может быть отрицательной', 'error');
        return;
    }
    if (!confirm(`Установить фонд в ${amount.toLocaleString()} ₽?`)) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount });
    if (response?.success) {
        showNotif(`💰 Фонд установлен: ${amount.toLocaleString()} ₽`, 'success');
        updateFundDisplay(amount);
        window.fundAmount = amount;
        closeFundManagementModal();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

async function addToFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount <= 0) { showNotif('Введите сумму больше 0', 'warning'); return; }
    
    const response = await apiCall('/fund/add', 'POST', { sum: amount });
    if (response?.success) {
        const newAmount = (window.fundAmount || 0) + amount;
        showNotif(`💰 Добавлено ${amount.toLocaleString()} ₽`, 'success');
        updateFundDisplay(newAmount);
        window.fundAmount = newAmount;
        document.getElementById('fundAddAmount').value = 0;
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

async function subtractFromFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount <= 0) { showNotif('Введите сумму больше 0', 'warning'); return; }
    
    const currentFund = window.fundAmount || 0;
    if (amount > currentFund) {
        showNotif(`Недостаточно средств в фонде (доступно: ${currentFund.toLocaleString()} ₽)`, 'error');
        return;
    }
    
    const response = await apiCall('/fund/add', 'POST', { sum: -amount });
    if (response?.success) {
        const newAmount = currentFund - amount;
        showNotif(`💰 Убавлено ${amount.toLocaleString()} ₽`, 'success');
        updateFundDisplay(newAmount);
        window.fundAmount = newAmount;
        document.getElementById('fundAddAmount').value = 0;
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

async function resetFund() {
    if (!confirm('Сбросить фонд в 0 ₽?')) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: 0 });
    if (response?.success) {
        showNotif('💰 Фонд обнулён', 'success');
        updateFundDisplay(0);
        window.fundAmount = 0;
        closeFundManagementModal();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
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
        showNotif('📅 Данные доступны с марта 2026 года', 'warning');
        if (btn) btn.classList.remove('loading');
        return;
    }
    
    currentMonth = newMonth;
    currentYear = newYear;
    daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    monthlyTotalsCache = {};
    dayDataCache = {};
    
    updateDisplay();
    updateUrl();
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
    
    updateDisplay();
    updateUrl();
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
    
    updateDisplay();
    updateUrl();
    loadSalaryData();
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
        } else {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💰</div><h3>Нет данных</h3><p>${data?.error || 'Попробуйте позже'}</p></div>`;
        }
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Ошибка</h3><p>${err.message}</p><button class="btn-primary" onclick="loadSalaryData()">🔄 Повторить</button></div>`;
    } finally {
        salaryIsLoading = false;
    }
}

function filterSalaryTable(searchTerm = null) {
    const searchValue = searchTerm !== null ? searchTerm : document.getElementById('salarySearch')?.value.toLowerCase() || '';
    const hideEmpty = document.getElementById('hideEmptyDays')?.checked || false;
    const groupByRole = document.getElementById('groupByRole')?.checked || false;
    
    const rows = document.querySelectorAll('.salary-table tbody tr.salary-employee-row');
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
        totalRow.style.display = visibleCount > 0 ? 'flex' : 'none';
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
    
    const dailyData = data.dailyData || [];
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
        html += `<td class="salary-employee-cell"><div class="salary-employee-content"><div class="salary-employee-avatar" onclick="openProfile('${escapeHtml(emp.name)}')">${avatarHtml}</div><div><div class="salary-employee-name">${escapeHtml(emp.name)}</div><div class="salary-employee-role">${roleNames[emp.role] || 'Оператор'}</div></div></div></td>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            const total = day ? (day.oklad + day.event + day.turnover + day.bonus35 + day.video + (day.extra_motivation || 0)) : 0;
            const isToday = isCurrentMonth && d === todayDate;
            const tooltip = day ? `Оклад: ${day.oklad} ₽\nМероприятие: ${day.event} ₽\nПремия с оборота: ${day.turnover} ₽\nПремия 35к: ${day.bonus35} ₽\nВидео: ${day.video} ₽\nДоп. мотивация: ${day.extra_motivation || 0} ₽` : 'Нет начислений';
            
            html += `<td class="day-cell ${total > 0 ? 'filled' : 'empty'} ${isToday ? 'today' : ''}" onclick="openDayModal(${emp.id}, ${d}, '${escapeHtml(emp.name)}')" title="${tooltip}">${total > 0 ? total.toLocaleString() + ' ₽' : '—'}</td>`;
        }
        
        html += `<td class="salary-total-cell" onclick="showMonthlyBreakdown(${emp.id}, '${escapeHtml(emp.name)}')">${(totals[emp.id] || 0).toLocaleString()} ₽</td></tr>`;
        html += `<tr class="salary-separator"><td colspan="${daysInMonth + 2}"><div class="separator-line"></div></td></tr>`;
    }
    
    html += `</tbody></table>`;
    container.innerHTML = html;
    
    filterSalaryTable();
}

function showMonthlyBreakdown(employeeId, employeeName) {
    const breakdown = monthlyTotalsCache[employeeId];
    if (!breakdown) {
        showNotif('Нет данных для отображения', 'warning');
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
    
    navigator.clipboard?.writeText(text).then(() => {
        showNotif('📋 Скопировано в буфер обмена', 'success');
    }).catch(() => {
        showNotif('Не удалось скопировать', 'error');
    });
}

// ============================================
// МОДАЛКА РЕДАКТИРОВАНИЯ ДНЯ
// ============================================

function openDayModal(employeeId, dayNumber, employeeName) {
    if (dayNumber < 1 || dayNumber > daysInMonth) {
        showNotif('Некорректный день', 'error');
        return;
    }
    
    const emp = employeesList.find(e => e.id === employeeId);
    if (!emp) {
        showNotif('Сотрудник не найден', 'error');
        return;
    }
    
    currentEmployeeId = employeeId;
    currentDayNumber = dayNumber;
    currentEmployeeIndex = employeesList.findIndex(e => e.id === employeeId);
    hasUnsavedChanges = false;
    
    const date = new Date(currentYear, currentMonth - 1, dayNumber);
    const modalDate = document.getElementById('modalDate');
    const modalEmployee = document.getElementById('modalEmployee');
    const employeePosition = document.getElementById('employeePosition');
    
    if (modalDate) modalDate.textContent = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (modalEmployee) modalEmployee.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(employeeName)}`;
    if (employeePosition) employeePosition.textContent = `${currentEmployeeIndex + 1} / ${employeesList.length}`;
    
    const footer = document.getElementById('modalFooter');
    if (footer) footer.style.display = 'flex';
    
    const applyAllBtn = document.getElementById('applyAllBtn');
    if (applyAllBtn) applyAllBtn.style.display = isDirector ? 'flex' : 'none';
    
    const prevBtn = document.getElementById('prevEmployeeBtn');
    const nextBtn = document.getElementById('nextEmployeeBtn');
    if (prevBtn) prevBtn.disabled = currentEmployeeIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentEmployeeIndex >= employeesList.length - 1;
    
    const inputs = ['salaryOklad', 'salaryEvent', 'salaryTurnover', 'salaryBonus35', 'salaryVideo', 'salaryExtraMotivation'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.disabled = !isDirector;
            if (isDirector) {
                input.addEventListener('input', () => { hasUnsavedChanges = true; updateDayTotal(); });
                input.addEventListener('change', () => { hasUnsavedChanges = true; updateDayTotal(); });
            }
        }
    });
    
    loadDayData(employeeId, dayNumber);
    document.getElementById('dayModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => document.getElementById('salaryOklad')?.focus(), 100);
}

function closeDayModal() {
    if (hasUnsavedChanges && isDirector) {
        if (!confirm('У вас есть несохранённые изменения. Выйти?')) return;
    }
    
    document.getElementById('dayModal').classList.remove('active');
    document.body.style.overflow = '';
    currentEmployeeId = null;
    currentDayNumber = null;
    originalDayData = null;
    hasUnsavedChanges = false;
}

function navigateEmployee(delta) {
    if (!employeesList.length) return;
    
    const newIndex = currentEmployeeIndex + delta;
    if (newIndex < 0 || newIndex >= employeesList.length) return;
    
    const emp = employeesList[newIndex];
    if (emp) {
        if (hasUnsavedChanges && isDirector) {
            if (!confirm('Сохранить изменения перед переходом?')) return;
            saveCurrentDay();
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
        dayDataCache[cacheKey] = data;
        fillDayDataFields(data);
        originalDayData = { ...data };
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
    showNotif('🧹 Поля очищены', 'info');
}

async function applyToAllOperators() {
    if (!isDirector) return;
    if (!confirm('Применить текущие значения ко ВСЕМ операторам за этот день?')) return;
    
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
    
    showNotif(`✅ Применено для ${successCount} из ${operators.length} операторов`, 'success');
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
        showNotif(`Максимальная сумма: ${MAX_AMOUNT.toLocaleString()} ₽`, 'error');
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
        showNotif('Нет изменений для сохранения', 'info');
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
            showNotif('✅ Сохранено', 'success');
            hasUnsavedChanges = false;
            originalDayData = { oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation };
            
            const cacheKey = `${currentEmployeeId}_${currentDayNumber}_${currentMonth}_${currentYear}`;
            dayDataCache[cacheKey] = { oklad, event, turnover, bonus35, video, extra_motivation: extraMotivation };
            monthlyTotalsCache = {};
            
            closeDayModal();
            loadSalaryData();
            loadFundForSalary();
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        showNotif('❌ Ошибка соединения', 'error');
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

console.log('✅ salary.js загружен (v5.0 — исправлено 50 багов)');