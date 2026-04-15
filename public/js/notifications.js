// public/js/notifications.js - СИСТЕМА УВЕДОМЛЕНИЙ С ОЧЕРЕДЬЮ

let notificationsList = [];
let unreadCount = 0;
let notificationIdCounter = 0;
const MAX_NOTIFICATIONS = 50;

// 🔥 ОЧЕРЕДЬ TOAST-УВЕДОМЛЕНИЙ
let toastQueue = [];
let isShowingToast = false;
const TOAST_DELAY = 800; // Задержка между уведомлениями (мс)

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
function initNotifications() {
    console.log('🔔 Инициализация системы уведомлений');
    loadNotificationsFromStorage();
    setupPusherNotificationListeners();
    updateNotificationsBadge();
}

function loadNotificationsFromStorage() {
    try {
        const saved = localStorage.getItem('warpoint_notifications');
        if (saved) {
            const data = JSON.parse(saved);
            notificationsList = data.list || [];
            unreadCount = data.unread || 0;
            notificationIdCounter = data.counter || 0;
        }
    } catch (e) {
        console.error('Ошибка загрузки уведомлений:', e);
    }
}

function saveNotificationsToStorage() {
    try {
        localStorage.setItem('warpoint_notifications', JSON.stringify({
            list: notificationsList,
            unread: unreadCount,
            counter: notificationIdCounter
        }));
    } catch (e) {
        console.error('Ошибка сохранения уведомлений:', e);
    }
}

// ============================================
// ОЧЕРЕДЬ TOAST-УВЕДОМЛЕНИЙ
// ============================================
function enqueueToast(notification) {
    toastQueue.push(notification);
    console.log(`📨 Уведомление добавлено в очередь (всего: ${toastQueue.length})`);
    processToastQueue();
}

function processToastQueue() {
    if (isShowingToast) return;
    if (toastQueue.length === 0) return;
    
    isShowingToast = true;
    const notification = toastQueue.shift();
    
    showToastNow(notification);
    
    // После показа текущего, запускаем следующий через задержку
    setTimeout(() => {
        isShowingToast = false;
        processToastQueue();
    }, TOAST_DELAY);
}

function showToastNow(notification) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    
    // Определяем цвет рамки в зависимости от типа
    let borderColor = '#10b981'; // зелёный по умолчанию
    if (notification.type === 'achievement') borderColor = '#fbbf24';
    else if (notification.type === 'gift_received') borderColor = '#ec4899';
    else if (notification.type === 'task_completed') borderColor = '#10b981';
    else if (notification.type === 'fine_approved') borderColor = '#ef4444';
    else if (notification.type === 'exchange') borderColor = '#3b82f6';
    else if (notification.type === 'new_employee') borderColor = '#8b5cf6';
    
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        min-width: 320px;
        max-width: 420px;
        background: linear-gradient(135deg, #1a1f2e, #0f1222);
        border-radius: 16px;
        padding: 14px 18px;
        display: flex;
        align-items: flex-start;
        gap: 14px;
        z-index: 99999;
        transform: translateX(450px);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
        border-left: 4px solid ${borderColor};
        cursor: pointer;
        backdrop-filter: blur(10px);
    `;
    
    toast.innerHTML = `
        <div style="font-size: 28px; flex-shrink: 0;">${notification.icon}</div>
        <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #f1f5f9;">${escapeHtml(notification.title)}</div>
            <div style="font-size: 12px; color: #94a3b8; line-height: 1.4;">${escapeHtml(notification.text)}</div>
        </div>
        <button class="toast-close-btn" style="background: none; border: none; color: #64748b; font-size: 20px; cursor: pointer; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;">&times;</button>
    `;
    
    document.body.appendChild(toast);
    
    // Кнопка закрытия
    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeToast(toast);
    });
    closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        closeBtn.style.color = '#f87171';
    });
    closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = 'none';
        closeBtn.style.color = '#64748b';
    });
    
    // Анимация появления
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // Клик по уведомлению
    toast.addEventListener('click', (e) => {
        if (!e.target.closest('.toast-close-btn')) {
            closeToast(toast);
        }
    });
    
    // Автоматическое закрытие через 5 секунд
    const timeoutId = setTimeout(() => {
        closeToast(toast);
    }, 5000);
    
    toast.dataset.timeoutId = timeoutId;
}

function closeToast(toast) {
    if (!toast.parentElement) return;
    
    // Очищаем таймаут
    if (toast.dataset.timeoutId) {
        clearTimeout(parseInt(toast.dataset.timeoutId));
    }
    
    // Анимация исчезновения
    toast.style.transform = 'translateX(450px)';
    toast.style.opacity = '0';
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 400);
}

// ============================================
// PUSHER СЛУШАТЕЛИ
// ============================================
function setupPusherNotificationListeners() {
    const checkPusher = setInterval(() => {
        if (window.channel && window.privateChannel) {
            clearInterval(checkPusher);
            bindNotificationEvents();
        }
    }, 200);
    
    setTimeout(() => clearInterval(checkPusher), 10000);
}

function bindNotificationEvents() {
    console.log('🔔 Привязка слушателей уведомлений к Pusher');
    
    // ГЛОБАЛЬНЫЕ УВЕДОМЛЕНИЯ (для всех)
    if (window.channel) {
        window.channel.bind('global-notification', (data) => {
            console.log('🌍 Глобальное уведомление:', data);
            
            // Не показываем, если пользователь исключён
            if (data.excludeUser === window.app?.currentUser) return;
            
            enqueueToast({
                type: data.type,
                icon: data.icon,
                title: data.title,
                text: data.text,
                time: data.time
            });
            
            addNotificationToList({
                id: 'global_' + data.time,
                type: data.type,
                icon: data.icon,
                title: data.title,
                text: data.text,
                time: data.time,
                read: false
            });
        });
    }
    
    // ЛИЧНЫЕ УВЕДОМЛЕНИЯ
    if (window.privateChannel) {
        window.privateChannel.bind('personal-notification', (data) => {
            console.log('📨 Личное уведомление:', data);
            
            enqueueToast({
                type: data.type,
                icon: data.icon,
                title: data.title,
                text: data.text,
                time: data.time
            });
            
            addNotificationToList({
                id: 'personal_' + data.time,
                type: data.type,
                icon: data.icon,
                title: data.title,
                text: data.text,
                time: data.time,
                read: false
            });
        });
        
        // Получен подарок
        window.privateChannel.bind('gift-received', (data) => {
            enqueueToast({
                type: 'gift_received',
                icon: '🎁',
                title: 'Вам подарок!',
                text: `${data.sender} подарил вам ${data.giftName} ${data.quantity > 1 ? `(x${data.quantity})` : ''}!`,
                time: Date.now()
            });
        });
    }
}

// ============================================
// ДОБАВЛЕНИЕ В СПИСОК
// ============================================
function addNotificationToList(notification) {
    notificationsList.unshift(notification);
    unreadCount++;
    
    if (notificationsList.length > MAX_NOTIFICATIONS) {
        notificationsList = notificationsList.slice(0, MAX_NOTIFICATIONS);
    }
    
    saveNotificationsToStorage();
    updateNotificationsBadge();
    renderNotificationsDropdown();
}

// ============================================
// UI: ВЫПАДАЮЩИЙ СПИСОК
// ============================================
function renderNotificationsDropdown() {
    const container = document.getElementById('notificationsList');
    const badge = document.getElementById('notificationsBadge');
    
    if (!container) return;
    
    if (notificationsList.length === 0) {
        container.innerHTML = '<div class="notifications-empty">🔔 Нет уведомлений</div>';
        return;
    }
    
    let html = '';
    for (const n of notificationsList.slice(0, 20)) {
        html += `
            <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead('${n.id}')">
                <div style="display: flex; gap: 12px;">
                    <div style="font-size: 24px;">${n.icon}</div>
                    <div style="flex: 1;">
                        <div class="notification-title">${escapeHtml(n.title)}</div>
                        <div class="notification-text">${escapeHtml(n.text)}</div>
                        <div class="notification-time">${formatTimeAgo(n.time)}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    if (badge) {
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function markNotificationRead(id) {
    const notification = notificationsList.find(n => n.id === id);
    if (notification && !notification.read) {
        notification.read = true;
        unreadCount = Math.max(0, unreadCount - 1);
        saveNotificationsToStorage();
        renderNotificationsDropdown();
        updateNotificationsBadge();
    }
}

function markAllNotificationsRead() {
    let changed = false;
    for (const n of notificationsList) {
        if (!n.read) {
            n.read = true;
            changed = true;
        }
    }
    if (changed) {
        unreadCount = 0;
        saveNotificationsToStorage();
        renderNotificationsDropdown();
        updateNotificationsBadge();
        showNotif('Все уведомления прочитаны', 'success');
    }
}

function clearAllNotifications() {
    if (notificationsList.length === 0) return;
    if (!confirm('Удалить все уведомления?')) return;
    
    notificationsList = [];
    unreadCount = 0;
    saveNotificationsToStorage();
    renderNotificationsDropdown();
    updateNotificationsBadge();
    
    const dropdown = document.getElementById('notificationsDropdown');
    if (dropdown) dropdown.classList.remove('show');
    
    showNotif('Уведомления очищены', 'success');
}

function updateNotificationsBadge() {
    const badge = document.getElementById('notificationsBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }
}

function toggleNotificationsDropdown() {
    const dropdown = document.getElementById('notificationsDropdown');
    if (!dropdown) return;
    
    if (dropdown.classList.contains('show')) {
        dropdown.classList.remove('show');
    } else {
        renderNotificationsDropdown();
        dropdown.classList.add('show');
    }
}

// ============================================
// ЭКСПОРТ
// ============================================
window.initNotifications = initNotifications;
window.enqueueToast = enqueueToast;
window.showToastNow = showToastNow;
window.renderNotificationsDropdown = renderNotificationsDropdown;
window.updateNotificationsBadge = updateNotificationsBadge;
window.toggleNotificationsDropdown = toggleNotificationsDropdown;
window.markAllNotificationsRead = markAllNotificationsRead;
window.clearAllNotifications = clearAllNotifications;
window.markNotificationRead = markNotificationRead;

// Автозапуск
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotifications);
} else {
    setTimeout(initNotifications, 500);
}

console.log('✅ notifications.js загружен (с очередью уведомлений)');