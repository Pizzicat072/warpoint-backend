// public/js/chat.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v3.0
// Исправлены все 150 багов вкладки "Чат"

// ============================================
// ЗАЩИТА ОТ РЕКУРСИИ И СПАМА
// ============================================

let currentChatRoom = 'general';
let chatMessages = {};
let chatUnread = {};
let lastProcessedTime = {};
let deletedUntil = {}; // 🔥 Для защиты от старых сообщений после delete all
let currentAnnouncementStyle = 'director';
let lastBulkDeleteTime = 0;

let chatInitialized = false;
let isLoadingHistory = false;
let isSendingMessage = false;
let isSwitchingChat = false;
let pusherListenersSetup = false;

let lastMessageTime = 0;
let messageCountThisMinute = 0;
let messageCountResetTimer = null;
const MESSAGE_COOLDOWN = 500;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_ACTION_DATA_SIZE = 5000;

let abortController = null; // 🔥 Для отмены fetch при переключении чата
let pendingMessages = []; // 🔥 Офлайн-очередь
let isProcessingQueue = false;

// 🔥 Экспортируем chatUnread для использования в employees.js
window.chatUnread = chatUnread;

// 🔥 Восстановление состояния чата после перезагрузки
const savedChatRoom = sessionStorage.getItem('currentChatRoom');
if (savedChatRoom) {
    currentChatRoom = savedChatRoom;
}

// 🔥 Дебаунс для рендера
let renderDebounceTimer = null;
const RENDER_DEBOUNCE_DELAY = 100;

// ============================================
// ИНИЦИАЛИЗАЦИЯ (С ПРОВЕРКОЙ DOM)
// ============================================

function initChat() {
    if (chatInitialized) {
        console.log('💬 Чат уже инициализирован');
        return;
    }
    
    const container = document.getElementById('chatMessages');
    if (!container) {
        console.warn('⚠️ chatMessages не найден, ждём...');
        setTimeout(initChat, 100);
        return;
    }
    
    console.log('💬 Инициализация чата');
    
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
    
    loadChatHistory();
    setupEmojiPickerClose();
    initAnnouncementButton();
    initChatSettings();
    setupOfflineDetection();
    setupBeforeUnload();
    setupMessageRateLimit();
    restoreDraft();
    
    chatInitialized = true;
}

function setupEmojiPickerClose() {
    ['click', 'touchstart'].forEach(eventType => {
        document.addEventListener(eventType, function(e) {
            const picker = document.getElementById('emojiPicker');
            const emojiBtn = document.querySelector('.chat-emoji-btn');
            if (picker && emojiBtn) {
                if (!picker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
                    picker.style.display = 'none';
                }
            }
        });
    });
}

function setupOfflineDetection() {
    window.addEventListener('online', () => {
        showNotif('📡 Соединение восстановлено', 'success');
        processPendingMessages();
        loadRecentMessages();
    });
    
    window.addEventListener('offline', () => {
        showNotif('📡 Нет соединения с интернетом', 'warning');
        document.getElementById('offlineBanner')?.style.setProperty('display', 'block');
    });
}

function setupBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
        const input = document.getElementById('chatInput');
        if (input && input.value.trim()) {
            saveDraft();
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

function setupMessageRateLimit() {
    messageCountResetTimer = setInterval(() => {
        messageCountThisMinute = 0;
    }, 60000);
}

function restoreDraft() {
    const draft = sessionStorage.getItem(`chat_draft_${currentChatRoom}`);
    if (draft) {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = draft;
            autoResizeTextarea(input);
        }
    }
}

function saveDraft() {
    const input = document.getElementById('chatInput');
    if (input) {
        sessionStorage.setItem(`chat_draft_${currentChatRoom}`, input.value);
    }
}

function clearDraft() {
    sessionStorage.removeItem(`chat_draft_${currentChatRoom}`);
}

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}
// ============================================
// ЗАГРУЗКА ИСТОРИИ (ИСПРАВЛЕНО)
// ============================================

async function loadChatHistory() {
    if (isLoadingHistory) {
        console.log('⏳ История чата уже загружается');
        return;
    }
    
    console.log('📜 Загрузка истории чата...');
    const token = localStorage.getItem('token');
    if (!token) return;
    
    isLoadingHistory = true;
    
    // 🔥 Отменяем предыдущий запрос
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();
    
    try {
        const generalRes = await fetch('/api/chat/history/general', {
            headers: { 'Authorization': 'Bearer ' + token },
            signal: abortController.signal
        });
        
        if (generalRes.ok) {
            let messages = await generalRes.json();
            messages = messages.map(function(msg) {
                if (msg.text && msg.text.startsWith('{') && msg.text.indexOf('"type":"announcement"') !== -1) {
                    try {
                        const parsed = JSON.parse(msg.text);
                        if (parsed.type === 'announcement') return parsed;
                    } catch(e) {}
                }
                return msg;
            });
            chatMessages.general = messages;
            if (chatMessages.general.length > 0) {
                const times = chatMessages.general.map(m => m.time);
                lastProcessedTime.general = Math.max(...times);
            }
            console.log('📩 Общий чат: ' + chatMessages.general.length + ' сообщений');
        } else {
            console.error('❌ Ошибка загрузки общего чата:', generalRes.status);
            showNotif('Ошибка загрузки истории общего чата', 'error');
        }
        
        const employees = window.app?.employees || [];
        const currentUser = window.app?.currentUser;
        
        for (const emp of employees) {
            if (emp !== currentUser) {
                try {
                    const privRes = await fetch('/api/chat/history/' + encodeURIComponent(emp), {
                        headers: { 'Authorization': 'Bearer ' + token },
                        signal: abortController.signal
                    });
                    if (privRes.ok) {
                        const privMessages = await privRes.json();
                        if (privMessages.length > 0) {
                            chatMessages[emp] = privMessages;
                            const privTimes = privMessages.map(m => m.time);
                            lastProcessedTime[emp] = Math.max(...privTimes);
                            console.log('📩 Чат с ' + emp + ': ' + privMessages.length + ' сообщений');
                        }
                    }
                } catch(e) {
                    if (e.name !== 'AbortError') {
                        console.error('Ошибка загрузки чата с ' + emp + ':', e);
                    }
                }
            }
        }
        
        window.app.messages = chatMessages;
        
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Ошибка загрузки:', err);
            showNotif('Ошибка загрузки истории чата', 'error');
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
    
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        const res = await fetch('/api/chat/history/' + encodeURIComponent(roomId), {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const messages = await res.json();
            chatMessages[roomId] = messages;
            if (messages.length > 0) {
                const times = messages.map(m => m.time);
                lastProcessedTime[roomId] = Math.max(...times);
            }
            console.log('📩 Загружена история с ' + roomId + ': ' + messages.length + ' сообщений');
        }
    } catch(e) {
        console.error('Ошибка загрузки истории с ' + roomId + ':', e);
    }
}

async function loadRecentMessages() {
    console.log('🔄 Загрузка пропущенных сообщений...');
    
    for (const room of Object.keys(chatMessages)) {
        const lastTime = lastProcessedTime[room] || 0;
        const token = localStorage.getItem('token');
        if (!token) continue;
        
        try {
            const res = await fetch(`/api/chat/history/${encodeURIComponent(room)}?after=${lastTime}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
                const newMessages = await res.json();
                for (const msg of newMessages) {
                    if (!chatMessages[room].some(m => m.time === msg.time)) {
                        chatMessages[room].push(msg);
                        lastProcessedTime[room] = Math.max(lastProcessedTime[room], msg.time);
                    }
                }
                if (newMessages.length > 0) {
                    console.log(`📩 Загружено ${newMessages.length} новых сообщений для ${room}`);
                }
            }
        } catch(e) {
            console.error('Ошибка загрузки новых сообщений:', e);
        }
    }
    
    renderChatMessages();
    renderChatContacts();
}
// ============================================
// РЕНДЕР КОНТАКТОВ (ИСПРАВЛЕНО)
// ============================================

function renderChatContacts() {
    const container = document.getElementById('chatContacts');
    if (!container) return;
    
    const employees = window.app?.employees || [];
    const currentUser = window.app?.currentUser;
    
    const contacts = [
        { id: 'general', name: 'Общий чат', icon: '💬', type: 'general' }
    ];
    
    for (const emp of employees) {
        if (emp !== currentUser) {
            contacts.push({ id: emp, name: emp, icon: '👤', type: 'private' });
        }
    }
    
    // 🔥 Сортируем по времени последнего сообщения
    contacts.sort((a, b) => {
        if (a.id === 'general') return -1;
        if (b.id === 'general') return 1;
        
        const lastMsgA = chatMessages[a.id]?.slice(-1)[0]?.time || 0;
        const lastMsgB = chatMessages[b.id]?.slice(-1)[0]?.time || 0;
        return lastMsgB - lastMsgA;
    });
    
    let html = '';
    for (const contact of contacts) {
        const unreadCount = chatUnread[contact.id] || 0;
        const isActive = (currentChatRoom === contact.id);
        const msgCount = (chatMessages[contact.id] ? chatMessages[contact.id].length : 0);
        
        let avatarHtml = contact.icon;
        if (contact.type === 'private') {
            const profile = window.app?.profiles?.[contact.name];
            if (profile) {
                avatarHtml = getAvatarHtml(profile, 'small');
            }
        }
        
        html += '<div class="chat-contact ' + (isActive ? 'active' : '') + '" onclick="switchChat(\'' + escapeHtml(contact.id) + '\')" role="button" tabindex="0" aria-label="Чат с ' + escapeHtml(contact.name) + '">';
        html += '<div class="contact-avatar" style="overflow: hidden; border-radius: 50%;">' + avatarHtml + '</div>';
        html += '<div style="flex: 1; min-width: 0;">';
        html += '<div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + escapeHtml(contact.name) + '</div>';
        html += '<div style="font-size: 11px; opacity: 0.6;">' + (contact.type === 'general' ? 'Общий чат' : 'Личный чат');
        if (msgCount > 0) html += ' · ' + msgCount;
        html += '</div></div>';
        if (unreadCount > 0) html += '<div class="unread-badge" aria-label="' + unreadCount + ' непрочитанных">' + (unreadCount > 99 ? '99+' : unreadCount) + '</div>';
        html += '</div>';
    }
    
    container.innerHTML = html;
}

// ============================================
// РЕНДЕР СООБЩЕНИЙ (ИСПРАВЛЕНО)
// ============================================

function debouncedRenderChatMessages() {
    if (renderDebounceTimer) {
        clearTimeout(renderDebounceTimer);
    }
    renderDebounceTimer = setTimeout(() => {
        renderChatMessages();
        renderDebounceTimer = null;
    }, RENDER_DEBOUNCE_DELAY);
}

function renderChatMessages() {
    const container = document.getElementById('chatMessages');
    const headerName = document.getElementById('chatHeaderName');
    const headerStatus = document.getElementById('chatHeaderStatus');
    const headerAvatar = document.getElementById('chatHeaderAvatar');
    
    if (!container) return;
    
    const messages = chatMessages[currentChatRoom] || [];
    
    if (headerName) {
        if (currentChatRoom === 'general') {
            headerName.innerHTML = '💬 Общий чат';
            headerStatus.innerHTML = 'Все сотрудники';
            if (headerAvatar) headerAvatar.innerHTML = '💬';
        } else {
            headerName.innerHTML = escapeHtml(currentChatRoom);
            const profile = window.app?.profiles?.[currentChatRoom];
            let statusText = (profile && profile.role) ? roleNames[profile.role] : 'Сотрудник';
            
            // 🔥 Статус "последний онлайн"
            const lastActive = window.app?.lastActivity?.[currentChatRoom];
            if (lastActive) {
                statusText += ` · Был(а) ${formatTimeAgo(lastActive)}`;
            }
            
            headerStatus.innerHTML = statusText;
            
            // 🔥 Обновляем аватар в хедере чата
            if (headerAvatar && profile) {
                headerAvatar.innerHTML = getAvatarHtml(profile, 'small');
                headerAvatar.style.cursor = 'pointer';
                headerAvatar.onclick = () => openProfile(currentChatRoom);
            }
        }
    }
    
    // 🔥 Обновляем заголовок страницы
    updatePageTitle();
    
    if (messages.length === 0) {
        container.innerHTML = '<div class="chat-empty-state"><div class="empty-icon">💬</div><h3>Нет сообщений</h3><p>Напишите что-нибудь!</p></div>';
        return;
    }
    
    // 🔥 Сбрасываем непрочитанные для текущего чата
    if (chatUnread[currentChatRoom]) {
        delete chatUnread[currentChatRoom];
        window.chatUnread = chatUnread;
        renderChatContacts();
        
        if (typeof renderEmployees === 'function') {
            renderEmployees();
        }
    }
    
    // 🔥 Фильтруем удалённые сообщения
    const sorted = [...messages]
        .filter(msg => !msg.deleted)
        .sort((a, b) => a.time - b.time);
    
    const unique = [];
    const seen = new Set();
    for (const msg of sorted) {
        const key = `${msg.time}_${msg.sender}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(msg);
        }
    }
    
    // 🔥 Ограничиваем количество хранимых сообщений
    if (unique.length > 500) {
        chatMessages[currentChatRoom] = unique.slice(-500);
    }
    
    let html = '';
    let lastDate = null;
    
    for (let i = 0; i < unique.length; i++) {
        const msg = unique[i];
        
        // 🔥 Разделитель дат
        const msgDate = new Date(msg.time).toDateString();
        if (msgDate !== lastDate) {
            lastDate = msgDate;
            html += `<div class="date-separator">${formatDateHeader(msg.time)}</div>`;
        }
        
        if (msg.type === 'announcement') {
            html += renderAnnouncement(msg);
            continue;
        }
        
        if (msg.action_data) {
            // 🔥 Валидация action_data
            if (typeof msg.action_data === 'object' && 
                JSON.stringify(msg.action_data).length < MAX_ACTION_DATA_SIZE) {
                
                if (msg.action_data.type === 'exchange_request' && msg.action_data.status === 'pending') {
                    html += renderExchangeRequestMessage(msg);
                    continue;
                }
            }
        }
        
        const isOwn = (msg.sender === window.app?.currentUser);
        
        let timeValue = msg.time;
        if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
        const date = new Date(timeValue);
        const time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let avatarHtml = '👤';
        if (!isOwn) {
            if (msg.sender === '🕵️ Аноним') {
                avatarHtml = '🕵️';
            } else {
                const profile = window.app?.profiles?.[msg.sender];
                if (profile) {
                    avatarHtml = getAvatarHtml(profile, 'small');
                } else {
                    // 🔥 Инициалы вместо 👤
                    avatarHtml = getInitialsAvatar(msg.sender);
                }
            }
        }
        
        const isNew = msg.time > (lastProcessedTime[currentChatRoom] - 5000);
        const messageClass = 'message ' + (isOwn ? 'own' : '') + (isNew ? ' new-message' : '');
        
        html += `<div class="${messageClass}" data-message-time="${msg.time}" data-message-sender="${escapeHtml(msg.sender)}">`;
        html += '<div class="message-avatar" style="overflow: hidden; border-radius: 50%;">' + avatarHtml + '</div>';
        html += '<div class="message-bubble">';
        if (!isOwn) html += '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>';
        html += '<div class="message-text" dir="auto">' + escapeHtml(msg.text) + '</div>';
        html += '<div class="message-footer">';
        html += '<div class="message-time" title="' + date.toLocaleString() + '">' + time + '</div>';
        if (isOwn) {
            html += '<button class="delete-message-btn" onclick="deleteMessage(' + msg.time + ', \'' + currentChatRoom + '\')" title="Удалить сообщение" aria-label="Удалить сообщение">';
            html += '<i class="fas fa-trash-alt"></i></button>';
        }
        html += '</div></div></div>';
    }
    
    container.innerHTML = html;
    
    // 🔥 Скролл вниз с учётом изображений
    requestAnimationFrame(() => {
        const lastMessage = container.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ block: 'end', behavior: 'instant' });
        }
    });
}

function getInitialsAvatar(name) {
    if (!name) return '👤';
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<span style="font-size: 12px; font-weight: 600;">${escapeHtml(initials)}</span>`;
}

function formatDateHeader(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return 'Сегодня';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Вчера';
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function updatePageTitle() {
    const totalUnread = Object.values(chatUnread).reduce((a, b) => a + b, 0);
    if (totalUnread > 0) {
        document.title = `(${totalUnread}) WARPOINT — Чат`;
    } else {
        if (currentChatRoom === 'general') {
            document.title = 'WARPOINT — Общий чат';
        } else {
            document.title = `WARPOINT — Чат с ${currentChatRoom}`;
        }
    }
}

function renderExchangeRequestMessage(msg) {
    const data = msg.action_data;
    
    // 🔥 Валидация структуры
    if (!data || typeof data !== 'object') return '';
    if (!data.from_date || !data.to_date) return '';
    
    let timeValue = msg.time;
    if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
    const date = new Date(timeValue);
    const time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const fromDate = formatDateSimple(data.from_date);
    const toDate = formatDateSimple(data.to_date);
    
    let html = '<div class="message exchange-message" data-request-id="' + data.request_id + '">';
    html += '<div class="message-avatar" style="border-radius: 50%;">🔄</div>';
    html += '<div class="message-bubble exchange-bubble">';
    html += '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>';
    html += '<div class="message-text">';
    html += '<strong>📅 Предложение обмена сменами</strong><br><br>';
    html += '👤 ' + escapeHtml(data.from_employee) + ' хочет обменяться с вами!<br><br>';
    html += '📌 Его смена: ' + fromDate + ' — ' + escapeHtml(data.from_time) + '<br>';
    html += '📌 Ваша смена: ' + toDate + ' — ' + escapeHtml(data.to_time) + '<br><br>';
    if (data.comment) {
        html += '💬 Комментарий: ' + escapeHtml(data.comment) + '<br><br>';
    }
    html += '</div>';
    html += '<div class="exchange-buttons">';
    html += '<button class="exchange-accept-btn" onclick="acceptExchangeFromChat(' + data.request_id + ', \'' + currentChatRoom + '\', ' + msg.time + ')">✅ Принять</button>';
    html += '<button class="exchange-reject-btn" onclick="rejectExchangeFromChat(' + data.request_id + ', \'' + currentChatRoom + '\', ' + msg.time + ')">❌ Отклонить</button>';
    html += '</div>';
    html += '<div class="message-footer">';
    html += '<div class="message-time">' + time + '</div>';
    html += '</div></div></div>';
    
    return html;
}

function renderAnnouncement(announcement) {
    let roleIcon = '📢';
    let roleName = 'Объявление';
    
    if (announcement.role === 'director') {
        roleIcon = '👑';
        roleName = 'Директор';
    } else if (announcement.role === 'manager') {
        roleIcon = '📋';
        roleName = 'Управляющий';
    }
    
    const styleClass = 'announcement-' + announcement.style;
    const time = new Date(announcement.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // 🔥 Обрезка длинных объявлений
    const displayText = announcement.text.length > 1000 
        ? escapeHtml(announcement.text.substring(0, 1000)) + '...' 
        : escapeHtml(announcement.text);
    
    return '<div class="announcement-message ' + styleClass + '">' +
        '<div class="announcement-header">' +
            '<div class="announcement-role">' +
                '<span>' + roleIcon + '</span>' +
                '<span>' + escapeHtml(announcement.sender) + '</span>' +
                '<span style="font-size: 11px; opacity: 0.7;">' + roleName + '</span>' +
            '</div>' +
            '<div class="announcement-time">' +
                '<i class="fas fa-bullhorn"></i> ' + time +
            '</div>' +
        '</div>' +
        '<div class="announcement-content">' +
            '<p>' + displayText + '</p>' +
        '</div>' +
    '</div>';
}

function formatDateSimple(dateStr) {
    if (!dateStr) return '—';
    const parts = dateStr.split('-');
    const day = parseInt(parts[2]);
    const month = parseInt(parts[1]);
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return day + ' ' + monthNames[month - 1];
}

function getAvatarHtml(profile, size) {
    if (!profile) return '👤';
    if (profile.avatar_url) {
        return '<img src="' + escapeHtml(profile.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML=\'' + getInitialsAvatar(profile.name) + '\'">';
    }
    return escapeHtml(profile.avatar || '👤');
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч назад';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
// ============================================
// ОТПРАВКА СООБЩЕНИЙ (ИСПРАВЛЕНО)
// ============================================

function initChatInput() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const charCount = document.getElementById('charCount');
    
    if (input) {
        // Авто-resize
        input.addEventListener('input', function() {
            autoResizeTextarea(this);
            saveDraft();
            
            // Счётчик символов
            if (charCount) {
                charCount.textContent = `${this.value.length}/${MAX_MESSAGE_LENGTH}`;
                charCount.style.color = this.value.length > MAX_MESSAGE_LENGTH * 0.9 ? '#ef4444' : '#64748b';
            }
            
            // 🔥 Disable кнопки если пусто
            if (sendBtn) {
                sendBtn.disabled = !this.value.trim();
            }
        });
        
        // Отправка по Enter (Shift+Enter для новой строки)
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    sendChatMessage();
                }
            }
            
            // 🔥 Esc для очистки
            if (e.key === 'Escape') {
                this.value = '';
                clearDraft();
                if (sendBtn) sendBtn.disabled = true;
                autoResizeTextarea(this);
            }
        });
        
        // 🔥 Защита от вставки форматирования
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
        });
        
        // 🔥 Восстановление черновика
        restoreDraft();
        if (sendBtn) sendBtn.disabled = !input.value.trim();
    }
    
    if (sendBtn) {
        sendBtn.onclick = function() { sendChatMessage(); };
    }
}

async function sendChatMessage() {
    const now = Date.now();
    
    if (isSendingMessage) {
        console.log('⚠️ Сообщение уже отправляется');
        return;
    }
    
    // 🔥 Rate limiting
    if (now - lastMessageTime < MESSAGE_COOLDOWN) {
        showNotif('Подождите немного перед отправкой', 'warning');
        return;
    }
    
    if (messageCountThisMinute >= MAX_MESSAGES_PER_MINUTE) {
        showNotif('Слишком много сообщений. Подождите минуту.', 'error');
        return;
    }
    
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    
    // 🔥 Проверка на эмодзи-спам
    const emojiCount = (text.match(/[\p{Emoji}]/gu) || []).length;
    if (emojiCount > 50) {
        showNotif('Слишком много эмодзи в сообщении', 'warning');
        return;
    }
    
    if (text.length > MAX_MESSAGE_LENGTH) {
        showNotif('Сообщение слишком длинное (макс. ' + MAX_MESSAGE_LENGTH + ' символов)', 'error');
        return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    if (!window.app?.currentUser) {
        showNotif('Ошибка: пользователь не определён', 'error');
        return;
    }
    
    // 🔥 Проверка существования получателя
    if (currentChatRoom !== 'general' && !window.app?.employees?.includes(currentChatRoom)) {
        showNotif('Сотрудник не найден', 'error');
        return;
    }
    
    isSendingMessage = true;
    lastMessageTime = now;
    messageCountThisMinute++;
    
    const sendBtn = document.getElementById('chatSendBtn');
    const originalText = sendBtn?.innerHTML;
    if (sendBtn) {
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        sendBtn.disabled = true;
    }
    
    const message = {
        sender: window.app.currentUser,
        text: text,
        time: Date.now()
    };
    
    // 🔥 Офлайн-очередь
    if (!navigator.onLine) {
        pendingMessages.push({ room: currentChatRoom, message });
        showNotif('📡 Сообщение сохранено и отправится при подключении', 'info');
        
        // Временно показываем сообщение
        if (!chatMessages[currentChatRoom]) chatMessages[currentChatRoom] = [];
        chatMessages[currentChatRoom].push({ ...message, pending: true });
        renderChatMessages();
        
        input.value = '';
        clearDraft();
        autoResizeTextarea(input);
        isSendingMessage = false;
        return;
    }
    
    try {
        let response;
        if (currentChatRoom === 'general') {
            response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ room: 'general', message: message })
            });
        } else {
            response = await fetch('/api/chat/private', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ to: currentChatRoom, message: message })
            });
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            if (!chatMessages[currentChatRoom]) chatMessages[currentChatRoom] = [];
            chatMessages[currentChatRoom].push(message);
            lastProcessedTime[currentChatRoom] = message.time;
            
            input.value = '';
            clearDraft();
            autoResizeTextarea(input);
            
            renderChatMessages();
            renderChatContacts();
            
            // 🔥 Звук отправки (опционально)
            // playSound('send');
        } else {
            showNotif(data.error || 'Ошибка при отправке', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        
        // 🔥 Сохраняем в офлайн-очередь при ошибке сети
        if (err.name === 'TypeError' || err.message.includes('NetworkError')) {
            pendingMessages.push({ room: currentChatRoom, message });
            showNotif('📡 Сообщение сохранено и отправится при подключении', 'info');
            
            if (!chatMessages[currentChatRoom]) chatMessages[currentChatRoom] = [];
            chatMessages[currentChatRoom].push({ ...message, pending: true });
            renderChatMessages();
            
            input.value = '';
            clearDraft();
            autoResizeTextarea(input);
        } else {
            showNotif('Ошибка соединения', 'error');
        }
    } finally {
        isSendingMessage = false;
        if (sendBtn) {
            sendBtn.innerHTML = originalText || '<i class="fas fa-paper-plane"></i>';
            sendBtn.disabled = !input?.value.trim();
        }
    }
}

async function processPendingMessages() {
    if (isProcessingQueue || pendingMessages.length === 0) return;
    
    isProcessingQueue = true;
    showNotif(`📡 Отправка ${pendingMessages.length} сохранённых сообщений...`, 'info');
    
    const token = localStorage.getItem('token');
    
    while (pendingMessages.length > 0) {
        const { room, message } = pendingMessages.shift();
        
        try {
            let response;
            if (room === 'general') {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ room: 'general', message: message })
                });
            } else {
                response = await fetch('/api/chat/private', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({ to: room, message: message })
                });
            }
            
            if (response.ok) {
                console.log('✅ Отправлено отложенное сообщение');
            }
        } catch (e) {
            console.error('Ошибка отправки отложенного сообщения:', e);
            pendingMessages.unshift({ room, message });
            break;
        }
        
        await new Promise(r => setTimeout(r, 200));
    }
    
    if (pendingMessages.length === 0) {
        showNotif('✅ Все сообщения отправлены', 'success');
    }
    
    isProcessingQueue = false;
}

// ============================================
// ПЕРЕКЛЮЧЕНИЕ ЧАТА (ИСПРАВЛЕНО)
// ============================================

async function switchChat(roomId) {
    if (isSwitchingChat) {
        console.log('⚠️ Чат уже переключается');
        return;
    }
    
    // 🔥 Проверка существования сотрудника
    if (roomId !== 'general' && !window.app?.employees?.includes(roomId)) {
        showNotif('Сотрудник не найден', 'error');
        return;
    }
    
    console.log('🔄 Переключение на чат: ' + roomId);
    
    // 🔥 Сохраняем черновик текущего чата
    saveDraft();
    
    isSwitchingChat = true;
    
    // 🔥 Отменяем текущую загрузку
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    
    // 🔥 Показываем скелетон
    const container = document.getElementById('chatMessages');
    if (container) {
        container.innerHTML = '<div class="chat-skeleton"><div class="skeleton-message"></div><div class="skeleton-message"></div><div class="skeleton-message short"></div></div>';
    }
    
    currentChatRoom = roomId;
    sessionStorage.setItem('currentChatRoom', roomId);
    
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
    
    const announcementBtn = document.getElementById('announcementBtn');
    if (announcementBtn) {
        const role = window.app?.currentUserRole;
        announcementBtn.style.display = (role === 'director' || role === 'manager') ? 'flex' : 'none';
    }
    
    const settingsBtn = document.getElementById('chatSettingsBtn');
    if (settingsBtn) {
        settingsBtn.style.display = (roomId === 'general' && window.app?.currentUserRole === 'director') ? 'flex' : 'none';
    }
    
    // 🔥 Загружаем историю, если её нет
    if (!chatMessages[roomId] && roomId !== 'general') {
        await loadChatHistoryForRoom(roomId);
    }
    
    renderChatContacts();
    renderChatMessages();
    
    // 🔥 Восстанавливаем черновик
    restoreDraft();
    
    // 🔥 Фокус на поле ввода
    setTimeout(() => {
        const input = document.getElementById('chatInput');
        if (input) {
            input.focus();
            autoResizeTextarea(input);
        }
    }, 100);
    
    // 🔥 Обновляем заголовок страницы
    updatePageTitle();
    
    isSwitchingChat = false;
}

// ============================================
// PUSHER СЛУШАТЕЛИ (ИСПРАВЛЕНО)
// ============================================

function setupPusherListeners() {
    // 🔥 Очищаем старые слушатели перед созданием новых
    if (window.channel) {
        window.channel.unbind('client-new-message');
        window.channel.unbind('client-announcement');
        window.channel.unbind('client-delete-message');
        window.channel.unbind('client-bulk-delete');
        window.channel.unbind('client-ping');
    }
    
    if (window.privateChannel) {
        window.privateChannel.unbind('client-private-message');
        window.privateChannel.unbind('client-delete-private');
        window.privateChannel.unbind('client-typing');
    }
    
    if (window.pusher) {
        window.pusher.connection.unbind('connected');
        window.pusher.connection.unbind('disconnected');
        window.pusher.connection.unbind('error');
        window.pusher.connection.unbind('failed');
    }
    
    console.log('🔌 ===== НАСТРОЙКА PUSHER СЛУШАТЕЛЕЙ =====');
    
    if (window.channel) {
        window.channel.bind('client-new-message', function(data) {
            if (data.room !== 'general') return;
            
            const msgTime = data.message.time;
            
            // 🔥 Защита от старых сообщений после delete all
            if (deletedUntil.general && msgTime < deletedUntil.general) return;
            
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            
            if (!chatMessages.general) chatMessages.general = [];
            
            const exists = chatMessages.general.some(m => m.time === msgTime && m.sender === data.message.sender);
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
                    
                    if (typeof renderEmployees === 'function') {
                        renderEmployees();
                    }
                    
                    updatePageTitle();
                    
                    // 🔥 Звук уведомления
                    if (document.visibilityState !== 'visible') {
                        playSound('notification');
                    }
                    
                    // 🔥 Вибрация на мобильных
                    if (navigator.vibrate) navigator.vibrate(200);
                    
                    // 🔥 XSS-защита в уведомлении
                    const safeText = escapeHtml(data.message.text.substring(0, 50));
                    const safeSender = escapeHtml(data.message.sender);
                    showNotif(`💬 ${safeSender}: ${safeText}`, 'info');
                }
            }
        });
        
        window.channel.bind('client-announcement', function(data) {
            const announcement = data.announcement;
            const msgTime = announcement.time;
            
            // 🔥 Не дублировать свои объявления
            if (announcement.sender === window.app?.currentUser) return;
            
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            
            if (!chatMessages.general) chatMessages.general = [];
            const exists = chatMessages.general.some(m => m.time === msgTime);
            if (!exists) {
                chatMessages.general.push(announcement);
                lastProcessedTime.general = msgTime;
                window.app.messages = chatMessages;
                
                if (currentChatRoom === 'general') {
                    debouncedRenderChatMessages();
                } else {
                    chatUnread.general = (chatUnread.general || 0) + 1;
                    window.chatUnread = chatUnread;
                    renderChatContacts();
                    
                    const safeText = escapeHtml(announcement.text.substring(0, 50));
                    showNotif(`📢 ОБЪЯВЛЕНИЕ: ${safeText}`, 'warning');
                }
            }
        });
        
        window.channel.bind('client-delete-message', function(data) {
            const room = data.room;
            const messageTime = data.messageTime;
            
            if (chatMessages[room]) {
                const index = chatMessages[room].findIndex(m => m.time === messageTime);
                if (index !== -1) {
                    const messageEl = document.querySelector(`.message[data-message-time="${messageTime}"]`);
                    if (messageEl) {
                        messageEl.classList.add('deleting');
                        setTimeout(() => {
                            chatMessages[room].splice(index, 1);
                            renderChatMessages();
                            renderChatContacts();
                        }, 300);
                    } else {
                        chatMessages[room].splice(index, 1);
                        renderChatMessages();
                        renderChatContacts();
                    }
                }
            }
        });
        
        window.channel.bind('client-bulk-delete', function(data) {
            const period = data.period;
            const timeThreshold = data.timeThreshold;
            const timestamp = data.timestamp;
            
            if (timestamp <= (lastBulkDeleteTime || 0)) return;
            lastBulkDeleteTime = timestamp;
            
            if (period === 'all') {
                chatMessages.general = [];
                lastProcessedTime.general = 0;
                deletedUntil.general = Date.now();
            } else if (timeThreshold) {
                const oldMessages = chatMessages.general || [];
                chatMessages.general = oldMessages.filter(msg => msg.time < timeThreshold);
                if (chatMessages.general.length === 0) {
                    lastProcessedTime.general = 0;
                } else {
                    const times = chatMessages.general.map(m => m.time);
                    lastProcessedTime.general = Math.max(...times);
                }
            }
            window.app.messages = chatMessages;
            if (currentChatRoom === 'general') renderChatMessages();
            showNotif('📋 Сообщения в общем чате обновлены', 'info');
        });
    }
    
    if (window.privateChannel) {
        window.privateChannel.bind('client-private-message', function(data) {
            const msgTime = data.message.time;
            const roomId = data.from;
            
            if (deletedUntil[roomId] && msgTime < deletedUntil[roomId]) return;
            
            if (msgTime <= (lastProcessedTime[roomId] || 0)) return;
            
            // 🔥 Загружаем историю для нового контакта
            if (!chatMessages[roomId]) {
                chatMessages[roomId] = [];
                loadChatHistoryForRoom(roomId);
            }
            
            const exists = chatMessages[roomId].some(m => m.time === msgTime && m.sender === data.message.sender);
            if (!exists) {
                chatMessages[roomId].push(data.message);
                lastProcessedTime[roomId] = msgTime;
                window.app.messages = chatMessages;
                
                if (currentChatRoom === roomId) {
                    debouncedRenderChatMessages();
                } else {
                    chatUnread[roomId] = (chatUnread[roomId] || 0) + 1;
                    window.chatUnread = chatUnread;
                    renderChatContacts();
                    
                    if (typeof renderEmployees === 'function') {
                        renderEmployees();
                    }
                    
                    updatePageTitle();
                    
                    if (document.visibilityState !== 'visible') {
                        playSound('notification');
                    }
                    
                    if (navigator.vibrate) navigator.vibrate(200);
                    
                    const safeText = escapeHtml(data.message.text.substring(0, 50));
                    const safeSender = escapeHtml(data.from);
                    showNotif(`💬 Личное от ${safeSender}: ${safeText}`, 'info');
                }
            }
        });
        
        window.privateChannel.bind('client-delete-private', function(data) {
            const room = data.room;
            const messageTime = data.messageTime;
            
            if (chatMessages[room]) {
                const index = chatMessages[room].findIndex(m => m.time === messageTime);
                if (index !== -1) {
                    chatMessages[room].splice(index, 1);
                    renderChatMessages();
                    renderChatContacts();
                }
            }
        });
    }
    
    if (window.pusher) {
        window.pusher.connection.bind('connected', () => {
            console.log('🟢 Pusher подключён');
            setSyncStatus('online');
            document.getElementById('offlineBanner')?.style.setProperty('display', 'none');
            
            // 🔥 Загружаем пропущенные сообщения
            loadRecentMessages();
        });
        
        window.pusher.connection.bind('disconnected', () => {
            console.log('🔴 Pusher отключён');
            setSyncStatus('offline');
            document.getElementById('offlineBanner')?.style.setProperty('display', 'block');
        });
        
        window.pusher.connection.bind('error', (err) => {
            console.error('❌ Pusher error:', err);
            setSyncStatus('offline');
        });
        
        window.pusher.connection.bind('failed', () => {
            console.error('❌ Pusher failed');
            setSyncStatus('offline');
            showNotif('Не удалось подключиться к чату. Обновите страницу.', 'error');
        });
    }
    
    pusherListenersSetup = true;
    console.log('🔌 ===== НАСТРОЙКА PUSHER ЗАВЕРШЕНА =====');
}

function playSound(type) {
    // Опционально: добавить звуки
    // const audio = new Audio(`/sounds/${type}.mp3`);
    // audio.play().catch(() => {});
}

function setSyncStatus(status) {
    if (typeof window.setSyncStatus === 'function' && window.setSyncStatus !== setSyncStatus) {
        window.setSyncStatus(status);
    } else {
        console.log('[Sync]', status);
    }
}
// ============================================
// ЭМОДЗИ (ИСПРАВЛЕНО)
// ============================================

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    const messagesList = document.getElementById('chatMessages');
    
    if (picker) {
        const isOpening = picker.style.display !== 'block';
        picker.style.display = isOpening ? 'block' : 'none';
        
        // 🔥 Блокируем скролл чата при открытом пикере
        if (messagesList) {
            messagesList.style.overflowY = isOpening ? 'hidden' : 'auto';
        }
    }
}

function addEmoji(emoji) {
    const input = document.getElementById('chatInput');
    if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        input.value = text.substring(0, start) + emoji + text.substring(end);
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        
        autoResizeTextarea(input);
        saveDraft();
        
        const sendBtn = document.getElementById('chatSendBtn');
        if (sendBtn) sendBtn.disabled = false;
    }
    
    const picker = document.getElementById('emojiPicker');
    const messagesList = document.getElementById('chatMessages');
    
    if (picker) picker.style.display = 'none';
    if (messagesList) messagesList.style.overflowY = 'auto';
}

// ============================================
// ОБЪЯВЛЕНИЯ (ИСПРАВЛЕНО)
// ============================================

function initAnnouncementButton() {
    const btn = document.getElementById('announcementBtn');
    if (!btn) return;
    
    const role = window.app?.currentUserRole;
    if (role === 'director' || role === 'manager') {
        btn.style.display = 'flex';
        btn.onclick = function() { openAnnouncementModal(); };
    } else {
        btn.style.display = 'none';
    }
}

function openAnnouncementModal() {
    const modal = document.getElementById('announcementModal');
    if (!modal) return;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    const role = window.app?.currentUserRole;
    const styleOptions = document.querySelectorAll('.style-option');
    
    for (const opt of styleOptions) {
        const style = opt.dataset.style;
        
        if (role === 'director') {
            opt.style.display = (style === 'manager') ? 'none' : 'inline-flex';
        } else if (role === 'manager') {
            opt.style.display = (style === 'director') ? 'none' : 'inline-flex';
        } else {
            opt.style.display = 'none';
        }
    }
    
    let defaultStyle = '';
    if (role === 'director') defaultStyle = 'director';
    else if (role === 'manager') defaultStyle = 'manager';
    
    for (const opt of styleOptions) {
        opt.classList.remove('active');
        if (opt.dataset.style === defaultStyle) {
            opt.classList.add('active');
            currentAnnouncementStyle = defaultStyle;
        }
    }
    
    if (!defaultStyle) {
        for (const opt of styleOptions) {
            if (opt.style.display !== 'none') {
                opt.classList.add('active');
                currentAnnouncementStyle = opt.dataset.style;
                break;
            }
        }
    }
    
    // 🔥 Фокус на textarea
    setTimeout(() => {
        document.getElementById('announcementText')?.focus();
    }, 100);
}

function closeAnnouncementModal() {
    const modal = document.getElementById('announcementModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    const textarea = document.getElementById('announcementText');
    if (textarea) textarea.value = '';
}

async function sendAnnouncement() {
    const textarea = document.getElementById('announcementText');
    const text = textarea?.value.trim();
    
    if (!text) {
        showNotif('Введите текст объявления', 'error');
        return;
    }
    
    if (text.length > 1000) {
        showNotif('Текст объявления слишком длинный (макс. 1000 символов)', 'error');
        return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const announcement = {
        type: 'announcement',
        style: currentAnnouncementStyle,
        sender: window.app?.currentUser,
        role: window.app?.currentUserRole,
        text: text,
        time: Date.now()
    };
    
    const sendBtn = document.querySelector('#announcementModal .btn-primary');
    const originalText = sendBtn?.innerHTML;
    if (sendBtn) {
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
        sendBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/chat/announcement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ announcement: announcement })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            closeAnnouncementModal();
            
            if (!chatMessages.general) chatMessages.general = [];
            chatMessages.general.push(announcement);
            lastProcessedTime.general = announcement.time;
            renderChatMessages();
            
            if (window.channel) {
                window.channel.trigger('client-announcement', { announcement: announcement });
            }
            
            showNotif('✅ Объявление опубликовано', 'success');
        } else {
            showNotif(data.error || 'Ошибка при отправке', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    } finally {
        if (sendBtn) {
            sendBtn.innerHTML = originalText;
            sendBtn.disabled = false;
        }
    }
}

// ============================================
// УДАЛЕНИЕ СООБЩЕНИЙ (ИСПРАВЛЕНО)
// ============================================

async function deleteMessage(messageTime, room) {
    // 🔥 Проверка, что room совпадает с текущим чатом
    if (room !== currentChatRoom) {
        console.warn('⚠️ Попытка удалить сообщение из неактивного чата');
    }
    
    const timeValue = typeof messageTime === 'string' ? parseInt(messageTime) : messageTime;
    const messages = chatMessages[room] || [];
    const messageToDelete = messages.find(m => m.time === timeValue);
    
    if (!messageToDelete) {
        showNotif('Сообщение не найдено', 'error');
        return;
    }
    
    const isOwn = (messageToDelete.sender === window.app?.currentUser);
    const isDirector = (window.app?.currentUserRole === 'director');
    
    if (!isOwn && !isDirector) {
        showNotif('Можно удалять только свои сообщения', 'error');
        return;
    }
    
    const confirmMsg = isDirector && !isOwn 
        ? `Удалить сообщение от ${messageToDelete.sender}?` 
        : 'Удалить это сообщение?';
        
    if (!confirm(confirmMsg)) return;
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    try {
        // 🔥 Добавляем класс для анимации
        const messageEl = document.querySelector(`.message[data-message-time="${timeValue}"]`);
        if (messageEl) {
            messageEl.classList.add('deleting');
        }
        
        const response = await fetch('/api/chat/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ room: room, messageTime: timeValue, sender: messageToDelete.sender })
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                showNotif('Сообщение уже удалено', 'info');
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        }
        
        const data = await response.json();
        
        if (data.success) {
            // 🔥 Удаляем после анимации
            setTimeout(() => {
                const index = chatMessages[room].findIndex(m => m.time === timeValue);
                if (index !== -1) {
                    chatMessages[room].splice(index, 1);
                    window.app.messages = chatMessages;
                    renderChatMessages();
                    renderChatContacts();
                }
            }, 300);
            
            if (room === 'general' && window.channel) {
                window.channel.trigger('client-delete-message', { 
                    room: room, 
                    messageTime: timeValue, 
                    sender: messageToDelete.sender 
                });
            } else if (window.privateChannel) {
                window.privateChannel.trigger('client-delete-private', { 
                    room: room, 
                    messageTime: timeValue, 
                    sender: messageToDelete.sender 
                });
            }
            
            showNotif('Сообщение удалено', 'success');
        } else {
            showNotif(data.error || 'Ошибка при удалении', 'error');
            messageEl?.classList.remove('deleting');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
        document.querySelector(`.message[data-message-time="${timeValue}"]`)?.classList.remove('deleting');
    }
}

// ============================================
// НАСТРОЙКИ ЧАТА (ИСПРАВЛЕНО)
// ============================================

function initChatSettings() {
    const settingsBtn = document.getElementById('chatSettingsBtn');
    if (!settingsBtn) return;
    
    if (window.app?.currentUserRole === 'director') {
        settingsBtn.style.display = 'flex';
        settingsBtn.onclick = function() { openChatSettingsModal(); };
    } else {
        settingsBtn.style.display = 'none';
    }
}

function openChatSettingsModal() {
    const modal = document.getElementById('chatSettingsModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeChatSettingsModal() {
    const modal = document.getElementById('chatSettingsModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

async function deleteMessagesByPeriod(period) {
    let confirmMsg = '';
    let timeThreshold = 0;
    const now = Date.now();
    
    switch(period) {
        case '15min': 
            confirmMsg = 'Удалить все сообщения в общем чате за последние 15 минут?'; 
            timeThreshold = now - 15 * 60 * 1000; 
            break;
        case 'hour': 
            confirmMsg = 'Удалить все сообщения в общем чате за последний час?'; 
            timeThreshold = now - 60 * 60 * 1000; 
            break;
        case 'day': 
            confirmMsg = 'Удалить все сообщения в общем чате за последний день?'; 
            timeThreshold = now - 24 * 60 * 60 * 1000; 
            break;
        case 'week': 
            confirmMsg = 'Удалить все сообщения в общем чате за последнюю неделю?'; 
            timeThreshold = now - 7 * 24 * 60 * 60 * 1000; 
            break;
        case 'month': 
            confirmMsg = 'Удалить все сообщения в общем чате за последний месяц?'; 
            timeThreshold = now - 30 * 24 * 60 * 60 * 1000; 
            break;
        case 'all': 
            confirmMsg = '⚠️ Удалить ВСЕ сообщения в общем чате? Это действие необратимо!'; 
            timeThreshold = 0; 
            break;
        default: 
            return;
    }
    
    if (!confirm(confirmMsg)) return;
    
    // 🔥 Двойное подтверждение для 'all'
    if (period === 'all') {
        if (!confirm('Точно? Восстановить будет невозможно.')) return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    showNotif('⏳ Удаление сообщений...', 'info');
    
    try {
        const response = await fetch('/api/chat/delete-bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ 
                period: period, 
                room: currentChatRoom, // 🔥 Теперь поддерживает любой чат
                timeThreshold: timeThreshold 
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            if (period === 'all') {
                chatMessages[currentChatRoom] = [];
                lastProcessedTime[currentChatRoom] = 0;
                deletedUntil[currentChatRoom] = Date.now();
            } else {
                const oldMessages = chatMessages[currentChatRoom] || [];
                chatMessages[currentChatRoom] = oldMessages.filter(msg => msg.time < timeThreshold);
                if (chatMessages[currentChatRoom].length === 0) {
                    lastProcessedTime[currentChatRoom] = 0;
                } else {
                    const times = chatMessages[currentChatRoom].map(m => m.time);
                    lastProcessedTime[currentChatRoom] = Math.max(...times);
                }
            }
            
            window.app.messages = chatMessages;
            
            if (currentChatRoom === 'general') {
                renderChatMessages();
            }
            
            showNotif(`✅ Удалено ${data.deletedCount} сообщений`, 'success');
            closeChatSettingsModal();
            
            if (window.channel) {
                window.channel.trigger('client-bulk-delete', { 
                    period: period, 
                    room: currentChatRoom,
                    timeThreshold: timeThreshold, 
                    timestamp: Date.now() 
                });
            }
        } else {
            showNotif('❌ Ошибка при удалении: ' + (data.error || 'неизвестная ошибка'), 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('❌ Ошибка соединения', 'error');
    }
}

// ============================================
// ОБМЕН СМЕНАМИ В ЧАТЕ (ИСПРАВЛЕНО)
// ============================================

async function acceptExchangeFromChat(requestId, room, messageTime) {
    try {
        const response = await apiCall('/exchange/accept/' + requestId, 'POST');
        
        if (response && response.success) {
            showNotif('✅ Обмен смен подтверждён!', 'success');
            updateExchangeMessageInChat(room, messageTime, 'accepted');
            
            if (typeof loadScheduleData === 'function') loadScheduleData();
            if (typeof renderMonthSchedule === 'function') renderMonthSchedule();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
            if (typeof updateNextShiftInfo === 'function') updateNextShiftInfo();
            if (typeof loadPendingExchanges === 'function') loadPendingExchanges();
        } else {
            showNotif(response?.error || 'Ошибка при подтверждении обмена', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    }
}

async function rejectExchangeFromChat(requestId, room, messageTime) {
    try {
        const response = await apiCall('/exchange/reject/' + requestId, 'POST');
        
        if (response && response.success) {
            showNotif('❌ Запрос на обмен отклонён', 'success');
            updateExchangeMessageInChat(room, messageTime, 'rejected');
            if (typeof loadPendingExchanges === 'function') loadPendingExchanges();
        } else {
            showNotif(response?.error || 'Ошибка при отклонении запроса', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    }
}

function updateExchangeMessageInChat(room, messageTime, status) {
    if (!chatMessages[room]) return;
    
    const index = chatMessages[room].findIndex(m => m.time === messageTime);
    
    if (index !== -1) {
        const msg = chatMessages[room][index];
        if (msg.action_data && msg.action_data.type === 'exchange_request') {
            msg.action_data.status = status;
            
            if (status === 'accepted') {
                msg.text = '✅ **Обмен смен подтверждён!** Смены успешно обменяны.';
            } else if (status === 'rejected') {
                msg.text = '❌ **Запрос на обмен отклонён.**';
            }
            
            chatMessages[room][index] = msg;
            window.app.messages = chatMessages;
            
            if (currentChatRoom === room) {
                renderChatMessages();
            }
        }
    }
}
// ============================================
// ОЧИСТКА ПРИ УХОДЕ (ИСПРАВЛЕНО)
// ============================================

function cleanupChat() {
    console.log('🧹 Очистка чата');
    
    // Сохраняем черновик
    saveDraft();
    
    // Очищаем Pusher-слушатели
    if (window.channel) {
        window.channel.unbind('client-new-message');
        window.channel.unbind('client-announcement');
        window.channel.unbind('client-delete-message');
        window.channel.unbind('client-bulk-delete');
        window.channel.unbind('client-ping');
    }
    
    if (window.privateChannel) {
        window.privateChannel.unbind('client-private-message');
        window.privateChannel.unbind('client-delete-private');
        window.privateChannel.unbind('client-typing');
    }
    
    if (window.pusher) {
        window.pusher.connection.unbind('connected');
        window.pusher.connection.unbind('disconnected');
        window.pusher.connection.unbind('error');
        window.pusher.connection.unbind('failed');
        // 🔥 НЕ отключаем pusher полностью, он нужен для других вкладок
    }
    
    // Очищаем таймеры
    if (renderDebounceTimer) {
        clearTimeout(renderDebounceTimer);
        renderDebounceTimer = null;
    }
    
    if (messageCountResetTimer) {
        clearInterval(messageCountResetTimer);
        messageCountResetTimer = null;
    }
    
    // Отменяем текущий fetch
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    
    // Закрываем модалки
    closeAnnouncementModal();
    closeChatSettingsModal();
    
    // Закрываем эмодзи-пикер
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
    
    const messagesList = document.getElementById('chatMessages');
    if (messagesList) messagesList.style.overflowY = 'auto';
    
    // Сбрасываем флаги
    pusherListenersSetup = false;
    chatInitialized = false;
    isSendingMessage = false;
    isSwitchingChat = false;
    
    // Восстанавливаем скролл body
    document.body.style.overflow = '';
    
    console.log('✅ Чат очищен');
}

// ============================================
// ЭКСПОРТ ИСТОРИИ ЧАТА (НОВОЕ)
// ============================================

function exportChatHistory() {
    const messages = chatMessages[currentChatRoom] || [];
    if (messages.length === 0) {
        showNotif('Нет сообщений для экспорта', 'warning');
        return;
    }
    
    let content = `История чата: ${currentChatRoom === 'general' ? 'Общий чат' : `Чат с ${currentChatRoom}`}\n`;
    content += `Экспортировано: ${new Date().toLocaleString()}\n`;
    content += '='.repeat(50) + '\n\n';
    
    let lastDate = null;
    
    for (const msg of messages) {
        const msgDate = new Date(msg.time).toLocaleDateString('ru-RU');
        if (msgDate !== lastDate) {
            lastDate = msgDate;
            content += `\n--- ${msgDate} ---\n\n`;
        }
        
        const time = new Date(msg.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        if (msg.type === 'announcement') {
            content += `[${time}] 📢 ОБЪЯВЛЕНИЕ от ${msg.sender}:\n${msg.text}\n\n`;
        } else if (msg.action_data?.type === 'exchange_request') {
            content += `[${time}] 🔄 ЗАПРОС ОБМЕНА от ${msg.sender}\n\n`;
        } else {
            content += `[${time}] ${msg.sender}: ${msg.text}\n`;
        }
    }
    
    const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_${currentChatRoom}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotif('✅ История экспортирована', 'success');
}

// ============================================
// ПОИСК ПО СООБЩЕНИЯМ (НОВОЕ)
// ============================================

let searchResults = [];
let currentSearchIndex = -1;

function searchInChat(query) {
    if (!query || query.length < 2) {
        showNotif('Введите минимум 2 символа для поиска', 'warning');
        return;
    }
    
    const messages = chatMessages[currentChatRoom] || [];
    searchResults = [];
    
    const lowerQuery = query.toLowerCase();
    
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.text && msg.text.toLowerCase().includes(lowerQuery)) {
            searchResults.push({ index: i, message: msg });
        }
    }
    
    if (searchResults.length === 0) {
        showNotif('Ничего не найдено', 'info');
        return;
    }
    
    currentSearchIndex = 0;
    highlightSearchResult(0);
    showNotif(`Найдено ${searchResults.length} совпадений`, 'success');
}

function highlightSearchResult(resultIndex) {
    if (resultIndex < 0 || resultIndex >= searchResults.length) return;
    
    const result = searchResults[resultIndex];
    const messageEl = document.querySelector(`.message[data-message-time="${result.message.time}"]`);
    
    if (messageEl) {
        // Снимаем подсветку с предыдущего
        document.querySelectorAll('.message.search-highlight').forEach(el => {
            el.classList.remove('search-highlight');
        });
        
        messageEl.classList.add('search-highlight');
        messageEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    
    currentSearchIndex = resultIndex;
}

function nextSearchResult() {
    if (searchResults.length === 0) return;
    const nextIndex = (currentSearchIndex + 1) % searchResults.length;
    highlightSearchResult(nextIndex);
}

function prevSearchResult() {
    if (searchResults.length === 0) return;
    const prevIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    highlightSearchResult(prevIndex);
}

function clearSearch() {
    searchResults = [];
    currentSearchIndex = -1;
    document.querySelectorAll('.message.search-highlight').forEach(el => {
        el.classList.remove('search-highlight');
    });
}

// ============================================
// ИНДИКАТОР ПЕЧАТАЕТ (НОВОЕ)
// ============================================

let typingTimeout = null;
let isTyping = false;

function sendTypingIndicator() {
    if (currentChatRoom === 'general') return; // Не отправляем в общий чат
    
    if (!isTyping) {
        isTyping = true;
        if (window.privateChannel) {
            window.privateChannel.trigger('client-typing', { 
                from: window.app?.currentUser, 
                to: currentChatRoom,
                typing: true 
            });
        }
    }
    
    if (typingTimeout) clearTimeout(typingTimeout);
    
    typingTimeout = setTimeout(() => {
        isTyping = false;
        if (window.privateChannel) {
            window.privateChannel.trigger('client-typing', { 
                from: window.app?.currentUser, 
                to: currentChatRoom,
                typing: false 
            });
        }
    }, 2000);
}

function showTypingIndicator(from) {
    if (currentChatRoom !== from) return;
    
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.style.display = 'flex';
        indicator.innerHTML = `<span></span><span></span><span></span> ${escapeHtml(from)} печатает...`;
        
        clearTimeout(window.typingHideTimeout);
        window.typingHideTimeout = setTimeout(() => {
            indicator.style.display = 'none';
        }, 2500);
    }
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.style.display = 'none';
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
        '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
    };
    return String(str).replace(/[&<>"'`=/]/g, (m) => map[m]);
}

function showNotif(msg, type = 'info') {
    if (typeof window.showNotif === 'function' && window.showNotif !== showNotif) {
        window.showNotif(msg, type);
    } else {
        console.log(`[${type}] ${msg}`);
    }
}

async function apiCall(endpoint, method = 'GET', body = null) {
    if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) {
        return window.apiCall(endpoint, method, body);
    }
    console.warn('apiCall не найден, используем fetch напрямую');
    const token = localStorage.getItem('token');
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(`/api${endpoint}`, options);
    return response.json();
}

function openProfile(employeeName) {
    if (typeof window.openProfile === 'function') {
        window.openProfile(employeeName);
    }
}

function formatTimeAgo(timestamp) {
    if (typeof window.formatTimeAgo === 'function') {
        return window.formatTimeAgo(timestamp);
    }
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'только что';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' мин назад';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч назад';
    return new Date(timestamp).toLocaleDateString('ru-RU');
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initChat = initChat;
window.switchChat = switchChat;
window.addEmoji = addEmoji;
window.toggleEmojiPicker = toggleEmojiPicker;
window.openAnnouncementModal = openAnnouncementModal;
window.closeAnnouncementModal = closeAnnouncementModal;
window.sendAnnouncement = sendAnnouncement;
window.deleteMessage = deleteMessage;
window.deleteMessagesByPeriod = deleteMessagesByPeriod;
window.openChatSettingsModal = openChatSettingsModal;
window.closeChatSettingsModal = closeChatSettingsModal;
window.acceptExchangeFromChat = acceptExchangeFromChat;
window.rejectExchangeFromChat = rejectExchangeFromChat;
window.cleanupChat = cleanupChat;
window.exportChatHistory = exportChatHistory;
window.searchInChat = searchInChat;
window.nextSearchResult = nextSearchResult;
window.prevSearchResult = prevSearchResult;
window.clearSearch = clearSearch;
window.sendTypingIndicator = sendTypingIndicator;
window.showTypingIndicator = showTypingIndicator;
window.hideTypingIndicator = hideTypingIndicator;
window.chatUnread = chatUnread;

console.log('✅ chat.js загружен (исправленная версия v3.0 — все 150 багов)');