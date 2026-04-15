// public/js/notifications.js - С ЗАЩИТОЙ ОТ БЕСКОНЕЧНЫХ ЦИКЛОВ

let notificationsList = [];
let unreadCount = 0;
let notificationIdCounter = 0;
const MAX_NOTIFICATIONS = 50;

// 🔥 ОЧЕРЕДЬ TOAST-УВЕДОМЛЕНИЙ
let toastQueue = [];
let isShowingToast = false;
const TOAST_DELAY = 800;

// 🔥 ЗАЩИТА ОТ ЧАСТЫХ ПРОВЕРОК
let lastCheck = 0;
const CHECK_INTERVAL = 30000; // Минимум 30 секунд между проверками
let isInitialized = false;

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
function initNotifications() {
    if (isInitialized) {
        console.log('🔔 Уведомления уже инициализированы');
        return;
    }
    isInitialized = true;
    
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
// ОЧЕРЕДЬ TOAST-УВЕДОМЛЕНИЙ (С ЗАЩИТОЙ)
// ============================================
function enqueueToast(notification) {
    // 🔥 Ограничение очереди
    if (toastQueue.length > 10) {
        console.log('⚠️ Очередь уведомлений переполнена, очищаем');
        toastQueue = toastQueue.slice(-5);
    }
    
    toastQueue.push(notification);
    processToastQueue();
}

function processToastQueue() {
    if (isShowingToast) return;
    if (toastQueue.length === 0) return;
    
    isShowingToast = true;
    const notification = toastQueue.shift();
    
    showToastNow(notification);
    
    setTimeout(() => {
        isShowingToast = false;
        processToastQueue();
    }, TOAST_DELAY);
}

function showToastNow(notification) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    
    let borderColor = '#10b981';
    if (notification.type === 'achievement') borderColor = '#fbbf24';
    else if (notification.type === 'gift_received') borderColor = '#ec4899';
    else if (notification.type === 'fine_approved') borderColor = '#ef4444';
    
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
        transition: all 0.4s;
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
        <button class="toast-close-btn" style="background: none; border: none; color: #64748b; font-size: 20px; cursor: pointer;">&times;</button>
    `;
    
    document.body.appendChild(toast);
    
    const closeBtn = toast.querySelector('.toast-close-btn');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeToast(toast);
    });
    
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    }, 10);
    
    toast.addEventListener('click', (e) => {
        if (!e.target.closest('.toast-close-btn')) closeToast(toast);
    });
    
    const timeoutId = setTimeout(() => closeToast(toast), 5000);
    toast.dataset.timeoutId = timeoutId;
}

function closeToast(toast) {
    if (!toast.parentElement) return;
    if (toast.dataset.timeoutId) clearTimeout(parseInt(toast.dataset.timeoutId));
    toast.style.transform = 'translateX(450px)';
    toast.style.opacity = '0';
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 400);
}

// ============================================
// PUSHER СЛУШАТЕЛИ (С ЗАЩИТОЙ)
// ============================================
let pusherBindingsSetup = false;

function setupPusherNotificationListeners() {
    if (pusherBindingsSetup) {
        console.log('🔔 Pusher слушатели уже настроены');
        return;
    }
    
    const checkPusher = setInterval(() => {
        if (window.channel && window.privateChannel) {
            clearInterval(checkPusher);
            bindNotificationEvents();
            pusherBindingsSetup = true;
        }
    }, 2000);
    
    setTimeout(() => clearInterval(checkPusher), 10000);
}

function bindNotificationEvents() {
    console.log('🔔 Привязка слушателей уведомлений к Pusher');
    
    if (window.channel) {
        window.channel.unbind('global-notification');
        window.channel.bind('global-notification', (data) => {
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
    
    if (window.privateChannel) {
        window.privateChannel.unbind('personal-notification');
        window.privateChannel.bind('personal-notification', (data) => {
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
    
    // 🔥 НЕ ВЫЗЫВАЕМ РЕНДЕР КАЖДЫЙ РАЗ
    if (document.getElementById('notificationsDropdown')?.classList.contains('show')) {
        renderNotificationsDropdown();
    }
}

// ============================================
// UI: ВЫПАДАЮЩИЙ СПИСОК
// ============================================
function renderNotificationsDropdown() {
    const container = document.getElementById('notificationsList');
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
        updateNotificationsBadge();
    }
}

function markAllNotificationsRead() {
    let changed = false;
    for (const n of notificationsList) {
        if (!n.read) { n.read = true; changed = true; }
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
window.renderNotificationsDropdown = renderNotificationsDropdown;
window.updateNotificationsBadge = updateNotificationsBadge;
window.toggleNotificationsDropdown = toggleNotificationsDropdown;
window.markAllNotificationsRead = markAllNotificationsRead;
window.clearAllNotifications = clearAllNotifications;
window.markNotificationRead = markNotificationRead;

// Автозапуск (с задержкой)
setTimeout(() => {
    if (!isInitialized) initNotifications();
}, 1000);

console.log('✅ notifications.js загружен (с защитой от циклов)');
