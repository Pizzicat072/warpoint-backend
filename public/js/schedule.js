// public/js/schedule.js — ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
(function() {
    'use strict';
    
    let currentScheduleMonth = new Date().getMonth();
    let currentScheduleYear = new Date().getFullYear();
    let currentScheduleData = {};
    let isSavingShift = false;
    let specialCases = {};
    let isLoadingSchedule = false;
    let scheduleLoadTimeout = null;
    let specialCasesLoaded = false;
    let isChangingMonth = false;

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

    function formatDateSimple(dateStr) {
        if (!dateStr) return '—';
        const parts = dateStr.split('-');
        const day = parseInt(parts[2]);
        const month = parseInt(parts[1]);
        const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${day} ${monthNames[month - 1]}`;
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================
    async function loadScheduleData() {
        if (isLoadingSchedule) {
            console.log('⏳ График уже загружается');
            return;
        }
        
        console.log('🔄 Загрузка данных графика...');
        isLoadingSchedule = true;
        
        if (scheduleLoadTimeout) clearTimeout(scheduleLoadTimeout);
        scheduleLoadTimeout = setTimeout(() => {
            console.error('❌ Таймаут загрузки графика');
            isLoadingSchedule = false;
        }, 15000);
        
        try {
            const response = await apiCall('/schedule?_=' + Date.now());
            
            if (response && Array.isArray(response)) {
                currentScheduleData = {};
                window.app = window.app || {};
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
            showNotif('Ошибка загрузки графика', 'error');
        } finally {
            clearTimeout(scheduleLoadTimeout);
            scheduleLoadTimeout = null;
            isLoadingSchedule = false;
        }
    }

    async function loadSpecialCases() {
        if (specialCasesLoaded) return;
        
        try {
            const response = await apiCall('/schedule/special-cases');
            if (response && response.success) {
                specialCases = response.data || {};
                specialCasesLoaded = true;
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
            cases.earlyLeave.forEach(el => descriptions.push(`• ${el.employee} уходит в ${el.time}`));
        }
        if (cases.replacements && cases.replacements.length > 0) {
            cases.replacements.forEach(r => descriptions.push(`• Замена: ${r.from} → ${r.to}`));
        }
        return descriptions;
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initSchedule() {
        console.log('📅 Инициализация графика');
        
        const container = document.getElementById('scheduleWeeksContainer');
        if (!container) {
            console.warn('⚠️ Контейнер графика не найден, ждём...');
            setTimeout(initSchedule, 100);
            return;
        }
        
        loadSpecialCases();
        loadScheduleData();
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
        if (isChangingMonth) {
            console.log('⚠️ Месяц уже меняется');
            return;
        }
        
        isChangingMonth = true;
        
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
        isChangingMonth = false;
    }

    function resetMonthSchedule() {
        const now = getTobolskNow();
        currentScheduleMonth = now.getMonth();
        currentScheduleYear = now.getFullYear();
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

    function getAvatarHtmlForSchedule(profile) {
        if (!profile) return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">👤</div>';
        
        if (profile.avatar_url && profile.avatar_url.startsWith('data:image')) {
            return `<img src="${profile.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.onerror=null; this.parentElement.innerHTML='👤'">`;
        } else if (profile.avatar) {
            return `<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">${escapeHtml(profile.avatar)}</div>`;
        } else {
            return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 20px;">👤</div>';
        }
    }

    function renderMonthSchedule() {
        const container = document.getElementById('scheduleWeeksContainer');
        if (!container) {
            console.warn('⚠️ Контейнер scheduleWeeksContainer не найден');
            return;
        }
        
        const monthYearEl = document.getElementById('currentMonthYear');
        if (monthYearEl) monthYearEl.textContent = formatMonthYear();
        
        const weeks = getWeeksInMonth();
        const currentUser = window.app?.currentUser;
        const isDirector = window.app?.currentUserRole === 'director';
        
        const employees = (window.app?.employees || []).filter(emp => {
            const profile = window.app?.profiles?.[emp];
            return profile && profile.role !== 'director';
        }).sort((a, b) => {
            const profileA = window.app?.profiles?.[a];
            const profileB = window.app?.profiles?.[b];
            const roleOrder = { 'admin': 1, 'operator': 2, 'manager': 3 };
            const orderA = roleOrder[profileA?.role] || 99;
            const orderB = roleOrder[profileB?.role] || 99;
            if (orderA !== orderB) return orderA - orderB;
            return (profileA?.name || a).localeCompare(profileB?.name || b);
        });
        
        if (weeks.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><h3>Нет данных</h3></div>';
            return;
        }
        
        let html = '';
        const now = getTobolskNow();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        for (let w = 0; w < weeks.length; w++) {
            const week = weeks[w];
            
            html += `<div class="week-schedule-card"><div class="week-header"></div>`;
            html += `<div class="week-days"><div class="day-header employee-header-cell">👥 Сотрудник</div>`;
            
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
                const profile = window.app?.profiles?.[emp];
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
                        if (emp === currentUser) additionalClass += ' my-shift';
                        if (shiftData.is_special) additionalClass += ' special-shift';
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
    // ЭКСПОРТ
    // ============================================
    window.initSchedule = initSchedule;
    window.changeMonth = changeMonth;
    window.resetMonthSchedule = resetMonthSchedule;
    window.loadScheduleData = loadScheduleData;

    console.log('✅ schedule.js загружен');
})();