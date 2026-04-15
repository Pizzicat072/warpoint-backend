// public/js/salary.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ

let currentEmployeeId = null;
let currentDayNumber = null;
let currentYear = 2026;
let currentMonth = 3;
let isDirector = false;
let salaryIsLoading = false;

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
    
    const now = new Date();
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

function updateDayTotal() {
    const oklad = parseFloat(document.getElementById('salaryOklad')?.value) || 0;
    const event = parseFloat(document.getElementById('salaryEvent')?.value) || 0;
    const turnover = parseFloat(document.getElementById('salaryTurnover')?.value) || 0;
    const bonus35 = parseFloat(document.getElementById('salaryBonus35')?.value) || 0;
    const video = parseFloat(document.getElementById('salaryVideo')?.value) || 0;
    const total = oklad + event + turnover + bonus35 + video;
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
            video: item.video || 0
        };
    });
    
    const totals = {};
    employees.forEach(emp => {
        let total = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const day = dataMap[`${emp.id}_${d}`];
            if (day) total += day.oklad + day.event + day.turnover + day.bonus35 + day.video;
        }
        totals[emp.id] = total;
    });
    
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
            const total = day ? (day.oklad + day.event + day.turnover + day.bonus35 + day.video) : 0;
            html += `<td class="day-cell ${total > 0 ? 'filled' : 'empty'}" onclick="openDayModal(${emp.id}, ${d}, '${escapeHtml(emp.name)}')">${total > 0 ? total.toLocaleString() + ' ₽' : '—'}</td>`;
        }
        
        html += `<td class="salary-total-cell">${(totals[emp.id] || 0).toLocaleString()} ₽</td></tr>`;
        html += `<tr class="salary-separator"><td colspan="${daysInMonth + 2}"><div class="separator-line"></div></td></tr>`;
    }
    
    html += `</tbody></table><div style="height:24px;"></div>`;
    container.innerHTML = html;
}

function openDayModal(employeeId, dayNumber, employeeName) {
    currentEmployeeId = employeeId;
    currentDayNumber = dayNumber;
    
    const date = new Date(currentYear, currentMonth - 1, dayNumber);
    document.getElementById('modalDate').textContent = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('modalEmployee').innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(employeeName)}`;
    
    const footer = document.getElementById('modalFooter');
    if (footer) footer.style.display = isDirector ? 'flex' : 'none';
    
    const inputs = ['salaryOklad', 'salaryEvent', 'salaryTurnover', 'salaryBonus35', 'salaryVideo'];
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
        
        updateDayTotal();
    } catch (err) {
        console.error(err);
        document.getElementById('salaryOklad').value = 0;
        document.getElementById('salaryEvent').value = 0;
        document.getElementById('salaryTurnover').value = 0;
        document.getElementById('salaryBonus35').value = 0;
        document.getElementById('salaryVideo').value = 0;
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
        video: parseFloat(document.getElementById('salaryVideo').value) || 0
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