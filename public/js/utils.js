// public/js/utils.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ v1.1
// Добавлены все уведомления

// ============================================
// XSS ЗАЩИТА
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return String(str).replace(/[&<>"'`=/]/g, (m) => map[m]);
}

// ============================================
// ФОРМАТИРОВАНИЕ ДАТ
// ============================================

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU');
}

function formatDateTime(dateStr, timeStr) {
    if (!dateStr) return '—';
    return `${formatDate(dateStr)} ${timeStr || ''}`;
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ============================================
// УВЕДОМЛЕНИЯ (ОБРАТНАЯ СОВМЕСТИМОСТЬ)
// ============================================

let activeNotification = null;
let notificationTimeout = null;
const MAX_NOTIFICATIONS = 5;
let notificationCount = 0;

function showNotif(msg, type = 'success') {
    // Перенаправляем в новую систему уведомлений
    if (typeof window.showSystemNotification === 'function' && window.showSystemNotification !== showNotif) {
        window.showSystemNotification(msg, type);
        return;
    }
    
    // Fallback — старый toast
    if (notificationCount > MAX_NOTIFICATIONS) {
        console.warn('⚠️ Слишком много уведомлений');
        return;
    }
    
    if (activeNotification) {
        activeNotification.remove();
        if (notificationTimeout) clearTimeout(notificationTimeout);
        notificationCount--;
    }
    
    const n = document.createElement('div');
    n.className = 'notification';
    const icon = type === 'error' ? 'exclamation-circle' : 
                 type === 'warning' ? 'exclamation-triangle' : 'check-circle';
    n.style.borderLeftColor = type === 'error' ? '#f87171' : 
                               type === 'warning' ? '#f59e0b' : '#34d399';
    n.innerHTML = `<i class="fas fa-${icon}"></i> ${escapeHtml(msg)}`;
    document.body.appendChild(n);
    activeNotification = n;
    notificationCount++;
    
    notificationTimeout = setTimeout(() => {
        if (n && n.remove) {
            n.remove();
            notificationCount--;
        }
        activeNotification = null;
    }, 4000);
}

// ============================================
// DEBOUNCE И THROTTLE
// ============================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================
// РОЛИ И ПРАВА
// ============================================

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

// ============================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ============================================

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

// ============================================
// СОБЫТИЯ ДАННЫХ
// ============================================

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
        case 'salary':
            if (typeof loadSalaryData === 'function') loadSalaryData();
            break;
        case 'fund':
            if (typeof loadFundForSalary === 'function') loadFundForSalary();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            break;
        case 'achievement':
            if (typeof renderAchievements === 'function') renderAchievements();
            if (typeof renderRatingTable === 'function') renderRatingTable();
            break;
    }
});

// ============================================
// ВРЕМЯ ТОБОЛЬСКА
// ============================================

function getTobolskNow() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
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

// ============================================
// АВАТАРЫ
// ============================================

function getEmployeeAvatar(employeeName, size = 'small') {
    const profile = window.app.profiles[employeeName];
    if (!profile) return '👤';
    
    if (profile.avatar_url && profile.avatar_url.startsWith('data:image')) {
        return '<img src="' + escapeHtml(profile.avatar_url) + '" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerHTML=\'👤\'">';
    }
    
    return escapeHtml(profile.avatar) || '👤';
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
        return '<img src="' + escapeHtml(profile.avatar_url) + '" style="width: ' + sizes.width + '; height: ' + sizes.height + '; object-fit: cover; border-radius: ' + sizes.borderRadius + ';" onerror="this.onerror=null; this.parentElement.innerHTML=\'<div style=&quot;display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: ' + sizes.fontSize + ';&quot;>👤</div>\'">';
    }
    
    return '<div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: linear-gradient(135deg, #6366f1, #ec4899); border-radius: ' + sizes.borderRadius + '; font-size: ' + sizes.fontSize + ';">' + (escapeHtml(profile.avatar) || '👤') + '</div>';
}

// ============================================
// WP БАЛАНС
// ============================================

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
    
    const userCoinsHeader = document.getElementById('userCoinsAmountHeader');
    if (userCoinsHeader) userCoinsHeader.textContent = balance.toLocaleString();
    
    const shopBalance = document.getElementById('userCoinsAmount');
    if (shopBalance) shopBalance.textContent = balance.toLocaleString();
    
    const profileCoins = document.getElementById('profileCoins');
    if (profileCoins) profileCoins.textContent = balance;
    
    if (typeof renderEmployees === 'function') renderEmployees();
}

// ============================================
// ТРАНЗАКЦИИ
// ============================================

function getTransactionIcon(type) {
    const icons = {
        'login_streak': { icon: '🎁', color: '#fbbf24', name: 'Ежедневный бонус' },
        'task_reward': { icon: '✅', color: '#10b981', name: 'Награда за задачу' },
        'shift_earn': { icon: '⏱️', color: '#06b6d4', name: 'Оплата смены' },
        'gift_send': { icon: '🎁', color: '#f97316', name: 'Отправка подарка' },
        'gift_receive': { icon: '🎁', color: '#ec4899', name: 'Получение подарка' },
        'shop_purchase': { icon: '🛒', color: '#8b5cf6', name: 'Покупка в магазине' },
        'fine': { icon: '⚠️', color: '#ef4444', name: 'Штраф' },
        'admin_bonus': { icon: '👑', color: '#fbbf24', name: 'Бонус от директора' },
        'achievement': { icon: '🏆', color: '#fbbf24', name: 'Достижение' }
    };
    return icons[type] || { icon: '💰', color: '#64748b', name: type };
}

function formatTransactionDate(dateStr) {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Сегодня';
    else if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
    
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

// ============================================
// ЭКСПОРТ
// ============================================

window.escapeHtml = escapeHtml;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.formatTimeAgo = formatTimeAgo;
window.showNotif = showNotif;
window.debounce = debounce;
window.throttle = throttle;
window.roleNames = roleNames;
window.rolesMap = rolesMap;
window.statusesList = statusesList;
window.avatars = avatars;
window.getTobolskNow = getTobolskNow;
window.parseLocalDate = parseLocalDate;
window.getDayFromDateStr = getDayFromDateStr;
window.getMonthNameFromDateStr = getMonthNameFromDateStr;
window.formatDateForDisplay = formatDateForDisplay;
window.getEmployeeAvatar = getEmployeeAvatar;
window.getAvatarHtml = getAvatarHtml;
window.formatWP = formatWP;
window.getCurrentBalance = getCurrentBalance;
window.hasEnoughWP = hasEnoughWP;
window.refreshAllBalanceDisplays = refreshAllBalanceDisplays;
window.getTransactionIcon = getTransactionIcon;
window.formatTransactionDate = formatTransactionDate;
window.getStreakBonus = getStreakBonus;
window.getNextStreakInfo = getNextStreakInfo;

console.log('✅ utils.js загружен (v1.1 — с уведомлениями)');