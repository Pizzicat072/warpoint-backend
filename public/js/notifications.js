// public/js/notifications.js — ОБЁРНУТ В IIFE
(function() {
    'use strict';
    
    let notificationsList = [];
    let unreadCount = 0;
    let notificationIdCounter = 0;
    const MAX_NOTIFICATIONS = 50;
    
    let toastQueue = [];
    let isShowingToast = false;
    const TOAST_DELAY = 800;
    const TOAST_DURATION = 5000;
    let activeToasts = new Map();
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
        
        console.log('🔔 Инициализация премиум-уведомлений');
        loadNotificationsFromStorage();
        setupPusherNotificationListeners();
        updateNotificationsBadge();
        updateSyncIndicator();
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
            notificationIdCounter = 0;
            localStorage.removeItem('warpoint_notifications');
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

    // ============================================
    // ИНДИКАТОР СИНХРОНИЗАЦИИ
    // ============================================
    function updateSyncIndicator() {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;
        
        const textSpan = indicator.querySelector('span');
        if (textSpan) textSpan.style.display = 'none';
        
        indicator.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            width: 40px;
            height: 40px;
            background: #11141c;
            backdrop-filter: blur(12px);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9998;
            border: 1px solid #1e2430;
            cursor: pointer;
            transition: all 0.3s;
        `;
        
        indicator.onclick = () => {
            if (typeof window.initPusher === 'function') window.initPusher();
        };
    }

    function setSyncStatus(status) {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;
        
        const icon = indicator.querySelector('i');
        if (!icon) return;
        
        if (status === 'online') {
            indicator.style.borderColor = '#10b981';
            icon.style.color = '#10b981';
            icon.className = 'fas fa-broadcast-tower fa-fw';
        } else if (status === 'connecting') {
            indicator.style.borderColor = '#f59e0b';
            icon.style.color = '#f59e0b';
            icon.className = 'fas fa-sync-alt fa-spin fa-fw';
        } else {
            indicator.style.borderColor = '#ef4444';
            icon.style.color = '#ef4444';
            icon.className = 'fas fa-broadcast-tower fa-fw';
        }
    }

    // ============================================
    // ОЧЕРЕДЬ TOAST-УВЕДОМЛЕНИЙ СО СТАКИНГОМ
    // ============================================
    function getToastKey(notification) {
        return `${notification.type}_${notification.title}_${notification.text}`;
    }

    function enqueueToast(notification) {
        const key = getToastKey(notification);
        
        if (activeToasts.has(key)) {
            const existing = activeToasts.get(key);
            existing.count++;
            
            const countEl = existing.element.querySelector('.toast-count');
            if (countEl) {
                countEl.textContent = `×${existing.count}`;
                countEl.style.display = 'flex';
            }
            
            if (existing.timeout) clearTimeout(existing.timeout);
            existing.timeout = setTimeout(() => closeToast(existing.element, key), TOAST_DURATION);
            
            console.log(`📨 Стакинг уведомления (×${existing.count}): ${notification.title}`);
            return;
        }
        
        toastQueue.push({ ...notification, key });
        console.log(`📨 Уведомление добавлено в очередь (всего: ${toastQueue.length})`);
        processToastQueue();
    }

    function processToastQueue() {
        if (isShowingToast) return;
        if (toastQueue.length === 0) return;
        
        isShowingToast = true;
        const { key, ...notification } = toastQueue.shift();
        
        showToastNow(notification, key);
        
        setTimeout(() => {
            isShowingToast = false;
            processToastQueue();
        }, TOAST_DELAY);
    }

    function showToastNow(notification, key) {
        const toast = document.createElement('div');
        toast.className = 'notification-toast-premium';
        
        let borderColor = '#10b981';
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
            border-radius: 20px;
            padding: 16px 18px;
            display: flex;
            align-items: center;
            gap: 16px;
            z-index: 100000;
            transform: translateX(450px);
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.2, 0.9, 0.4, 1);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
            border-left: 4px solid ${borderColor};
            cursor: pointer;
            backdrop-filter: blur(20px);
        `;
        
        toast.innerHTML = `
            <div class="toast-icon" style="font-size: 32px; flex-shrink: 0;">${escapeHtml(notification.icon)}</div>
            <div style="flex: 1;">
                <div class="toast-title" style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #f1f5f9;">${escapeHtml(notification.title)}</div>
                <div class="toast-text" style="font-size: 12px; color: #94a3b8; line-height: 1.4;">${escapeHtml(notification.text)}</div>
            </div>
            <div class="toast-count" style="display: none; background: ${borderColor}; color: white; padding: 2px 8px; border-radius: 20px; font-size: 12px; font-weight: 600;">×1</div>
            <button class="toast-close" style="background: none; border: none; color: #64748b; font-size: 20px; cursor: pointer; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 8px; transition: all 0.2s;">×</button>
        `;
        
        document.body.appendChild(toast);
        
        const timeoutId = setTimeout(() => closeToast(toast, key), TOAST_DURATION);
        activeToasts.set(key, { element: toast, count: 1, timeout: timeoutId });
        
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeToast(toast, key);
        });
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            closeBtn.style.color = '#f87171';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'none';
            closeBtn.style.color = '#64748b';
        });
        
        toast.addEventListener('click', (e) => {
            if (!e.target.closest('.toast-close')) closeToast(toast, key);
        });
        
        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
            toast.style.opacity = '1';
        }, 10);
    }

    function closeToast(toast, key) {
        if (!toast.parentElement) return;
        
        const active = activeToasts.get(key);
        if (active && active.timeout) clearTimeout(active.timeout);
        activeToasts.delete(key);
        
        toast.style.transform = 'translateX(450px)';
        toast.style.opacity = '0';
        
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 400);
    }

    // ============================================
    // PUSHER СЛУШАТЕЛИ
    // ============================================
    function setupPusherNotificationListeners() {
        if (pusherBindingsSetup) return;
        
        const checkPusher = setInterval(() => {
            if (window.channel && window.privateChannel) {
                clearInterval(checkPusher);
                bindNotificationEvents();
                pusherBindingsSetup = true;
                setSyncStatus('online');
            }
        }, 500);
        
        setTimeout(() => clearInterval(checkPusher), 10000);
    }

    function bindNotificationEvents() {
        console.log('🔔 Привязка слушателей уведомлений');
        
        if (window.channel) {
            window.channel.bind('pusher:subscription_succeeded', () => setSyncStatus('online'));
            window.channel.bind('pusher:subscription_error', () => setSyncStatus('offline'));
            
            window.channel.bind('global-notification', (data) => {
                if (data.excludeUser === window.app?.currentUser) return;
                
                enqueueToast({ type: data.type, icon: data.icon, title: data.title, text: data.text, time: data.time });
                addNotificationToList({ id: 'global_' + data.time, type: data.type, icon: data.icon, title: data.title, text: data.text, time: data.time, read: false });
            });
        }
        
        if (window.privateChannel) {
            window.privateChannel.bind('personal-notification', (data) => {
                enqueueToast({ type: data.type, icon: data.icon, title: data.title, text: data.text, time: data.time });
                addNotificationToList({ id: 'personal_' + data.time, type: data.type, icon: data.icon, title: data.title, text: data.text, time: data.time, read: false });
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
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;">🔔 Нет уведомлений</div>';
            return;
        }
        
        let html = '';
        for (const n of notificationsList.slice(0, 20)) {
            html += `
                <div class="notification-item ${n.read ? '' : 'unread'}" onclick="markNotificationRead('${n.id}')">
                    <div style="display: flex; gap: 12px;">
                        <div style="font-size: 24px;">${escapeHtml(n.icon)}</div>
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
    // ОЧИСТКА
    // ============================================
    function cleanupNotifications() {
        if (window.channel) window.channel.unbind('global-notification');
        if (window.privateChannel) window.privateChannel.unbind('personal-notification');
        pusherBindingsSetup = false;
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
    window.setSyncStatus = setSyncStatus;
    window.cleanupNotifications = cleanupNotifications;

    setTimeout(() => { if (!isInitialized) initNotifications(); }, 1000);

    console.log('✅ notifications.js загружен');
})();