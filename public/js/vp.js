// public/js/vp.js - ФИНАЛЬНАЯ ВЕРСИЯ

let vpData = [];
let vpCurrentYear = 2026;
let vpCurrentMonth = 3;
let canEditVp = false;
let isLoadingVp = false;

const VP_START_YEAR = 2026;
const VP_START_MONTH = 3;
const VP_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function initVp() {
    console.log('🎮 Инициализация ВП (мероприятий)');
    
    const monthDisplay = document.getElementById('vpMonthDisplay');
    const yearDisplay = document.getElementById('vpYearDisplay');
    const prevBtn = document.getElementById('vpPrevMonth');
    const nextBtn = document.getElementById('vpNextMonth');
    const addBtn = document.getElementById('vpAddBtn');
    const searchInput = document.getElementById('vpSearch');
    const showArchivedCheckbox = document.getElementById('showArchived');
    
    if (!monthDisplay || !yearDisplay) {
        setTimeout(initVp, 100);
        return;
    }
    
    const now = new Date();
    let todayYear = now.getFullYear();
    let todayMonth = now.getMonth() + 1;
    
    if (todayYear < VP_START_YEAR || (todayYear === VP_START_YEAR && todayMonth < VP_START_MONTH)) {
        vpCurrentYear = VP_START_YEAR;
        vpCurrentMonth = VP_START_MONTH;
    } else {
        vpCurrentYear = todayYear;
        vpCurrentMonth = todayMonth;
    }
    
    const role = window.app.currentUserRole;
    canEditVp = (role === 'director' || role === 'manager' || role === 'admin');
    
    updateVpInterface();
    updateVpDisplay();
    loadVpData();
    
    if (prevBtn) {
        prevBtn.onclick = () => changeVpMonth(-1);
    }
    if (nextBtn) {
        nextBtn.onclick = () => changeVpMonth(1);
    }
    if (addBtn) {
        addBtn.style.display = canEditVp ? 'flex' : 'none';
        addBtn.onclick = () => openVpModal();
    }
    if (searchInput) {
        searchInput.oninput = () => renderVpTable();
    }
    if (showArchivedCheckbox) {
        showArchivedCheckbox.onchange = (e) => {
            window.showArchived = e.target.checked;
            loadVpData();
        };
    }
    
    if (window.notificationCheckInterval) clearInterval(window.notificationCheckInterval);
    window.notificationCheckInterval = setInterval(() => {
        if (typeof renderVpTable === 'function') {
            renderVpTable();
        }
    }, 60 * 1000);
}

window.showArchived = false;

function changeVpMonth(delta) {
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
    loadVpData();
}

function updateVpDisplay() {
    const monthDisplay = document.getElementById('vpMonthDisplay');
    const yearDisplay = document.getElementById('vpYearDisplay');
    
    if (monthDisplay) monthDisplay.textContent = VP_MONTHS[vpCurrentMonth - 1];
    if (yearDisplay) yearDisplay.textContent = vpCurrentYear;
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

function checkEditAccess() {
    if (!canEditVp) {
        showNotif('🔒 У вас нет прав на редактирование', 'warning');
        return false;
    }
    return true;
}

async function loadVpData() {
    if (isLoadingVp) return;
    isLoadingVp = true;
    
    const tbody = document.getElementById('vpTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...<\/td></tr>';
    }
    
    try {
        const archivedParam = window.showArchived ? 'true' : 'false';
        const url = `/vp?month=${vpCurrentMonth}&year=${vpCurrentYear}&archived=${archivedParam}`;
        const data = await apiCall(url);
        
        if (data && Array.isArray(data)) {
            vpData = data;
            updateVpStats();
            renderVpTable();
        } else if (data && data.success === false) {
            console.error('Ошибка:', data.error);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" class="empty-state">❌ ${data.error}<\/td></tr>`;
            }
        }
    } catch (err) {
        console.error('Ошибка загрузки ВП:', err);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">❌ Ошибка загрузки данных<\/td></tr>';
        }
    } finally {
        isLoadingVp = false;
    }
}

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

function isUnpaidOverdue(vp) {
    // Только если статус оплаты "Не оплачено"
    if (vp.payment_type !== 'not_paid') return false;
    // Если в архиве — не подсвечиваем
    if (vp.is_archived) return false;
    
    const bookingDate = new Date(vp.booking_date);
    const daysAfterBooking = (new Date() - bookingDate) / (1000 * 60 * 60 * 24);
    
    // Если прошло 2 и более дня
    return daysAfterBooking >= 2;
}

function isPhotoActionAvailable(vp) {
    // Если уже отмечено - не активна
    if (vp.photo_status === 'sent') return false;
    // Если в архиве - не активна
    if (vp.is_archived) return false;
    
    // Проверяем, есть ли время мероприятия
    if (!vp.event_time || vp.event_time === 'null' || vp.event_time === '') {
        return false;
    }
    
    const now = new Date();
    
    // Берем event_date из строки (только YYYY-MM-DD)
    let dateStr = vp.event_date;
    if (dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
    }
    
    // Формируем правильную дату и время начала мероприятия
    const eventDateTimeStr = `${dateStr}T${vp.event_time}`;
    const eventStartTime = new Date(eventDateTimeStr);
    
    // Проверяем, корректная ли дата
    if (isNaN(eventStartTime.getTime())) {
        return false;
    }
    
    const minutesBeforeEnd = 5;
    const eventEndTime = new Date(eventStartTime.getTime() + minutesBeforeEnd * 60 * 1000);
    
    // ЖЁСТКАЯ ПРОВЕРКА: мероприятие должно быть сегодня или в прошлом
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(dateStr);
    eventDate.setHours(0, 0, 0, 0);
    
    // Если мероприятие в будущем (завтра или позже) - кнопка не активна
    if (eventDate > today) {
        console.log('Мероприятие в будущем, кнопка не активна');
        return false;
    }
    
    // Если мероприятие сегодня или в прошлом - проверяем время
    // Кнопка активна только если сейчас >= (время окончания - 5 минут)
    const result = now >= eventEndTime;
    
    console.log('Сейчас:', now);
    console.log('Начало мероприятия:', eventStartTime);
    console.log('Окончание мероприятия (мин. до конца):', eventEndTime);
    console.log('Можно отметить:', result);
    
    return result;
}
function isScriptActionAvailable(vp) {
    if (vp.script_status === 'sent') return false;
    if (vp.is_archived) return false;
    
    if (!vp.event_time || vp.event_time === 'null' || vp.event_time === '') {
        return false;
    }
    
    const now = new Date();
    
    let dateStr = vp.event_date;
    if (dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
    }
    
    const eventDateTimeStr = `${dateStr}T${vp.event_time}`;
    const eventDateTime = new Date(eventDateTimeStr);
    
    if (isNaN(eventDateTime.getTime())) {
        return false;
    }
    
    const daysAfterEvent = 2;
    const availableDate = new Date(eventDateTime.getTime() + daysAfterEvent * 24 * 60 * 60 * 1000);
    
    return now >= availableDate;
}

function getPhotoStatusClass(vp) {
    if (vp.is_archived) return 'status-archived';
    if (vp.photo_status === 'sent') return 'status-success';
    if (isPhotoActionAvailable(vp)) return 'status-warning';
    return 'status-pending';
}

function getPhotoStatusText(vp) {
    if (vp.is_archived) return '📦 Отменено';
    if (vp.photo_status === 'sent') return '✅ Отправлено';
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
    if (vp.script_status === 'sent') return '✅ Отправлен';
    if (isScriptActionAvailable(vp)) return '📝 Можно отметить';
    return '⏳ Ожидает';
}

async function updatePhotoStatus(id) {
    if (!canEditVp) return;
    
    const vp = vpData.find(v => v.id === id);
    if (!vp) return;
    
    if (vp.is_archived) {
        showNotif('❌ Нельзя отметить фото у отменённого мероприятия', 'warning');
        return;
    }
    
    if (!isPhotoActionAvailable(vp)) {
        showNotif('❌ Сейчас нельзя отметить фото. Кнопка станет доступна за 5 минут до окончания мероприятия и останется доступной после.', 'warning');
        return;
    }
    
    if (vp.photo_status === 'sent') {
        showNotif('Фото уже отмечено как отправленное', 'info');
        return;
    }
    
    const response = await apiCall(`/vp/${id}`, 'PUT', {
        photoStatus: 'sent'
    });
    
    if (response && response.success) {
        showNotif('📸 Фото отмечено как отправленное!', 'success');
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
        showNotif('❌ Сейчас нельзя отметить скрипт. Кнопка станет доступна через 2 дня после мероприятия.', 'warning');
        return;
    }
    
    if (vp.script_status === 'sent') {
        showNotif('Скрипт уже отмечен как отправленный', 'info');
        return;
    }
    
    const response = await apiCall(`/vp/${id}`, 'PUT', {
        scriptStatus: 'sent'
    });
    
    if (response && response.success) {
        showNotif('📝 Скрипт отзыва отмечен как отправленный!', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка при обновлении', 'error');
    }
}

function showBookingDetails(vp) {
    const paymentTypeMap = {
        'evotor_card': '💳 Эвотор (карта)',
        'evotor_cash': '💵 Эвотор (нал)',
        'vtb': '🏦 ВТБ',
        'sber': '🏦 Сбер',
        'not_paid': '⏳ Не оплачено'
    };
    
    const photoStatusText = getPhotoStatusText(vp);
    const scriptStatusText = getScriptStatusText(vp);
    const eventTimeFormatted = vp.event_time ? vp.event_time.slice(0, 5) : '—';
    const bookingDateFormatted = vp.booking_date ? new Date(vp.booking_date).toLocaleDateString() : '—';
    const createdAtFormatted = vp.created_at ? new Date(vp.created_at).toLocaleDateString() : '—';
    const updatedAtFormatted = vp.updated_at ? new Date(vp.updated_at).toLocaleDateString() : '—';
    
    const hasComment = vp.comment && vp.comment.trim() !== '';
    
    const modalHtml = `
        <div id="bookingDetailsModal" class="modal active">
            <div class="modal-window" style="max-width: 650px; width: 90%; max-height: 85vh; display: flex; flex-direction: column; padding: 0;">
                <div class="modal-header" style="flex-shrink: 0;">
                    <div class="modal-icon">
                        <i class="fas fa-info-circle"></i>
                    </div>
                    <div class="modal-title">
                        <h3>Детали мероприятия</h3>
                        <p>${escapeHtml(vp.customer_name)}</p>
                    </div>
                    <button class="modal-close" onclick="closeBookingDetailsModal()" style="background: rgba(255,255,255,0.1); border-radius: 50%; width: 32px; height: 32px;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px 24px;">
                    <div class="details-section" style="margin-bottom: 16px; padding-bottom: 12px;">
                        <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                            <i class="fas fa-calendar-alt"></i> Дата и время
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Дата мероприятия:</span>
                            <span class="detail-value">${formatDate(vp.event_date)}</span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Время:</span>
                            <span class="detail-value">${eventTimeFormatted}</span>
                        </div>
                    </div>
                    
                    <div class="details-section" style="margin-bottom: 16px; padding-bottom: 12px;">
                        <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                            <i class="fas fa-user"></i> Клиент и админ
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Клиент:</span>
                            <span class="detail-value"><strong>${escapeHtml(vp.customer_name)}</strong></span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Админ:</span>
                            <span class="detail-value">${escapeHtml(vp.admin || '—')}</span>
                        </div>
                    </div>
                    
                    <div class="details-section" style="margin-bottom: 16px; padding-bottom: 12px;">
                        <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                            <i class="fas fa-credit-card"></i> Финансы
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Сумма предоплаты:</span>
                            <span class="detail-value amount" style="color: #fbbf24;">${vp.amount || 0} ₽</span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Тип оплаты:</span>
                            <span class="detail-value">${paymentTypeMap[vp.payment_type] || vp.payment_type}</span>
                        </div>
                    </div>
                    
                    <div class="details-section" style="margin-bottom: 16px; padding-bottom: 12px;">
                        <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                            <i class="fas fa-camera"></i> Статусы
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Фото:</span>
                            <span class="detail-value"><span class="status-badge ${getPhotoStatusClass(vp)}" style="padding: 2px 8px; font-size: 10px;">${photoStatusText}</span></span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Скрипт отзыва:</span>
                            <span class="detail-value"><span class="status-badge ${getScriptStatusClass(vp)}" style="padding: 2px 8px; font-size: 10px;">${scriptStatusText}</span></span>
                        </div>
                    </div>
                    
                    <div class="details-section" style="margin-bottom: 16px; padding-bottom: 12px;">
                        <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                            <i class="fas fa-history"></i> История
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Дата бронирования:</span>
                            <span class="detail-value">${bookingDateFormatted}</span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Кто создал:</span>
                            <span class="detail-value">${escapeHtml(vp.created_by || '—')}</span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Дата создания:</span>
                            <span class="detail-value">${createdAtFormatted}</span>
                        </div>
                        <div class="detail-row" style="margin-bottom: 6px;">
                            <span class="detail-label" style="min-width: 110px;">Последнее изменение:</span>
                            <span class="detail-value">${updatedAtFormatted}</span>
                        </div>
                    </div>
                    
                    ${hasComment ? `
                        <div class="details-section">
                            <div class="section-title" style="font-size: 12px; margin-bottom: 8px;">
                                <i class="fas fa-comment"></i> Комментарий
                            </div>
                            <div class="comment-box" style="background: rgba(0,0,0,0.2); padding: 10px 12px; border-radius: 10px; font-size: 12px;">
                                ${escapeHtml(vp.comment)}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer" style="flex-shrink: 0; padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end;">
                    <button class="btn-secondary" onclick="closeBookingDetailsModal()" style="padding: 8px 20px;">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
function closeBookingDetailsModal() {
    const modal = document.getElementById('bookingDetailsModal');
    if (modal) modal.remove();
}

function renderVpTable() {
    const tbody = document.getElementById('vpTableBody');
    if (!tbody) return;
    
    const search = document.getElementById('vpSearch')?.value.toLowerCase() || '';
    
    let filtered = [...vpData];
    
    if (search) {
        filtered = filtered.filter(v => 
            (v.customer_name && v.customer_name.toLowerCase().includes(search)) ||
            (v.admin && v.admin.toLowerCase().includes(search))
        );
    }
    
    filtered.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px;">${window.showArchived ? '📦 В архиве нет мероприятий' : '🎮 Нет мероприятий за выбранный период'}<\/td></td>`;
        return;
    }
    
    tbody.innerHTML = filtered.map(vp => {
        const photoStatusClass = getPhotoStatusClass(vp);
        const photoStatusText = getPhotoStatusText(vp);
        const isPhotoActive = !vp.is_archived && isPhotoActionAvailable(vp) && vp.photo_status !== 'sent';
        
        const scriptStatusClass = getScriptStatusClass(vp);
        const scriptStatusText = getScriptStatusText(vp);
        const isScriptActive = !vp.is_archived && isScriptActionAvailable(vp) && vp.script_status !== 'sent';
        
        const isUnpaid = isUnpaidOverdue(vp);
        const rowClass = isUnpaid ? 'vp-row-unpaid' : '';
        
        const paymentTypeMap = {
            'evotor_card': '💳 Эвотор (карта)',
            'evotor_cash': '💵 Эвотор (нал)',
            'vtb': '🏦 ВТБ',
            'sber': '🏦 Сбер',
            'not_paid': '⏳ Не оплачено'
        };
        const paymentText = paymentTypeMap[vp.payment_type] || vp.payment_type;
        
        const eventTimeFormatted = vp.event_time ? vp.event_time.slice(0, 5) : '—';
        
        const vpJson = JSON.stringify(vp).replace(/"/g, '&quot;');
        
        return `
            <tr class="${rowClass}">
                <td>${formatDate(vp.event_date)}</td>
                <td>${eventTimeFormatted}</td>
                <td><strong class="clickable-customer" onclick='showBookingDetails(${vpJson})'>${escapeHtml(vp.customer_name)}</strong></td>
                <td>${escapeHtml(vp.admin || '—')}</td>
                <td>${vp.amount || 0} ₽</td>
                <td>${paymentText}</td>
                <td class="quick-action-cell">
                    ${canEditVp && isPhotoActive && !vp.is_archived ? `
                        <button class="btn-action btn-photo" onclick="event.stopPropagation(); updatePhotoStatus(${vp.id})">
                            <i class="fas fa-camera"></i> Отметить фото
                        </button>
                    ` : `
                        <span class="status-badge ${photoStatusClass}">${photoStatusText}</span>
                    `}
                </td>
                <td class="quick-action-cell">
                    ${canEditVp && isScriptActive && !vp.is_archived ? `
                        <button class="btn-action btn-script" onclick="event.stopPropagation(); updateScriptStatus(${vp.id})">
                            <i class="fas fa-paper-plane"></i> Отметить скрипт
                        </button>
                    ` : `
                        <span class="status-badge ${scriptStatusClass}">${scriptStatusText}</span>
                    `}
                </td>
                <td style="white-space: nowrap;">
                    ${canEditVp && !vp.is_archived ? `<button class="btn-small" onclick="openVpModal(${vp.id})"><i class="fas fa-edit"></i> Ред.</button>` : ''}
                    ${canEditVp && !vp.is_archived ? `<button class="btn-small btn-delete" onclick="cancelVp(${vp.id})"><i class="fas fa-archive"></i> В архив</button>` : ''}
                    ${canEditVp && vp.is_archived ? `<button class="btn-small btn-restore" onclick="restoreVp(${vp.id})"><i class="fas fa-undo"></i> Восстановить</button>` : ''}
                    ${canEditVp && vp.is_archived ? `<button class="btn-small btn-danger" onclick="deleteVpPermanently(${vp.id})"><i class="fas fa-trash-alt"></i> Удалить</button>` : ''}
                    ${!canEditVp && !vp.is_archived ? '<span style="color:#64748b; font-size:11px;">🔍 Только просмотр</span>' : ''}
                </td>
            </tr>
        `;
    }).join('');
}

async function restoreVp(vpId) {
    if (!canEditVp) return;
    
    if (!confirm('Восстановить мероприятие из архива?')) return;
    
    const response = await apiCall(`/vp/${vpId}`, 'PUT', {
        is_archived: false
    });
    
    if (response && response.success) {
        showNotif('📦 Мероприятие восстановлено из архива', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка при восстановлении', 'error');
    }
}

async function deleteVpPermanently(vpId) {
    if (!canEditVp) return;
    
    if (!confirm('⚠️ ВНИМАНИЕ! Вы уверены, что хотите НАВСЕГДА удалить мероприятие? Это действие необратимо.')) return;
    
    const response = await apiCall(`/vp/${vpId}`, 'DELETE');
    if (response && response.success) {
        showNotif('🗑️ Мероприятие удалено навсегда', 'success');
        await loadVpData();
    } else {
        showNotif('Ошибка при удалении: ' + (response?.error || 'неизвестная ошибка'), 'error');
    }
}

function openVpModal(vpId = null) {
    if (!canEditVp) return;
    
    const vp = vpId ? vpData.find(v => v.id === vpId) : null;
    
    const employees = window.app.employees || [];
    const profiles = window.app.profiles || {};
    const admins = employees.filter(emp => profiles[emp]?.role === 'admin');
    
    const eventDateValue = vp?.event_date || '';
    
    const modalHtml = `
        <div id="vpModal" class="modal active">
            <div class="modal-window" style="max-width: 550px;">
                <div class="modal-header">
                    <div class="modal-icon">
                        <i class="fas fa-gamepad"></i>
                    </div>
                    <div class="modal-title">
                        <h3>${vp ? '✏️ Редактирование мероприятия' : '➕ Новое мероприятие'}</h3>
                        <p>${vp ? 'Измените данные мероприятия' : 'Заполните информацию о мероприятии'}</p>
                    </div>
                    <button class="modal-close" onclick="closeVpModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="vpId" value="${vp?.id || ''}">
                    
                    <div class="form-group">
                        <label>Дата мероприятия</label>
                        <input type="date" id="vpEventDate" class="form-input" value="${eventDateValue}">
                    </div>
                    
                    <div class="form-group">
                        <label>Время</label>
                        <select id="vpEventTime" class="form-select">
                            ${['10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'].map(t => 
                                `<option value="${t}" ${vp?.event_time === t ? 'selected' : ''}>${t}</option>`
                            ).join('')}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>Имя клиента</label>
                        <input type="text" id="vpCustomerName" class="form-input" value="${escapeHtml(vp?.customer_name || '')}">
                    </div>
                    
                    <div class="form-group">
                        <label>Админ</label>
                        <select id="vpAdmin" class="form-select">
                            <option value="">Выберите админа</option>
                            ${admins.map(emp => 
                                `<option value="${escapeHtml(emp)}" ${vp?.admin === emp ? 'selected' : ''}>${escapeHtml(emp)}</option>`
                            ).join('')}
                            ${admins.length === 0 ? '<option disabled>Нет доступных админов</option>' : ''}
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>Сумма предоплаты</label>
                        <input type="number" id="vpAmount" class="form-input" value="${vp?.amount || 2000}">
                    </div>
                    
                    <div class="form-group">
                        <label>Тип оплаты</label>
                        <select id="vpPaymentType" class="form-select">
                            <option value="evotor_card" ${vp?.payment_type === 'evotor_card' ? 'selected' : ''}>💳 Эвотор (карта)</option>
                            <option value="evotor_cash" ${vp?.payment_type === 'evotor_cash' ? 'selected' : ''}>💵 Эвотор (нал)</option>
                            <option value="vtb" ${vp?.payment_type === 'vtb' ? 'selected' : ''}>🏦 ВТБ</option>
                            <option value="sber" ${vp?.payment_type === 'sber' ? 'selected' : ''}>🏦 Сбер</option>
                            <option value="not_paid" ${vp?.payment_type === 'not_paid' ? 'selected' : ''}>⏳ Не оплачено</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>Комментарий</label>
                        <textarea id="vpComment" class="form-textarea" rows="3" placeholder="Дополнительная информация о брони...">${escapeHtml(vp?.comment || '')}</textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="closeVpModal()">Отмена</button>
                    <button class="btn-primary" onclick="saveVp()">💾 Сохранить</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeVpModal() {
    const modal = document.getElementById('vpModal');
    if (modal) modal.remove();
}

async function saveVp() {
    if (!canEditVp) return;
    
    const vpId = document.getElementById('vpId')?.value;
    const eventDate = document.getElementById('vpEventDate')?.value;
    let eventTime = document.getElementById('vpEventTime')?.value;
    const customerName = document.getElementById('vpCustomerName')?.value.trim();
    const admin = document.getElementById('vpAdmin')?.value;
    const amount = parseInt(document.getElementById('vpAmount')?.value) || 0;
    const paymentType = document.getElementById('vpPaymentType')?.value;
    const comment = document.getElementById('vpComment')?.value || '';
    
    if (!customerName) {
        showNotif('Введите имя клиента', 'error');
        return;
    }
    
    if (!admin) {
        showNotif('Выберите админа', 'error');
        return;
    }
    
    if (!eventDate) {
        showNotif('Выберите дату мероприятия', 'error');
        return;
    }
    
    if (eventTime && eventTime.length > 5) {
        eventTime = eventTime.slice(0, 5);
    }
    
    const vpDataToSend = {
        eventDate: eventDate,
        eventTime: eventTime,
        customerName: customerName,
        admin: admin,
        amount: amount,
        paymentType: paymentType,
        comment: comment
    };
    
    let response;
    if (vpId) {
        response = await apiCall(`/vp/${vpId}`, 'PUT', vpDataToSend);
    } else {
        vpDataToSend.bookingDate = new Date().toISOString().split('T')[0];
        vpDataToSend.photoStatus = 'pending';
        vpDataToSend.scriptStatus = 'not_sent';
        response = await apiCall('/vp', 'POST', { vp: vpDataToSend });
    }
    
    if (response && response.success) {
        showNotif(vpId ? '✅ Мероприятие обновлено' : '✅ Мероприятие создано', 'success');
        closeVpModal();
        await loadVpData();
    } else {
        showNotif('❌ Ошибка при сохранении: ' + (response?.error || 'неизвестная ошибка'), 'error');
    }
}

async function cancelVp(vpId) {
    if (!canEditVp) return;
    
    if (!confirm('Отправить мероприятие в архив? Оно будет скрыто из основного списка.')) return;
    
    const response = await apiCall(`/vp/${vpId}`, 'PUT', {
        is_archived: true
    });
    
    if (response && response.success) {
        showNotif('📦 Мероприятие отправлено в архив', 'success');
        await loadVpData();
    } else {
        showNotif('❌ Ошибка при отправке в архив: ' + (response?.error || 'неизвестная ошибка'), 'error');
    }
}

function exportVpToExcel() {
    showNotif('📊 Экспорт в Excel будет доступен в следующей версии', 'info');
}

function resetVpFilters() {
    const searchInput = document.getElementById('vpSearch');
    const showArchivedCheckbox = document.getElementById('showArchived');
    
    if (searchInput) searchInput.value = '';
    if (showArchivedCheckbox) {
        showArchivedCheckbox.checked = false;
        window.showArchived = false;
    }
    
    loadVpData();
}

window.initVp = initVp;
window.openVpModal = openVpModal;
window.closeVpModal = closeVpModal;
window.saveVp = saveVp;
window.cancelVp = cancelVp;
window.restoreVp = restoreVp;
window.deleteVpPermanently = deleteVpPermanently;
window.exportVpToExcel = exportVpToExcel;
window.updatePhotoStatus = updatePhotoStatus;
window.updateScriptStatus = updateScriptStatus;
window.resetVpFilters = resetVpFilters;
window.showBookingDetails = showBookingDetails;
window.closeBookingDetailsModal = closeBookingDetailsModal;