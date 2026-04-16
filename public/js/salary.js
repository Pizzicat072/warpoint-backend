// public/js/salary.js — ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ С ФОНДОМ И ДОП. МОТИВАЦИЕЙ

let currentEmployeeId = null;
let currentDayNumber = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let isDirector = false;
let salaryIsLoading = false;
let monthlyTotalsCache = {};

const START_YEAR = 2026;
const START_MONTH = 3;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function initSalary() {
    const container = document.getElementById('salaryTableContainer');
    if (!container) {
        return;
    }
    
    console.log('💰 Инициализация зарплаты');
    
    const monthDisplay = document.getElementById('currentMonthDisplay');
    const yearDisplay = document.getElementById('currentYearDisplay');
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    const exportBtn = document.getElementById('exportBtn');
    
    if (!monthDisplay || !yearDisplay) {
        setTimeout(initSalary, 100);
        return;
    }
    
    const now = getTobolskNow ? getTobolskNow() : new Date();
    let todayYear = now.getFullYear();
    let todayMonth = now.getMonth() + 1;
    
    if (todayYear < START_YEAR || (todayYear === START_YEAR && todayMonth < START_MONTH)) {
        currentYear = START_YEAR;
        currentMonth = START_MONTH;
    } else {
        currentYear = todayYear;
        currentMonth = todayMonth;
    }
    
    console.log(`📅 Текущий месяц: ${MONTHS[currentMonth - 1]} ${currentYear}`);
    
    if (window.app && window.app.currentUserRole) {
        isDirector = window.app.currentUserRole === 'director';
        const roleBadge = document.getElementById('salaryRoleText');
        if (roleBadge) {
            roleBadge.innerHTML = isDirector ? '<i class="fas fa-edit"></i> Режим редактирования' : '<i class="fas fa-eye"></i> Режим просмотра';
        }
    }
    
    updateDisplay();
    loadFundForSalary();
    
    if (window.app && window.app.employees && window.app.employees.length > 0) {
        loadSalaryData();
    } else {
        waitForEmployees();
    }
    
    if (prevBtn) {
        const newPrevBtn = prevBtn.cloneNode(true);
        prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
        newPrevBtn.addEventListener('click', () => prevMonth());
    }
    
    if (nextBtn) {
        const newNextBtn = nextBtn.cloneNode(true);
        nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
        newNextBtn.addEventListener('click', () => nextMonth());
    }
    
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true);
        exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', () => exportSalaryToExcel());
    }
}

// 🔥 НОВОЕ: Загрузка фонда для страницы зарплаты
async function loadFundForSalary() {
    try {
        const response = await apiCall('/fund');
        if (response && response.amount !== undefined) {
            const fundEl = document.getElementById('salaryFundAmount');
            if (fundEl) fundEl.textContent = response.amount.toLocaleString() + ' ₽';
            
            // Сохраняем в глобальный кэш
            window.fundAmount = response.amount;
        }
    } catch (err) {
        console.error('Ошибка загрузки фонда:', err);
    }
}

function prevMonth() {
    let newMonth = currentMonth - 1;
    let newYear = currentYear;
    
    if (newMonth < 1) {
        newMonth = 12;
        newYear--;
    }
    
    if (newYear < START_YEAR || (newYear === START_YEAR && newMonth < START_MONTH)) {
        showNotif('📅 Данные доступны с марта 2026 года', 'warning');
        return;
    }
    
    currentMonth = newMonth;
    currentYear = newYear;
    
    updateDisplay();
    loadSalaryData();
}

function nextMonth() {
    let newMonth = currentMonth + 1;
    let newYear = currentYear;
    
    if (newMonth > 12) {
        newMonth = 1;
        newYear++;
    }
    
    currentMonth = newMonth;
    currentYear = newYear;
    
    updateDisplay();
    loadSalaryData();
}

function updateDisplay() {
    const monthDisplay = document.getElementById('currentMonthDisplay');
    const yearDisplay = document.getElementById('currentYearDisplay');
    
    if (monthDisplay) monthDisplay.textContent = MONTHS[currentMonth - 1];
    if (yearDisplay) yearDisplay.textContent = currentYear;
}

// 🔥 ОБНОВЛЕНО: Добавлена доп. мотивация
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

function waitForEmployees(retries = 0) {
    if (window.app && window.app.employees && window.app.employees.length > 0) {
        loadSalaryData();
    } else if (retries < 20) {
        setTimeout(() => waitForEmployees(retries + 1), 500);
    } else {
        const container = document.getElementById('salaryTableContainer');
        if (container) {
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Ошибка загрузки</h3><button class="btn-primary" onclick="location.reload()">🔄 Перезагрузить</button></div>`;
        }
    }
}

async function loadSalaryData() {
    if (salaryIsLoading) return;
    salaryIsLoading = true;
    
    const container = document.getElementById('salaryTableContainer');
    if (!container) {
        salaryIsLoading = false;
        return;
    }
    
    container.innerHTML = '<div class="loading-state"><div class="loading-ring"></div><div class="loading-text">Загрузка...</div></div>';
    
    try {
        const data = await apiCall(`/salary?month=${currentMonth}&year=${currentYear}`);
        if (data && data.employees) {
            renderTable(data);
        } else {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><h3>Нет данных</h3></div>';
        }
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><h3>Ошибка</h3><p>${err.message}</p></div>`;
    } finally {
        salaryIsLoading = false;
    }
}
function renderTable(data) {
    const container = document.getElementById('salaryTableContainer');
    if (!container) return;
    
    const employees = (data.employees || []).filter(emp => emp.role !== 'director');
    
    if (employees.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><h3>Нет сотрудников</h3><button class="btn-primary" onclick="window.switchToTab('employees')">➕ Добавить</button></div>`;
        return;
    }
    
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
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
    const breakdowns = {}; // 🔥 Для детализации по сотрудникам
    
    employees.forEach(emp => {
        let total = 0;
        let okladTotal = 0, eventTotal = 0, turnoverTotal = 0, bonus35Total = 0, videoTotal = 0, extraTotal = 0;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            if (day) {
                total += day.oklad + day.event + day.turnover + day.bonus35 + day.video + (day.extra_motivation || 0);
                okladTotal += day.oklad;
                eventTotal += day.event;
                turnoverTotal += day.turnover;
                bonus35Total += day.bonus35;
                videoTotal += day.video;
                extraTotal += (day.extra_motivation || 0);
            }
        }
        totals[emp.id] = total;
        breakdowns[emp.id] = { oklad: okladTotal, event: eventTotal, turnover: turnoverTotal, bonus35: bonus35Total, video: videoTotal, extra: extraTotal, total };
    });
    
    monthlyTotalsCache = breakdowns;
    
    let dayHeaders = '';
    for (let d = 1; d <= daysInMonth; d++) {
        dayHeaders += `<th style="min-width: 65px;">${d}</th>`;
    }
    
    let html = `<table class="salary-table"><thead><tr><th style="min-width:180px;">Сотрудник</th>${dayHeaders}<th>ИТОГО</th></tr></thead><tbody>`;
    
    for (const emp of employees) {
        html += `<tr class="salary-employee-row">`;
        html += `<td class="salary-employee-cell"><div class="salary-employee-content"><div class="salary-employee-avatar">${emp.avatar_url ? `<img src="${emp.avatar_url}" style="width:100%;height:100%;object-fit:cover;">` : (emp.avatar || '👤')}</div><div><div class="salary-employee-name">${escapeHtml(emp.name)}</div><div class="salary-employee-role">${roleNames[emp.role] || 'Оператор'}</div></div></div></td>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            const total = day ? (day.oklad + day.event + day.turnover + day.bonus35 + day.video + (day.extra_motivation || 0)) : 0;
            html += `<td class="day-cell ${total > 0 ? 'filled' : 'empty'}" onclick="openDayModal(${emp.id}, ${d}, '${escapeHtml(emp.name)}')">${total > 0 ? total.toLocaleString() + ' ₽' : '—'}</td>`;
        }
        
        // 🔥 ИТОГО — КЛИКАБЕЛЬНО для детализации
        html += `<td class="salary-total-cell" onclick="showMonthlyBreakdown(${emp.id}, '${escapeHtml(emp.name)}')">${(totals[emp.id] || 0).toLocaleString()} ₽</td></tr>`;
        html += `<tr class="salary-separator"><td colspan="${daysInMonth + 2}"><div class="separator-line"></div></td></tr>`;
    }
    
    html += `</tbody></table><div style="height:24px;"></div>`;
    container.innerHTML = html;
}

// 🔥 НОВОЕ: Детализация итога за месяц
function showMonthlyBreakdown(employeeId, employeeName) {
    const breakdown = monthlyTotalsCache[employeeId];
    if (!breakdown) {
        showNotif('Нет данных для отображения', 'warning');
        return;
    }
    
    const modalHtml = `
        <div id="monthlyBreakdownModal" class="modal active">
            <div class="modal-window" style="max-width: 500px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>📊 Детализация за ${MONTHS[currentMonth - 1]} ${currentYear}</h3>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">${escapeHtml(employeeName)}</p>
                </div>
                <div style="padding: 20px;">
                    <div class="breakdown-item">
                        <span>💰 Оклад</span>
                        <strong>${breakdown.oklad.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-item">
                        <span>🎉 Мероприятия</span>
                        <strong>${breakdown.event.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-item">
                        <span>📈 Премия с оборота</span>
                        <strong>${breakdown.turnover.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-item">
                        <span>🏆 Премия за 35 тыс.</span>
                        <strong>${breakdown.bonus35.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-item">
                        <span>📹 Ролик/Отзыв</span>
                        <strong>${breakdown.video.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-item">
                        <span>🎁 Доп. мотивация</span>
                        <strong>${breakdown.extra.toLocaleString()} ₽</strong>
                    </div>
                    <div class="breakdown-total">
                        <span>ИТОГО</span>
                        <strong>${breakdown.total.toLocaleString()} ₽</strong>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-secondary" onclick="closeMonthlyBreakdownModal()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeMonthlyBreakdownModal() {
    const modal = document.getElementById('monthlyBreakdownModal');
    if (modal) modal.remove();
}

function openDayModal(employeeId, dayNumber, employeeName) {
    currentEmployeeId = employeeId;
    currentDayNumber = dayNumber;
    
    const date = new Date(currentYear, currentMonth - 1, dayNumber);
    document.getElementById('modalDate').textContent = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('modalEmployee').innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(employeeName)}`;
    
    const footer = document.getElementById('modalFooter');
    if (footer) footer.style.display = isDirector ? 'flex' : 'none';
    
    const inputs = ['salaryOklad', 'salaryEvent', 'salaryTurnover', 'salaryBonus35', 'salaryVideo', 'salaryExtraMotivation'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.disabled = !isDirector;
            input.addEventListener('input', () => updateDayTotal());
        }
    });
    
    loadDayData(employeeId, dayNumber);
    document.getElementById('dayModal').classList.add('active');
}

async function loadDayData(employeeId, dayNumber) {
    try {
        const data = await apiCall(`/salary/day?employee_id=${employeeId}&day=${dayNumber}&month=${currentMonth}&year=${currentYear}`);
        
        document.getElementById('salaryOklad').value = data?.oklad || 0;
        document.getElementById('salaryEvent').value = data?.event || 0;
        document.getElementById('salaryTurnover').value = data?.turnover || 0;
        document.getElementById('salaryBonus35').value = data?.bonus35 || 0;
        document.getElementById('salaryVideo').value = data?.video || 0;
        document.getElementById('salaryExtraMotivation').value = data?.extra_motivation || 0;
        
        updateDayTotal();
    } catch (err) {
        console.error(err);
        document.getElementById('salaryOklad').value = 0;
        document.getElementById('salaryEvent').value = 0;
        document.getElementById('salaryTurnover').value = 0;
        document.getElementById('salaryBonus35').value = 0;
        document.getElementById('salaryVideo').value = 0;
        document.getElementById('salaryExtraMotivation').value = 0;
        updateDayTotal();
    }
}

function clearCurrentDay() {
    if (!isDirector) return;
    document.getElementById('salaryOklad').value = 0;
    document.getElementById('salaryEvent').value = 0;
    document.getElementById('salaryTurnover').value = 0;
    document.getElementById('salaryBonus35').value = 0;
    document.getElementById('salaryVideo').value = 0;
    document.getElementById('salaryExtraMotivation').value = 0;
    updateDayTotal();
    showNotif('🧹 Поля очищены', 'info');
}

async function saveCurrentDay() {
    if (!isDirector) return;
    
    const data = {
        employee_id: currentEmployeeId,
        day_number: currentDayNumber,
        month: currentMonth,
        year: currentYear,
        oklad: parseFloat(document.getElementById('salaryOklad').value) || 0,
        event: parseFloat(document.getElementById('salaryEvent').value) || 0,
        turnover: parseFloat(document.getElementById('salaryTurnover').value) || 0,
        bonus35: parseFloat(document.getElementById('salaryBonus35').value) || 0,
        video: parseFloat(document.getElementById('salaryVideo').value) || 0,
        extra_motivation: parseFloat(document.getElementById('salaryExtraMotivation').value) || 0
    };
    
    const saveBtn = document.querySelector('#dayModal .btn-save');
    const originalText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        saveBtn.disabled = true;
    }
    
    try {
        const response = await apiCall('/salary/day/save', 'POST', data);
        if (response?.success) {
            showNotif('✅ Сохранено', 'success');
            closeDayModal();
            loadSalaryData();
            // 🔥 Обновляем фонд если изменился
            loadFundForSalary();
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        showNotif('❌ Ошибка соединения', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }
}

function closeDayModal() {
    document.getElementById('dayModal').classList.remove('active');
    currentEmployeeId = null;
    currentDayNumber = null;
}

function exportSalaryToExcel() {
    showNotif('📊 Экспорт в разработке', 'info');
}

// 🔥 ДОБАВЛЕНО: getTobolskNow если не определена глобально
function getTobolskNow() {
    if (typeof window.getTobolskNow === 'function') {
        return window.getTobolskNow();
    }
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initSalary = initSalary;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.openDayModal = openDayModal;
window.closeDayModal = closeDayModal;
window.saveCurrentDay = saveCurrentDay;
window.clearCurrentDay = clearCurrentDay;
window.exportSalaryToExcel = exportSalaryToExcel;
window.loadFundForSalary = loadFundForSalary;
window.showMonthlyBreakdown = showMonthlyBreakdown;
window.closeMonthlyBreakdownModal = closeMonthlyBreakdownModal;