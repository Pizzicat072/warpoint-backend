// public/js/utils.js

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;'
    }[m] || m));
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
}

function formatDateTime(dateStr, timeStr) {
    if (!dateStr) return '—';
    return `${formatDate(dateStr)} ${timeStr || ''}`;
}

let activeNotification = null;
let notificationTimeout = null;

function showNotif(msg, type = 'success') {
    if (activeNotification) {
        activeNotification.remove();
        if (notificationTimeout) clearTimeout(notificationTimeout);
    }
    
    const n = document.createElement('div');
    n.className = 'notification';
    const icon = type === 'error' ? 'exclamation-circle' : 
                 type === 'warning' ? 'exclamation-triangle' : 'check-circle';
    n.style.borderLeftColor = type === 'error' ? '#f87171' : 
                               type === 'warning' ? '#f59e0b' : '#34d399';
    n.innerHTML = `<i class="fas fa-${icon}"></i> ${msg}`;
    document.body.appendChild(n);
    activeNotification = n;
    
    notificationTimeout = setTimeout(() => {
        if (n && n.remove) n.remove();
        activeNotification = null;
    }, 4000);
}

const roleNames = {
    director: 'Директор',
    manager: 'Управляющий',
    admin: 'Админ',
    operator: 'Оператор'
};

const rolesMap = {
    director: { level: 4, canEdit: true, canDelete: true, canEditTasks: true, canEditSite: true, canEditFines: true, canEditSalary: true, canEditSchedule: true },
    manager: { level: 3, canEdit: true, canDelete: true, canEditTasks: true, canEditSite: true, canEditFines: false, canEditSalary: false, canEditSchedule: true },
    admin: { level: 2, canEdit: false, canDelete: false, canEditTasks: true, canEditSite: false, canEditFines: false, canEditSalary: false, canEditSchedule: false },
    operator: { level: 1, canEdit: false, canDelete: false, canEditTasks: true, canEditSite: false, canEditFines: false, canEditSalary: false, canEditSchedule: false }
};

const statusesList = ['💼 Работаю', '☕ Перерыв', '🎯 В фокусе', '⭐ MVP', '🚀 Взлёт'];
const avatars = ['👤', '😎', '🔥', '⚡', '🎯', '🏆', '🦸', '👑'];

window.app = {
    currentUser: null,
    currentUserRole: null,
    currentUserPermissions: null,
    employees: [],
    profiles: {},
    tasks: [],
    fines: [],
    schedule: {},
    lastActivity: {},
    stickers: {},
    achievements: {}
};

window.dispatchDataUpdate = function(type, data) {
    const event = new CustomEvent('dataUpdate', { detail: { type, data } });
    window.dispatchEvent(event);
};

window.addEventListener('dataUpdate', (e) => {
    const { type, data } = e.detail;
    console.log('🔄 Синхронизация:', type, data);
    
    switch(type) {
        case 'schedule':
            if (typeof renderMonthSchedule === 'function') renderMonthSchedule();
            if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            if (typeof renderEmployees === 'function') renderEmployees();
            break;
        case 'profile':
            if (typeof renderEmployees === 'function') renderEmployees();
            if (typeof updateUserAvatarAndStatus === 'function') updateUserAvatarAndStatus();
            break;
        case 'task':
            if (typeof renderTasksTable === 'function') renderTasksTable();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            break;
        case 'fine':
            if (typeof renderFinesTable === 'function') renderFinesTable();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            break;
    }
});

function getTobolskNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
}

function getDayFromDateStr(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    return parseInt(parts[2]);
}

function getMonthNameFromDateStr(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const date = new Date(year, month, 1);
    return date.toLocaleString('ru', { month: 'long' });
}

function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    const day = getDayFromDateStr(dateStr);
    const month = getMonthNameFromDateStr(dateStr);
    return `${day} ${month}`;
}

function getEmployeeAvatar(employeeName, size = 'small') {
    const profile = window.app.profiles[employeeName];
    if (!profile) return '👤';
    
    if (profile.avatar_url && profile.avatar_url.startsWith('data:image')) {
        return '<img src="' + profile.avatar_url + '" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerHTML=\'👤\'">';
    }
    
    return profile.avatar || '👤';
}

function getAvatarHtml(profile, size = 'small') {
    if (!profile) return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: 24px;">👤</div>';
    
    const sizeMap = {
        'tiny': { width: '24px', height: '24px', fontSize: '14px', borderRadius: '50%' },
        'small': { width: '36px', height: '36px', fontSize: '20px', borderRadius: '50%' },
        'medium': { width: '48px', height: '48px', fontSize: '28px', borderRadius: '50%' },
        'large': { width: '70px', height: '70px', fontSize: '40px', borderRadius: '24px' }
    };
    const sizes = sizeMap[size] || sizeMap.small;
    
    if (profile.avatar_url && profile.avatar_url.startsWith('data:image')) {
        return '<img src="' + profile.avatar_url + '" style="width: ' + sizes.width + '; height: ' + sizes.height + '; object-fit: cover; border-radius: ' + sizes.borderRadius + ';" onerror="this.onerror=null; this.parentElement.innerHTML=\'<div style=&quot;display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: ' + sizes.fontSize + ';&quot;>👤</div>\'">';
    }
    
    return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: linear-gradient(135deg, #6366f1, #ec4899); border-radius: ' + sizes.borderRadius + '; font-size: ' + sizes.fontSize + ';">' + (profile.avatar || '👤') + '</div>';
}

function formatWP(amount) {
    if (amount === undefined || amount === null) return '0 WP';
    return amount.toLocaleString() + ' WP';
}

function getCurrentBalance() {
    const currentUser = window.app?.currentUser;
    if (currentUser && window.app?.profiles?.[currentUser]) {
        return window.app.profiles[currentUser].coins || 0;
    }
    return 0;
}

function hasEnoughWP(requiredAmount) {
    return getCurrentBalance() >= requiredAmount;
}

function refreshAllBalanceDisplays() {
    const currentUser = window.app?.currentUser;
    if (!currentUser) return;
    
    const balance = window.app?.profiles?.[currentUser]?.coins || 0;
    
    // Дашборд
    const userCoinsHeader = document.getElementById('userCoinsAmountHeader');
    if (userCoinsHeader) userCoinsHeader.textContent = balance.toLocaleString();
    
    // Магазин
    const shopBalance = document.getElementById('userCoinsAmount');
    if (shopBalance) shopBalance.textContent = balance.toLocaleString();
    
    // Профиль
    const profileCoins = document.getElementById('profileCoins');
    if (profileCoins) profileCoins.textContent = balance;
    
    // Карточки сотрудников (если открыты)
    if (typeof renderEmployees === 'function') renderEmployees();
}

window.refreshAllBalanceDisplays = refreshAllBalanceDisplays;

function showWPEarnedNotification(amount, source, targetElement = null) {
    if (!targetElement) {
        targetElement = document.getElementById('userCoinsAmount');
    }
    
    if (!targetElement) return;
    
    const rect = targetElement.getBoundingClientRect();
    
    const notification = document.createElement('div');
    notification.className = 'wp-earned-notification';
    notification.innerHTML = `
        <div class="wp-notification-content">
            <span class="wp-notification-icon">💰</span>
            <span class="wp-notification-amount">+${amount}</span>
            <span class="wp-notification-source">${source}</span>
        </div>
    `;
    notification.style.position = 'fixed';
    notification.style.left = `${rect.left + rect.width / 2 - 60}px`;
    notification.style.top = `${rect.top - 50}px`;
    notification.style.zIndex = '10000';
    notification.style.pointerEvents = 'none';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transition = 'all 0.5s ease';
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-30px)';
        setTimeout(() => notification.remove(), 500);
    }, 2000);
}

function showWPSpentNotification(amount, source) {
    const targetElement = document.getElementById('userCoinsAmount');
    if (!targetElement) return;
    
    const rect = targetElement.getBoundingClientRect();
    
    const notification = document.createElement('div');
    notification.className = 'wp-spent-notification';
    notification.innerHTML = `
        <div class="wp-notification-content">
            <span class="wp-notification-icon">💸</span>
            <span class="wp-notification-amount">-${amount}</span>
            <span class="wp-notification-source">${source}</span>
        </div>
    `;
    notification.style.position = 'fixed';
    notification.style.left = `${rect.left + rect.width / 2 - 60}px`;
    notification.style.top = `${rect.top - 50}px`;
    notification.style.zIndex = '10000';
    notification.style.pointerEvents = 'none';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transition = 'all 0.5s ease';
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(-30px)';
        setTimeout(() => notification.remove(), 500);
    }, 2000);
}

const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    .wp-earned-notification, .wp-spent-notification {
        animation: wpNotificationSlideIn 0.3s ease-out;
    }
    
    .wp-notification-content {
        background: linear-gradient(135deg, #1a1f2e, #0f1222);
        border-radius: 40px;
        padding: 8px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        border: 1px solid;
    }
    
    .wp-earned-notification .wp-notification-content {
        border-color: #10b981;
    }
    
    .wp-spent-notification .wp-notification-content {
        border-color: #ef4444;
    }
    
    .wp-notification-icon {
        font-size: 20px;
    }
    
    .wp-notification-amount {
        font-size: 18px;
        font-weight: 700;
    }
    
    .wp-earned-notification .wp-notification-amount {
        color: #10b981;
    }
    
    .wp-spent-notification .wp-notification-amount {
        color: #ef4444;
    }
    
    .wp-notification-source {
        font-size: 11px;
        color: #94a3b8;
        padding-left: 10px;
        border-left: 1px solid #2a3240;
    }
    
    @keyframes wpNotificationSlideIn {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`;

if (!document.querySelector('#wpNotificationStyles')) {
    notificationStyles.id = 'wpNotificationStyles';
    document.head.appendChild(notificationStyles);
}

function getTransactionIcon(type) {
    const icons = {
        'login_streak': { icon: '🎁', color: '#fbbf24', name: 'Ежедневный бонус' },
        'task_reward': { icon: '✅', color: '#10b981', name: 'Награда за задачу' },
        'shift_earn': { icon: '⏱️', color: '#06b6d4', name: 'Оплата смены' },
        'gift_send': { icon: '🎁', color: '#f97316', name: 'Отправка подарка' },
        'gift_receive': { icon: '🎁', color: '#ec4899', name: 'Получение подарка' },
        'shop_purchase': { icon: '🛒', color: '#8b5cf6', name: 'Покупка в магазине' },
        'fine': { icon: '⚠️', color: '#ef4444', name: 'Штраф' },
        'admin_bonus': { icon: '👑', color: '#fbbf24', name: 'Бонус от директора' }
    };
    return icons[type] || { icon: '💰', color: '#64748b', name: type };
}

function formatTransactionDate(dateStr) {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return 'Сегодня';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Вчера';
    }
    
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function getStreakBonus(day) {
    const bonuses = { 1: 5, 2: 8, 3: 12, 4: 15, 5: 20, 6: 25, 7: 50 };
    return bonuses[Math.min(day, 7)] || 5;
}

function getNextStreakInfo(currentStreak) {
    const nextDay = Math.min(currentStreak + 1, 7);
    const nextBonus = getStreakBonus(nextDay);
    return { day: nextDay, bonus: nextBonus };
}

window.formatWP = formatWP;
window.getCurrentBalance = getCurrentBalance;
window.hasEnoughWP = hasEnoughWP;
window.refreshAllBalanceDisplays = refreshAllBalanceDisplays;
window.showWPEarnedNotification = showWPEarnedNotification;
window.showWPSpentNotification = showWPSpentNotification;
window.getTransactionIcon = getTransactionIcon;
window.formatTransactionDate = formatTransactionDate;
window.getStreakBonus = getStreakBonus;
window.getNextStreakInfo = getNextStreakInfo;
window.getTobolskNow = getTobolskNow;
window.parseLocalDate = parseLocalDate;
window.getDayFromDateStr = getDayFromDateStr;
window.getMonthNameFromDateStr = getMonthNameFromDateStr;
window.formatDateForDisplay = formatDateForDisplay;
window.dispatchDataUpdate = dispatchDataUpdate;
window.getEmployeeAvatar = getEmployeeAvatar;
window.getAvatarHtml = getAvatarHtml;

console.log('✅ utils.js загружен');