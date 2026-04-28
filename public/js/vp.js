// public/js/vp.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v4.5
// Полный экспорт всех функций

let vpData = [];
let vpCurrentYear;
let vpCurrentMonth;
let canEditVp = false;
let isLoadingVp = false;
let isSavingVp = false;
let isUpdatingPhoto = false;
let isUpdatingScript = false;
let vpFilters = { search: '', showArchived: false };
let vpNotificationInterval = null;
let originalVpData = null;
let abortController = null;
let searchDebounceTimer = null;
let vpInitialized = false;

let vpStatusFilter = 'all';
let vpAdminFilter = 'all';
let vpMyOnly = false;
let vpSortState = { field: 'date', order: 'desc' };

const VP_START_YEAR = 2026;
const VP_START_MONTH = 3;
const VP_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const VP_SCRIPT_AVAILABLE_DAYS = 2;
const MAX_VP_AMOUNT = 1000000;

function resetVpState() { console.log('🧹 Сброс состояния ВП'); vpInitialized = false; if (vpNotificationInterval) { clearInterval(vpNotificationInterval); vpNotificationInterval = null; } if (typeof abortController !== 'undefined' && abortController) { abortController.abort(); abortController = null; } }

function getTobolskNow() { if (typeof window.getTobolskNow === 'function') return window.getTobolskNow(); const now = new Date(); return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' })); }

function formatDate(dateStr) { if (!dateStr) return '—'; if (typeof dateStr === 'string' && dateStr.includes('T')) dateStr = dateStr.split('T')[0]; const parts = dateStr.split('-'); if (parts.length !== 3) return '—'; const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])); if (isNaN(d.getTime())) return '—'; return d.toLocaleDateString('ru-RU'); }

function formatTimeWithDuration(eventTime, duration) { if (!eventTime) return '—'; const dur = duration || 1; const [hours, minutes] = eventTime.split(':').map(Number); const totalMinutes = hours * 60 + minutes + dur * 60; const endHours = Math.floor(totalMinutes / 60) % 24; const endMinutes = totalMinutes % 60; return `${eventTime.slice(0, 5)} - ${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`; }

function escapeHtml(str) { if (!str) return ''; const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }; return String(str).replace(/[&<>"']/g, m => map[m]); }

function showSystemNotification(message, type) { if (typeof window.showSystemNotification === 'function') window.showSystemNotification(message, type); else if (typeof window.showNotif === 'function') window.showNotif(message, type); else console.log(`[${type}] ${message}`); }

async function apiCall(endpoint, method = 'GET', body = null) { if (typeof window.originalApiCall === 'function') return window.originalApiCall(endpoint, method, body); if (typeof window.apiCall === 'function') return window.apiCall(endpoint, method, body); const token = localStorage.getItem('token'); const options = { method, headers: { 'Content-Type': 'application/json' } }; if (token) options.headers['Authorization'] = `Bearer ${token}`; if (body) options.body = JSON.stringify(body); try { const response = await fetch(`/api${endpoint}`, options); return await response.json(); } catch (e) { console.error('Fetch error:', e); return { success: false, error: 'Ошибка соединения' }; } }

function initVp() {
    if (vpInitialized) { console.log('🎮 ВП уже инициализирован'); return; }
    console.log('🎮 Инициализация ВП');
    
    const monthDisplay = document.getElementById('vpMonthDisplay');
    const yearDisplay = document.getElementById('vpYearDisplay');
    if (!monthDisplay || !yearDisplay) { setTimeout(initVp, 100); return; }
    
    const now = getTobolskNow();
    let todayYear = now.getFullYear(), todayMonth = now.getMonth() + 1;
    if (todayYear < VP_START_YEAR || (todayYear === VP_START_YEAR && todayMonth < VP_START_MONTH)) { 
        vpCurrentYear = VP_START_YEAR; 
        vpCurrentMonth = VP_START_MONTH; 
    } else { 
        vpCurrentYear = todayYear; 
        vpCurrentMonth = todayMonth; 
    }
    
    const role = window.app?.currentUserRole || 'operator';
    const profile = window.app?.profiles?.[window.app?.currentUser];
    canEditVp = (role === 'director' || role === 'manager' || (role === 'admin' && profile?.can_edit_vp === true));
    
    updateVpInterface();
    updateVpDisplay();
    updateMonthButtons();
    
    setupEventListeners();
    
    loadVpData();
    
    document.title = 'WARPOINT — Учёт мероприятий';
    
    if (vpNotificationInterval) clearInterval(vpNotificationInterval);
    vpNotificationInterval = setInterval(() => { 
        if (document.visibilityState === 'visible') renderVpTable(); 
    }, 60000);
    
    vpInitialized = true;
}
    else { vpCurrentYear = todayYear; vpCurrentMonth = todayMonth; }
    const role = window.app?.currentUserRole || 'operator';
    const profile = window.app?.profiles?.[window.app?.currentUser];
    canEditVp = (role === 'director' || role === 'manager' || (role === 'admin' && profile?.can_edit_vp === true));
    updateVpInterface(); updateVpDisplay(); updateMonthButtons(); loadVpData();
    document.title = 'WARPOINT — Учёт мероприятий';
    setupEventListeners();
    if (vpNotificationInterval) clearInterval(vpNotificationInterval);
    vpNotificationInterval = setInterval(() => { if (document.visibilityState === 'visible') renderVpTable(); }, 60000);
    vpInitialized = true;
}

function setupEventListeners() {
    var prevBtn = document.getElementById('vpPrevMonth');
    var nextBtn = document.getElementById('vpNextMonth');
    var addBtn = document.getElementById('vpAddBtn');
    
    if (prevBtn) prevBtn.onclick = function() { changeVpMonth(-1); };
    if (nextBtn) nextBtn.onclick = function() { changeVpMonth(1); };
    
    if (addBtn) {
        // Всегда назначаем обработчик
        addBtn.onclick = function() {
            if (!canEditVp) {
                showSystemNotification('❌ Нет прав для создания мероприятий', 'error');
                return;
            }
            openVpModal();
        };
        addBtn.style.display = canEditVp ? 'flex' : 'none';
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeVpModal();
            closeBookingDetailsModal();
        }
    });
}

function updateMonthButtons() {
    const prevBtn = document.getElementById('vpPrevMonth');
    if (prevBtn) { const isAtStart = (vpCurrentYear === VP_START_YEAR && vpCurrentMonth <= VP_START_MONTH); prevBtn.disabled = isAtStart; prevBtn.style.opacity = isAtStart ? '0.5' : '1'; prevBtn.style.cursor = isAtStart ? 'not-allowed' : 'pointer'; }
}

function changeVpMonth(delta) {
    if (isLoadingVp) return;
    let newMonth = vpCurrentMonth + delta, newYear = vpCurrentYear;
    if (newMonth > 12) { newMonth = 1; newYear++; } else if (newMonth < 1) { newMonth = 12; newYear--; }
    if (newYear < VP_START_YEAR || (newYear === VP_START_YEAR && newMonth < VP_START_MONTH)) { showSystemNotification('📅 Данные доступны с марта 2026 года', 'warning'); return; }
    vpCurrentMonth = newMonth; vpCurrentYear = newYear;
    vpSortState = { field: 'date', order: 'desc' };
    updateVpDisplay(); updateMonthButtons(); updateUrl();
    showSystemNotification(`📅 ${VP_MONTHS[vpCurrentMonth-1]} ${vpCurrentYear}`, 'info');
    loadVpData();
}

function updateVpDisplay() { document.getElementById('vpMonthDisplay').textContent = VP_MONTHS[vpCurrentMonth - 1]; document.getElementById('vpYearDisplay').textContent = vpCurrentYear; }
function updateUrl() { const url = new URL(window.location); url.searchParams.set('month', vpCurrentMonth); url.searchParams.set('year', vpCurrentYear); window.history.pushState({}, '', url); }

function updateVpInterface() {
    const accessBadge = document.getElementById('vpAccessBadge');
    if (accessBadge) { if (canEditVp) { accessBadge.innerHTML = '<i class="fas fa-edit"></i> Режим редактирования'; accessBadge.style.color = '#10b981'; accessBadge.style.borderColor = 'rgba(16,185,129,0.5)'; } else { accessBadge.innerHTML = '<i class="fas fa-eye"></i> Только просмотр'; accessBadge.style.color = '#64748b'; accessBadge.style.borderColor = 'rgba(100,116,139,0.3)'; } }
}

async function loadVpData() {
    if (isLoadingVp) return;
    if (typeof abortController !== 'undefined' && abortController) { abortController.abort(); }
if (typeof abortController !== 'undefined') { abortController = new AbortController(); }
    isLoadingVp = true;
    const tbody = document.getElementById('vpTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</td></tr>';
    try {
        const url = `/vp?month=${vpCurrentMonth}&year=${vpCurrentYear}&archived=${vpFilters.showArchived}`;
        const data = await apiCall(url);
        if (data && Array.isArray(data)) { vpData = data; updateVpStats(); renderVpTable(); showSystemNotification(`📊 Загружено ${vpData.length} мероприятий`, 'info'); }
        else if (data && data.success === false) { if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-state">❌ ${data.error}</td></tr>`; showSystemNotification('❌ Не удалось загрузить мероприятия', 'error'); }
        else { if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state">🎮 Нет мероприятий</td></tr>'; }
    } catch (err) { if (err.name !== 'AbortError') { console.error('Ошибка загрузки ВП:', err); if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state">❌ Ошибка загрузки данных</td></tr>'; showSystemNotification('❌ Ошибка загрузки данных', 'error'); } }
    finally { isLoadingVp = false; }
}

function updateVpStats() {
    const activeBookings = vpData.filter(v => !v.is_archived), archivedBookings = vpData.filter(v => v.is_archived === true);
    const total = activeBookings.length, totalAmount = activeBookings.reduce((sum, vp) => sum + (vp.amount || 0), 0);
    const photoPending = activeBookings.filter(v => v.photo_status === 'pending').length;
    const scriptNotSent = activeBookings.filter(v => v.script_status === 'not_sent').length;
    const unpaidOverdue = activeBookings.filter(v => { if (v.payment_type !== 'not_paid' || v.is_archived) return false; const daysAfterBooking = (new Date() - new Date(v.booking_date)) / (1000 * 60 * 60 * 24); return daysAfterBooking >= 2; }).length;
    document.getElementById('vpTotalCount').textContent = total;
    document.getElementById('vpTotalAmount').textContent = totalAmount.toLocaleString() + ' ₽';
    document.getElementById('vpPhotoPending').textContent = photoPending;
    document.getElementById('vpScriptPending').textContent = scriptNotSent;
    document.getElementById('vpArchivedCount').textContent = archivedBookings.length;
    const unpaidEl = document.getElementById('vpUnpaidOverdue'); if (unpaidEl) { unpaidEl.textContent = unpaidOverdue; unpaidEl.style.color = unpaidOverdue > 0 ? '#ef4444' : '#10b981'; }
}

function isPhotoActionAvailable(vp) { if (vp.photo_status === 'sent' || vp.is_archived || !vp.event_time) return false; const now = getTobolskNow(); let dateStr = typeof vp.event_date === 'string' && vp.event_date.includes('T') ? vp.event_date.split('T')[0] : vp.event_date; const [hours, minutes] = vp.event_time.split(':').map(Number); const eventEndTime = new Date(Date.UTC(parseInt(dateStr.split('-')[0]), parseInt(dateStr.split('-')[1]) - 1, parseInt(dateStr.split('-')[2]), hours - 5, minutes)); if (isNaN(eventEndTime.getTime())) return false; eventEndTime.setHours(eventEndTime.getHours() + (vp.duration || 1)); const today = new Date(now); today.setUTCHours(0,0,0,0); const eventDate = new Date(Date.UTC(parseInt(dateStr.split('-')[0]), parseInt(dateStr.split('-')[1]) - 1, parseInt(dateStr.split('-')[2]))); if (eventDate > today) return false; return now >= eventEndTime; }
function isScriptActionAvailable(vp) { if (vp.script_status === 'sent' || vp.is_archived || !vp.event_time) return false; const now = getTobolskNow(); let dateStr = typeof vp.event_date === 'string' && vp.event_date.includes('T') ? vp.event_date.split('T')[0] : vp.event_date; const [hours, minutes] = vp.event_time.split(':').map(Number); const eventDateTime = new Date(Date.UTC(parseInt(dateStr.split('-')[0]), parseInt(dateStr.split('-')[1]) - 1, parseInt(dateStr.split('-')[2]), hours - 5, minutes)); if (isNaN(eventDateTime.getTime())) return false; const availableDate = new Date(eventDateTime.getTime() + VP_SCRIPT_AVAILABLE_DAYS * 24 * 60 * 60 * 1000); return now >= availableDate; }

function getPhotoStatusClass(vp) { if (vp.is_archived) return 'status-archived'; if (vp.photo_status === 'sent') return 'status-success'; if (isPhotoActionAvailable(vp)) return 'status-warning'; return 'status-pending'; }
function getPhotoStatusText(vp) { if (vp.is_archived) return '📦 Отменено'; if (vp.photo_status === 'sent') return '📸 Отправлено'; if (isPhotoActionAvailable(vp)) return '📸 Можно отметить'; return '⏳ Ожидает'; }
function getScriptStatusClass(vp) { if (vp.is_archived) return 'status-archived'; if (vp.script_status === 'sent') return 'status-success'; if (isScriptActionAvailable(vp)) return 'status-warning'; return 'status-pending'; }
function getScriptStatusText(vp) { if (vp.is_archived) return '📦 Отменено'; if (vp.script_status === 'sent') return '📝 Отправлен'; if (isScriptActionAvailable(vp)) return '📝 Можно отметить'; return '⏳ Ожидает'; }

async function updatePhotoStatus(id) { if (!canEditVp || isUpdatingPhoto) return; const vp = vpData.find(v => v.id === id); if (!vp || vp.is_archived) return; if (!isPhotoActionAvailable(vp)) { showSystemNotification('❌ Сейчас нельзя отметить фото', 'warning'); return; } isUpdatingPhoto = true; try { const response = await apiCall(`/vp/${id}`, 'PUT', { photoStatus: 'sent' }); if (response && response.success) { vp.photo_status = 'sent'; renderVpTable(); updateVpStats(); showSystemNotification('📸 Фото отмечено', 'success'); } else { showSystemNotification('❌ Ошибка при обновлении', 'error'); } } finally { isUpdatingPhoto = false; } }
async function updateScriptStatus(id) { if (!canEditVp || isUpdatingScript) return; const vp = vpData.find(v => v.id === id); if (!vp || vp.is_archived) return; if (!isScriptActionAvailable(vp)) { showSystemNotification('❌ Сейчас нельзя отметить скрипт', 'warning'); return; } isUpdatingScript = true; try { const response = await apiCall(`/vp/${id}`, 'PUT', { scriptStatus: 'sent' }); if (response && response.success) { vp.script_status = 'sent'; renderVpTable(); updateVpStats(); showSystemNotification('📝 Скрипт отмечен', 'success'); } else { showSystemNotification('❌ Ошибка при обновлении', 'error'); } } finally { isUpdatingScript = false; } }

function renderVpTable() {
    const tbody = document.getElementById('vpTableBody'); if (!tbody) return;
    let filtered = [...vpData];
    if (vpFilters.search) filtered = filtered.filter(v => (v.customer_name && v.customer_name.toLowerCase().includes(vpFilters.search)) || (v.admin && v.admin.toLowerCase().includes(vpFilters.search)));
    if (vpStatusFilter !== 'all') { if (vpStatusFilter === 'photo_pending') filtered = filtered.filter(v => v.photo_status === 'pending' && !v.is_archived); else if (vpStatusFilter === 'script_pending') filtered = filtered.filter(v => v.script_status === 'not_sent' && !v.is_archived); else if (vpStatusFilter === 'unpaid') filtered = filtered.filter(v => { if (v.payment_type !== 'not_paid' || v.is_archived) return false; const daysAfterBooking = (new Date() - new Date(v.booking_date)) / (1000 * 60 * 60 * 24); return daysAfterBooking >= 2; }); }
    if (vpAdminFilter !== 'all') filtered = filtered.filter(v => v.admin === vpAdminFilter);
    if (vpMyOnly) filtered = filtered.filter(v => v.admin === window.app?.currentUser);
    filtered.sort((a, b) => { let aVal = a[vpSortState.field], bVal = b[vpSortState.field]; if (vpSortState.field === 'date') { aVal = new Date(a.event_date); bVal = new Date(b.event_date); } else if (vpSortState.field === 'customer') { aVal = (a.customer_name || '').toLowerCase(); bVal = (b.customer_name || '').toLowerCase(); } else if (vpSortState.field === 'admin') { aVal = (a.admin || '').toLowerCase(); bVal = (b.admin || '').toLowerCase(); } else if (vpSortState.field === 'amount') { aVal = a.amount || 0; bVal = b.amount || 0; } return vpSortState.order === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1); });
    if (filtered.length === 0) { const message = vpFilters.search ? '🔍 Ничего не найдено' : (vpFilters.showArchived ? '📦 В архиве нет мероприятий' : '🎮 Нет мероприятий'); tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px;">${message}</td></tr>`; updateVpStats(); return; }
    const today = getTobolskNow().toISOString().split('T')[0];
    const paymentTypeMap = { 'evotor_card': '💳 Эвотор (карта)', 'evotor_cash': '💵 Эвотор (нал)', 'vtb': '🏦 ВТБ', 'sber': '🏦 Сбер', 'not_paid': '⏳ Не оплачено' };
    tbody.innerHTML = filtered.map(vp => {
        const photoStatusClass = getPhotoStatusClass(vp), photoStatusText = getPhotoStatusText(vp), isPhotoActive = !vp.is_archived && isPhotoActionAvailable(vp) && vp.photo_status !== 'sent';
        const scriptStatusClass = getScriptStatusClass(vp), scriptStatusText = getScriptStatusText(vp), isScriptActive = !vp.is_archived && isScriptActionAvailable(vp) && vp.script_status !== 'sent';
        const isUnpaid = !vp.is_archived && vp.payment_type === 'not_paid' && (new Date() - new Date(vp.booking_date)) / (1000 * 60 * 60 * 24) >= 2;
        const isPast = (() => { const now = getTobolskNow(); let dateStr = typeof vp.event_date === 'string' && vp.event_date.includes('T') ? vp.event_date.split('T')[0] : vp.event_date; const [hours, minutes] = vp.event_time.split(':').map(Number); const eventDateTime = new Date(Date.UTC(parseInt(dateStr.split('-')[0]), parseInt(dateStr.split('-')[1]) - 1, parseInt(dateStr.split('-')[2]), hours - 5, minutes)); if (isNaN(eventDateTime.getTime())) return false; const eventEndTime = new Date(eventDateTime.getTime() + (vp.duration || 1) * 60 * 60 * 1000); return now > eventEndTime; })();
        const isToday = vp.event_date === today;
        let rowClass = isUnpaid ? 'vp-row-unpaid' : (isPast ? 'vp-row-past' : (isToday ? 'vp-row-today' : ''));
        return `<tr class="${rowClass}" onclick="window.showBookingDetails(${vp.id})" style="cursor: pointer;"><td>${formatDate(vp.event_date)}</td><td>${formatTimeWithDuration(vp.event_time, vp.duration)}</td><td><strong class="clickable-customer">${escapeHtml(vp.customer_name)}</strong></td><td class="admin-cell">${escapeHtml(vp.admin || '—')}</td><td>${(vp.amount || 0).toLocaleString()} ₽</td><td><span class="payment-badge payment-${vp.payment_type}">${paymentTypeMap[vp.payment_type] || vp.payment_type}</span></td><td onclick="event.stopPropagation()">${canEditVp && isPhotoActive ? `<button class="btn-action btn-photo" onclick="window.updatePhotoStatus(${vp.id})"><i class="fas fa-camera"></i> Отметить</button>` : `<span class="status-badge ${photoStatusClass}">${photoStatusText}</span>`}</td><td onclick="event.stopPropagation()">${canEditVp && isScriptActive ? `<button class="btn-action btn-script" onclick="window.updateScriptStatus(${vp.id})"><i class="fas fa-paper-plane"></i> Отметить</button>` : `<span class="status-badge ${scriptStatusClass}">${scriptStatusText}</span>`}</td><td style="white-space: nowrap;" onclick="event.stopPropagation()">${canEditVp && !vp.is_archived ? `<button class="btn-small" onclick="window.openVpModal(${vp.id})"><i class="fas fa-edit"></i></button>` : ''}${canEditVp && !vp.is_archived ? `<button class="btn-small btn-delete" onclick="window.cancelVp(${vp.id})"><i class="fas fa-archive"></i></button>` : ''}${canEditVp && vp.is_archived ? `<button class="btn-small btn-restore" onclick="window.restoreVp(${vp.id})"><i class="fas fa-undo"></i></button>` : ''}${canEditVp && vp.is_archived ? `<button class="btn-small btn-danger" onclick="window.deleteVpPermanently(${vp.id})"><i class="fas fa-trash-alt"></i></button>` : ''}</td></tr>`;
    }).join('');
    updateVpStats();
}

function showBookingDetails(vpId) {
    const vp = vpData.find(v => v.id === vpId); if (!vp) return;
    const paymentTypeMap = { 'evotor_card': '💳 Эвотор (карта)', 'evotor_cash': '💵 Эвотор (нал)', 'vtb': '🏦 ВТБ', 'sber': '🏦 Сбер', 'not_paid': '⏳ Не оплачено' };
    const modalHtml = `<div id="bookingDetailsModal" class="modal active" onclick="window.closeBookingDetailsModal()"><div class="modal-window" style="max-width:550px;max-height:85vh;overflow-y:auto;" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-icon"><i class="fas fa-info-circle"></i></div><div class="modal-title"><h3>Детали мероприятия</h3><p>${escapeHtml(vp.customer_name)}</p></div><button class="modal-close" onclick="window.closeBookingDetailsModal()">&times;</button></div><div class="modal-body"><div class="details-section"><div class="section-title"><i class="fas fa-calendar-alt"></i> Дата и время</div><div class="detail-row"><span class="detail-label">Дата:</span><span class="detail-value">${formatDate(vp.event_date)}</span></div><div class="detail-row"><span class="detail-label">Время:</span><span class="detail-value">${formatTimeWithDuration(vp.event_time, vp.duration)}</span></div><div class="detail-row"><span class="detail-label">Длительность:</span><span class="detail-value">${vp.duration || 1} час(а)</span></div></div><div class="details-section"><div class="section-title"><i class="fas fa-user"></i> Клиент и админ</div><div class="detail-row"><span class="detail-label">Клиент:</span><span class="detail-value"><strong>${escapeHtml(vp.customer_name)}</strong></span></div><div class="detail-row"><span class="detail-label">Админ:</span><span class="detail-value">${escapeHtml(vp.admin || '—')}</span></div><div class="detail-row"><span class="detail-label">Создал:</span><span class="detail-value">${escapeHtml(vp.created_by || '—')}</span></div></div><div class="details-section"><div class="section-title"><i class="fas fa-credit-card"></i> Финансы</div><div class="detail-row"><span class="detail-label">Сумма:</span><span class="detail-value amount">${(vp.amount || 0).toLocaleString()} ₽</span></div><div class="detail-row"><span class="detail-label">Оплата:</span><span class="detail-value">${paymentTypeMap[vp.payment_type] || vp.payment_type}</span></div><div class="detail-row"><span class="detail-label">Дата брони:</span><span class="detail-value">${formatDate(vp.booking_date)}</span></div></div>${vp.comment ? `<div class="details-section"><div class="section-title"><i class="fas fa-comment"></i> Комментарий</div><div class="comment-box">${escapeHtml(vp.comment)}</div></div>` : ''}<div class="details-section"><div class="section-title"><i class="fas fa-chart-bar"></i> Статусы</div><div class="detail-row"><span class="detail-label">Фото:</span><span class="detail-value"><span class="status-badge ${getPhotoStatusClass(vp)}">${getPhotoStatusText(vp)}</span></span></div><div class="detail-row"><span class="detail-label">Скрипт:</span><span class="detail-value"><span class="status-badge ${getScriptStatusClass(vp)}">${getScriptStatusText(vp)}</span></span></div></div></div><div class="modal-footer"><button class="btn-secondary" onclick="window.closeBookingDetailsModal()">Закрыть</button>${canEditVp && !vp.is_archived ? `<button class="btn-primary" onclick="window.closeBookingDetailsModal();window.openVpModal(${vp.id})"><i class="fas fa-edit"></i> Редактировать</button>` : ''}</div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml); document.body.style.overflow = 'hidden';
}
function closeBookingDetailsModal() { document.getElementById('bookingDetailsModal')?.remove(); document.body.style.overflow = ''; }

async function restoreVp(vpId) { if (!canEditVp) return; if (!confirm('Восстановить мероприятие из архива?')) return; const response = await apiCall(`/vp/${vpId}`, 'PUT', { is_archived: false }); if (response?.success) { showSystemNotification('📦 Мероприятие восстановлено', 'success'); await loadVpData(); } else { showSystemNotification('❌ Ошибка восстановления', 'error'); } }
async function deleteVpPermanently(vpId) { if (!canEditVp) return; if (window.app?.currentUserRole !== 'director') { showSystemNotification('❌ Только директор может удалять навсегда', 'error'); return; } if (!confirm('⚠️ Навсегда удалить мероприятие?')) return; if (!confirm('Точно?')) return; const response = await apiCall(`/vp/${vpId}`, 'DELETE'); if (response?.success) { showSystemNotification('🗑️ Мероприятие удалено навсегда', 'warning'); vpData = vpData.filter(v => v.id !== vpId); renderVpTable(); updateVpStats(); } else { showSystemNotification('❌ Ошибка удаления', 'error'); } }
async function cancelVp(vpId) { if (!canEditVp) return; if (!confirm('Переместить мероприятие в архив?')) return; const response = await apiCall(`/vp/${vpId}`, 'PUT', { is_archived: true }); if (response?.success) { showSystemNotification('📦 Мероприятие перемещено в архив', 'info'); await loadVpData(); } else { showSystemNotification('❌ Ошибка архивации', 'error'); } }

function openVpModal(vpId = null) { if (!canEditVp) return; const vp = vpId ? vpData.find(v => v.id === vpId) : null; originalVpData = vp ? { ...vp } : null; const employees = window.app?.employees || []; const profiles = window.app?.profiles || {}; const admins = employees.filter(emp => profiles[emp]?.role === 'admin' || profiles[emp]?.role === 'manager'); const currentUser = window.app?.currentUser; const today = getTobolskNow().toISOString().split('T')[0]; let defaultDate = today; if (vp?.event_date) { defaultDate = typeof vp.event_date === 'string' && vp.event_date.includes('T') ? vp.event_date.split('T')[0] : vp.event_date; } const defaultTime = vp?.event_time || '10:00'; const defaultDuration = vp?.duration || 1; const isCurrentUserAdmin = admins.includes(currentUser); const defaultAdmin = vp?.admin || (isCurrentUserAdmin ? currentUser : ''); const modalHtml = `<div id="vpModal" class="modal active" onclick="window.closeVpModal()"><div class="modal-window" style="max-width:550px;" onclick="event.stopPropagation()"><div class="modal-header"><div class="modal-icon"><i class="fas fa-gamepad"></i></div><div class="modal-title"><h3>${vp ? '✏️ Редактирование' : '➕ Новое мероприятие'}</h3></div><button class="modal-close" onclick="window.closeVpModal()">&times;</button></div><div class="modal-body"><input type="hidden" id="vpId" value="${vp?.id || ''}"><div class="form-group"><label>📅 Дата <span style="color:#ef4444;">*</span></label><input type="date" id="vpEventDate" class="form-input" value="${defaultDate}" min="${today}" required></div><div class="form-row-2"><div class="form-group"><label>⏰ Время начала</label><select id="vpEventTime" class="form-select">${['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'].map(t => `<option value="${t}" ${defaultTime === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="form-group"><label>⌛ Длительность</label><select id="vpDuration" class="form-select">${[1,2,3,4].map(d => `<option value="${d}" ${defaultDuration === d ? 'selected' : ''}>${d} час${d === 1 ? '' : 'а'}</option>`).join('')}</select></div></div><div class="form-group"><label>👤 Клиент <span style="color:#ef4444;">*</span></label><input type="text" id="vpCustomerName" class="form-input" value="${escapeHtml(vp?.customer_name || '')}" maxlength="100" required></div><div class="form-group"><label>🛡️ Админ <span style="color:#ef4444;">*</span></label><select id="vpAdmin" class="form-select" required><option value="">Выберите админа</option>${admins.map(emp => `<option value="${escapeHtml(emp)}" ${defaultAdmin === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`).join('')}</select></div><div class="form-group"><label>💰 Сумма (₽)</label><input type="number" id="vpAmount" class="form-input" value="${vp?.amount || 2000}" min="0" max="${MAX_VP_AMOUNT}"></div><div class="form-group"><label>💳 Тип оплаты</label><select id="vpPaymentType" class="form-select"><option value="evotor_card" ${vp?.payment_type === 'evotor_card' ? 'selected' : ''}>💳 Эвотор (карта)</option><option value="evotor_cash" ${vp?.payment_type === 'evotor_cash' ? 'selected' : ''}>💵 Эвотор (нал)</option><option value="vtb" ${vp?.payment_type === 'vtb' ? 'selected' : ''}>🏦 ВТБ</option><option value="sber" ${vp?.payment_type === 'sber' ? 'selected' : ''}>🏦 Сбер</option><option value="not_paid" ${vp?.payment_type === 'not_paid' ? 'selected' : ''}>⏳ Не оплачено</option></select></div><div class="form-group"><label>📝 Комментарий</label><textarea id="vpComment" class="form-textarea" rows="3" maxlength="500">${escapeHtml(vp?.comment || '')}</textarea></div></div><div class="modal-footer"><button class="btn-secondary" onclick="window.closeVpModal()">Отмена</button>${vp ? '<button class="btn-secondary" onclick="window.resetVpForm()"><i class="fas fa-undo-alt"></i> Сбросить</button>' : ''}<button class="btn-primary" onclick="window.saveVp()" id="saveVpBtn">💾 Сохранить</button></div></div></div>`; document.body.insertAdjacentHTML('beforeend', modalHtml); document.body.style.overflow = 'hidden'; setTimeout(() => document.getElementById('vpCustomerName')?.focus(), 100); }
function closeVpModal() { document.getElementById('vpModal')?.remove(); document.body.style.overflow = ''; originalVpData = null; }
function resetVpForm() { if (!originalVpData) return; document.getElementById('vpEventDate').value = originalVpData.event_date || ''; document.getElementById('vpEventTime').value = originalVpData.event_time || '10:00'; document.getElementById('vpDuration').value = originalVpData.duration || 1; document.getElementById('vpCustomerName').value = originalVpData.customer_name || ''; document.getElementById('vpAdmin').value = originalVpData.admin || ''; document.getElementById('vpAmount').value = originalVpData.amount || 2000; document.getElementById('vpPaymentType').value = originalVpData.payment_type || 'evotor_card'; document.getElementById('vpComment').value = originalVpData.comment || ''; showSystemNotification('🔄 Форма сброшена', 'info'); }

async function saveVp() { if (!canEditVp || isSavingVp) return; const vpId = document.getElementById('vpId')?.value; const eventDate = document.getElementById('vpEventDate')?.value; const eventTime = document.getElementById('vpEventTime')?.value; const duration = parseInt(document.getElementById('vpDuration')?.value) || 1; const customerName = document.getElementById('vpCustomerName')?.value.trim(); const admin = document.getElementById('vpAdmin')?.value; const amount = parseInt(document.getElementById('vpAmount')?.value) || 0; const paymentType = document.getElementById('vpPaymentType')?.value; const comment = document.getElementById('vpComment')?.value || ''; if (!customerName || !admin || !eventDate) { showSystemNotification('❌ Заполните обязательные поля', 'error'); return; } if (amount > MAX_VP_AMOUNT) { showSystemNotification(`❌ Максимальная сумма: ${MAX_VP_AMOUNT.toLocaleString()} ₽`, 'error'); return; } const today = getTobolskNow().toISOString().split('T')[0]; if (eventDate < today) { showSystemNotification('❌ Нельзя создать мероприятие в прошлом', 'error'); return; } if (eventDate === today) { const now = getTobolskNow(); const currentHour = now.getHours(), currentMinutes = now.getMinutes(); const [eventHour, eventMinutes] = eventTime.split(':').map(Number); if (eventHour < currentHour || (eventHour === currentHour && eventMinutes <= currentMinutes)) { showSystemNotification('❌ Время мероприятия уже прошло', 'error'); return; } } const [startHour] = eventTime.split(':').map(Number); if (startHour + duration > 22) { showSystemNotification('❌ Длительность не может выходить за 22:00', 'error'); return; } isSavingVp = true; const saveBtn = document.getElementById('saveVpBtn'); if (saveBtn) { saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...'; saveBtn.disabled = true; } try { const vpDataToSend = { eventDate, eventTime, duration, customerName, admin, amount, paymentType, comment }; let response; if (vpId) { response = await apiCall(`/vp/${vpId}`, 'PUT', vpDataToSend); } else { vpDataToSend.bookingDate = today; vpDataToSend.photoStatus = 'pending'; vpDataToSend.scriptStatus = 'not_sent'; response = await apiCall('/vp', 'POST', { vp: vpDataToSend }); } if (response?.success) { showSystemNotification(vpId ? '✅ Мероприятие обновлено' : '✅ Мероприятие создано', 'success'); closeVpModal(); await loadVpData(); } else { showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error'); } } finally { isSavingVp = false; if (saveBtn) { saveBtn.innerHTML = '💾 Сохранить'; saveBtn.disabled = false; } } }

function resetVpFilters() { document.getElementById('vpSearch').value = ''; document.getElementById('showArchived').checked = false; document.getElementById('vpStatusFilter').value = 'all'; document.getElementById('vpAdminFilter').value = 'all'; document.getElementById('filterMyOnly').checked = false; vpFilters.search = ''; vpFilters.showArchived = false; vpStatusFilter = 'all'; vpAdminFilter = 'all'; vpMyOnly = false; showSystemNotification('🔄 Фильтры сброшены', 'info'); loadVpData(); }
function filterByStatus() { vpStatusFilter = document.getElementById('vpStatusFilter')?.value || 'all'; renderVpTable(); }
function filterByAdmin() { vpAdminFilter = document.getElementById('vpAdminFilter')?.value || 'all'; renderVpTable(); }
function filterMyOnly() { vpMyOnly = document.getElementById('filterMyOnly')?.checked || false; renderVpTable(); }
function sortVpBy(field) { if (vpSortState.field === field) { vpSortState.order = vpSortState.order === 'asc' ? 'desc' : 'asc'; } else { vpSortState.field = field; vpSortState.order = 'asc'; } document.querySelectorAll('.vp-table th i').forEach(i => i.className = 'fas fa-sort'); const activeTh = document.querySelector(`.vp-table th[data-field="${field}"] i`); if (activeTh) { activeTh.className = vpSortState.order === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down'; } renderVpTable(); }

function exportVpToExcel() { const dataToExport = vpFilters.showArchived ? vpData : vpData.filter(v => !v.is_archived); if (dataToExport.length === 0) { showSystemNotification('⚠️ Нет данных для экспорта', 'warning'); return; } const headers = ['Дата', 'Время', 'Клиент', 'Админ', 'Сумма', 'Оплата', 'Фото', 'Скрипт', 'Комментарий', 'Длительность']; const rows = dataToExport.map(v => [formatDate(v.event_date), formatTimeWithDuration(v.event_time, v.duration), v.customer_name, v.admin || '—', v.amount, { 'evotor_card': 'Эвотор (карта)', 'evotor_cash': 'Эвотор (нал)', 'vtb': 'ВТБ', 'sber': 'Сбер', 'not_paid': 'Не оплачено' }[v.payment_type] || v.payment_type, v.photo_status === 'sent' ? 'Отправлено' : 'Ожидает', v.script_status === 'sent' ? 'Отправлен' : 'Ожидает', (v.comment || '').replace(/[;"]/g, ''), (v.duration || 1) + ' час(а)']); const csvContent = [headers.join(';'), ...rows.map(r => r.map(c => `"${c}"`).join(';'))].join('\n'); const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `vp_export_${vpCurrentYear}_${vpCurrentMonth}.csv`; a.click(); URL.revokeObjectURL(a.href); showSystemNotification(`📊 Экспортировано ${dataToExport.length} мероприятий`, 'success'); }

function goToToday() { const now = getTobolskNow(); vpCurrentYear = now.getFullYear(); vpCurrentMonth = now.getMonth() + 1; if (vpCurrentYear < VP_START_YEAR || (vpCurrentYear === VP_START_YEAR && vpCurrentMonth < VP_START_MONTH)) { vpCurrentYear = VP_START_YEAR; vpCurrentMonth = VP_START_MONTH; } vpSortState = { field: 'date', order: 'desc' }; updateVpDisplay(); updateMonthButtons(); updateUrl(); showSystemNotification('📅 Переход к текущему месяцу', 'info'); loadVpData(); }

// ЭКСПОРТ В WINDOW
window.initVp = initVp;
window.resetVpState = resetVpState;
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
window.filterByStatus = filterByStatus;
window.filterByAdmin = filterByAdmin;
window.filterMyOnly = filterMyOnly;
window.sortVpBy = sortVpBy;
window.exportVpToExcel = exportVpToExcel;
window.showBookingDetails = showBookingDetails;
window.closeBookingDetailsModal = closeBookingDetailsModal;
window.goToToday = goToToday;
window.changeVpMonth = changeVpMonth;
window.loadVpData = loadVpData;
window.renderVpTable = renderVpTable;
window.vpFilters = vpFilters;

console.log('✅ vp.js загружен (v4.5 — полный экспорт)');