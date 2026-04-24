// public/js/chat.js — WARPOINT CHAT v5.0 PRO
// Профессиональный чат как в современных мессенджерах
// Исправлено: Invalid Date, удаление сообщений, кэш при переключении вкладок

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    var CONFIG = {
        MESSAGE_COOLDOWN: 500,
        MAX_MESSAGE_LENGTH: 2000,
        MAX_MESSAGES_PER_MINUTE: 30,
        RENDER_DEBOUNCE_DELAY: 100,
        HISTORY_LOAD_TIMEOUT: 15000,
        TYPING_TIMEOUT: 2000,
        TYPING_DISPLAY_TIMEOUT: 2500,
        MESSAGE_CLEANUP_THRESHOLD: 1000,
        MAX_VISIBLE_MESSAGES: 500
    };

    // ============================================
    // ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ============================================
    var currentChatRoom = 'general';
    var chatMessages = {};
    var chatUnread = {};
    var lastProcessedTime = {};
    var deletedUntil = {};
    var currentAnnouncementStyle = 'director';
    var lastBulkDeleteTime = 0;

    var chatInitialized = false;
    var isLoadingHistory = false;
    var isSendingMessage = false;
    var isSwitchingChat = false;
    var pusherListenersSetup = false;

    var lastMessageTime = 0;
    var messageCountThisMinute = 0;
    var messageCountResetTimer = null;

    var abortController = null;
    var pendingMessages = [];
    var isProcessingQueue = false;

    var renderDebounceTimer = null;
    var typingTimeout = null;
    var isTyping = false;

    var searchResults = [];
    var currentSearchIndex = -1;

    window.chatUnread = chatUnread;

    // Восстанавливаем последнюю комнату
    var savedChatRoom = sessionStorage.getItem('currentChatRoom');
    if (savedChatRoom) {
        currentChatRoom = savedChatRoom;
    }

    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================
    function resetChatState() {
        console.log('🧹 Сброс состояния чата');
        chatInitialized = false;
        pusherListenersSetup = false;
        if (renderDebounceTimer) {
            clearTimeout(renderDebounceTimer);
            renderDebounceTimer = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        if (messageCountResetTimer) {
            clearInterval(messageCountResetTimer);
            messageCountResetTimer = null;
        }
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
    }

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function escapeHtml(str) {
        if (!str && str !== 0) return '';
        str = String(str);
        var map = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#039;'
        };
        return str.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    function showSystemNotification(message, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        }
    }

    function parseTimestamp(ts) {
        if (ts === null || ts === undefined) return Date.now();
        if (typeof ts === 'string') ts = parseInt(ts, 10);
        if (isNaN(ts) || ts <= 0) return Date.now();
        return ts;
    }

    function formatTime(timestamp) {
        var ts = parseTimestamp(timestamp);
        var date = new Date(ts);
        if (isNaN(date.getTime())) return '--:--';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatTimeAgo(timestamp) {
        var ts = parseTimestamp(timestamp);
        var diff = Date.now() - ts;
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч назад';
        var date = new Date(ts);
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }

    function formatDateHeader(timestamp) {
        var ts = parseTimestamp(timestamp);
        var date = new Date(ts);
        if (isNaN(date.getTime())) return '—';
        var today = new Date();
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === today.toDateString()) return 'Сегодня';
        if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatDateSimple(dateStr) {
        if (!dateStr) return '—';
        var parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        var day = parseInt(parts[2], 10);
        var month = parseInt(parts[1], 10);
        var monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return day + ' ' + monthNames[month - 1];
    }

    function getAvatarHtml(profile) {
        if (!profile) return '<span style="font-size:24px;">👤</span>';
        if (profile.avatar_url) {
            return '<img src="' + escapeHtml(profile.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.innerHTML=\'<span style=font-size:14px;font-weight:600;>' + getInitials(profile.name) + '</span>\'">';
        }
        return escapeHtml(profile.avatar || '👤');
    }

    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    }

    function getRoleName(role) {
        var names = { director: 'Директор', manager: 'Управляющий', admin: 'Админ', operator: 'Оператор' };
        return names[role] || 'Сотрудник';
    }

    function openProfile(employeeName) {
        if (typeof window.openProfile === 'function') {
            window.openProfile(employeeName);
            return;
        }
        if (typeof window.loadPage === 'function') {
            window.loadPage('employees');
            setTimeout(function() {
                if (typeof window.openProfile === 'function') window.openProfile(employeeName);
            }, 500);
        }
    }
    // ============================================
    // API ЗАПРОСЫ
    // ============================================
    async function apiCall(endpoint, method, body) {
        if (!method) method = 'GET';
        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
        var options = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        if (body) options.body = JSON.stringify(body);
        try {
            var response = await fetch('/api' + endpoint, options);
            return await response.json();
        } catch (e) {
            console.error('API Error:', e.message);
            return { success: false, error: 'Ошибка соединения' };
        }
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initChat() {
        if (chatInitialized) {
            var container = document.getElementById('chatMessages');
            if (container && !container.querySelector('.message')) {
                renderChatMessages();
                renderChatContacts();
            }
            return;
        }

        var container = document.getElementById('chatMessages');
        if (!container) {
            setTimeout(initChat, 100);
            return;
        }

        console.log('💬 Инициализация чата v5.0');

        var picker = document.getElementById('emojiPicker');
        if (picker) picker.style.display = 'none';

        loadChatHistory();
        setupEmojiPickerClose();
        initAnnouncementButton();
        initChatSettings();
        setupOfflineDetection();
        setupMessageRateLimit();
        restoreDraft();

        chatInitialized = true;
    }

    function setupEmojiPickerClose() {
        document.addEventListener('click', function(e) {
            var picker = document.getElementById('emojiPicker');
            var btn = document.querySelector('.chat-emoji-btn');
            if (picker && btn && !picker.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                picker.style.display = 'none';
            }
        });
    }

    function setupOfflineDetection() {
        window.addEventListener('online', function() {
            showSystemNotification('📡 Соединение восстановлено', 'success');
            document.getElementById('offlineBanner') && (document.getElementById('offlineBanner').style.display = 'none');
            processPendingMessages();
            loadRecentMessages();
        });
        window.addEventListener('offline', function() {
            showSystemNotification('📡 Нет соединения', 'warning');
            var banner = document.getElementById('offlineBanner');
            if (banner) banner.style.display = 'block';
        });
    }

    function setupMessageRateLimit() {
        messageCountResetTimer = setInterval(function() {
            messageCountThisMinute = 0;
        }, 60000);
    }

    function restoreDraft() {
        var draft = sessionStorage.getItem('chat_draft_' + currentChatRoom);
        if (draft) {
            var input = document.getElementById('chatInput');
            if (input) {
                input.value = draft;
                autoResizeTextarea(input);
            }
        }
    }

    function saveDraft() {
        var input = document.getElementById('chatInput');
        if (input) {
            sessionStorage.setItem('chat_draft_' + currentChatRoom, input.value);
        }
    }

    function clearDraft() {
        sessionStorage.removeItem('chat_draft_' + currentChatRoom);
    }

    function autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    // ============================================
    // ЗАГРУЗКА ИСТОРИИ ЧАТА
    // ============================================
    async function loadChatHistory() {
        if (isLoadingHistory) return;

        var token = localStorage.getItem('token');
        if (!token) return;

        isLoadingHistory = true;

        if (abortController) abortController.abort();
        abortController = new AbortController();

        try {
            // Общий чат
            var generalRes = await fetch('/api/chat/history/general', {
                headers: { 'Authorization': 'Bearer ' + token },
                signal: abortController.signal
            });

            if (generalRes.ok) {
                var messages = await generalRes.json();
                messages = messages.map(function(msg) {
                    if (msg.text && msg.text.indexOf('"type":"announcement"') !== -1) {
                        try {
                            var parsed = JSON.parse(msg.text);
                            if (parsed.type === 'announcement') return parsed;
                        } catch(e) {}
                    }
                    return msg;
                });
                chatMessages.general = messages;
                if (messages.length > 0) {
                    var times = messages.map(function(m) { return parseTimestamp(m.time); });
                    lastProcessedTime.general = Math.max.apply(null, times);
                }
                console.log('📩 Общий чат: ' + messages.length + ' сообщений');
            }

            // Личные чаты
            var employees = (window.app && window.app.employees) ? window.app.employees : [];
            var currentUser = window.app ? window.app.currentUser : null;

            for (var i = 0; i < employees.length; i++) {
                var emp = employees[i];
                if (emp === currentUser) continue;

                try {
                    var privRes = await fetch('/api/chat/history/' + encodeURIComponent(emp), {
                        headers: { 'Authorization': 'Bearer ' + token },
                        signal: abortController.signal
                    });
                    if (privRes.ok) {
                        var privMessages = await privRes.json();
                        if (privMessages.length > 0) {
                            chatMessages[emp] = privMessages;
                            var privTimes = privMessages.map(function(m) { return parseTimestamp(m.time); });
                            lastProcessedTime[emp] = Math.max.apply(null, privTimes);
                        }
                    }
                } catch(e) {
                    if (e.name !== 'AbortError') console.error('Ошибка чата с ' + emp + ':', e.message);
                }
            }

            window.app.messages = chatMessages;
            showSystemNotification('💬 История чата загружена', 'info');

        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Ошибка загрузки истории:', err.message);
            }
        } finally {
            isLoadingHistory = false;
            abortController = null;
        }

        renderChatContacts();
        renderChatMessages();
        initChatInput();
        setupPusherListeners();
    }

    async function loadChatHistoryForRoom(roomId) {
        if (roomId === 'general' || chatMessages[roomId]) return;

        var token = localStorage.getItem('token');
        if (!token) return;

        try {
            var res = await fetch('/api/chat/history/' + encodeURIComponent(roomId), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
                var messages = await res.json();
                chatMessages[roomId] = messages;
                if (messages.length > 0) {
                    var times = messages.map(function(m) { return parseTimestamp(m.time); });
                    lastProcessedTime[roomId] = Math.max.apply(null, times);
                }
            }
        } catch(e) {
            console.error('Ошибка:', e.message);
        }
    }

    async function loadRecentMessages() {
        var rooms = Object.keys(chatMessages);
        var token = localStorage.getItem('token');
        if (!token) return;

        for (var i = 0; i < rooms.length; i++) {
            var room = rooms[i];
            var lastTime = lastProcessedTime[room] || 0;

            try {
                var res = await fetch('/api/chat/history/' + encodeURIComponent(room) + '?after=' + lastTime, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    var newMessages = await res.json();
                    for (var j = 0; j < newMessages.length; j++) {
                        var msg = newMessages[j];
                        var exists = false;
                        for (var k = 0; k < (chatMessages[room] || []).length; k++) {
                            if (chatMessages[room][k].time === msg.time && chatMessages[room][k].sender === msg.sender) {
                                exists = true;
                                break;
                            }
                        }
                        if (!exists) {
                            if (!chatMessages[room]) chatMessages[room] = [];
                            chatMessages[room].push(msg);
                            lastProcessedTime[room] = Math.max(lastProcessedTime[room], parseTimestamp(msg.time));
                        }
                    }
                }
            } catch(e) {}
        }

        renderChatMessages();
        renderChatContacts();
    }
    // ============================================
    // РЕНДЕР КОНТАКТОВ
    // ============================================
    function renderChatContacts() {
        var container = document.getElementById('chatContacts');
        if (!container) return;

        var employees = (window.app && window.app.employees) ? window.app.employees : [];
        var currentUser = window.app ? window.app.currentUser : null;

        var contacts = [{ id: 'general', name: 'Общий чат', icon: '💬', type: 'general' }];

        for (var i = 0; i < employees.length; i++) {
            var emp = employees[i];
            if (emp !== currentUser) {
                contacts.push({ id: emp, name: emp, icon: '👤', type: 'private' });
            }
        }

        contacts.sort(function(a, b) {
            if (a.id === 'general') return -1;
            if (b.id === 'general') return 1;
            var msgsA = chatMessages[a.id] || [];
            var msgsB = chatMessages[b.id] || [];
            var lastA = msgsA.length > 0 ? parseTimestamp(msgsA[msgsA.length - 1].time) : 0;
            var lastB = msgsB.length > 0 ? parseTimestamp(msgsB[msgsB.length - 1].time) : 0;
            return lastB - lastA;
        });

        var html = '';

        for (var j = 0; j < contacts.length; j++) {
            var contact = contacts[j];
            var unreadCount = chatUnread[contact.id] || 0;
            var isActive = currentChatRoom === contact.id;
            var msgCount = chatMessages[contact.id] ? chatMessages[contact.id].length : 0;

            var avatarHtml = contact.icon;
            if (contact.type === 'private') {
                var profile = (window.app && window.app.profiles) ? window.app.profiles[contact.name] : null;
                if (profile) avatarHtml = getAvatarHtml(profile);
            }

            html += '<div class="chat-contact' + (isActive ? ' active' : '') + '" onclick="switchChat(\'' + escapeHtml(contact.id) + '\')">';
            html += '<div class="contact-avatar" style="overflow:hidden;border-radius:50%;width:48px;height:48px;min-width:48px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6366f1,#ec4899);">' + avatarHtml + '</div>';
            html += '<div style="flex:1;min-width:0;">';
            html += '<div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(contact.name) + '</div>';
            html += '<div style="font-size:11px;opacity:0.6;">' + (contact.type === 'general' ? 'Общий чат' : 'Личный чат');
            if (msgCount > 0) html += ' · ' + msgCount;
            html += '</div></div>';
            if (unreadCount > 0) html += '<div class="unread-badge">' + (unreadCount > 99 ? '99+' : unreadCount) + '</div>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    // ============================================
    // РЕНДЕР СООБЩЕНИЙ
    // ============================================
    function debouncedRenderChatMessages() {
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        renderDebounceTimer = setTimeout(function() {
            renderChatMessages();
            renderDebounceTimer = null;
        }, CONFIG.RENDER_DEBOUNCE_DELAY);
    }

    function renderChatMessages() {
        var container = document.getElementById('chatMessages');
        if (!container) return;

        var headerName = document.getElementById('chatHeaderName');
        var headerStatus = document.getElementById('chatHeaderStatus');
        var headerAvatar = document.getElementById('chatHeaderAvatar');

        var messages = chatMessages[currentChatRoom] || [];

        // Заголовок чата
        if (headerName) {
            if (currentChatRoom === 'general') {
                headerName.innerHTML = '💬 Общий чат';
                headerStatus.innerHTML = 'Все сотрудники';
                if (headerAvatar) headerAvatar.innerHTML = '💬';
            } else {
                headerName.innerHTML = escapeHtml(currentChatRoom);
                var profile = (window.app && window.app.profiles) ? window.app.profiles[currentChatRoom] : null;
                var statusText = profile ? getRoleName(profile.role) : 'Сотрудник';
                var lastActive = (window.app && window.app.lastActivity) ? window.app.lastActivity[currentChatRoom] : null;
                if (lastActive) statusText += ' · Был(а) ' + formatTimeAgo(lastActive);
                headerStatus.innerHTML = statusText;

                if (headerAvatar && profile) {
                    headerAvatar.innerHTML = getAvatarHtml(profile);
                    headerAvatar.style.cursor = 'pointer';
                    headerAvatar.onclick = function() { openProfile(currentChatRoom); };
                }
            }
        }

        updatePageTitle();

        if (messages.length === 0) {
            container.innerHTML = '<div class="chat-empty-state"><div class="empty-icon">💬</div><h3>Нет сообщений</h3><p>Напишите что-нибудь!</p></div>';
            return;
        }

        // Очищаем непрочитанные
        if (chatUnread[currentChatRoom]) {
            delete chatUnread[currentChatRoom];
            window.chatUnread = chatUnread;
            renderChatContacts();
            if (typeof renderEmployees === 'function') renderEmployees();
        }

        // Сортируем и убираем дубликаты
        var filtered = messages.filter(function(msg) { return !msg.deleted; });
        filtered.sort(function(a, b) { return parseTimestamp(a.time) - parseTimestamp(b.time); });

        var unique = [];
        var seen = {};
        for (var i = 0; i < filtered.length; i++) {
            var msg = filtered[i];
            var key = parseTimestamp(msg.time) + '_' + msg.sender;
            if (!seen[key]) {
                seen[key] = true;
                unique.push(msg);
            }
        }

        if (unique.length > CONFIG.MAX_VISIBLE_MESSAGES) {
            chatMessages[currentChatRoom] = unique.slice(-CONFIG.MAX_VISIBLE_MESSAGES);
            unique = chatMessages[currentChatRoom];
        }

        var html = '';
        var lastDate = null;

        for (var j = 0; j < unique.length; j++) {
            var msg = unique[j];
            var msgTime = parseTimestamp(msg.time);
            var msgDateObj = new Date(msgTime);
            var msgDateStr = isNaN(msgDateObj.getTime()) ? '' : msgDateObj.toDateString();

            if (msgDateStr !== lastDate) {
                lastDate = msgDateStr;
                html += '<div class="date-separator"><span>' + formatDateHeader(msgTime) + '</span></div>';
            }

            // Объявления
            if (msg.type === 'announcement') {
                html += renderAnnouncement(msg);
                continue;
            }

            // Запросы обмена
            if (msg.action_data && typeof msg.action_data === 'object') {
                if (msg.action_data.type === 'exchange_request' && msg.action_data.status === 'pending') {
                    html += renderExchangeRequestMessage(msg);
                    continue;
                }
            }

            var isOwn = msg.sender === (window.app ? window.app.currentUser : null);
            var time = formatTime(msgTime);
            var fullTime = new Date(msgTime).toLocaleString();

            // Аватар
            var avatarHtml = '<span style="font-size:20px;">👤</span>';
            if (!isOwn) {
                if (msg.sender === '🕵️ Аноним') {
                    avatarHtml = '<span style="font-size:20px;">🕵️</span>';
                } else {
                    var senderProfile = (window.app && window.app.profiles) ? window.app.profiles[msg.sender] : null;
                    if (senderProfile) {
                        avatarHtml = getAvatarHtml(senderProfile);
                    } else {
                        avatarHtml = '<span style="font-size:12px;font-weight:600;">' + getInitials(msg.sender) + '</span>';
                    }
                }
            }

            var isNew = msgTime > (lastProcessedTime[currentChatRoom] || 0) - 5000;
            var messageClass = 'message' + (isOwn ? ' own' : '') + (isNew ? ' new-message' : '');

            html += '<div class="' + messageClass + '" data-message-time="' + msgTime + '" data-message-sender="' + escapeHtml(msg.sender) + '">';
            html += '<div class="message-avatar" style="overflow:hidden;border-radius:50%;">' + avatarHtml + '</div>';
            html += '<div class="message-bubble">';
            if (!isOwn) html += '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>';
            html += '<div class="message-text" dir="auto">' + escapeHtml(msg.text) + '</div>';
            html += '<div class="message-footer">';
            html += '<div class="message-time" title="' + fullTime + '">' + time + '</div>';
            if (isOwn) {
                html += '<button class="delete-message-btn" onclick="deleteMessage(\'' + msgTime + '\', \'' + currentChatRoom + '\')" title="Удалить"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '</div></div></div>';
        }

        container.innerHTML = html;

        // Прокрутка вниз
        setTimeout(function() {
            if (container.lastElementChild) {
                container.lastElementChild.scrollIntoView({ block: 'end', behavior: 'instant' });
            }
        }, 50);
    }

    function updatePageTitle() {
        var total = 0;
        var unreadKeys = Object.keys(chatUnread);
        for (var i = 0; i < unreadKeys.length; i++) {
            total += chatUnread[unreadKeys[i]] || 0;
        }
        if (total > 0) {
            document.title = '(' + total + ') WARPOINT — Чат';
        } else {
            document.title = currentChatRoom === 'general' ? 'WARPOINT — Общий чат' : 'WARPOINT — Чат с ' + currentChatRoom;
        }
    }

    function renderAnnouncement(announcement) {
        var roleIcon = '📢';
        var roleName = 'Объявление';
        if (announcement.role === 'director') { roleIcon = '👑'; roleName = 'Директор'; }
        else if (announcement.role === 'manager') { roleIcon = '📋'; roleName = 'Управляющий'; }

        var aTime = parseTimestamp(announcement.time);
        var time = formatTime(aTime);
        var styleClass = 'announcement-' + (announcement.style || 'director');
        var displayText = announcement.text.length > 1000
            ? escapeHtml(announcement.text.substring(0, 1000)) + '...'
            : escapeHtml(announcement.text);

        return '<div class="announcement-message ' + styleClass + '">' +
            '<div class="announcement-header">' +
                '<div class="announcement-role"><span>' + roleIcon + '</span><span>' + escapeHtml(announcement.sender) + '</span><span style="font-size:11px;opacity:0.7;">' + roleName + '</span></div>' +
                '<div class="announcement-time"><i class="fas fa-bullhorn"></i> ' + time + '</div>' +
            '</div>' +
            '<div class="announcement-content"><p>' + displayText + '</p></div>' +
        '</div>';
    }

    function renderExchangeRequestMessage(msg) {
        var data = msg.action_data;
        if (!data || typeof data !== 'object') return '';
        if (!data.from_date || !data.to_date) return '';

        var msgTime = parseTimestamp(msg.time);
        var time = formatTime(msgTime);
        var fromDate = formatDateSimple(data.from_date);
        var toDate = formatDateSimple(data.to_date);

        return '<div class="message exchange-message" data-request-id="' + data.request_id + '">' +
            '<div class="message-avatar" style="border-radius:50%;">🔄</div>' +
            '<div class="message-bubble exchange-bubble">' +
                '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>' +
                '<div class="message-text">' +
                    '<strong>📅 Предложение обмена сменами</strong><br><br>' +
                    '👤 ' + escapeHtml(data.from_employee) + ' хочет обменяться с вами!<br><br>' +
                    '📌 Его смена: ' + fromDate + ' — ' + escapeHtml(data.from_time) + '<br>' +
                    '📌 Ваша смена: ' + toDate + ' — ' + escapeHtml(data.to_time) + '<br><br>' +
                    (data.comment ? '💬 Комментарий: ' + escapeHtml(data.comment) + '<br><br>' : '') +
                '</div>' +
                '<div class="exchange-buttons">' +
                    '<button class="exchange-accept-btn" onclick="acceptExchangeFromChat(' + data.request_id + ', \'' + currentChatRoom + '\', ' + msgTime + ')">✅ Принять</button>' +
                    '<button class="exchange-reject-btn" onclick="rejectExchangeFromChat(' + data.request_id + ', \'' + currentChatRoom + '\', ' + msgTime + ')">❌ Отклонить</button>' +
                '</div>' +
                '<div class="message-footer"><div class="message-time">' + time + '</div></div>' +
            '</div>' +
        '</div>';
    }
    // ============================================
    // ОТПРАВКА СООБЩЕНИЙ
    // ============================================
    function initChatInput() {
        var input = document.getElementById('chatInput');
        var sendBtn = document.getElementById('chatSendBtn');
        var charCount = document.getElementById('charCount');

        if (input) {
            input.addEventListener('input', function() {
                autoResizeTextarea(this);
                saveDraft();
                if (charCount) {
                    charCount.textContent = this.value.length + '/' + CONFIG.MAX_MESSAGE_LENGTH;
                    charCount.style.color = this.value.length > CONFIG.MAX_MESSAGE_LENGTH * 0.9 ? '#ef4444' : '#64748b';
                }
                if (sendBtn) sendBtn.disabled = !this.value.trim();
            });

            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (sendBtn && !sendBtn.disabled) sendChatMessage();
                }
                if (e.key === 'Escape') {
                    this.value = '';
                    clearDraft();
                    if (sendBtn) sendBtn.disabled = true;
                    autoResizeTextarea(this);
                }
            });

            restoreDraft();
            if (sendBtn) sendBtn.disabled = !input.value.trim();
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', function() { sendChatMessage(); });
        }
    }

    async function sendChatMessage() {
        var now = Date.now();

        if (isSendingMessage) return;
        if (now - lastMessageTime < CONFIG.MESSAGE_COOLDOWN) {
            showSystemNotification('⚠️ Подождите немного', 'warning');
            return;
        }
        if (messageCountThisMinute >= CONFIG.MAX_MESSAGES_PER_MINUTE) {
            showSystemNotification('❌ Слишком много сообщений', 'error');
            return;
        }

        var input = document.getElementById('chatInput');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        if (text.length > CONFIG.MAX_MESSAGE_LENGTH) {
            showSystemNotification('❌ Сообщение слишком длинное', 'error');
            return;
        }

        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
        if (!token) { showSystemNotification('❌ Не авторизован', 'error'); return; }
        if (!window.app || !window.app.currentUser) { showSystemNotification('❌ Пользователь не определён', 'error'); return; }

        isSendingMessage = true;
        lastMessageTime = now;
        messageCountThisMinute++;

        var sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) { sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; sendBtn.disabled = true; }

        var message = { sender: window.app.currentUser, text: text, time: Date.now() };

        try {
            var roomParam = currentChatRoom === 'general' ? 'general' : currentChatRoom;
            var response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ room: roomParam === 'general' ? 'general' : null, message: message })
            });

            if (roomParam !== 'general') {
                response = await fetch('/api/chat/private', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ to: roomParam, message: message })
                });
            }

            if (!chatMessages[roomParam]) chatMessages[roomParam] = [];
            chatMessages[roomParam].push(message);
            lastProcessedTime[roomParam] = message.time;

            input.value = '';
            clearDraft();
            autoResizeTextarea(input);

            renderChatMessages();
            renderChatContacts();
        } catch (err) {
            console.error('Ошибка отправки:', err.message);
            showSystemNotification('❌ Ошибка соединения', 'error');
        } finally {
            isSendingMessage = false;
            if (sendBtn) { sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>'; sendBtn.disabled = false; }
        }
    }

    async function processPendingMessages() {
        if (isProcessingQueue || pendingMessages.length === 0) return;
        isProcessingQueue = true;

        var token = localStorage.getItem('token');
        while (pendingMessages.length > 0) {
            var item = pendingMessages.shift();
            try {
                var response;
                if (item.room === 'general') {
                    response = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ room: 'general', message: item.message })
                    });
                } else {
                    response = await fetch('/api/chat/private', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ to: item.room, message: item.message })
                    });
                }
            } catch(e) {
                pendingMessages.unshift(item);
                break;
            }
            await new Promise(function(r) { setTimeout(r, 200); });
        }
        isProcessingQueue = false;
    }

    // ============================================
    // ПЕРЕКЛЮЧЕНИЕ ЧАТА
    // ============================================
    async function switchChat(roomId) {
        if (isSwitchingChat || currentChatRoom === roomId) return;

        saveDraft();
        isSwitchingChat = true;

        if (abortController) { abortController.abort(); abortController = null; }

        currentChatRoom = roomId;
        sessionStorage.setItem('currentChatRoom', roomId);

        var picker = document.getElementById('emojiPicker');
        if (picker) picker.style.display = 'none';

        var announcementBtn = document.getElementById('announcementBtn');
        if (announcementBtn) {
            var role = window.app ? window.app.currentUserRole : null;
            announcementBtn.style.display = (role === 'director' || role === 'manager') ? 'flex' : 'none';
        }

        var settingsBtn = document.getElementById('chatSettingsBtn');
        if (settingsBtn) {
            settingsBtn.style.display = (roomId === 'general' && window.app && window.app.currentUserRole === 'director') ? 'flex' : 'none';
        }

        if (!chatMessages[roomId] && roomId !== 'general') {
            await loadChatHistoryForRoom(roomId);
        }

        renderChatContacts();
        renderChatMessages();
        restoreDraft();
        updatePageTitle();

        setTimeout(function() {
            var input = document.getElementById('chatInput');
            if (input) { input.focus(); autoResizeTextarea(input); }
        }, 100);

        isSwitchingChat = false;
    }

    // ============================================
    // PUSHER
    // ============================================
    function setupPusherListeners() {
        if (pusherListenersSetup) return;

        if (window.pusher) {
            window.pusher.connection.bind('connected', function() {
                console.log('🟢 Pusher подключён');
                document.getElementById('offlineBanner') && (document.getElementById('offlineBanner').style.display = 'none');
                loadRecentMessages();
            });

            window.pusher.connection.bind('disconnected', function() {
                console.log('🔴 Pusher отключён');
                document.getElementById('offlineBanner') && (document.getElementById('offlineBanner').style.display = 'block');
            });
        }

        if (window.channel) {
            window.channel.bind('client-new-message', function(data) {
                if (!data || !data.message) return;
                var msgTime = parseTimestamp(data.message.time);
                if (!chatMessages.general) chatMessages.general = [];

                var exists = false;
                for (var i = 0; i < chatMessages.general.length; i++) {
                    if (parseTimestamp(chatMessages.general[i].time) === msgTime && chatMessages.general[i].sender === data.message.sender) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    chatMessages.general.push(data.message);
                    lastProcessedTime.general = msgTime;
                    window.app.messages = chatMessages;

                    if (currentChatRoom === 'general') {
                        debouncedRenderChatMessages();
                    } else {
                        chatUnread.general = (chatUnread.general || 0) + 1;
                        window.chatUnread = chatUnread;
                        renderChatContacts();
                        if (typeof renderEmployees === 'function') renderEmployees();
                        updatePageTitle();
                        showSystemNotification('💬 ' + escapeHtml(data.message.sender) + ': ' + escapeHtml(data.message.text.substring(0, 50)), 'info');
                    }
                }
            });

            window.channel.bind('client-announcement', function(data) {
                if (!data || !data.announcement) return;
                var announcement = data.announcement;
                var msgTime = parseTimestamp(announcement.time);
                if (announcement.sender === (window.app ? window.app.currentUser : null)) return;
                if (!chatMessages.general) chatMessages.general = [];

                var exists = false;
                for (var i = 0; i < chatMessages.general.length; i++) {
                    if (parseTimestamp(chatMessages.general[i].time) === msgTime) { exists = true; break; }
                }
                if (!exists) {
                    chatMessages.general.push(announcement);
                    lastProcessedTime.general = msgTime;
                    window.app.messages = chatMessages;
                    if (currentChatRoom === 'general') debouncedRenderChatMessages();
                    else { chatUnread.general = (chatUnread.general || 0) + 1; renderChatContacts(); updatePageTitle(); }
                    showSystemNotification('📢 ОБЪЯВЛЕНИЕ: ' + escapeHtml(announcement.text.substring(0, 50)), 'warning');
                }
            });
        }

        if (window.privateChannel) {
            window.privateChannel.bind('client-private-message', function(data) {
                if (!data || !data.message) return;
                var msgTime = parseTimestamp(data.message.time);
                var from = data.from;
                if (!chatMessages[from]) chatMessages[from] = [];

                var exists = false;
                for (var i = 0; i < chatMessages[from].length; i++) {
                    if (parseTimestamp(chatMessages[from][i].time) === msgTime && chatMessages[from][i].sender === data.message.sender) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    chatMessages[from].push(data.message);
                    lastProcessedTime[from] = msgTime;
                    window.app.messages = chatMessages;

                    if (currentChatRoom === from) {
                        debouncedRenderChatMessages();
                    } else {
                        chatUnread[from] = (chatUnread[from] || 0) + 1;
                        window.chatUnread = chatUnread;
                        renderChatContacts();
                        if (typeof renderEmployees === 'function') renderEmployees();
                        updatePageTitle();
                        showSystemNotification('💬 Личное от ' + escapeHtml(from) + ': ' + escapeHtml(data.message.text.substring(0, 50)), 'info');
                    }
                }
            });
        }

        pusherListenersSetup = true;
    }

    // ============================================
    // ЭМОДЗИ, ОБЪЯВЛЕНИЯ, УДАЛЕНИЕ, НАСТРОЙКИ
    // ============================================
    function toggleEmojiPicker() {
        var picker = document.getElementById('emojiPicker');
        if (picker) {
            picker.style.display = picker.style.display === 'block' ? 'none' : 'block';
        }
    }

    function addEmoji(emoji) {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var start = input.selectionStart || 0;
        var end = input.selectionEnd || 0;
        var text = input.value || '';
        input.value = text.substring(0, start) + emoji + text.substring(end);
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        autoResizeTextarea(input);
        saveDraft();
        var sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) sendBtn.disabled = false;

        var picker = document.getElementById('emojiPicker');
        if (picker) picker.style.display = 'none';
    }

    function initAnnouncementButton() {
        var btn = document.getElementById('announcementBtn');
        if (!btn) return;
        var role = window.app ? window.app.currentUserRole : null;
        btn.style.display = (role === 'director' || role === 'manager') ? 'flex' : 'none';
        btn.onclick = function() { openAnnouncementModal(); };
    }

    function openAnnouncementModal() {
        var modal = document.getElementById('announcementModal');
        if (!modal) return;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        setTimeout(function() {
            var ta = document.getElementById('announcementText');
            if (ta) ta.focus();
        }, 100);
    }

    function closeAnnouncementModal() {
        var modal = document.getElementById('announcementModal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
        var ta = document.getElementById('announcementText');
        if (ta) ta.value = '';
    }

    async function sendAnnouncement() {
        var textarea = document.getElementById('announcementText');
        var text = textarea ? textarea.value.trim() : '';
        if (!text) { showSystemNotification('❌ Введите текст', 'error'); return; }
        if (text.length > 1000) { showSystemNotification('❌ Слишком длинный текст', 'error'); return; }

        var token = localStorage.getItem('token');
        if (!token) return;

        var announcement = {
            type: 'announcement',
            style: currentAnnouncementStyle,
            sender: window.app ? window.app.currentUser : 'Система',
            role: window.app ? window.app.currentUserRole : 'manager',
            text: text,
            time: Date.now()
        };

        try {
            var response = await fetch('/api/chat/announcement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ announcement: announcement })
            });

            if (!response.ok) throw new Error('HTTP ' + response.status);
            var data = await response.json();

            if (data.success) {
                closeAnnouncementModal();
                if (!chatMessages.general) chatMessages.general = [];
                chatMessages.general.push(announcement);
                lastProcessedTime.general = announcement.time;
                renderChatMessages();
                showSystemNotification('📢 Объявление опубликовано', 'success');
            } else {
                showSystemNotification('❌ ' + (data.error || 'Ошибка'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        }
    }
    // ============================================
    // УДАЛЕНИЕ СООБЩЕНИЙ — ПОЛНОСТЬЮ ИСПРАВЛЕНО
    // ============================================
    async function deleteMessage(messageTime, room) {
        // Приводим к числу
        var timeValue = messageTime;
        if (typeof timeValue === 'string') timeValue = parseInt(timeValue, 10);
        if (isNaN(timeValue) || timeValue <= 0) {
            showSystemNotification('❌ Некорректное время', 'error');
            return;
        }

        var messages = chatMessages[room] || [];
        if (messages.length === 0) {
            showSystemNotification('❌ Нет сообщений в чате', 'error');
            return;
        }

        // Ищем сообщение
        var messageToDelete = null;
        for (var i = messages.length - 1; i >= 0; i--) {
            var msgTime = messages[i].time;
            if (typeof msgTime === 'string') msgTime = parseInt(msgTime, 10);
            if (!isNaN(msgTime) && msgTime === timeValue) {
                messageToDelete = messages[i];
                break;
            }
        }

        if (!messageToDelete) {
            showSystemNotification('❌ Сообщение не найдено', 'error');
            console.log('Искали:', timeValue, 'Доступные:', messages.map(function(m) { return m.time + '(' + typeof m.time + ')'; }).join(', '));
            return;
        }

        var isOwn = messageToDelete.sender === (window.app ? window.app.currentUser : null);
        var isDirector = window.app && window.app.currentUserRole === 'director';

        if (!isOwn && !isDirector) {
            showSystemNotification('❌ Можно удалять только свои сообщения', 'error');
            return;
        }

        var confirmMsg = isDirector && !isOwn
            ? 'Удалить сообщение от ' + messageToDelete.sender + '?'
            : 'Удалить это сообщение?';

        if (!confirm(confirmMsg)) return;

        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
        if (!token) { showSystemNotification('❌ Не авторизован', 'error'); return; }

        try {
            // Анимация удаления
            var messageEl = document.querySelector('.message[data-message-time="' + timeValue + '"]');
            if (messageEl) messageEl.classList.add('deleting');

            var response = await fetch('/api/chat/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ room: room, messageTime: timeValue, sender: messageToDelete.sender })
            });

            if (!response.ok) {
                if (response.status === 404) {
                    showSystemNotification('ℹ️ Сообщение уже удалено', 'info');
                } else {
                    throw new Error('HTTP ' + response.status);
                }
            }

            var data = await response.json();

            if (data.success) {
                setTimeout(function() {
                    // Удаляем из массива
                    var idx = -1;
                    for (var j = 0; j < chatMessages[room].length; j++) {
                        var mt = chatMessages[room][j].time;
                        if (typeof mt === 'string') mt = parseInt(mt, 10);
                        if (mt === timeValue) { idx = j; break; }
                    }
                    if (idx !== -1) {
                        chatMessages[room].splice(idx, 1);
                        window.app.messages = chatMessages;
                        renderChatMessages();
                        renderChatContacts();
                    }
                }, 300);

                showSystemNotification('🗑️ Сообщение удалено', 'info');
            } else {
                showSystemNotification('❌ ' + (data.error || 'Ошибка'), 'error');
                if (messageEl) messageEl.classList.remove('deleting');
            }
        } catch (err) {
            console.error('Ошибка удаления:', err.message);
            showSystemNotification('❌ Ошибка соединения', 'error');
            var el = document.querySelector('.message[data-message-time="' + timeValue + '"]');
            if (el) el.classList.remove('deleting');
        }
    }

    // ============================================
    // НАСТРОЙКИ ЧАТА
    // ============================================
    function initChatSettings() {
        var btn = document.getElementById('chatSettingsBtn');
        if (!btn) return;
        btn.style.display = (window.app && window.app.currentUserRole === 'director') ? 'flex' : 'none';
        btn.onclick = function() { openChatSettingsModal(); };
    }

    function openChatSettingsModal() {
        var modal = document.getElementById('chatSettingsModal');
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; }
    }

    function closeChatSettingsModal() {
        var modal = document.getElementById('chatSettingsModal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    }

    // ============================================
    // ОБМЕН СМЕНАМИ В ЧАТЕ
    // ============================================
    async function acceptExchangeFromChat(requestId, room, messageTime) {
        try {
            var response = await apiCall('/exchange/accept/' + requestId, 'POST');
            if (response && response.success) {
                showSystemNotification('✅ Обмен подтверждён', 'success');
                if (typeof loadScheduleData === 'function') loadScheduleData();
                if (typeof renderMonthSchedule === 'function') renderMonthSchedule();
            } else {
                showSystemNotification('❌ ' + ((response && response.error) || 'Ошибка'), 'error');
            }
        } catch (err) {
            showSystemNotification('❌ Ошибка соединения', 'error');
        }
    }

    async function rejectExchangeFromChat(requestId, room, messageTime) {
        try {
            var response = await apiCall('/exchange/reject/' + requestId, 'POST');
            if (response && response.success) {
                showSystemNotification('❌ Запрос отклонён', 'info');
            } else {
                showSystemNotification('❌ ' + ((response && response.error) || 'Ошибка'), 'error');
            }
        } catch (err) {
            showSystemNotification('❌ Ошибка соединения', 'error');
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    function exportChatHistory() {
        var messages = chatMessages[currentChatRoom] || [];
        if (messages.length === 0) { showSystemNotification('⚠️ Нет сообщений', 'warning'); return; }

        var content = 'История чата: ' + (currentChatRoom === 'general' ? 'Общий чат' : 'Чат с ' + currentChatRoom) + '\n';
        content += 'Экспортировано: ' + new Date().toLocaleString() + '\n';
        content += '='.repeat(50) + '\n\n';

        var lastDate = null;
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            var msgTime = parseTimestamp(msg.time);
            var msgDate = new Date(msgTime).toLocaleDateString('ru-RU');
            if (msgDate !== lastDate) {
                lastDate = msgDate;
                content += '\n--- ' + msgDate + ' ---\n\n';
            }
            var time = formatTime(msgTime);
            content += '[' + time + '] ' + msg.sender + ': ' + msg.text + '\n';
        }

        var blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chat_' + currentChatRoom + '_' + new Date().toISOString().split('T')[0] + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showSystemNotification('📄 История экспортирована', 'success');
    }

    // ============================================
    // ОЧИСТКА ПРИ УХОДЕ
    // ============================================
    function cleanupChat() {
        console.log('🧹 Очистка чата');
        saveDraft();
        if (window.channel) {
            window.channel.unbind('client-new-message');
            window.channel.unbind('client-announcement');
            window.channel.unbind('client-delete-message');
            window.channel.unbind('client-bulk-delete');
        }
        if (window.privateChannel) {
            window.privateChannel.unbind('client-private-message');
            window.privateChannel.unbind('client-delete-private');
        }
        if (renderDebounceTimer) { clearTimeout(renderDebounceTimer); renderDebounceTimer = null; }
        if (messageCountResetTimer) { clearInterval(messageCountResetTimer); messageCountResetTimer = null; }
        if (abortController) { abortController.abort(); abortController = null; }
        closeAnnouncementModal();
        closeChatSettingsModal();
        var picker = document.getElementById('emojiPicker');
        if (picker) picker.style.display = 'none';
        pusherListenersSetup = false;
        chatInitialized = false;
        isSendingMessage = false;
        isSwitchingChat = false;
        document.body.style.overflow = '';
    }

    // ============================================
    // ЭКСПОРТ В WINDOW
    // ============================================
    window.initChat = initChat;
    window.resetChatState = resetChatState;
    window.switchChat = switchChat;
    window.addEmoji = addEmoji;
    window.toggleEmojiPicker = toggleEmojiPicker;
    window.openAnnouncementModal = openAnnouncementModal;
    window.closeAnnouncementModal = closeAnnouncementModal;
    window.sendAnnouncement = sendAnnouncement;
    window.deleteMessage = deleteMessage;
    window.openChatSettingsModal = openChatSettingsModal;
    window.closeChatSettingsModal = closeChatSettingsModal;
    window.acceptExchangeFromChat = acceptExchangeFromChat;
    window.rejectExchangeFromChat = rejectExchangeFromChat;
    window.cleanupChat = cleanupChat;
    window.exportChatHistory = exportChatHistory;
    window.chatUnread = chatUnread;
    window.selectAnnouncementStyle = function(style) {
        currentAnnouncementStyle = style;
        var opts = document.querySelectorAll('.style-option');
        for (var i = 0; i < opts.length; i++) {
            opts[i].classList.remove('active');
            if (opts[i].dataset.style === style) opts[i].classList.add('active');
        }
    };

    // Автозапуск при загрузке страницы
    setTimeout(function() {
        if (document.getElementById('chatMessages') && !chatInitialized) {
            initChat();
        }
    }, 200);
window.sendChatMessage = sendChatMessage;
window.toggleChatSearch = function() {
    var wrapper = document.getElementById('chatSearchWrapper');
    var input = document.getElementById('chatSearchInput');
    if (wrapper && input) {
        if (wrapper.style.display === 'none' || !wrapper.style.display) {
            wrapper.style.display = 'flex';
            input.focus();
        } else {
            wrapper.style.display = 'none';
            input.value = '';
        }
    }
};
    console.log('✅ chat.js v5.0 PRO загружен');
})();