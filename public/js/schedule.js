// public/js/schedule.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v3.1
// Добавлены все уведомления

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
    let abortController = null;
    let massEditorUnsavedChanges = false;
    let shiftDraft = null;
    let scheduleInitialized = false;

    const myShiftsOnly = false;
    const operatorsOnly = false;

    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================

    function resetScheduleState() {
        console.log('🧹 Сброс состояния графика');
        scheduleInitialized = false;
        if (scheduleLoadTimeout) {
            clearTimeout(scheduleLoadTimeout);
            scheduleLoadTimeout = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
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

    function formatDateSimple(dateStr) {
        if (!dateStr) return '—';
        const parts = dateStr.split('-');
        const day = parseInt(parts[2]);
        const month = parseInt(parts[1]);
        const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${day} ${monthNames[month - 1]}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, m => map[m]);
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

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================

    async function loadScheduleData() {
        if (isLoadingSchedule) {
            console.log('⏳ График уже загружается');
            return;
        }
        
        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();
        
        console.log('🔄 Загрузка данных графика...');
        isLoadingSchedule = true;
        
        showScheduleSkeleton();
        
        if (scheduleLoadTimeout) clearTimeout(scheduleLoadTimeout);
        scheduleLoadTimeout = setTimeout(() => {
            console.error('❌ Таймаут загрузки графика');
            isLoadingSchedule = false;
            hideScheduleSkeleton();
            showSystemNotification('❌ Превышено время загрузки', 'error');
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
                showSystemNotification(`📊 Загружено ${response.length} записей графика`, 'info');
                renderMonthSchedule();
            } else if (response && response.length === 0) {
                currentScheduleData = {};
                window.app.schedule = {};
                renderMonthSchedule();
                showSystemNotification('📅 Нет данных за этот месяц', 'info');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('❌ Ошибка загрузки графика:', err);
                showSystemNotification('❌ Ошибка загрузки графика', 'error');
            }
        } finally {
            clearTimeout(scheduleLoadTimeout);
            scheduleLoadTimeout = null;
            isLoadingSchedule = false;
            abortController = null;
            hideScheduleSkeleton();
        }
    }

    function showScheduleSkeleton() {
        const container = document.getElementById('scheduleWeeksContainer');
        if (container) {
            container.innerHTML = `
                <div class="schedule-skeleton">
                    <div class="skeleton-week"></div>
                    <div class="skeleton-week"></div>
                    <div class="skeleton-week"></div>
                </div>
            `;
        }
    }

    function hideScheduleSkeleton() {
        // Скелетон заменяется при рендере
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
        if (scheduleInitialized) {
            console.log('📅 График уже инициализирован');
            return;
        }
        
        console.log('📅 Инициализация графика');
        
        const container = document.getElementById('scheduleWeeksContainer');
        if (!container) {
            console.warn('⚠️ Контейнер графика не найден, ждём...');
            setTimeout(initSchedule, 100);
            return;
        }
        
        const now = getTobolskNow();
        currentScheduleMonth = now.getMonth();
        currentScheduleYear = now.getFullYear();
        
        loadSpecialCases();
        loadScheduleData();
        setupVisibilityChange();
        setupKeyboardNavigation();
        updateUrl();
        
        document.title = 'WARPOINT — График смен';
        
        scheduleInitialized = true;
    }

    function setupVisibilityChange() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && getCurrentPage() === 'schedule') {
                loadScheduleData();
            }
        });
    }

    function setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            if (getCurrentPage() !== 'schedule') return;
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                changeMonth(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                changeMonth(1);
            } else if (e.key === 'Escape') {
                closeAllModals();
            }
        });
    }

    function closeAllModals() {
        if (typeof closeShiftModal === 'function') closeShiftModal();
        if (typeof closeMassEditor === 'function') closeMassEditor();
        if (typeof closeExchangeModal === 'function') closeExchangeModal();
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
        
        let newMonth = currentScheduleMonth + delta;
        let newYear = currentScheduleYear;
        
        if (newMonth < 0) {
            newMonth = 11;
            newYear--;
        }
        if (newMonth > 11) {
            newMonth = 0;
            newYear++;
        }
        
        currentScheduleMonth = newMonth;
        currentScheduleYear = newYear;
        
        updateUrl();
        showSystemNotification(`📅 ${formatMonthYear()}`, 'info');
        renderMonthSchedule();
        loadScheduleData();
        
        isChangingMonth = false;
    }

    function goToToday() {
        const now = getTobolskNow();
        currentScheduleMonth = now.getMonth();
        currentScheduleYear = now.getFullYear();
        updateUrl();
        showSystemNotification('📅 Переход к текущей дате', 'info');
        renderMonthSchedule();
        loadScheduleData();
    }

    function updateUrl() {
        const url = new URL(window.location);
        url.searchParams.set('month', currentScheduleMonth + 1);
        url.searchParams.set('year', currentScheduleYear);
        window.history.pushState({}, '', url);
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
            return `<img src="${escapeHtml(profile.avatar_url)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='👤'">`;
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
        
        const currentWeekNumber = Math.ceil(now.getDate() / 7);
        
        for (let w = 0; w < weeks.length; w++) {
            const week = weeks[w];
            const isCurrentWeek = w === currentWeekNumber - 1 && currentScheduleMonth === now.getMonth() && currentScheduleYear === now.getFullYear();
            
            html += `<div class="week-schedule-card ${isCurrentWeek ? 'current-week' : ''}">`;
            html += `<div class="week-header"></div>`;
            html += `<div class="week-days"><div class="day-header employee-header-cell">👥 Сотрудник</div>`;
            
            for (let i = 0; i < 7; i++) {
                const day = week.days[i];
                const isSpecialDay = isWeekendOrFriday(i);
                const isToday = day.dateStr === today;
                const showDayNumber = day.isCurrentMonth;
                const hasSpecial = showDayNumber && hasSpecialCases(day.dateStr);
                const specialDesc = hasSpecial ? getSpecialCasesDescription(day.dateStr)?.join('\n') : '';
                
                html += `<div class="day-header ${isSpecialDay ? 'weekend-bg' : ''}" 
                               style="${isToday ? 'background: rgba(99,102,241,0.3);' : ''} cursor: pointer;" 
                               onclick="${isDirector && showDayNumber ? `openMassEditor('${day.dateStr}')` : ''}"
                               title="${specialDesc || (isDirector ? 'Кликните для массового редактирования' : '')}">
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
                    let tooltipText = '';
                    
                    if (!isCurrentMonth) {
                        displayText = '';
                        statusClass = 'shift-empty hidden-day';
                    } else if (shiftData.status !== 'working' && shiftData.status) {
                        displayText = getStatusText(shiftData.status);
                        statusClass = `status-${shiftData.status}`;
                        tooltipText = displayText;
                    } else if (shiftData.time) {
                        let timeDisplay = shiftData.time;
                        
                        if (shiftData.is_special && shiftData.special_end_time && !shiftData.special_end_time.startsWith('exchange_')) {
                            timeDisplay = `⭐ ${shiftData.time}-${shiftData.special_end_time.slice(0, 5)}`;
                            tooltipText = `Смена: ${shiftData.time} - ${shiftData.special_end_time.slice(0, 5)}`;
                        } else if (shiftData.is_special && shiftData.special_end_time && shiftData.special_end_time.startsWith('exchange_')) {
                            timeDisplay = '🔄 ' + shiftData.time;
                            additionalClass += ' exchanged-shift';
                            tooltipText = `Обмен с: ${shiftData.special_end_time.replace('exchange_', '')}`;
                        } else {
                            timeDisplay = shiftData.time;
                            tooltipText = `Смена: ${shiftData.time} - 22:00`;
                        }
                        
                        displayText = timeDisplay;
                        statusClass = 'shift-time';
                        if (emp === currentUser) additionalClass += ' my-shift';
                        if (shiftData.is_special && !shiftData.special_end_time?.startsWith('exchange_')) additionalClass += ' special-shift';
                    } else {
                        displayText = '—';
                        statusClass = 'shift-empty';
                        tooltipText = 'Нет смены';
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
                        style="${!isCurrentMonth ? 'opacity: 0.3; cursor: default;' : 'cursor: pointer;'}"
                        title="${tooltipText}">
                        <div class="shift-display ${statusClass}">${displayText}</div>
                    </div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        
        container.innerHTML = html;
        container.scrollTop = 0;
    }

    // ============================================
    // МОДАЛКА СМЕНЫ
    // ============================================

    function openShiftModalForEmployee(dateStr, employee) {
        const shiftData = currentScheduleData[dateStr]?.[employee] || { time: '10:00', status: 'working', is_special: false, special_end_time: '22:00' };
        
        shiftDraft = { date: dateStr, employee, ...shiftData };
        
        const modalHtml = `
            <div id="shiftModal" class="modal active" onclick="closeShiftModal()">
                <div class="modal-window glass-modal" style="max-width: 500px;" onclick="event.stopPropagation()">
                    <div class="modal-header-premium">
                        <div class="modal-icon"><i class="fas fa-calendar-plus"></i></div>
                        <div class="modal-title">
                            <h3>${shiftData.time ? '✏️ Редактировать смену' : '➕ Добавить смену'}</h3>
                            <p>${formatDateSimple(dateStr)} · ${escapeHtml(employee)}</p>
                        </div>
                        <button class="modal-close" onclick="closeShiftModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label><i class="fas fa-clock"></i> Время начала</label>
                            <select id="shiftTime" class="form-select">
                                <option value="">— Выберите время —</option>
                                ${['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'].map(t => 
                                    `<option value="${t}" ${shiftData.time === t ? 'selected' : ''}>${t}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label><i class="fas fa-tag"></i> Статус</label>
                            <select id="shiftStatus" class="form-select">
                                <option value="working" ${shiftData.status === 'working' ? 'selected' : ''}>✅ Работает</option>
                                <option value="sick" ${shiftData.status === 'sick' ? 'selected' : ''}>🤒 Болен</option>
                                <option value="vacation" ${shiftData.status === 'vacation' ? 'selected' : ''}>🏖️ Отпуск</option>
                                <option value="dayoff" ${shiftData.status === 'dayoff' ? 'selected' : ''}>🏠 Выходной</option>
                                <option value="study" ${shiftData.status === 'study' ? 'selected' : ''}>📚 Учёба</option>
                            </select>
                        </div>
                        <div class="form-group" id="specialEndTimeGroup" style="display: ${shiftData.is_special ? 'block' : 'none'};">
                            <label><i class="fas fa-flag-checkered"></i> Особая смена (время окончания)</label>
                            <input type="time" id="specialEndTime" class="form-input" value="${shiftData.special_end_time || '22:00'}" placeholder="Например, 20:00">
                            <div class="form-hint">Оставьте 22:00 для обычной смены</div>
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="isSpecial" ${shiftData.is_special ? 'checked' : ''}> ⭐ Особая смена
                            </label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        ${shiftData.time ? `<button class="btn-danger" onclick="deleteShift('${dateStr}', '${escapeHtml(employee)}')"><i class="fas fa-trash-alt"></i> Удалить</button>` : ''}
                        <button class="btn-secondary" onclick="closeShiftModal()">Отмена</button>
                        <button class="btn-primary" onclick="saveShift('${dateStr}', '${escapeHtml(employee)}')" id="saveShiftBtn">💾 Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';
        
        const isSpecialCheckbox = document.getElementById('isSpecial');
        const specialEndTimeGroup = document.getElementById('specialEndTimeGroup');
        if (isSpecialCheckbox && specialEndTimeGroup) {
            isSpecialCheckbox.addEventListener('change', (e) => {
                specialEndTimeGroup.style.display = e.target.checked ? 'block' : 'none';
            });
        }
        
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeShiftModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    function closeShiftModal() {
        const modal = document.getElementById('shiftModal');
        if (modal) modal.remove();
        document.body.style.overflow = '';
        shiftDraft = null;
    }

    async function saveShift(dateStr, employee) {
        if (isSavingShift) return;
        
        const shiftTime = document.getElementById('shiftTime')?.value;
        const shiftStatus = document.getElementById('shiftStatus')?.value;
        const isSpecial = document.getElementById('isSpecial')?.checked || false;
        const specialEndTime = document.getElementById('specialEndTime')?.value || null;
        
        if (!shiftTime) {
            showSystemNotification('❌ Выберите время начала смены', 'error');
            return;
        }
        
        if (isSpecial && specialEndTime) {
            const [endHour] = specialEndTime.split(':').map(Number);
            if (endHour > 22) {
                showSystemNotification('❌ Время окончания не может быть позже 22:00', 'error');
                return;
            }
            
            const [startHour] = shiftTime.split(':').map(Number);
            if (endHour <= startHour) {
                showSystemNotification('❌ Время окончания должно быть позже времени начала', 'error');
                return;
            }
        }
        
        const today = getTobolskNow().toISOString().split('T')[0];
        if (dateStr === today) {
            const now = getTobolskNow();
            const [startHour, startMinute] = shiftTime.split(':').map(Number);
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            
            if (startHour < currentHour || (startHour === currentHour && startMinute <= currentMinute)) {
                if (!confirm('⚠️ Время смены уже прошло. Всё равно сохранить?')) {
                    return;
                }
            }
        }
        
        isSavingShift = true;
        const saveBtn = document.getElementById('saveShiftBtn');
        const originalText = saveBtn?.innerHTML;
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            saveBtn.disabled = true;
        }
        
        try {
            const response = await apiCall('/schedule/shift', 'POST', {
                date: dateStr,
                employee: employee,
                shift_time: shiftTime,
                shift_status: shiftStatus,
                is_special: isSpecial,
                special_end_time: specialEndTime
            });
            
            if (response && response.success) {
                showSystemNotification('✅ Смена сохранена', 'success');
                closeShiftModal();
                await loadScheduleData();
                if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
                if (typeof updateDashboardStats === 'function') updateDashboardStats();
            } else {
                showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        } finally {
            isSavingShift = false;
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    async function deleteShift(dateStr, employee) {
        if (!confirm(`Удалить смену для ${employee} на ${formatDateSimple(dateStr)}?`)) return;
        
        try {
            const response = await apiCall('/schedule/shift', 'DELETE', { date: dateStr, employee });
            
            if (response && response.success) {
                showSystemNotification('🗑️ Смена удалена', 'warning');
                closeShiftModal();
                await loadScheduleData();
                if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
                if (typeof updateDashboardStats === 'function') updateDashboardStats();
            } else {
                showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        }
    }

    // ============================================
    // МАССОВЫЙ РЕДАКТОР
    // ============================================

    function openMassEditor(dateStr) {
        const cases = specialCases[dateStr] || { allowThreeOperators: false, earlyLeave: [], replacements: [] };
        
        const employees = (window.app?.employees || []).filter(emp => {
            const profile = window.app?.profiles?.[emp];
            return profile && profile.role !== 'director';
        });
        
        const earlyLeaveHtml = (cases.earlyLeave || []).map((el, idx) => `
            <div class="special-case-row">
                <select class="special-employee" data-index="${idx}">
                    <option value="">Выберите сотрудника</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${el.employee === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <input type="time" class="special-time" value="${el.time || ''}" placeholder="Время ухода">
                <button class="remove-special-btn" onclick="removeEarlyLeave(${idx})"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        
        const replacementsHtml = (cases.replacements || []).map((r, idx) => `
            <div class="special-case-row">
                <select class="special-from" data-index="${idx}">
                    <option value="">Кого заменяют</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${r.from === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <select class="special-to" data-index="${idx}">
                    <option value="">Кто заменяет</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}" ${r.to === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                </select>
                <button class="remove-special-btn" onclick="removeReplacement(${idx})"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        
        const modalHtml = `
            <div id="massEditorModal" class="modal active" onclick="closeMassEditor()">
                <div class="modal-window" style="max-width: 700px;" onclick="event.stopPropagation()">
                    <div class="modal-header-premium">
                        <div class="modal-icon"><i class="fas fa-users-cog"></i></div>
                        <div class="modal-title">
                            <h3>Массовое редактирование</h3>
                            <p>${formatDateSimple(dateStr)}</p>
                        </div>
                        <button class="modal-close" onclick="closeMassEditor()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="special-cases-section">
                            <div class="special-checkbox">
                                <label>
                                    <input type="checkbox" id="allowThreeOperators" ${cases.allowThreeOperators ? 'checked' : ''}>
                                    <span>👥 Разрешить 3 оператора</span>
                                </label>
                            </div>
                            
                            <div class="special-subsection">
                                <div class="special-subtitle">🏃 Ранний уход</div>
                                <div id="earlyLeaveContainer">${earlyLeaveHtml || '<div class="empty-hint">Нет сотрудников с ранним уходом</div>'}</div>
                                <button class="add-special-btn" onclick="addEarlyLeave()"><i class="fas fa-plus"></i> Добавить ранний уход</button>
                            </div>
                            
                            <div class="special-subsection">
                                <div class="special-subtitle">🔄 Замены</div>
                                <div id="replacementsContainer">${replacementsHtml || '<div class="empty-hint">Нет замен</div>'}</div>
                                <button class="add-special-btn" onclick="addReplacement()"><i class="fas fa-plus"></i> Добавить замену</button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeMassEditor()">Отмена</button>
                        <button class="btn-secondary" onclick="clearAllSpecialCases('${dateStr}')"><i class="fas fa-eraser"></i> Очистить все</button>
                        <button class="btn-primary" onclick="saveMassEditor('${dateStr}')" id="saveMassEditorBtn">💾 Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';
        
        massEditorUnsavedChanges = false;
        
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeMassEditor();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    function closeMassEditor() {
        if (massEditorUnsavedChanges && !confirm('У вас есть несохранённые изменения. Выйти?')) {
            return;
        }
        const modal = document.getElementById('massEditorModal');
        if (modal) modal.remove();
        document.body.style.overflow = '';
        massEditorUnsavedChanges = false;
    }

    function markMassEditorChanged() {
        massEditorUnsavedChanges = true;
    }

    function addEarlyLeave() {
        const container = document.getElementById('earlyLeaveContainer');
        const employees = (window.app?.employees || []).filter(emp => {
            const profile = window.app?.profiles?.[emp];
            return profile && profile.role !== 'director';
        });
        
        const idx = Date.now();
        const html = `
            <div class="special-case-row" id="earlyLeave-${idx}">
                <select class="special-employee" onchange="markMassEditorChanged()">
                    <option value="">Выберите сотрудника</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
                </select>
                <input type="time" class="special-time" placeholder="Время ухода" onchange="markMassEditorChanged()">
                <button class="remove-special-btn" onclick="document.getElementById('earlyLeave-${idx}').remove(); markMassEditorChanged()"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        if (container.querySelector('.empty-hint')) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
        }
        markMassEditorChanged();
    }

    function addReplacement() {
        const container = document.getElementById('replacementsContainer');
        const employees = (window.app?.employees || []).filter(emp => {
            const profile = window.app?.profiles?.[emp];
            return profile && profile.role !== 'director';
        });
        
        const idx = Date.now();
        const html = `
            <div class="special-case-row" id="replacement-${idx}">
                <select class="special-from" onchange="markMassEditorChanged()">
                    <option value="">Кого заменяют</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
                </select>
                <select class="special-to" onchange="markMassEditorChanged()">
                    <option value="">Кто заменяет</option>
                    ${employees.map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
                </select>
                <button class="remove-special-btn" onclick="document.getElementById('replacement-${idx}').remove(); markMassEditorChanged()"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        if (container.querySelector('.empty-hint')) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
        }
        markMassEditorChanged();
    }

    function clearAllSpecialCases(dateStr) {
        if (!confirm('Очистить все особые случаи для этого дня?')) return;
        
        document.getElementById('allowThreeOperators').checked = false;
        document.getElementById('earlyLeaveContainer').innerHTML = '<div class="empty-hint">Нет сотрудников с ранним уходом</div>';
        document.getElementById('replacementsContainer').innerHTML = '<div class="empty-hint">Нет замен</div>';
        markMassEditorChanged();
        showSystemNotification('🧹 Особые случаи очищены', 'info');
    }

    async function saveMassEditor(dateStr) {
        const allowThreeOperators = document.getElementById('allowThreeOperators')?.checked || false;
        
        const earlyLeave = [];
        document.querySelectorAll('#earlyLeaveContainer .special-case-row').forEach(row => {
            const employee = row.querySelector('.special-employee')?.value;
            const time = row.querySelector('.special-time')?.value;
            if (employee && time) {
                earlyLeave.push({ employee, time });
            }
        });
        
        const replacements = [];
        document.querySelectorAll('#replacementsContainer .special-case-row').forEach(row => {
            const from = row.querySelector('.special-from')?.value;
            const to = row.querySelector('.special-to')?.value;
            if (from && to) {
                replacements.push({ from, to });
            }
        });
        
        const cases = { allowThreeOperators, earlyLeave, replacements };
        
        const saveBtn = document.getElementById('saveMassEditorBtn');
        const originalText = saveBtn?.innerHTML;
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            saveBtn.disabled = true;
        }
        
        try {
            const response = await apiCall('/schedule/special-cases', 'POST', { date: dateStr, cases });
            
            if (response && response.success) {
                showSystemNotification('✅ Особые случаи сохранены', 'success');
                specialCases[dateStr] = cases;
                massEditorUnsavedChanges = false;
                closeMassEditor();
                await loadScheduleData();
            } else {
                showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    // ============================================
    // ОБМЕН СМЕНАМИ
    // ============================================

    function openExchangeModal(dateStr, toEmployee, toShiftTime) {
        const currentUser = window.app?.currentUser;
        const myShift = currentScheduleData[dateStr]?.[currentUser];
        
        if (!myShift || !myShift.time) {
            showSystemNotification('❌ У вас нет смены в этот день', 'error');
            return;
        }
        
        const modalHtml = `
            <div id="exchangeModal" class="modal active" onclick="closeExchangeModal()">
                <div class="modal-window" style="max-width: 500px;" onclick="event.stopPropagation()">
                    <div class="modal-header-premium">
                        <div class="modal-icon"><i class="fas fa-exchange-alt"></i></div>
                        <div class="modal-title">
                            <h3>Предложить обмен</h3>
                            <p>${formatDateSimple(dateStr)}</p>
                        </div>
                        <button class="modal-close" onclick="closeExchangeModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="exchange-info-card">
                            <div class="exchange-info-item">
                                <span class="label">Ваша смена:</span>
                                <span class="value">${myShift.time} - 22:00</span>
                            </div>
                            <div class="exchange-info-item">
                                <span class="label">Смена ${escapeHtml(toEmployee)}:</span>
                                <span class="value">${toShiftTime || '—'}</span>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label><i class="fas fa-comment"></i> Комментарий</label>
                            <textarea id="exchangeComment" class="form-textarea" rows="3" placeholder="Напишите причину обмена..."></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary" onclick="closeExchangeModal()">Отмена</button>
                        <button class="btn-primary" onclick="sendExchangeRequest('${dateStr}', '${escapeHtml(toEmployee)}', '${toShiftTime || ''}')">📤 Отправить запрос</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';
        
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeExchangeModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    function closeExchangeModal() {
        const modal = document.getElementById('exchangeModal');
        if (modal) modal.remove();
        document.body.style.overflow = '';
    }

    async function sendExchangeRequest(toDate, toEmployee, toShiftTime) {
        const currentUser = window.app?.currentUser;
        const today = getTobolskNow().toISOString().split('T')[0];
        
        const myShifts = Object.entries(currentScheduleData)
            .filter(([date, shifts]) => date >= today && shifts[currentUser]?.time)
            .sort(([a], [b]) => a.localeCompare(b));
        
        if (myShifts.length === 0) {
            showSystemNotification('❌ У вас нет будущих смен для обмена', 'error');
            return;
        }
        
        let fromDate = toDate;
        let fromShiftTime = currentScheduleData[toDate]?.[currentUser]?.time;
        
        if (!fromShiftTime) {
            fromDate = myShifts[0][0];
            fromShiftTime = myShifts[0][1][currentUser].time;
        }
        
        const comment = document.getElementById('exchangeComment')?.value || '';
        
        try {
            const response = await apiCall('/exchange/create', 'POST', {
                toEmployee,
                toDate,
                toShiftTime,
                fromDate,
                fromShiftTime,
                comment
            });
            
            if (response && response.success) {
                showSystemNotification('🔄 Запрос на обмен отправлен', 'success');
                closeExchangeModal();
            } else {
                showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        }
    }

    // ============================================
    // ФИЛЬТРЫ
    // ============================================

    function toggleMyShiftsFilter() {
        const checkbox = document.getElementById('filterMyShifts');
        window.myShiftsOnly = checkbox?.checked || false;
        showSystemNotification(`👤 ${window.myShiftsOnly ? 'Только мои смены' : 'Все смены'}`, 'info');
        renderMonthSchedule();
    }

    function toggleOperatorsFilter() {
        const checkbox = document.getElementById('filterOperatorsOnly');
        window.operatorsOnly = checkbox?.checked || false;
        showSystemNotification(`👥 ${window.operatorsOnly ? 'Только операторы' : 'Все сотрудники'}`, 'info');
        renderMonthSchedule();
    }

    function resetScheduleFilters() {
        document.getElementById('filterMyShifts').checked = false;
        document.getElementById('filterOperatorsOnly').checked = false;
        window.myShiftsOnly = false;
        window.operatorsOnly = false;
        showSystemNotification('🔄 Фильтры сброшены', 'info');
        renderMonthSchedule();
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    function exportSchedule() {
        showSystemNotification('📊 Экспорт графика...', 'info');
        // Заглушка
    }

    function getCurrentPage() {
        return typeof window.getCurrentPage === 'function' ? window.getCurrentPage() : null;
    }

    function openProfile(employeeName) {
        if (typeof window.openProfile === 'function') {
            window.openProfile(employeeName);
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    window.initSchedule = initSchedule;
    window.resetScheduleState = resetScheduleState;
    window.changeMonth = changeMonth;
    window.goToToday = goToToday;
    window.loadScheduleData = loadScheduleData;
    window.openShiftModalForEmployee = openShiftModalForEmployee;
    window.closeShiftModal = closeShiftModal;
    window.saveShift = saveShift;
    window.deleteShift = deleteShift;
    window.openMassEditor = openMassEditor;
    window.closeMassEditor = closeMassEditor;
    window.saveMassEditor = saveMassEditor;
    window.addEarlyLeave = addEarlyLeave;
    window.addReplacement = addReplacement;
    window.clearAllSpecialCases = clearAllSpecialCases;
    window.markMassEditorChanged = markMassEditorChanged;
    window.openExchangeModal = openExchangeModal;
    window.closeExchangeModal = closeExchangeModal;
    window.sendExchangeRequest = sendExchangeRequest;
    window.renderMonthSchedule = renderMonthSchedule;
    window.toggleMyShiftsFilter = toggleMyShiftsFilter;
    window.toggleOperatorsFilter = toggleOperatorsFilter;
    window.resetScheduleFilters = resetScheduleFilters;
    window.exportSchedule = exportSchedule;

    console.log('✅ schedule.js загружен (v3.1 — с уведомлениями)');
})();