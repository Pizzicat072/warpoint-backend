// public/js/schedule.js - БЕЗ ЗВУКОВ

let currentScheduleMonth = new Date().getMonth();
let currentScheduleYear = new Date().getFullYear();
let currentScheduleData = {};
let isSavingShift = false;
let specialCases = {};

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadScheduleData() {
    console.log('🔄 Загрузка данных графика с сервера...');
    
    try {
        const response = await apiCall('/schedule?_=' + Date.now());
        
        if (response && Array.isArray(response)) {
            currentScheduleData = {};
            window.app.schedule = {};
            
            for (const item of response) {
                const dateStr = item.date;
                if (!currentScheduleData[dateStr]) {
                    currentScheduleData[dateStr] = {};
                }
                currentScheduleData[dateStr][item.employee] = {
                    time: item.shift_time,
                    status: item.shift_status,
                    is_special: item.is_special,
                    special_end_time: item.special_end_time
                };
            }
            window.app.schedule = currentScheduleData;
            console.log(`✅ Загружено ${response.length} записей графика`);
            renderMonthSchedule();
        }
    } catch (err) {
        console.error('❌ Ошибка загрузки графика:', err);
    }
}

function initSchedule() {
    console.log('📅 Инициализация графика');
    loadSpecialCases();
    loadScheduleData();
}

// ============================================
// ОСОБЫЕ СЛУЧАИ
// ============================================

async function loadSpecialCases() {
    try {
        const response = await apiCall('/schedule/special-cases');
        if (response && response.success) {
            specialCases = response.data || {};
        }
    } catch (err) {
        console.error('Ошибка загрузки особых случаев:', err);
        specialCases = {};
    }
}

function hasSpecialCases(date) {
    const cases = specialCases[date];
    if (!cases) return false;
    return !!(cases.allowThreeOperators || (cases.earlyLeave && cases.earlyLeave.length > 0) || (cases.replacements && cases.replacements.length > 0));
}

function getSpecialCasesDescription(date) {
    const cases = specialCases[date];
    if (!cases) return null;
    
    const descriptions = [];
    if (cases.allowThreeOperators) descriptions.push('• Разрешено 3 оператора');
    if (cases.earlyLeave && cases.earlyLeave.length > 0) {
        cases.earlyLeave.forEach(el => {
            descriptions.push(`• ${el.employee} уходит в ${el.time}`);
        });
    }
    if (cases.replacements && cases.replacements.length > 0) {
        cases.replacements.forEach(r => {
            descriptions.push(`• Замена: ${r.from} → ${r.to}`);
        });
    }
    return descriptions;
}

// ============================================
// ПРОВЕРКА ЛИМИТА ОПЕРАТОРОВ
// ============================================

async function checkOperatorsLimit(date, time, excludeEmployee = null) {
    const schedule = window.app.schedule[date] || {};
    let operatorsOnShift = 0;
    
    for (const [emp, shift] of Object.entries(schedule)) {
        if (excludeEmployee && emp === excludeEmployee) continue;
        const profile = window.app.profiles[emp];
        if (profile && profile.role === 'operator' && shift.time === time && shift.status === 'working') {
            operatorsOnShift++;
        }
    }
    
    return operatorsOnShift < 2;
}

// ============================================
// ОТРИСОВКА КАЛЕНДАРЯ
// ============================================

function getWeeksInMonth() {
    const firstDay = new Date(currentScheduleYear, currentScheduleMonth, 1);
    const lastDay = new Date(currentScheduleYear, currentScheduleMonth + 1, 0);
    
    const firstMonday = new Date(firstDay);
    const dayOfWeek = firstDay.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    firstMonday.setDate(firstDay.getDate() - daysToMonday);
    
    const weeks = [];
    let currentStart = new Date(firstMonday);
    
    while (currentStart <= lastDay) {
        const week = { days: [] };
        for (let i = 0; i < 7; i++) {
            const day = new Date(currentStart);
            day.setDate(currentStart.getDate() + i);
            
            const year = day.getFullYear();
            const month = String(day.getMonth() + 1).padStart(2, '0');
            const dayNum = String(day.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${dayNum}`;
            
            week.days.push({
                date: day,
                dateStr: dateStr,
                dayNum: day.getDate(),
                month: day.getMonth(),
                isCurrentMonth: day.getMonth() === currentScheduleMonth
            });
        }
        weeks.push(week);
        currentStart.setDate(currentStart.getDate() + 7);
    }
    return weeks;
}

function formatMonthYear() {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${months[currentScheduleMonth]} ${currentScheduleYear}`;
}

function changeMonth(delta) {
    currentScheduleMonth += delta;
    if (currentScheduleMonth < 0) {
        currentScheduleMonth = 11;
        currentScheduleYear--;
    }
    if (currentScheduleMonth > 11) {
        currentScheduleMonth = 0;
        currentScheduleYear++;
    }
    renderMonthSchedule();
}

function resetMonthSchedule() {
    currentScheduleMonth = new Date().getMonth();
    currentScheduleYear = new Date().getFullYear();
    renderMonthSchedule();
}

function getWeekdayName(dayIndex) {
    const names = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
    return names[dayIndex];
}

function isWeekendOrFriday(dayIndex) {
    return dayIndex === 4 || dayIndex === 5 || dayIndex === 6;
}

function getStatusText(status) {
    const statusMap = {
        'working': '✅ Работает',
        'sick': '🤒 Болен',
        'vacation': '🏖️ Отпуск',
        'dayoff': '🏠 Выходной',
        'study': '📚 Учёба'
    };
    return statusMap[status] || status;
}

function formatDateSimple(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    const day = parseInt(parts[2]);
    const month = parseInt(parts[1]);
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${day} ${monthNames[month - 1]}`;
}

function getAvatarHtmlForSchedule(profile) {
    if (!profile) return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">👤</div>';
    
    if (profile.avatar_url && profile.avatar_url.startsWith('data:image')) {
        return `<img src="${profile.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.onerror=null; this.parentElement.innerHTML='👤'">`;
    } else if (profile.avatar) {
        return `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">${escapeHtml(profile.avatar)}</div>`;
    } else {
        return `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">👤</div>`;
    }
}

function renderMonthSchedule() {
    const container = document.getElementById('scheduleWeeksContainer');
    if (!container) return;
    
    document.getElementById('currentMonthYear').textContent = formatMonthYear();
    
    const weeks = getWeeksInMonth();
    const currentUser = window.app.currentUser;
    const isDirector = window.app.currentUserRole === 'director';
    
    const employees = window.app.employees.filter(emp => {
        const profile = window.app.profiles[emp];
        return profile && profile.role !== 'director';
    }).sort((a, b) => {
        const profileA = window.app.profiles[a];
        const profileB = window.app.profiles[b];
        const roleOrder = { 'admin': 1, 'operator': 2, 'manager': 3 };
        const orderA = roleOrder[profileA?.role] || 99;
        const orderB = roleOrder[profileB?.role] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (profileA?.name || a).localeCompare(profileB?.name || b);
    });
    
    if (weeks.length === 0) {
        container.innerHTML = '<div class="empty-state">Нет данных</div>';
        return;
    }
    
    let html = '';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    for (let w = 0; w < weeks.length; w++) {
        const week = weeks[w];
        
        html += `<div class="week-schedule-card">
            <div class="week-header"></div>`;
        
        html += `<div class="week-days">
            <div class="day-header employee-header-cell">👥 Сотрудник</div>`;
        
        for (let i = 0; i < 7; i++) {
            const day = week.days[i];
            const isSpecialDay = isWeekendOrFriday(i);
            const isToday = day.dateStr === today;
            const showDayNumber = day.isCurrentMonth;
            const hasSpecial = showDayNumber && hasSpecialCases(day.dateStr);
            
            html += `<div class="day-header ${isSpecialDay ? 'weekend-bg' : ''}" style="${isToday ? 'background: rgba(99,102,241,0.3);' : ''}" 
                           onclick="${isDirector && showDayNumber ? `openMassEditor('${day.dateStr}')` : ''}"
                           title="${hasSpecial ? getSpecialCasesDescription(day.dateStr)?.join('\n') || 'Особый случай' : ''}">
                <div>${getWeekdayName(i)}</div>
                ${showDayNumber ? `<div class="day-number">${day.dayNum}${hasSpecial ? ' ⚡' : ''}</div>` : '<div class="day-number empty-day"></div>'}
            </div>`;
        }
        html += `</div>`;
        
        for (const emp of employees) {
            const profile = window.app.profiles[emp];
            if (!profile) continue;
            
            const isCurrentUser = emp === currentUser;
            const avatarHtml = getAvatarHtmlForSchedule(profile);
            
            html += `<div class="week-row ${isCurrentUser ? 'current-user-row' : ''}">
                <div class="employee-name-cell" onclick="openProfile('${escapeHtml(emp)}')">
                    <div class="employee-avatar-small">${avatarHtml}</div>
                    <span>${escapeHtml(profile.name || emp)}</span>
                </div>`;
            
            for (let i = 0; i < 7; i++) {
                const day = week.days[i];
                const dateStr = day.dateStr;
                const shiftData = currentScheduleData[dateStr]?.[emp] || { time: '', status: 'working', is_special: false };
                const isCurrentMonth = day.isCurrentMonth;
                const isSpecialDay = isWeekendOrFriday(i);
                
                let displayText = '';
                let statusClass = '';
                let additionalClass = '';
                
                if (!isCurrentMonth) {
                    displayText = '';
                    statusClass = 'shift-empty hidden-day';
                } else if (shiftData.status !== 'working' && shiftData.status) {
                    displayText = getStatusText(shiftData.status);
                    statusClass = `status-${shiftData.status}`;
                } else if (shiftData.time) {
                    let timeDisplay = shiftData.time;
                    
                    if (shiftData.is_special && shiftData.special_end_time && shiftData.special_end_time.startsWith('exchange_')) {
                        timeDisplay = '🔄 ' + shiftData.time;
                        additionalClass += ' exchanged-shift';
                    }
                    
                    displayText = timeDisplay;
                    statusClass = 'shift-time';
                    if (emp === currentUser) {
                        additionalClass += ' my-shift';
                    }
                    if (shiftData.is_special) {
                        additionalClass += ' special-shift';
                    }
                } else {
                    displayText = '—';
                    statusClass = 'shift-empty';
                }
                
                let onclickAttr = '';
                if (isCurrentMonth) {
                    if (isDirector) {
                        onclickAttr = `onclick="openShiftModalForEmployee('${dateStr}', '${escapeHtml(emp)}')"`;
                    } else if (emp === currentUser) {
                        onclickAttr = `onclick="openShiftModalForEmployee('${dateStr}', '${escapeHtml(emp)}')"`;
                    } else {
                        onclickAttr = `onclick="openExchangeModal('${dateStr}', '${escapeHtml(emp)}', '${shiftData.time || ''}')"`;
                    }
                }
                
                html += `<div class="shift-cell ${isSpecialDay ? 'weekend-bg' : ''} ${additionalClass}" 
                    ${onclickAttr}
                    style="${!isCurrentMonth ? 'opacity: 0.3; cursor: default;' : 'cursor: pointer;'}">
                    <div class="shift-display ${statusClass}">${displayText}</div>
                </div>`;
            }
            html += `</div>`;
        }
        html += `</div>`;
    }
    
    container.innerHTML = html;
}

// ============================================
// РЕДАКТОР СМЕНЫ
// ============================================

function openShiftModalForEmployee(dateStr, employee) {
    const shiftData = currentScheduleData[dateStr]?.[employee] || { time: '', status: 'working', is_special: false };
    const profile = window.app.profiles[employee];
    const formattedDate = formatDateSimple(dateStr);
    const isAdmin = profile?.role === 'admin';
    const isDirector = window.app.currentUserRole === 'director';
    
    const daySpecial = specialCases[dateStr];
    let employeeEarlyLeave = null;
    if (daySpecial && daySpecial.earlyLeave) {
        employeeEarlyLeave = daySpecial.earlyLeave.find(el => el.employee === employee);
    }
    
    const isExchanged = shiftData.is_special && shiftData.special_end_time && shiftData.special_end_time.startsWith('exchange_');
    const exchangeInfo = isExchanged ? `🔄 Получена в результате обмена с ${shiftData.special_end_time.replace('exchange_', '').replace('_to_', ' → ')}` : '';
    
    const modalHtml = `
        <div id="shiftModal" class="modal active">
            <div class="modal-window-glass">
                <div class="glass-header">
                    <div class="glass-header-left">
                        <div class="glass-icon">
                            <i class="fas fa-calendar-alt"></i>
                        </div>
                        <div>
                            <h3 class="glass-title">Редактирование смены</h3>
                            <p class="glass-subtitle">${formattedDate} · ${escapeHtml(employee)}</p>
                        </div>
                    </div>
                    <button class="glass-close" onclick="closeShiftModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="glass-body">
                    <input type="hidden" id="shiftDate" value="${dateStr}">
                    <input type="hidden" id="shiftEmployee" value="${escapeHtml(employee)}">
                    
                    ${employeeEarlyLeave ? `
                        <div class="glass-special-notice">
                            <i class="fas fa-bolt"></i>
                            <span>⚡ Особый случай: сотрудник уходит в ${employeeEarlyLeave.time}</span>
                        </div>
                    ` : ''}
                    
                    ${isExchanged ? `
                        <div class="glass-exchange-notice">
                            <i class="fas fa-exchange-alt"></i>
                            <span>${exchangeInfo}</span>
                        </div>
                    ` : ''}
                    
                    <div class="glass-field">
                        <label class="glass-label">
                            <i class="fas fa-clock"></i> Время начала смены
                        </label>
                        ${isAdmin && !isDirector ? `
                            <div class="glass-locked-field">
                                <input type="text" class="glass-input" value="10:00" disabled>
                                <span class="glass-lock-icon">🔒</span>
                            </div>
                            <div class="glass-hint">Администратор работает с 10:00</div>
                        ` : `
                            <select id="shiftTime" class="glass-select">
                                <option value="10:00" ${shiftData.time === '10:00' ? 'selected' : ''}>10:00</option>
                                <option value="11:00" ${shiftData.time === '11:00' ? 'selected' : ''}>11:00</option>
                                <option value="12:00" ${shiftData.time === '12:00' ? 'selected' : ''}>12:00</option>
                                <option value="13:00" ${shiftData.time === '13:00' ? 'selected' : ''}>13:00</option>
                                <option value="14:00" ${shiftData.time === '14:00' ? 'selected' : ''}>14:00</option>
                                <option value="15:00" ${shiftData.time === '15:00' ? 'selected' : ''}>15:00</option>
                                <option value="16:00" ${shiftData.time === '16:00' ? 'selected' : ''}>16:00</option>
                                <option value="17:00" ${shiftData.time === '17:00' ? 'selected' : ''}>17:00</option>
                                <option value="18:00" ${shiftData.time === '18:00' ? 'selected' : ''}>18:00</option>
                                <option value="19:00" ${shiftData.time === '19:00' ? 'selected' : ''}>19:00</option>
                                <option value="20:00" ${shiftData.time === '20:00' ? 'selected' : ''}>20:00</option>
                                <option value="21:00" ${shiftData.time === '21:00' ? 'selected' : ''}>21:00</option>
                            </select>
                        `}
                    </div>
                    
                    <div class="glass-field">
                        <label class="glass-label">
                            <i class="fas fa-user-md"></i> Статус
                        </label>
                        <select id="shiftStatus" class="glass-select">
                            <option value="working" ${shiftData.status === 'working' ? 'selected' : ''}>✅ Работает</option>
                            <option value="dayoff" ${shiftData.status === 'dayoff' ? 'selected' : ''}>🏠 Выходной</option>
                            <option value="sick" ${shiftData.status === 'sick' ? 'selected' : ''}>🤒 Болен</option>
                            <option value="vacation" ${shiftData.status === 'vacation' ? 'selected' : ''}>🏖️ Отпуск</option>
                            <option value="study" ${shiftData.status === 'study' ? 'selected' : ''}>📚 Учёба</option>
                        </select>
                    </div>
                    
                    <div style="display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap;">
                        ${employee === window.app.currentUser ? `
                            <button id="deleteMyShiftBtn" class="glass-btn glass-btn-danger" onclick="deleteMyShift()">
                                <i class="fas fa-trash-alt"></i> Удалить мою смену
                            </button>
                        ` : ''}
                        <button id="shiftSaveBtn" class="glass-btn glass-btn-primary" onclick="saveShift()">
                            <i class="fas fa-save"></i> Сохранить
                        </button>
                        <button class="glass-btn glass-btn-secondary" onclick="closeShiftModal()">
                            <i class="fas fa-times"></i> Отмена
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// ============================================
// УДАЛЕНИЕ СВОЕЙ СМЕНЫ
// ============================================

async function deleteMyShift() {
    const date = document.getElementById('shiftDate')?.value;
    const employee = document.getElementById('shiftEmployee')?.value;
    
    if (!date || !employee) {
        showNotif('Ошибка: не удалось удалить смену', 'error');
        return;
    }
    
    if (employee !== window.app.currentUser) {
        showNotif('❌ Нельзя удалить чужую смену', 'error');
        return;
    }
    
    const formattedDate = formatDateSimple(date);
    if (!confirm(`🗑️ Удалить свою смену на ${formattedDate}?`)) return;
    
    const deleteBtn = document.getElementById('deleteMyShiftBtn');
    const originalText = deleteBtn ? deleteBtn.innerHTML : 'Удалить';
    if (deleteBtn) {
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Удаление...';
        deleteBtn.disabled = true;
    }
    
    try {
        const response = await apiCall('/schedule/shift', 'DELETE', { date, employee });
        
        if (response && response.success) {
            if (currentScheduleData[date]) {
                delete currentScheduleData[date][employee];
                if (Object.keys(currentScheduleData[date]).length === 0) {
                    delete currentScheduleData[date];
                }
            }
            if (window.app.schedule[date]) {
                delete window.app.schedule[date][employee];
                if (Object.keys(window.app.schedule[date]).length === 0) {
                    delete window.app.schedule[date];
                }
            }
            
            renderMonthSchedule();
            if (typeof renderEmployees === 'function') renderEmployees();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
            
            showNotif('✅ Смена удалена', 'success');
            closeShiftModal();
        } else {
            showNotif('❌ Ошибка при удалении', 'error');
        }
    } catch (err) {
        console.error('Ошибка удаления:', err);
        showNotif('❌ Ошибка соединения', 'error');
    } finally {
        if (deleteBtn) {
            deleteBtn.innerHTML = originalText;
            deleteBtn.disabled = false;
        }
    }
}

// ============================================
// СОХРАНЕНИЕ СМЕНЫ
// ============================================

async function saveShift() {
    if (isSavingShift) return;
    isSavingShift = true;
    
    const saveBtn = document.getElementById('shiftSaveBtn');
    const originalText = saveBtn ? saveBtn.innerHTML : 'Сохранить';
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        saveBtn.disabled = true;
    }
    
    try {
        const date = document.getElementById('shiftDate')?.value;
        const employee = document.getElementById('shiftEmployee')?.value;
        const status = document.getElementById('shiftStatus')?.value;
        let time = document.getElementById('shiftTime')?.value;
        
        if (!date || !employee) {
            showNotif('Ошибка: не удалось сохранить смену', 'error');
            return;
        }
        
        const profile = window.app.profiles[employee];
        const isAdmin = profile?.role === 'admin';
        const isDirector = window.app.currentUserRole === 'director';
        
        if (isAdmin && !isDirector && time && time !== '') {
            time = '10:00';
        }
        
        const shiftTime = time || null;
        
        if (status === 'working' && shiftTime && profile?.role === 'operator') {
            const daySpecial = specialCases[date];
            const allowThree = daySpecial?.allowThreeOperators || false;
            const isLimitOk = await checkOperatorsLimit(date, shiftTime, employee);
            
            if (!isLimitOk && !allowThree && !isDirector) {
                showNotif('❌ Нельзя! В этой смене уже 2 оператора.', 'error');
                return;
            }
        }
        
        const response = await apiCall('/schedule/shift', 'POST', {
            date: date,
            employee: employee,
            shift_time: shiftTime,
            shift_status: status,
            is_special: false,
            special_end_time: null
        });
        
        if (response && response.success) {
            if (!currentScheduleData[date]) currentScheduleData[date] = {};
            currentScheduleData[date][employee] = {
                time: shiftTime,
                status: status,
                is_special: false,
                special_end_time: null
            };
            
            if (!window.app.schedule[date]) window.app.schedule[date] = {};
            window.app.schedule[date][employee] = {
                time: shiftTime,
                status: status,
                is_special: false,
                special_end_time: null
            };
            
            renderMonthSchedule();
            if (typeof renderEmployees === 'function') renderEmployees();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
            
            showNotif('✅ Смена сохранена', 'success');
            closeShiftModal();
        } else {
            showNotif('❌ Ошибка при сохранении', 'error');
        }
    } finally {
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
        isSavingShift = false;
    }
}

async function deleteShift() {
    const date = document.getElementById('shiftDate')?.value;
    const employee = document.getElementById('shiftEmployee')?.value;
    
    if (!date || !employee) {
        showNotif('Ошибка: не удалось удалить смену', 'error');
        return;
    }
    
    if (!confirm(`Удалить смену для ${employee} на ${formatDateSimple(date)}?`)) return;
    
    try {
        const response = await apiCall('/schedule/shift', 'DELETE', { date, employee });
        
        if (response && response.success) {
            if (currentScheduleData[date]) {
                delete currentScheduleData[date][employee];
                if (Object.keys(currentScheduleData[date]).length === 0) {
                    delete currentScheduleData[date];
                }
            }
            if (window.app.schedule[date]) {
                delete window.app.schedule[date][employee];
                if (Object.keys(window.app.schedule[date]).length === 0) {
                    delete window.app.schedule[date];
                }
            }
            
            renderMonthSchedule();
            if (typeof renderEmployees === 'function') renderEmployees();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
            
            showNotif('✅ Смена удалена', 'success');
            closeShiftModal();
        } else {
            showNotif('❌ Ошибка при удалении', 'error');
        }
    } catch (err) {
        console.error('Ошибка удаления:', err);
        showNotif('❌ Ошибка при удалении', 'error');
    }
}

function closeShiftModal() {
    const modal = document.getElementById('shiftModal');
    if (modal) modal.remove();
}

// ============================================
// ОБМЕН СМЕНАМИ
// ============================================

function openExchangeModal(dateStr, employee, shiftTime) {
    const formattedDate = formatDateSimple(dateStr);
    
    const modalHtml = `
        <div id="exchangeModal" class="modal active">
            <div class="modal-window-glass" style="max-width: 500px;">
                <div class="glass-header">
                    <div class="glass-header-left">
                        <div class="glass-icon">
                            <i class="fas fa-exchange-alt"></i>
                        </div>
                        <div>
                            <h3 class="glass-title">Предложение обмена сменами</h3>
                            <p class="glass-subtitle">${formattedDate} · ${escapeHtml(employee)}</p>
                        </div>
                    </div>
                    <button class="glass-close" onclick="closeExchangeModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="glass-body">
                    <div class="glass-info-card">
                        <div class="glass-info-icon">
                            <i class="fas fa-info-circle"></i>
                        </div>
                        <div class="glass-info-content">
                            <div class="glass-info-title">Смена сотрудника</div>
                            <div class="glass-info-value">${shiftTime ? `${shiftTime}` : 'Смена не проставлена'}</div>
                        </div>
                    </div>
                    
                    <div class="glass-field">
                        <label class="glass-label">
                            <i class="fas fa-calendar-alt"></i> Выберите свою смену для обмена
                        </label>
                        <select id="exchangeSelect" class="glass-select">
                            <option value="">Загрузка...</option>
                        </select>
                    </div>
                    
                    <div class="glass-field">
                        <label class="glass-label">
                            <i class="fas fa-comment"></i> Комментарий (необязательно)
                        </label>
                        <textarea id="exchangeComment" class="glass-textarea" rows="2" placeholder="Почему хотите обменяться?"></textarea>
                    </div>
                    
                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="glass-btn glass-btn-primary" onclick="sendExchangeRequest('${dateStr}', '${escapeHtml(employee)}')">
                            <i class="fas fa-paper-plane"></i> Отправить запрос
                        </button>
                        <button class="glass-btn glass-btn-secondary" onclick="closeExchangeModal()">
                            <i class="fas fa-times"></i> Отмена
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    loadExchangeOptions(employee, dateStr);
}

function closeExchangeModal() {
    const modal = document.getElementById('exchangeModal');
    if (modal) modal.remove();
}

async function loadExchangeOptions(employee, targetDate) {
    const select = document.getElementById('exchangeSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">Выберите свою смену для обмена</option>';
    let hasAvailable = false;
    const currentUser = window.app.currentUser;
    const today = new Date().toISOString().split('T')[0];
    
    for (const [date, shifts] of Object.entries(currentScheduleData)) {
        if (date === targetDate) continue;
        if (date < today) continue;
        
        const myShift = shifts[currentUser];
        if (myShift && myShift.time && myShift.status === 'working') {
            const formattedDate = formatDateSimple(date);
            select.innerHTML += `<option value="${date}|${myShift.time}">${formattedDate} — ${myShift.time}</option>`;
            hasAvailable = true;
        }
    }
    
    if (!hasAvailable) {
        select.innerHTML = '<option value="">😔 Нет доступных смен для обмена</option>';
    }
}

async function sendExchangeRequest(targetDate, targetEmployee) {
    const exchangeValue = document.getElementById('exchangeSelect')?.value;
    const comment = document.getElementById('exchangeComment')?.value;
    
    if (!exchangeValue || exchangeValue.includes('Нет доступных')) {
        showNotif('Выберите свою смену для обмена', 'error');
        return;
    }
    
    const [myDate, myTime] = exchangeValue.split('|');
    
    console.log('Отправка запроса на обмен:', {
        fromEmployee: window.app.currentUser,
        toEmployee: targetEmployee,
        fromDate: myDate,
        toDate: targetDate,
        fromTime: myTime,
        toTime: currentScheduleData[targetDate]?.[targetEmployee]?.time || null
    });
    
    const response = await apiCall('/exchange/create', 'POST', {
        toEmployee: targetEmployee,
        toDate: targetDate,
        toShiftTime: currentScheduleData[targetDate]?.[targetEmployee]?.time || null,
        fromDate: myDate,
        fromShiftTime: myTime,
        comment: comment
    });
    
    if (response && response.success) {
        showNotif(`📩 Запрос на обмен отправлен ${targetEmployee}`, 'success');
        closeExchangeModal();
        
        if (typeof loadPendingExchanges === 'function') {
            loadPendingExchanges();
        }
        if (typeof loadMyActiveExchanges === 'function') {
            loadMyActiveExchanges();
        }
    } else {
        showNotif(response?.error || 'Ошибка при отправке запроса', 'error');
    }
}

// ============================================
// МАССОВЫЙ РЕДАКТОР
// ============================================

function openMassEditor(dateStr) {
    const employees = window.app.employees.filter(emp => {
        const profile = window.app.profiles[emp];
        return profile && profile.role !== 'director';
    });
    
    const formattedDate = formatDateSimple(dateStr);
    const daySpecial = specialCases[dateStr] || {};
    
    let employeesHtml = '';
    for (const emp of employees) {
        const profile = window.app.profiles[emp];
        const shiftData = currentScheduleData[dateStr]?.[emp] || { time: '', status: 'working' };
        const isAdmin = profile?.role === 'admin';
        
        employeesHtml += `
            <div class="mass-editor-row">
                <div class="mass-editor-employee">
                    <div class="mass-editor-avatar">${getAvatarHtmlForSchedule(profile)}</div>
                    <div class="mass-editor-name">${escapeHtml(emp)}</div>
                    <div class="mass-editor-role ${isAdmin ? 'admin' : 'operator'}">${isAdmin ? 'Админ' : 'Оператор'}</div>
                </div>
                <div class="mass-editor-time">
                    ${isAdmin ? `
                        <div class="glass-locked-field">
                            <input type="text" class="glass-input" value="10:00" disabled style="width: 100px;">
                            <span class="glass-lock-icon">🔒</span>
                        </div>
                    ` : `
                        <select class="mass-editor-time-select" data-employee="${escapeHtml(emp)}">
                            <option value="10:00" ${shiftData.time === '10:00' ? 'selected' : ''}>10:00</option>
                            <option value="11:00" ${shiftData.time === '11:00' ? 'selected' : ''}>11:00</option>
                            <option value="12:00" ${shiftData.time === '12:00' ? 'selected' : ''}>12:00</option>
                            <option value="13:00" ${shiftData.time === '13:00' ? 'selected' : ''}>13:00</option>
                            <option value="14:00" ${shiftData.time === '14:00' ? 'selected' : ''}>14:00</option>
                            <option value="15:00" ${shiftData.time === '15:00' ? 'selected' : ''}>15:00</option>
                            <option value="16:00" ${shiftData.time === '16:00' ? 'selected' : ''}>16:00</option>
                            <option value="17:00" ${shiftData.time === '17:00' ? 'selected' : ''}>17:00</option>
                            <option value="18:00" ${shiftData.time === '18:00' ? 'selected' : ''}>18:00</option>
                            <option value="19:00" ${shiftData.time === '19:00' ? 'selected' : ''}>19:00</option>
                            <option value="20:00" ${shiftData.time === '20:00' ? 'selected' : ''}>20:00</option>
                            <option value="21:00" ${shiftData.time === '21:00' ? 'selected' : ''}>21:00</option>
                        </select>
                    `}
                </div>
                <div class="mass-editor-status">
                    <select class="mass-editor-status-select" data-employee="${escapeHtml(emp)}">
                        <option value="working" ${shiftData.status === 'working' ? 'selected' : ''}>✅ Работает</option>
                        <option value="dayoff" ${shiftData.status === 'dayoff' ? 'selected' : ''}>🏠 Выходной</option>
                        <option value="sick" ${shiftData.status === 'sick' ? 'selected' : ''}>🤒 Болен</option>
                        <option value="vacation" ${shiftData.status === 'vacation' ? 'selected' : ''}>🏖️ Отпуск</option>
                        <option value="study" ${shiftData.status === 'study' ? 'selected' : ''}>📚 Учёба</option>
                    </select>
                </div>
            </div>
        `;
    }
    
    let earlyLeavesHtml = '';
    if (daySpecial.earlyLeave && daySpecial.earlyLeave.length > 0) {
        earlyLeavesHtml = daySpecial.earlyLeave.map(el => `
            <div class="special-case-row">
                <select class="special-employee" data-type="earlyLeave">
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${el.employee === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <span>уходит в</span>
                <select class="special-time">
                    <option value="18:00" ${el.time === '18:00' ? 'selected' : ''}>18:00</option>
                    <option value="19:00" ${el.time === '19:00' ? 'selected' : ''}>19:00</option>
                    <option value="20:00" ${el.time === '20:00' ? 'selected' : ''}>20:00</option>
                    <option value="21:00" ${el.time === '21:00' ? 'selected' : ''}>21:00</option>
                </select>
                <button class="remove-special-btn" onclick="removeSpecialCase(this, 'earlyLeave', '${dateStr}')">🗑️</button>
            </div>
        `).join('');
    }
    
    let replacementsHtml = '';
    if (daySpecial.replacements && daySpecial.replacements.length > 0) {
        replacementsHtml = daySpecial.replacements.map(r => `
            <div class="special-case-row">
                <select class="special-from" data-type="replacement">
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${r.from === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <span>→</span>
                <select class="special-to">
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${r.to === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <button class="remove-special-btn" onclick="removeSpecialCase(this, 'replacement', '${dateStr}')">🗑️</button>
            </div>
        `).join('');
    }
    
    const modalHtml = `
        <div id="massEditorModal" class="modal active">
            <div class="modal-window-glass" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
                <div class="glass-header">
                    <div class="glass-header-left">
                        <div class="glass-icon">
                            <i class="fas fa-edit"></i>
                        </div>
                        <div>
                            <h3 class="glass-title">Массовый редактор</h3>
                            <p class="glass-subtitle">${formattedDate}</p>
                        </div>
                    </div>
                    <button class="glass-close" onclick="closeMassEditor()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="glass-body">
                    <div class="mass-editor-table">
                        <div class="mass-editor-header">
                            <div>Сотрудник</div>
                            <div>Время начала</div>
                            <div>Статус</div>
                        </div>
                        ${employeesHtml}
                    </div>
                    
                    <div class="special-cases-section">
                        <h4>⚡ Особые случаи</h4>
                        
                        <div class="special-checkbox">
                            <label>
                                <input type="checkbox" id="allowThreeOperators" ${daySpecial.allowThreeOperators ? 'checked' : ''}>
                                <span>Разрешить 3 операторов в смене</span>
                            </label>
                        </div>
                        
                        <div class="special-subsection">
                            <div class="special-subtitle">⏰ Сотрудник уходит раньше:</div>
                            <div id="earlyLeavesContainer">
                                ${earlyLeavesHtml}
                            </div>
                            <button class="add-special-btn" onclick="addEarlyLeaveRow('${dateStr}')">➕ Добавить</button>
                        </div>
                        
                        <div class="special-subsection">
                            <div class="special-subtitle">🔄 Срочная замена:</div>
                            <div id="replacementsContainer">
                                ${replacementsHtml}
                            </div>
                            <button class="add-special-btn" onclick="addReplacementRow('${dateStr}')">➕ Добавить</button>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 12px; margin-top: 24px; justify-content: flex-end;">
                        <button class="glass-btn glass-btn-primary" onclick="saveMassEditor('${dateStr}')">
                            <i class="fas fa-save"></i> Сохранить все
                        </button>
                        <button class="glass-btn glass-btn-secondary" onclick="closeMassEditor()">
                            <i class="fas fa-times"></i> Отмена
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeMassEditor() {
    const modal = document.getElementById('massEditorModal');
    if (modal) modal.remove();
}

function addEarlyLeaveRow(dateStr) {
    const container = document.getElementById('earlyLeavesContainer');
    if (!container) return;
    
    const employees = window.app.employees.filter(emp => {
        const profile = window.app.profiles[emp];
        return profile && profile.role !== 'director';
    });
    
    const rowHtml = `
        <div class="special-case-row">
            <select class="special-employee" data-type="earlyLeave">
                ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
            </select>
            <span>уходит в</span>
            <select class="special-time">
                <option value="18:00">18:00</option>
                <option value="19:00">19:00</option>
                <option value="20:00">20:00</option>
                <option value="21:00">21:00</option>
            </select>
            <button class="remove-special-btn" onclick="removeSpecialCase(this, 'earlyLeave', '${dateStr}')">🗑️</button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHtml);
}

function addReplacementRow(dateStr) {
    const container = document.getElementById('replacementsContainer');
    if (!container) return;
    
    const employees = window.app.employees.filter(emp => {
        const profile = window.app.profiles[emp];
        return profile && profile.role !== 'director';
    });
    
    const rowHtml = `
        <div class="special-case-row">
            <select class="special-from" data-type="replacement">
                ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
            </select>
            <span>→</span>
            <select class="special-to">
                ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
            </select>
            <button class="remove-special-btn" onclick="removeSpecialCase(this, 'replacement', '${dateStr}')">🗑️</button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHtml);
}

function removeSpecialCase(btn, type, dateStr) {
    btn.closest('.special-case-row').remove();
}

async function saveMassEditor(dateStr) {
    const timeSelects = document.querySelectorAll('.mass-editor-time-select');
    const statusSelects = document.querySelectorAll('.mass-editor-status-select');
    
    for (const select of timeSelects) {
        const employee = select.dataset.employee;
        const time = select.value;
        const statusSelect = document.querySelector(`.mass-editor-status-select[data-employee="${employee}"]`);
        const status = statusSelect ? statusSelect.value : 'working';
        
        await apiCall('/schedule/shift', 'POST', {
            date: dateStr,
            employee: employee,
            shift_time: time || null,
            shift_status: status,
            is_special: false,
            special_end_time: null
        });
    }
    
    const allowThreeOperators = document.getElementById('allowThreeOperators')?.checked || false;
    
    const earlyLeaves = [];
    document.querySelectorAll('.special-employee').forEach(select => {
        const employee = select.value;
        const timeSelect = select.closest('.special-case-row').querySelector('.special-time');
        const time = timeSelect ? timeSelect.value : null;
        if (employee && time) {
            earlyLeaves.push({ employee, time });
        }
    });
    
    const replacements = [];
    document.querySelectorAll('.special-from').forEach(select => {
        const from = select.value;
        const toSelect = select.closest('.special-case-row').querySelector('.special-to');
        const to = toSelect ? toSelect.value : null;
        if (from && to && from !== to) {
            replacements.push({ from, to });
        }
    });
    
    const specialCasesData = {
        allowThreeOperators: allowThreeOperators,
        earlyLeave: earlyLeaves,
        replacements: replacements
    };
    
    await apiCall('/schedule/special-cases', 'POST', {
        date: dateStr,
        cases: specialCasesData
    });
    
    specialCases[dateStr] = specialCasesData;
    
    showNotif('✅ Все изменения сохранены', 'success');
    closeMassEditor();
    await loadScheduleData();
    renderMonthSchedule();
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initSchedule = initSchedule;
window.changeMonth = changeMonth;
window.resetMonthSchedule = resetMonthSchedule;
window.openShiftModalForEmployee = openShiftModalForEmployee;
window.saveShift = saveShift;
window.deleteShift = deleteShift;
window.deleteMyShift = deleteMyShift;
window.closeShiftModal = closeShiftModal;
window.openMassEditor = openMassEditor;
window.closeMassEditor = closeMassEditor;
window.saveMassEditor = saveMassEditor;
window.addEarlyLeaveRow = addEarlyLeaveRow;
window.addReplacementRow = addReplacementRow;
window.removeSpecialCase = removeSpecialCase;
window.openExchangeModal = openExchangeModal;
window.closeExchangeModal = closeExchangeModal;
window.sendExchangeRequest = sendExchangeRequest;
window.loadScheduleData = loadScheduleData;
window.checkOperatorsLimit = checkOperatorsLimit;