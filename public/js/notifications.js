// public/js/notifications.js — ВЕРСИЯ v3.0
// Двухуровневая система: системные toast + важные события с историей
// Отображается поверх модалок (z-index: 100000+)

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const NOTIFICATION_TYPES = {
    // Системные (только toast)
    SUCCESS: 'success',
    ERROR: 'error',
    INFO: 'info',
    WARNING: 'warning',
    LOADING: 'loading',
    
    // Важные события (toast + история)
    GIFT_RECEIVED: 'gift_received',
    GIFT_SENT: 'gift_sent',
    FINE_APPROVED: 'fine_approved',
    FINE_CREATED: 'fine_created',
    TASK_COMPLETED: 'task_completed',
    TASK_CREATED: 'task_created',
    TASK_OVERDUE: 'task_overdue',
    EXCHANGE_REQUEST: 'exchange_request',
    EXCHANGE_ACCEPTED: 'exchange_accepted',
    EXCHANGE_REJECTED: 'exchange_rejected',
    ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',
    NEW_EMPLOYEE: 'new_employee',
    RATING_MILESTONE: 'rating_milestone',
    BONUS_RECEIVED: 'bonus_received',
    MENTION: 'mention',
    SCHEDULE_UPDATED: 'schedule_updated',
    VP_CREATED: 'vp_created',
    VP_UPDATED: 'vp_updated',
    SALARY_UPDATED: 'salary_updated',
    FUND_UPDATED: 'fund_updated'
};

const EVENT_CONFIG = {
    [NOTIFICATION_TYPES.GIFT_RECEIVED]: {
        icon: '🎁',
        color: '#ec4899',
        title: 'Вам подарок!',
        message: (data) => {
            if (data.anonymous) return `Анонимный подарок: ${data.giftName}`;
            return `${data.sender} подарил вам ${data.giftName}`;
        },
        actions: ['thanks', 'view_gift']
    },
    [NOTIFICATION_TYPES.GIFT_SENT]: {
        icon: '🎁',
        color: '#ec4899',
        title: 'Подарок отправлен',
        message: (data) => `Вы подарили ${data.giftName} для ${data.recipient}`,
        actions: []
    },
    [NOTIFICATION_TYPES.FINE_APPROVED]: {
        icon: '⚠️',
        color: '#ef4444',
        title: 'Штраф подтверждён',
        message: (data) => {
            const parts = [];
            if (data.amount) parts.push(`${data.amount} ₽`);
            if (data.coins) parts.push(`${data.coins} WP`);
            if (data.rating) parts.push(`${Math.abs(data.rating)} рейтинга`);
            return `${data.reason} (${parts.join(' + ')})`;
        },
        actions: ['view_fine', 'appeal']
    },
    [NOTIFICATION_TYPES.FINE_CREATED]: {
        icon: '📋',
        color: '#f59e0b',
        title: 'Новое нарушение',
        message: (data) => `${data.employee} — ${data.reason}`,
        actions: ['view_fine']
    },
    [NOTIFICATION_TYPES.TASK_COMPLETED]: {
        icon: '✅',
        color: '#10b981',
        title: 'Задача выполнена',
        message: (data) => {
            if (data.isGroup) return `Групповая задача «${data.taskName}» выполнена`;
            return `${data.executor} выполнил задачу «${data.taskName}»`;
        },
        actions: ['view_task']
    },
    [NOTIFICATION_TYPES.TASK_CREATED]: {
        icon: '📋',
        color: '#3b82f6',
        title: 'Новая задача',
        message: (data) => `${data.author} назначил вам задачу «${data.taskName}»`,
        actions: ['view_task']
    },
    [NOTIFICATION_TYPES.TASK_OVERDUE]: {
        icon: '🔴',
        color: '#ef4444',
        title: 'Просрочена задача',
        message: (data) => `Задача «${data.taskName}» просрочена`,
        actions: ['view_task']
    },
    [NOTIFICATION_TYPES.EXCHANGE_REQUEST]: {
        icon: '🔄',
        color: '#3b82f6',
        title: 'Предложение обмена',
        message: (data) => `${data.from} хочет обменяться сменами`,
        actions: ['accept_exchange', 'reject_exchange', 'view_exchange']
    },
    [NOTIFICATION_TYPES.EXCHANGE_ACCEPTED]: {
        icon: '✅',
        color: '#10b981',
        title: 'Обмен подтверждён',
        message: (data) => `${data.to} принял ваш запрос на обмен`,
        actions: ['view_schedule']
    },
    [NOTIFICATION_TYPES.EXCHANGE_REJECTED]: {
        icon: '❌',
        color: '#ef4444',
        title: 'Обмен отклонён',
        message: (data) => `${data.to} отклонил ваш запрос на обмен`,
        actions: ['view_schedule']
    },
    [NOTIFICATION_TYPES.ACHIEVEMENT_UNLOCKED]: {
        icon: '🏆',
        color: '#fbbf24',
        title: 'Новое достижение!',
        message: (data) => `${data.name} — +${data.coins} WP`,
        actions: ['view_achievements']
    },
    [NOTIFICATION_TYPES.NEW_EMPLOYEE]: {
        icon: '👋',
        color: '#8b5cf6',
        title: 'Новый сотрудник',
        message: (data) => `${data.name} присоединился к команде!`,
        actions: ['view_profile']
    },
    [NOTIFICATION_TYPES.RATING_MILESTONE]: {
        icon: '⭐',
        color: '#fbbf24',
        title: 'Новый ранг!',
        message: (data) => `Ваш рейтинг достиг ${data.rating} — ${data.rank}`,
        actions: ['view_rating']
    },
    [NOTIFICATION_TYPES.BONUS_RECEIVED]: {
        icon: '💰',
        color: '#fbbf24',
        title: 'Бонус от директора',
        message: (data) => `+${data.coins} WP${data.reason ? ` (${data.reason})` : ''}`,
        actions: []
    },
    [NOTIFICATION_TYPES.MENTION]: {
        icon: '💬',
        color: '#6366f1',
        title: 'Вас упомянули',
        message: (data) => `${data.sender} упомянул вас в чате`,
        actions: ['open_chat']
    },
    [NOTIFICATION_TYPES.SCHEDULE_UPDATED]: {
        icon: '📅',
        color: '#3b82f6',
        title: 'График обновлён',
        message: (data) => `Ваша смена на ${data.date} изменена`,
        actions: ['view_schedule']
    },
    [NOTIFICATION_TYPES.VP_CREATED]: {
        icon: '🎮',
        color: '#10b981',
        title: 'Новое мероприятие',
        message: (data) => `${data.admin} добавил ВП на ${data.date}`,
        actions: ['view_vp']
    },
    [NOTIFICATION_TYPES.VP_UPDATED]: {
        icon: '🎮',
        color: '#f59e0b',
        title: 'Мероприятие обновлено',
        message: (data) => `ВП на ${data.date} изменено`,
        actions: ['view_vp']
    },
    [NOTIFICATION_TYPES.SALARY_UPDATED]: {
        icon: '💰',
        color: '#fbbf24',
        title: 'Зарплата обновлена',
        message: (data) => `Ваши начисления за ${data.date} изменены`,
        actions: ['view_salary']
    },
    [NOTIFICATION_TYPES.FUND_UPDATED]: {
        icon: '🏦',
        color: '#fbbf24',
        title: 'Фонд обновлён',
        message: (data) => `Корпоративный фонд: ${data.amount} ₽`,
        actions: []
    }
};

// ============================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================

let notificationsList = [];
let unreadCount = 0;
let notificationIdCounter = 0;
const MAX_NOTIFICATIONS = 100;
const TOAST_Z_INDEX = 100001;
const MODAL_Z_INDEX = 100000;

let activeToasts = [];
let isInitialized = false;
let pusherBindingsSetup = false;

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initNotifications() {
    if (isInitialized) {
        console.log('🔔 Уведомления уже инициализированы');
        return;
    }
    isInitialized = true;
    
    console.log('🔔 Инициализация системы уведомлений v3.0');
    
    loadNotificationsFromStorage();
    setupPusherNotificationListeners();
    updateNotificationsBadge();
    
    // Добавляем стили для toast
    injectToastStyles();
}

function injectToastStyles() {
    if (document.getElementById('toast-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
        @keyframes slideInRight {
            from { opacity: 0; transform: translateX(100px); }
            to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes slideOutRight {
            from { opacity: 1; transform: translateX(0); }
            to { opacity: 0; transform: translateX(100px); }
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .system-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            min-width: 280px;
            max-width: 400px;
            background: #1a1f2e;
            border-radius: 12px;
            padding: 12px 16px;
            z-index: ${TOAST_Z_INDEX};
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideInRight 0.2s ease;
            pointer-events: auto;
        }
        
        .system-toast.closing {
            animation: slideOutRight 0.2s ease forwards;
        }
        
        .event-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            min-width: 340px;
            max-width: 440px;
            background: linear-gradient(135deg, #1a1f2e, #0f1222);
            border-radius: 20px;
            padding: 18px 20px;
            z-index: ${TOAST_Z_INDEX};
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
            animation: slideInRight 0.3s ease;
            pointer-events: auto;
            backdrop-filter: blur(20px);
        }
        
        .event-toast.closing {
            animation: slideOutRight 0.2s ease forwards;
        }
        
        .toast-action-btn {
            padding: 8px 16px;
            border-radius: 30px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .toast-action-btn:hover {
            background: rgba(255, 255, 255, 0.15);
            transform: translateY(-1px);
        }
        
        .toast-action-btn.accept {
            background: rgba(16, 185, 129, 0.2);
            border-color: rgba(16, 185, 129, 0.4);
            color: #10b981;
        }
        
        .toast-action-btn.accept:hover {
            background: rgba(16, 185, 129, 0.35);
        }
        
        .toast-action-btn.reject {
            background: rgba(239, 68, 68, 0.2);
            border-color: rgba(239, 68, 68, 0.4);
            color: #f87171;
        }
        
        .toast-action-btn.reject:hover {
            background: rgba(239, 68, 68, 0.35);
        }
        
        .toast-close {
            background: none;
            border: none;
            color: #64748b;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        
        .toast-close:hover {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
        }
        
        /* Стек уведомлений */
        .system-toast:nth-last-child(1) { bottom: 24px; }
        .system-toast:nth-last-child(2) { bottom: 90px; }
        .system-toast:nth-last-child(3) { bottom: 156px; }
        .system-toast:nth-last-child(4) { bottom: 222px; }
        .system-toast:nth-last-child(5) { bottom: 288px; }
        
        .event-toast:nth-last-child(1) { bottom: 24px; }
        .event-toast:nth-last-child(2) { bottom: 110px; }
        .event-toast:nth-last-child(3) { bottom: 196px; }
        
        /* Адаптивность */
        @media (max-width: 768px) {
            .system-toast, .event-toast {
                left: 16px;
                right: 16px;
                min-width: auto;
                max-width: none;
                bottom: 16px !important;
            }
            
            .system-toast:nth-last-child(n+2),
            .event-toast:nth-last-child(n+2) {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);
}

function loadNotificationsFromStorage() {
    try {
        const saved = localStorage.getItem('warpoint_notifications');
        if (saved) {
            const data = JSON.parse(saved);
            notificationsList = data.list || [];
            unreadCount = data.unread || 0;
            notificationIdCounter = data.counter || 0;
            
            if (notificationsList.length > MAX_NOTIFICATIONS) {
                notificationsList = notificationsList.slice(0, MAX_NOTIFICATIONS);
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки уведомлений:', e);
        notificationsList = [];
        unreadCount = 0;
    }
}

function saveNotificationsToStorage() {
    try {
        localStorage.setItem('warpoint_notifications', JSON.stringify({
            list: notificationsList.slice(0, MAX_NOTIFICATIONS),
            unread: unreadCount,
            counter: notificationIdCounter
        }));
    } catch (e) {
        console.error('Ошибка сохранения уведомлений:', e);
        if (e.name === 'QuotaExceededError') {
            notificationsList = notificationsList.slice(0, 20);
            try {
                localStorage.setItem('warpoint_notifications', JSON.stringify({
                    list: notificationsList,
                    unread: unreadCount,
                    counter: notificationIdCounter
                }));
            } catch(e2) {}
        }
    }
}

function generateId() {
    return `n_${Date.now()}_${++notificationIdCounter}`;
}

// ============================================
// СИСТЕМНЫЕ УВЕДОМЛЕНИЯ (ТОЛЬКО TOAST)
// ============================================

function showSystemNotification(message, type = 'info') {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
        loading: '⏳'
    };
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6',
        loading: '#6366f1'
    };
    
    const toast = document.createElement('div');
    toast.className = 'system-toast';
    toast.style.borderLeftColor = colors[type] || '#3b82f6';
    
    let iconHtml = icons[type] || 'ℹ️';
    if (type === 'loading') {
        iconHtml = '<i class="fas fa-spinner fa-spin" style="color: #6366f1;"></i>';
    }
    
    toast.innerHTML = `
        <span style="font-size: 20px;">${iconHtml}</span>
        <span style="flex: 1; font-size: 13px; color: #e2e8f0;">${escapeHtmlNotification(message)}</span>
        <button class="toast-close" onclick="closeToast(this.parentElement)">×</button>
    `;
    
    document.body.appendChild(toast);
    activeToasts.push(toast);
    
    // Автоудаление
    const duration = type === 'loading' ? 0 : (type === 'error' ? 5000 : 4000);
    if (duration > 0) {
        setTimeout(() => closeToast(toast), duration);
    }
    
    return toast;
}

function closeToast(toast) {
    if (!toast || !toast.parentElement) return;
    
    toast.classList.add('closing');
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
            activeToasts = activeToasts.filter(t => t !== toast);
        }
    }, 200);
}

function updateLoadingToast(toast, message, type = 'success') {
    if (!toast || !toast.parentElement) return;
    
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    
    toast.style.borderLeftColor = colors[type] || '#3b82f6';
    toast.querySelector('span:first-child').innerHTML = icons[type] || 'ℹ️';
    toast.querySelector('span:nth-child(2)').textContent = message;
    
    setTimeout(() => closeToast(toast), 4000);
}

// ============================================
// ВАЖНЫЕ СОБЫТИЯ (TOAST + ИСТОРИЯ)
// ============================================

function sendEvent(eventType, data, recipient = null) {
    const config = EVENT_CONFIG[eventType];
    if (!config) {
        console.error('Неизвестный тип события:', eventType);
        return;
    }
    
    const notification = {
        id: generateId(),
        type: eventType,
        icon: config.icon,
        color: config.color,
        title: config.title,
        message: config.message(data),
        actions: config.actions || [],
        data: data,
        time: Date.now(),
        read: false,
        recipient: recipient
    };
    
    // Если получатель — текущий пользователь или нет получателя
    if (!recipient || recipient === window.app?.currentUser) {
        addNotificationToList(notification);
        showEventToast(notification);
    }
    
    // Отправить через Pusher другому пользователю
    if (recipient && recipient !== window.app?.currentUser) {
        sendPusherNotification(recipient, notification);
    }
    
    // Сохранить на сервере (если нужно)
    // saveNotificationToServer(notification);
}

function showEventToast(notification) {
    const toast = document.createElement('div');
    toast.className = 'event-toast';
    toast.style.borderLeftColor = notification.color;
    
    let actionsHtml = '';
    if (notification.actions && notification.actions.length > 0) {
        actionsHtml = `
            <div class="event-toast-actions" style="margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${notification.actions.map(action => renderActionButton(action, notification)).join('')}
            </div>
        `;
    }
    
    toast.innerHTML = `
        <div style="display: flex; gap: 14px;">
            <div style="font-size: 36px; line-height: 1;">${notification.icon}</div>
            <div style="flex: 1;">
                <div style="font-weight: 700; font-size: 14px; color: #f1f5f9; margin-bottom: 4px;">${escapeHtmlNotification(notification.title)}</div>
                <div style="font-size: 12px; color: #94a3b8; line-height: 1.4;">${escapeHtmlNotification(notification.message)}</div>
                ${actionsHtml}
            </div>
            <button class="toast-close" onclick="closeToast(this.parentElement.parentElement.parentElement)">×</button>
        </div>
    `;
    
    document.body.appendChild(toast);
    activeToasts.push(toast);
    
    setTimeout(() => closeToast(toast), 8000);
}

function renderActionButton(action, notification) {
    switch(action) {
        case 'thanks':
            return `<button class="toast-action-btn" onclick="sendThanks('${notification.id}')">🙏 Спасибо</button>`;
        case 'view_gift':
            return `<button class="toast-action-btn" onclick="viewGift('${notification.id}')">🎁 Посмотреть</button>`;
        case 'view_fine':
            return `<button class="toast-action-btn" onclick="viewFine('${notification.data.fineId}')">👁️ Посмотреть</button>`;
        case 'appeal':
            return `<button class="toast-action-btn" onclick="appealFine('${notification.data.fineId}')">⚖️ Оспорить</button>`;
        case 'view_task':
            return `<button class="toast-action-btn" onclick="viewTask('${notification.data.taskId}')">📋 К задаче</button>`;
        case 'accept_exchange':
            return `<button class="toast-action-btn accept" onclick="acceptExchangeFromToast('${notification.data.requestId}')">✅ Принять</button>`;
        case 'reject_exchange':
            return `<button class="toast-action-btn reject" onclick="rejectExchangeFromToast('${notification.data.requestId}')">❌ Отклонить</button>`;
        case 'view_exchange':
            return `<button class="toast-action-btn" onclick="viewExchange('${notification.data.requestId}')">🔄 Посмотреть</button>`;
        case 'view_achievements':
            return `<button class="toast-action-btn" onclick="viewAchievements()">🏆 Достижения</button>`;
        case 'view_profile':
            return `<button class="toast-action-btn" onclick="viewProfile('${notification.data.name}')">👤 Профиль</button>`;
        case 'view_rating':
            return `<button class="toast-action-btn" onclick="viewRating()">⭐ Рейтинг</button>`;
        case 'open_chat':
            return `<button class="toast-action-btn" onclick="openChat('${notification.data.roomId || notification.data.sender}')">💬 Чат</button>`;
        case 'view_schedule':
            return `<button class="toast-action-btn" onclick="viewSchedule()">📅 График</button>`;
        case 'view_vp':
            return `<button class="toast-action-btn" onclick="viewVp()">🎮 ВП</button>`;
        case 'view_salary':
            return `<button class="toast-action-btn" onclick="viewSalary()">💰 Зарплата</button>`;
        default:
            return '';
    }
}

function addNotificationToList(notification) {
    notificationsList.unshift(notification);
    unreadCount++;
    
    if (notificationsList.length > MAX_NOTIFICATIONS) {
        notificationsList = notificationsList.slice(0, MAX_NOTIFICATIONS);
    }
    
    saveNotificationsToStorage();
    updateNotificationsBadge();
    
    if (document.getElementById('notificationsDropdown')?.classList.contains('show')) {
        renderNotificationsDropdown();
    }
}

// ============================================
// PUSHER
// ============================================

function setupPusherNotificationListeners() {
    if (pusherBindingsSetup) return;
    
    const checkPusher = setInterval(() => {
        if (window.channel && window.privateChannel) {
            clearInterval(checkPusher);
            bindNotificationEvents();
            pusherBindingsSetup = true;
        }
    }, 500);
    
    setTimeout(() => clearInterval(checkPusher), 10000);
}

function bindNotificationEvents() {
    if (window.privateChannel) {
        window.privateChannel.bind('personal-notification', (data) => {
            const config = EVENT_CONFIG[data.type];
            if (config) {
                sendEvent(data.type, data.data);
            }
        });
    }
}

function sendPusherNotification(recipient, notification) {
    if (!window.pusher || !window.privateChannel) return;
    
    // Отправка через серверный API
    fetch('/api/notifications/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
            recipient: recipient,
            type: notification.type,
            data: notification.data
        })
    }).catch(e => console.error('Ошибка отправки уведомления:', e));
}

// ============================================
// ДЕЙСТВИЯ ПО КНОПКАМ
// ============================================

function sendThanks(notificationId) {
    const notification = notificationsList.find(n => n.id === notificationId);
    if (!notification) return;
    
    if (notification.type === NOTIFICATION_TYPES.GIFT_RECEIVED && !notification.data.anonymous) {
        // Отправить благодарность через чат
        if (typeof window.openChatWithEmployee === 'function') {
            window.openChatWithEmployee(notification.data.sender);
        }
    }
    
    showSystemNotification('🙏 Спасибо отправлено!', 'success');
}

function viewGift(notificationId) {
    const notification = notificationsList.find(n => n.id === notificationId);
    if (notification) {
        markNotificationRead(notificationId);
    }
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('shop');
    }
}

function viewFine(fineId) {
    if (typeof window.openFineModal === 'function') {
        window.openFineModal(fineId);
    }
}

function appealFine(fineId) {
    if (typeof window.appealFine === 'function') {
        window.appealFine(fineId);
    }
    showSystemNotification('⚖️ Апелляция отправлена', 'info');
}

function viewTask(taskId) {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('tasks');
        setTimeout(() => {
            if (typeof window.openTaskModal === 'function') {
                window.openTaskModal(taskId);
            }
        }, 300);
    }
}

function acceptExchangeFromToast(requestId) {
    if (typeof window.acceptExchange === 'function') {
        window.acceptExchange(requestId);
    }
}

function rejectExchangeFromToast(requestId) {
    if (typeof window.rejectExchange === 'function') {
        window.rejectExchange(requestId);
    }
}

function viewExchange(requestId) {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('dashboard');
    }
}

function viewAchievements() {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('rating');
        setTimeout(() => {
            document.querySelector('.rating-tab[data-tab="achievements"]')?.click();
        }, 200);
    }
}

function viewProfile(name) {
    if (typeof window.openProfile === 'function') {
        window.openProfile(name);
    }
}

function viewRating() {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('rating');
    }
}

function openChat(roomId) {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('chat');
        setTimeout(() => {
            if (typeof window.switchChat === 'function') {
                window.switchChat(roomId);
            }
        }, 300);
    }
}

function viewSchedule() {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('schedule');
    }
}

function viewVp() {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('vp');
    }
}

function viewSalary() {
    if (typeof window.switchToTab === 'function') {
        window.switchToTab('salary');
    }
}

// ============================================
// ИСТОРИЯ УВЕДОМЛЕНИЙ (КОЛОКОЛЬЧИК)
// ============================================

function renderNotificationsDropdown() {
    const container = document.getElementById('notificationsList');
    if (!container) return;
    
    if (notificationsList.length === 0) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;">🔔 Нет уведомлений</div>';
        return;
    }
    
    let html = '';
    for (const n of notificationsList.slice(0, 30)) {
        const timeAgo = formatTimeAgoNotification(n.time);
        
        html += `
            <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead('${n.id}')">
                <div style="display: flex; gap: 12px;">
                    <div style="font-size: 24px;">${n.icon}</div>
                    <div style="flex: 1;">
                        <div class="notification-title">${escapeHtmlNotification(n.title)}</div>
                        <div class="notification-text">${escapeHtmlNotification(n.message)}</div>
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function formatTimeAgoNotification(timestamp) {
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
        renderNotificationsDropdown();
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
        showSystemNotification('Все уведомления прочитаны', 'success');
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
    
    document.getElementById('notificationsDropdown')?.classList.remove('show');
    showSystemNotification('Уведомления очищены', 'success');
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
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeHtmlNotification(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function cleanupNotifications() {
    if (window.channel) {
        window.channel.unbind('global-notification');
    }
    if (window.privateChannel) {
        window.privateChannel.unbind('personal-notification');
    }
    pusherBindingsSetup = false;
    
    activeToasts.forEach(toast => closeToast(toast));
    activeToasts = [];
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initNotifications = initNotifications;
window.showSystemNotification = showSystemNotification;
window.showNotif = showSystemNotification; // Обратная совместимость
window.sendEvent = sendEvent;
window.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
window.closeToast = closeToast;
window.updateLoadingToast = updateLoadingToast;
window.renderNotificationsDropdown = renderNotificationsDropdown;
window.updateNotificationsBadge = updateNotificationsBadge;
window.toggleNotificationsDropdown = toggleNotificationsDropdown;
window.markAllNotificationsRead = markAllNotificationsRead;
window.clearAllNotifications = clearAllNotifications;
window.markNotificationRead = markNotificationRead;
window.cleanupNotifications = cleanupNotifications;

// Экспорт действий для кнопок
window.sendThanks = sendThanks;
window.viewGift = viewGift;
window.viewFine = viewFine;
window.appealFine = appealFine;
window.viewTask = viewTask;
window.acceptExchangeFromToast = acceptExchangeFromToast;
window.rejectExchangeFromToast = rejectExchangeFromToast;
window.viewExchange = viewExchange;
window.viewAchievements = viewAchievements;
window.viewProfile = viewProfile;
window.viewRating = viewRating;
window.openChat = openChat;
window.viewSchedule = viewSchedule;
window.viewVp = viewVp;
window.viewSalary = viewSalary;

// Автоинициализация
setTimeout(() => { if (!isInitialized) initNotifications(); }, 1000);

console.log('✅ notifications.js загружен (v3.0 — двухуровневая система)');