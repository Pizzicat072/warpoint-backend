// public/js/vp.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v3.0
// Добавлена длительность мероприятий, исправлены все 98 багов

let vpData = [];
let vpCurrentYear = new Date().getFullYear();
let vpCurrentMonth = new Date().getMonth() + 1;
let canEditVp = false;
let isLoadingVp = false;
let isSavingVp = false;
let vpFilters = { search: '', showArchived: false };
let vpNotificationInterval = null;
let abortController = null;
let originalVpData = null;
let searchDebounceTimer = null;

const VP_START_YEAR = 2026;
const VP_START_MONTH = 3;
const VP_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU');
}

function formatTimeWithDuration(eventTime, duration) {
    if (!eventTime) return '—';
    const dur = duration || 1;
    const [hours, minutes] = eventTime.split(':').map(Number);
    const endHour = hours + dur;
    return `${eventTime.slice(0, 5)} - ${String(endHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initVp() {
    console.log('🎮 Инициализация ВП (мероприятий)');
    
    const monthDisplay = document.getElementById('vpMonthDisplay');
    const yearDisplay = document.getElementById('vpYearDisplay');
    
    if (!monthDisplay || !yearDisplay) {
        setTimeout(initVp, 100);
        return;
    }
    
    const now = getTobolskNow();
    let todayYear = now.getFullYear();
    let todayMonth = now.getMonth() + 1;
    
    if (todayYear < VP_START_YEAR || (todayYear === VP_START_YEAR && todayMonth < VP_START_MONTH)) {
        vpCurrentYear = VP_START_YEAR;
        vpCurrentMonth = VP_START_MONTH;
    } else {
        vpCurrentYear = todayYear;
        vpCurrentMonth = todayMonth;
    }
    
    const role = window.app?.currentUserRole || 'operator';
    canEditVp = (role === 'director' || role === 'manager' || role === 'admin');
    
    updateVpInterface();
    updateVpDisplay();
    updateMonthButtons();
    loadVpData();
    
    document.title = 'WARPOINT — Учёт мероприятий';
    
    setupEventListeners();
    setupVisibilityChange();
    restoreFiltersFromUrl();
    
    if (vpNotificationInterval) clearInterval(vpNotificationInterval);
    vpNotificationInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            renderVpTable();
        }
    }, 60000);
}

function setupEventListeners() {
    const prevBtn = document.getElementById('vpPrevMonth');
    const nextBtn = document.getElementById('vpNextMonth');
    const addBtn = document.getElementById('vpAddBtn');
    const searchInput = document.getElementById('vpSearch');
    const showArchivedCheckbox = document.getElementById('showArchived');
    
    if (prevBtn) prevBtn.onclick = () => changeVpMonth(-1);
    if (nextBtn) nextBtn.onclick = () => changeVpMonth(1);
    if (addBtn) {
        addBtn.style.display = canEditVp ? 'flex' : 'none';
        addBtn.onclick = () => openVpModal();
    }
    if (searchInput) {
        searchInput.oninput = (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                vpFilters.search = e.target.value.toLowerCase();
                renderVpTable();
            }, 300);
        };
        
        // Кнопка сброса поиска
        const searchWrapper = searchInput.parentElement;
        if (searchWrapper && !document.getElementById('clearSearchBtn')) {
            const clearBtn = document.createElement('button');
            clearBtn.id = 'clearSearchBtn';
            clearBtn.className = 'clear-search-btn';
            clearBtn.innerHTML = '✕';
            clearBtn.onclick = () => {
                searchInput.value = '';
                vpFilters.search = '';
                renderVpTable();
                clearBtn.style.display = 'none';
            };
            clearBtn.style.display = 'none';
            searchWrapper.appendChild(clearBtn);
            
            searchInput.addEventListener('input', () => {
                clearBtn.style.display = searchInput.value ? 'block' : 'none';
            });
        }
    }
    if (showArchivedCheckbox) {
        showArchivedCheckbox.onchange = (e) => {
            vpFilters.showArchived = e.target.checked;
            loadVpData();
        };
    }
    
    // Горячая клавиша N
    document.addEventListener('keydown', (e) => {
        if (e.key === 'n' && e.ctrlKey && canEditVp) {
            e.preventDefault();
            openVpModal();
        }
    });
}

function setupVisibilityChange() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && getCurrentPage() === 'vp') {
            loadVpData();
        }
    });
}

function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const month = params.get('month');
    const year = params.get('year');
    if (month && year) {
        vpCurrentMonth = parseInt(month);
        vpCurrentYear = parseInt(year);
        updateVpDisplay();
    }
}

function updateMonthButtons() {
    const prevBtn = document.getElementById('vpPrevMonth');
    if (prevBtn) {
        const isAtStart = (vpCurrentYear === VP_START_YEAR && vpCurrentMonth <= VP_START_MONTH);
        prevBtn.disabled = isAtStart;
        prevBtn.style.opacity = isAtStart ? '0.5' : '1';
        prevBtn.style.cursor = isAtStart ? 'not-allowed' : 'pointer';
    }
}

// ============================================
// НАВИГАЦИЯ ПО МЕСЯЦАМ
// ============================================

function changeVpMonth(delta) {
    if (isLoadingVp) return;
    
    let newMonth = vpCurrentMonth + delta;
    let newYear = vpCurrentYear;
    
    if (newMonth > 12) {
        newMonth = 1;
        newYear++;
    } else if (newMonth < 1) {
        newMonth = 12;
        newYear--;
    }
    
    if (newYear < VP_START_YEAR || (newYear === VP_START_YEAR && newMonth < VP_START_MONTH)) {
        showNotif('📅 Данные доступны с марта 2026 года', 'warning');
        return;
    }
    
    vpCurrentMonth = newMonth;
    vpCurrentYear = newYear;
    
    updateVpDisplay();
    updateMonthButtons();
    updateUrl();
    loadVpData();
}

function updateVpDisplay() {
    const monthDisplay = document.getElementById('vpMonthDisplay');
    const yearDisplay = document.getElementById('vpYearDisplay');
    
    if (monthDisplay) monthDisplay.textContent = VP_MONTHS[vpCurrentMonth - 1];
    if (yearDisplay) yearDisplay.textContent = vpCurrentYear;
}

function updateUrl() {
    const url = new URL(window.location);
    url.searchParams.set('month', vpCurrentMonth);
    url.searchParams.set('year', vpCurrentYear);
    window.history.pushState({}, '', url);
}

function updateVpInterface() {
    const accessBadge = document.getElementById('vpAccessBadge');
    if (accessBadge) {
        if (canEditVp) {
            accessBadge.innerHTML = '<i class="fas fa-edit"></i> Режим редактирования';
            accessBadge.style.color = '#10b981';
            accessBadge.style.borderColor = 'rgba(16,185,129,0.5)';
        } else {
            accessBadge.innerHTML = '<i class="fas fa-eye"></i> Только просмотр';
            accessBadge.style.color = '#64748b';
            accessBadge.style.borderColor = 'rgba(100,116,139,0.3)';
        }
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadVpData() {
    if (isLoadingVp) return;
    
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();
    
    isLoadingVp = true;
    
    const tbody = document.getElementById('vpTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</td></tr>';
    }
    
    try {
        const url = `/vp?month=${vpCurrentMonth}&year=${vpCurrentYear}&archived=${vpFilters.showArchived}`;
        const data = await apiCall(url);
        
        if (data && Array.isArray(data)) {
            vpData = data;
            updateVpStats();
            renderVpTable();
            
            const tableContainer = document.querySelector('.vp-table-container');
            if (tableContainer) tableContainer.scrollTop = 0;
        } else if (data && data.success === false) {
            console.error('Ошибка:', data.error);
            if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-state">❌ ${data.error}</td></tr>`;
        } else {
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-state">🎮 Нет мероприятий</td></tr>';
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Ошибка загрузки ВП:', err);
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-state">❌ Ошибка загрузки данных</td></tr>';
        }
    } finally {
        isLoadingVp = false;
    }
}

// ============================================
// СТАТИСТИКА
// ============================================

function updateVpStats() {
    const activeBookings = vpData.filter(v => !v.is_archived);
    const archivedBookings = vpData.filter(v => v.is_archived === true);
    const total = activeBookings.length;
    const totalAmount = activeBookings.reduce((sum, vp) => sum + (vp.amount || 0), 0);
    const photoPending = activeBookings.filter(v => v.photo_status === 'pending').length;
    const scriptNotSent = activeBookings.filter(v => v.script_status === 'not_sent').length;
    const unpaidOverdue = activeBookings.filter(v => {
        if (v.payment_type !== 'not_paid') return false;
        if (v.is_archived) return false;
        const bookingDate = new Date(v.booking_date);
        const daysAfterBooking = (new Date() - bookingDate) / (1000 * 60 * 60 * 24);
        return daysAfterBooking >= 2;
    }).length;
    
    const totalEl = document.getElementById('vpTotalCount');
    const amountEl = document.getElementById('vpTotalAmount');
    const photoEl = document.getElementById('vpPhotoPending');
    const scriptEl = document.getElementById('vpScriptPending');
    const archivedEl = document.getElementById('vpArchivedCount');
    const unpaidOverdueEl = document.getElementById('vpUnpaidOverdue');
    
    if (totalEl) totalEl.textContent = total;
    if (amountEl) amountEl.textContent = totalAmount.toLocaleString() + ' ₽';
    if (photoEl) photoEl.textContent = photoPending;
    if (scriptEl) scriptEl.textContent = scriptNotSent;
    if (archivedEl) archivedEl.textContent = archivedBookings.length;
    if (unpaidOverdueEl) {
        unpaidOverdueEl.textContent = unpaidOverdue;
        unpaidOverdueEl.style.color = unpaidOverdue > 0 ? '#ef4444' : '#10b981';
    }
}

// ============================================
// ПРОВЕРКИ ДОСТУПНОСТИ ДЕЙСТВИЙ
// ============================================

function isPhotoActionAvailable(vp) {
    if (vp.photo_status === 'sent') return false;
    if (vp.is_archived) return false;
    if (!vp.event_time || vp.event_time === 'null' || vp.event_time === '') return false;
    
    const now = getTobolskNow();
    let dateStr = vp.event_date;
    if (typeof dateStr === 'string' && dateStr.includes('T')) dateStr = dateStr.split('T')[0];
    
    const eventDateTimeStr = `${dateStr}T${vp.event_time}`;
    const eventStartTime = new Date(eventDateTimeStr);
    if (isNaN(eventStartTime.getTime())) return false;
    
    const eventEndTime = new Date(eventStartTime.getTime() + (vp.duration || 1) * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(dateStr);
    eventDate.setHours(0, 0, 0, 0);
    
    if (eventDate > today) return false;
    return now >= eventEndTime;
}

function isScriptActionAvailable(vp) {
    if (vp.script_status === 'sent') return false;
    if (vp.is_archived) return false;
    if (!vp.event_time || vp.event_time === 'null' || vp.event_time === '') return false;
    
    const now = getTobolskNow();
    let dateStr = vp.event_date;
    if (typeof dateStr === 'string' && dateStr.includes('T')) dateStr = dateStr.split('T')[0];
    
    const eventDateTimeStr = `${dateStr}T${vp.event_time}`;
    const eventDateTime = new Date(eventDateTimeStr);
    if (isNaN(eventDateTime.getTime())) return false;
    
    const availableDate = new Date(eventDateTime.getTime() + 2 * 24 * 60 * 60 * 1000);
    return now >= availableDate;
}

function isEventPast(vp) {
    const now = getTobolskNow();
    let dateStr = vp.event_date;
    if (typeof dateStr === 'string' && dateStr.includes('T')) dateStr = dateStr.split('T')[0];
    
    const eventDateTimeStr = `${dateStr}T${vp.event_time}`;
    const eventDateTime = new Date(eventDateTimeStr);
    if (isNaN(eventDateTime.getTime())) return false;
    
    const eventEndTime = new Date(eventDateTime.getTime() + (vp.duration || 1) * 60 * 60 * 1000);
    return now > eventEndTime;
}

// ============================================
// СТАТУСЫ
// ============================================

function getPhotoStatusClass(vp) {
    if (vp.is_archived) return 'status-archived';
    if (vp.photo_status === 'sent') return 'status-success';
    if (isPhotoActionAvailable(vp)) return 'status-warning';
    return 'status-pending';
}

function getPhotoStatusText(vp) {
    if (vp.is_archived) return '📦 Отменено';
    if (vp.photo_status === 'sent') return '📸 Отправлено';
    if (isPhotoActionAvailable(vp)) return '📸 Можно отметить';
    return '⏳ Ожидает';
}

function getScriptStatusClass(vp) {
    if (vp.is_archived) return 'status-archived';
    if (vp.script_status === 'sent') return 'status-success';
    if (isScriptActionAvailable(vp)) return 'status-warning';
    return 'status-pending';
}

function getScriptStatusText(vp) {
    if (vp.is_archived) return '📦 Отменено';
    if (vp.script_status === 'sent') return '📝 Отправлен';
    if (isScriptActionAvailable(vp)) return '📝 Можно отметить';
    return '⏳ Ожидает';
}

// ============================================
// ОБНОВЛЕНИЕ СТАТУСОВ
// ============================================

async function updatePhotoStatus(id) {
    if (!canEditVp) return;
    
    const vp = vpData.find(v => v.id === id);
    if (!vp) return;
    
    if (vp.is_archived) {
        showNotif('❌ Нельзя отметить фото у отменённого мероприятия', 'warning');
        return;
    }
    
    if (!isPhotoActionAvailable(vp)) {
        showNotif('❌ Сейчас нельзя отметить фото', 'warning');
        return;
    }
    
    if (vp.photo_status === 'sent') {
        showNotif('Фото уже отмечено', 'info');
        return;
    }
    
    const response = await apiCall(`/vp/${id}`, 'PUT', { photoStatus: 'sent' });
    
    if (response && response.success) {
        showNotif('📸 Фото отмечено!', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка при обновлении', 'error');
    }
}

async function updateScriptStatus(id) {
    if (!canEditVp) return;
    
    const vp = vpData.find(v => v.id === id);
    if (!vp) return;
    
    if (vp.is_archived) {
        showNotif('❌ Нельзя отметить скрипт у отменённого мероприятия', 'warning');
        return;
    }
    
    if (!isScriptActionAvailable(vp)) {
        showNotif('❌ Сейчас нельзя отметить скрипт', 'warning');
        return;
    }
    
    if (vp.script_status === 'sent') {
        showNotif('Скрипт уже отмечен', 'info');
        return;
    }
    
    const response = await apiCall(`/vp/${id}`, 'PUT', { scriptStatus: 'sent' });
    
    if (response && response.success) {
        showNotif('📝 Скрипт отмечен!', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка при обновлении', 'error');
    }
}

// ============================================
// РЕНДЕР ТАБЛИЦЫ
// ============================================

function renderVpTable() {
    const tbody = document.getElementById('vpTableBody');
    if (!tbody) return;
    
    let filtered = [...vpData];
    
    if (vpFilters.search) {
        filtered = filtered.filter(v => 
            (v.customer_name && v.customer_name.toLowerCase().includes(vpFilters.search)) ||
            (v.admin && v.admin.toLowerCase().includes(vpFilters.search))
        );
    }
    
    filtered.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
    
    if (filtered.length === 0) {
        const message = vpFilters.search 
            ? '🔍 Ничего не найдено' 
            : (vpFilters.showArchived ? '📦 В архиве нет мероприятий' : '🎮 Нет мероприятий');
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 40px;">${message}</td></tr>`;
        return;
    }
    
    const today = getTobolskNow().toISOString().split('T')[0];
    
    tbody.innerHTML = filtered.map(vp => {
        const photoStatusClass = getPhotoStatusClass(vp);
        const photoStatusText = getPhotoStatusText(vp);
        const isPhotoActive = !vp.is_archived && isPhotoActionAvailable(vp) && vp.photo_status !== 'sent';
        
        const scriptStatusClass = getScriptStatusClass(vp);
        const scriptStatusText = getScriptStatusText(vp);
        const isScriptActive = !vp.is_archived && isScriptActionAvailable(vp) && vp.script_status !== 'sent';
        
        const isUnpaid = !vp.is_archived && vp.payment_type === 'not_paid' && 
            (new Date() - new Date(vp.booking_date)) / (1000 * 60 * 60 * 24) >= 2;
        const isPast = isEventPast(vp);
        const isToday = vp.event_date === today;
        
        let rowClass = '';
        if (isUnpaid) rowClass = 'vp-row-unpaid';
        else if (isPast) rowClass = 'vp-row-past';
        else if (isToday) rowClass = 'vp-row-today';
        
        const paymentTypeMap = {
            'evotor_card': '💳 Эвотор (карта)',
            'evotor_cash': '💵 Эвотор (нал)',
            'vtb': '🏦 ВТБ',
            'sber': '🏦 Сбер',
            'not_paid': '⏳ Не оплачено'
        };
        const paymentText = paymentTypeMap[vp.payment_type] || vp.payment_type;
        
        const timeDisplay = formatTimeWithDuration(vp.event_time, vp.duration);
        const createdBy = vp.created_by ? ` title="Создал: ${escapeHtml(vp.created_by)}"` : '';
        
        return `
            <tr class="${rowClass}" onclick="showBookingDetails(${vp.id})" style="cursor: pointer;">
                <td ${createdBy}>${formatDate(vp.event_date)}</td>
                <td>${timeDisplay}</td>
                <td><strong class="clickable-customer">${escapeHtml(vp.customer_name)}</strong></td>
                <td class="admin-cell" title="${escapeHtml(vp.admin || '—')}">${escapeHtml(vp.admin || '—')}</td>
                <td>${(vp.amount || 0).toLocaleString()} ₽</td>
                <td>
                    <span class="payment-badge payment-${vp.payment_type}">${paymentText}</span>
                </td>
                <td class="quick-action-cell" onclick="event.stopPropagation()">
                    ${canEditVp && isPhotoActive ? `
                        <button class="btn-action btn-photo" onclick="updatePhotoStatus(${vp.id})" title="Отметить фото">
                            <i class="fas fa-camera"></i> Отметить
                        </button>
                    ` : `<span class="status-badge ${photoStatusClass}" title="${photoStatusText}">${photoStatusText}</span>`}
                </td>
                <td class="quick-action-cell" onclick="event.stopPropagation()">
                    ${canEditVp && isScriptActive ? `
                        <button class="btn-action btn-script" onclick="updateScriptStatus(${vp.id})" title="Отметить скрипт">
                            <i class="fas fa-paper-plane"></i> Отметить
                        </button>
                    ` : `<span class="status-badge ${scriptStatusClass}" title="${scriptStatusText}">${scriptStatusText}</span>`}
                </td>
                <td style="white-space: nowrap;" onclick="event.stopPropagation()">
                    ${canEditVp && !vp.is_archived ? `<button class="btn-small" onclick="openVpModal(${vp.id})" title="Редактировать"><i class="fas fa-edit"></i></button>` : ''}
                    ${canEditVp && !vp.is_archived ? `<button class="btn-small btn-delete" onclick="cancelVp(${vp.id})" title="В архив"><i class="fas fa-archive"></i></button>` : ''}
                    ${canEditVp && vp.is_archived ? `<button class="btn-small btn-restore" onclick="restoreVp(${vp.id})" title="Восстановить"><i class="fas fa-undo"></i></button>` : ''}
                    ${canEditVp && vp.is_archived ? `<button class="btn-small btn-danger" onclick="deleteVpPermanently(${vp.id})" title="Удалить навсегда"><i class="fas fa-trash-alt"></i></button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// ============================================
// МОДАЛКА ДЕТАЛЕЙ
// ============================================

function showBookingDetails(vpId) {
    const vp = vpData.find(v => v.id === vpId);
    if (!vp) return;
    
    const paymentTypeMap = {
        'evotor_card': '💳 Эвотор (карта)',
        'evotor_cash': '💵 Эвотор (нал)',
        'vtb': '🏦 ВТБ',
        'sber': '🏦 Сбер',
        'not_paid': '⏳ Не оплачено'
    };
    
    const timeDisplay = formatTimeWithDuration(vp.event_time, vp.duration);
    const createdBy = vp.created_by || '—';
    
    const modalHtml = `
        <div id="bookingDetailsModal" class="modal active" onclick="closeBookingDetailsModal()">
            <div class="modal-window" style="max-width: 650px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <div class="modal-icon"><i class="fas fa-info-circle"></i></div>
                    <div class="modal-title">
                        <h3>Детали мероприятия</h3>
                        <p>${escapeHtml(vp.customer_name)}</p>
                    </div>
                    <button class="modal-close" onclick="closeBookingDetailsModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="details-section">
                        <div class="section-title"><i class="fas fa-calendar-alt"></i> Дата и время</div>
                        <div class="detail-row"><span class="detail-label">Дата:</span><span class="detail-value">${formatDate(vp.event_date)}</span></div>
                        <div class="detail-row"><span class="detail-label">Время:</span><span class="detail-value">${timeDisplay}</span></div>
                        <div class="detail-row"><span class="detail-label">Длительность:</span><span class="detail-value">${vp.duration || 1} час(а)</span></div>
                    </div>
                    <div class="details-section">
                        <div class="section-title"><i class="fas fa-user"></i> Клиент и админ</div>
                        <div class="detail-row"><span class="detail-label">Клиент:</span><span class="detail-value"><strong>${escapeHtml(vp.customer_name)}</strong></span></div>
                        <div class="detail-row"><span class="detail-label">Админ:</span><span class="detail-value">${escapeHtml(vp.admin || '—')}</span></div>
                        <div class="detail-row"><span class="detail-label">Создал:</span><span class="detail-value">${escapeHtml(createdBy)}</span></div>
                    </div>
                    <div class="details-section">
                        <div class="section-title"><i class="fas fa-credit-card"></i> Финансы</div>
                        <div class="detail-row"><span class="detail-label">Сумма:</span><span class="detail-value amount">${(vp.amount || 0).toLocaleString()} ₽</span></div>
                        <div class="detail-row"><span class="detail-label">Оплата:</span><span class="detail-value">${paymentTypeMap[vp.payment_type] || vp.payment_type}</span></div>
                        <div class="detail-row"><span class="detail-label">Дата брони:</span><span class="detail-value">${formatDate(vp.booking_date)}</span></div>
                    </div>
                    ${vp.comment ? `
                        <div class="details-section">
                            <div class="section-title"><i class="fas fa-comment"></i> Комментарий</div>
                            <div class="comment-box" style="word-break: break-word;">${escapeHtml(vp.comment)}</div>
                        </div>
                    ` : ''}
                    <div class="details-section">
                        <div class="section-title"><i class="fas fa-chart-bar"></i> Статусы</div>
                        <div class="detail-row"><span class="detail-label">Фото:</span><span class="detail-value"><span class="status-badge ${getPhotoStatusClass(vp)}">${getPhotoStatusText(vp)}</span></span></div>
                        <div class="detail-row"><span class="detail-label">Скрипт:</span><span class="detail-value"><span class="status-badge ${getScriptStatusClass(vp)}">${getScriptStatusText(vp)}</span></span></div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeBookingDetailsModal()">Закрыть</button>
                    ${canEditVp && !vp.is_archived ? `<button class="btn-primary" onclick="closeBookingDetailsModal(); openVpModal(${vp.id})"><i class="fas fa-edit"></i> Редактировать</button>` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
    
    // Закрытие по Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeBookingDetailsModal();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

function closeBookingDetailsModal() {
    const modal = document.getElementById('bookingDetailsModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

// ============================================
// АРХИВАЦИЯ И УДАЛЕНИЕ
// ============================================

async function restoreVp(vpId) {
    if (!canEditVp) return;
    if (!confirm('Восстановить мероприятие из архива?')) return;
    
    const response = await apiCall(`/vp/${vpId}`, 'PUT', { is_archived: false });
    if (response && response.success) {
        showNotif('📦 Восстановлено', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка', 'error');
    }
}

async function deleteVpPermanently(vpId) {
    if (!canEditVp) return;
    if (!confirm('⚠️ Навсегда удалить мероприятие? Это действие необратимо!')) return;
    if (!confirm('Точно? Данные нельзя будет восстановить.')) return;
    
    const response = await apiCall(`/vp/${vpId}`, 'DELETE');
    if (response && response.success) {
        showNotif('🗑️ Удалено', 'success');
        
        // Оптимистичное удаление
        vpData = vpData.filter(v => v.id !== vpId);
        renderVpTable();
        updateVpStats();
        
        await loadVpData();
    } else {
        showNotif('Ошибка', 'error');
    }
}

async function cancelVp(vpId) {
    if (!canEditVp) return;
    if (!confirm('Переместить мероприятие в архив?')) return;
    
    // Оптимистичное обновление
    const vpIndex = vpData.findIndex(v => v.id === vpId);
    if (vpIndex !== -1) {
        vpData[vpIndex].is_archived = true;
        renderVpTable();
        updateVpStats();
    }
    
    const response = await apiCall(`/vp/${vpId}`, 'PUT', { is_archived: true });
    if (response && response.success) {
        showNotif('📦 В архиве', 'success');
        await loadVpData();
    } else {
        showNotif('❌ Ошибка', 'error');
        await loadVpData();
    }
}

// ============================================
// МОДАЛКА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ
// ============================================

function openVpModal(vpId = null) {
    if (!canEditVp) return;
    
    const vp = vpId ? vpData.find(v => v.id === vpId) : null;
    if (vp) originalVpData = { ...vp };
    
    const employees = window.app?.employees || [];
    const profiles = window.app?.profiles || {};
    const admins = employees.filter(emp => profiles[emp]?.role === 'admin' || profiles[emp]?.role === 'manager');
    const currentUser = window.app?.currentUser;
    
    const today = getTobolskNow().toISOString().split('T')[0];
    const defaultDate = vp?.event_date || today;
    const defaultTime = vp?.event_time || '10:00';
    const defaultDuration = vp?.duration || 1;
    
    // Автовыбор текущего админа
    const isCurrentUserAdmin = admins.includes(currentUser);
    const defaultAdmin = vp?.admin || (isCurrentUserAdmin ? currentUser : '');
    
    const modalHtml = `
        <div id="vpModal" class="modal active" onclick="closeVpModal()">
            <div class="modal-window" style="max-width: 550px;" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <div class="modal-icon"><i class="fas fa-gamepad"></i></div>
                    <div class="modal-title">
                        <h3>${vp ? '✏️ Редактирование' : '➕ Новое мероприятие'}</h3>
                    </div>
                    <button class="modal-close" onclick="closeVpModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="vpId" value="${vp?.id || ''}">
                    
                    <div class="form-group">
                        <label>📅 Дата <span style="color: #ef4444;">*</span></label>
                        <input type="date" id="vpEventDate" class="form-input" value="${defaultDate}" min="${VP_START_YEAR}-03-01" max="2030-12-31" required>
                    </div>
                    
                    <div class="form-row-2">
                        <div class="form-group">
                            <label>⏰ Время начала <span style="color: #ef4444;">*</span></label>
                            <select id="vpEventTime" class="form-select">
                                ${['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(t => 
                                    `<option value="${t}" ${defaultTime === t ? 'selected' : ''}>${t}</option>`
                                ).join('')}
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label>⌛ Длительность</label>
                            <select id="vpDuration" class="form-select">
                                ${[1,2,3,4].map(d => 
                                    `<option value="${d}" ${defaultDuration === d ? 'selected' : ''}>${d} час${d === 1 ? '' : 'а'}</option>`
                                ).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>👤 Клиент <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="vpCustomerName" class="form-input" value="${escapeHtml(vp?.customer_name || '')}" maxlength="100" placeholder="Имя клиента" required>
                    </div>
                    
                    <div class="form-group">
                        <label>🛡️ Админ <span style="color: #ef4444;">*</span></label>
                        <select id="vpAdmin" class="form-select" required>
                            <option value="">Выберите админа</option>
                            ${admins.map(emp => `<option value="${escapeHtml(emp)}" ${defaultAdmin === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>💰 Сумма (₽)</label>
                        <input type="number" id="vpAmount" class="form-input" value="${vp?.amount || 2000}" min="0" max="100000" placeholder="Например, 2000">
                    </div>
                    
                    <div class="form-group">
                        <label>💳 Тип оплаты</label>
                        <select id="vpPaymentType" class="form-select">
                            <option value="evotor_card" ${vp?.payment_type === 'evotor_card' ? 'selected' : ''}>💳 Эвотор (карта)</option>
                            <option value="evotor_cash" ${vp?.payment_type === 'evotor_cash' ? 'selected' : ''}>💵 Эвотор (нал)</option>
                            <option value="vtb" ${vp?.payment_type === 'vtb' ? 'selected' : ''}>🏦 ВТБ</option>
                            <option value="sber" ${vp?.payment_type === 'sber' ? 'selected' : ''}>🏦 Сбер</option>
                            <option value="not_paid" ${vp?.payment_type === 'not_paid' ? 'selected' : ''}>⏳ Не оплачено</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>📝 Комментарий</label>
                        <textarea id="vpComment" class="form-textarea" rows="3" maxlength="500" placeholder="Дополнительная информация...">${escapeHtml(vp?.comment || '')}</textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeVpModal()">Отмена</button>
                    ${vp ? `<button class="btn-secondary" onclick="resetVpForm()" title="Сбросить изменения"><i class="fas fa-undo-alt"></i> Сбросить</button>` : ''}
                    <button class="btn-primary" onclick="saveVp()" id="saveVpBtn">💾 Сохранить</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
    
    // Фокус на поле "Клиент"
    setTimeout(() => document.getElementById('vpCustomerName')?.focus(), 100);
    
    // Enter для сохранения
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeVpModal();
            document.removeEventListener('keydown', escHandler);
        } else if (e.key === 'Enter' && e.ctrlKey) {
            saveVp();
        }
    };
    document.addEventListener('keydown', escHandler);
    
    // Сохраняем обработчик в модалку
    const modal = document.getElementById('vpModal');
    modal._escHandler = escHandler;
}

function closeVpModal() {
    const modal = document.getElementById('vpModal');
    if (modal) {
        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
        }
        modal.remove();
    }
    document.body.style.overflow = '';
    originalVpData = null;
}

function resetVpForm() {
    if (!originalVpData) return;
    
    document.getElementById('vpEventDate').value = originalVpData.event_date || '';
    document.getElementById('vpEventTime').value = originalVpData.event_time || '10:00';
    document.getElementById('vpDuration').value = originalVpData.duration || 1;
    document.getElementById('vpCustomerName').value = originalVpData.customer_name || '';
    document.getElementById('vpAdmin').value = originalVpData.admin || '';
    document.getElementById('vpAmount').value = originalVpData.amount || 2000;
    document.getElementById('vpPaymentType').value = originalVpData.payment_type || 'evotor_card';
    document.getElementById('vpComment').value = originalVpData.comment || '';
    
    showNotif('Форма сброшена', 'info');
}

async function saveVp() {
    if (!canEditVp || isSavingVp) return;
    
    const vpId = document.getElementById('vpId')?.value;
    const eventDate = document.getElementById('vpEventDate')?.value;
    const eventTime = document.getElementById('vpEventTime')?.value;
    const duration = parseInt(document.getElementById('vpDuration')?.value) || 1;
    const customerName = document.getElementById('vpCustomerName')?.value.trim();
    const admin = document.getElementById('vpAdmin')?.value;
    const amount = parseInt(document.getElementById('vpAmount')?.value) || 0;
    const paymentType = document.getElementById('vpPaymentType')?.value;
    const comment = document.getElementById('vpComment')?.value || '';
    
    // Валидация
    if (!customerName) { showNotif('Введите имя клиента', 'error'); return; }
    if (!admin) { showNotif('Выберите админа', 'error'); return; }
    if (!eventDate) { showNotif('Выберите дату', 'error'); return; }
    if (amount < 0) { showNotif('Сумма не может быть отрицательной', 'error'); return; }
    
    const today = getTobolskNow().toISOString().split('T')[0];
    if (eventDate < today) {
        showNotif('❌ Нельзя создать мероприятие в прошлом', 'error');
        return;
    }
    
    // Проверка времени для сегодня
    if (eventDate === today) {
        const now = getTobolskNow();
        const currentHour = now.getHours();
        const currentMinutes = now.getMinutes();
        const [eventHour, eventMinutes] = eventTime.split(':').map(Number);
        
        if (eventHour < currentHour || (eventHour === currentHour && eventMinutes <= currentMinutes)) {
            showNotif('❌ Время мероприятия уже прошло', 'error');
            return;
        }
    }
    
    // Проверка на дубликат
    const isDuplicate = vpData.some(v => 
        v.event_date === eventDate && 
        v.event_time === eventTime && 
        v.customer_name === customerName &&
        (!vpId || v.id !== parseInt(vpId))
    );
    
    if (isDuplicate) {
        if (!confirm('⚠️ Похожее мероприятие уже существует. Всё равно создать?')) {
            return;
        }
    }
    
    isSavingVp = true;
    const saveBtn = document.getElementById('saveVpBtn');
    const originalText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
        saveBtn.disabled = true;
    }
    
    const vpDataToSend = { eventDate, eventTime, duration, customerName, admin, amount, paymentType, comment };
    
    try {
        let response;
        if (vpId) {
            response = await apiCall(`/vp/${vpId}`, 'PUT', vpDataToSend);
        } else {
            vpDataToSend.bookingDate = getTobolskNow().toISOString().split('T')[0];
            vpDataToSend.photoStatus = 'pending';
            vpDataToSend.scriptStatus = 'not_sent';
            response = await apiCall('/vp', 'POST', { vp: vpDataToSend });
        }
        
        if (response && response.success) {
            showNotif(vpId ? '✅ Обновлено' : '✅ Создано', 'success');
            closeVpModal();
            await loadVpData();
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error(err);
        showNotif('❌ Ошибка соединения', 'error');
    } finally {
        isSavingVp = false;
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }
}

// ============================================
// ФИЛЬТРЫ И ЭКСПОРТ
// ============================================

function resetVpFilters() {
    const searchInput = document.getElementById('vpSearch');
    const showArchivedCheckbox = document.getElementById('showArchived');
    const clearBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) {
        searchInput.value = '';
        vpFilters.search = '';
    }
    if (showArchivedCheckbox) {
        showArchivedCheckbox.checked = false;
        vpFilters.showArchived = false;
    }
    if (clearBtn) clearBtn.style.display = 'none';
    
    renderVpTable();
}

function exportVpToExcel() {
    const dataToExport = vpData.filter(v => !v.is_archived);
    if (dataToExport.length === 0) {
        showNotif('Нет данных для экспорта', 'warning');
        return;
    }
    
    const headers = ['Дата', 'Время', 'Клиент', 'Админ', 'Сумма', 'Оплата', 'Фото', 'Скрипт', 'Комментарий'];
    const rows = dataToExport.map(v => {
        const paymentTypeMap = {
            'evotor_card': 'Эвотор (карта)',
            'evotor_cash': 'Эвотор (нал)',
            'vtb': 'ВТБ',
            'sber': 'Сбер',
            'not_paid': 'Не оплачено'
        };
        
        return [
            formatDate(v.event_date),
            formatTimeWithDuration(v.event_time, v.duration),
            v.customer_name,
            v.admin || '—',
            v.amount,
            paymentTypeMap[v.payment_type] || v.payment_type,
            v.photo_status === 'sent' ? 'Отправлено' : 'Ожидает',
            v.script_status === 'sent' ? 'Отправлен' : 'Ожидает',
            (v.comment || '').replace(/[;"]/g, '')
        ];
    });
    
    const csvContent = [
        headers.join(';'),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vp_export_${vpCurrentYear}_${vpCurrentMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotif(`📊 Экспортировано ${dataToExport.length} мероприятий`, 'success');
}

function getCurrentPage() {
    return typeof window.getCurrentPage === 'function' ? window.getCurrentPage() : null;
}

function showNotif(msg, type) {
    if (typeof window.showNotif === 'function') {
        window.showNotif(msg, type);
    } else {
        console.log(`[${type}] ${msg}`);
    }
}

async function apiCall(endpoint, method = 'GET', body = null) {
    if (typeof window.apiCall === 'function') {
        return window.apiCall(endpoint, method, body);
    }
    console.warn('apiCall не найден');
    return { success: false, error: 'API недоступен' };
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initVp = initVp;
window.openVpModal = openVpModal;
window.closeVpModal = closeVpModal;
window.resetVpForm = resetVpForm;
window.saveVp = saveVp;
window.cancelVp = cancelVp;
window.restoreVp = restoreVp;
window.deleteVpPermanently = deleteVpPermanently;
window.updatePhotoStatus = updatePhotoStatus;
window.updateScriptStatus = updateScriptStatus;
window.resetVpFilters = resetVpFilters;
window.exportVpToExcel = exportVpToExcel;
window.showBookingDetails = showBookingDetails;
window.closeBookingDetailsModal = closeBookingDetailsModal;

console.log('✅ vp.js загружен (исправленная версия v3.0 с длительностью)');