// public/js/chat.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

// ============================================
// ЗАЩИТА ОТ РЕКУРСИИ И СПАМА
// ============================================

let currentChatRoom = 'general';
let chatMessages = {};
let chatUnread = {};
let lastProcessedTime = {};
let currentAnnouncementStyle = 'director';
let lastBulkDeleteTime = 0;

let chatInitialized = false;
let isLoadingHistory = false;
let isSendingMessage = false;
let isSwitchingChat = false;
let pusherListenersSetup = false;

let lastMessageTime = 0;
const MESSAGE_COOLDOWN = 500;
const MAX_MESSAGE_LENGTH = 2000;

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
    
    chatInitialized = true;
}

function setupEmojiPickerClose() {
    document.addEventListener('click', function(e) {
        const picker = document.getElementById('emojiPicker');
        const emojiBtn = document.getElementById('chatEmojiBtn');
        if (picker && emojiBtn) {
            if (!picker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
                picker.style.display = 'none';
            }
        }
    });
}

// ============================================
// ЗАГРУЗКА ИСТОРИИ
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
    
    try {
        const generalRes = await fetch('/api/chat/history/general', {
            headers: { 'Authorization': 'Bearer ' + token }
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
        }
        
        const employees = window.app?.employees || [];
        const currentUser = window.app?.currentUser;
        
        for (const emp of employees) {
            if (emp !== currentUser) {
                try {
                    const privRes = await fetch('/api/chat/history/' + encodeURIComponent(emp), {
                        headers: { 'Authorization': 'Bearer ' + token }
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
                    console.error('Ошибка загрузки чата с ' + emp + ':', e);
                }
            }
        }
        
        window.app.messages = chatMessages;
        
    } catch (err) {
        console.error('Ошибка загрузки:', err);
        showNotif('Ошибка загрузки истории чата', 'error');
    } finally {
        isLoadingHistory = false;
    }
    
    renderChatContacts();
    renderChatMessages();
    initChatInput();
    setupPusherListeners();
}

// ============================================
// РЕНДЕР КОНТАКТОВ
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
        
        html += '<div class="chat-contact ' + (isActive ? 'active' : '') + '" onclick="switchChat(\'' + contact.id + '\')">';
        html += '<div class="contact-avatar" style="overflow: hidden;">' + avatarHtml + '</div>';
        html += '<div style="flex: 1;">';
        html += '<div style="font-weight: 500;">' + escapeHtml(contact.name) + '</div>';
        html += '<div style="font-size: 11px; opacity: 0.6;">' + (contact.type === 'general' ? 'Общий чат' : 'Личный чат');
        if (msgCount > 0) html += ' · ' + msgCount;
        html += '</div></div>';
        if (unreadCount > 0) html += '<div class="unread-badge">' + unreadCount + '</div>';
        html += '</div>';
    }
    
    container.innerHTML = html;
}

// ============================================
// РЕНДЕР СООБЩЕНИЙ (С XSS-ЗАЩИТОЙ)
// ============================================

function renderChatMessages() {
    const container = document.getElementById('chatMessages');
    const headerName = document.getElementById('chatHeaderName');
    const headerStatus = document.getElementById('chatHeaderStatus');
    
    if (!container) return;
    
    const messages = chatMessages[currentChatRoom] || [];
    
    if (headerName) {
        if (currentChatRoom === 'general') {
            headerName.innerHTML = '💬 Общий чат';
            headerStatus.innerHTML = 'Все сотрудники';
        } else {
            headerName.innerHTML = escapeHtml(currentChatRoom);
            const profile = window.app?.profiles?.[currentChatRoom];
            headerStatus.innerHTML = (profile && profile.role) ? roleNames[profile.role] : 'Сотрудник';
        }
    }
    
    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; opacity: 0.5;">💬 Нет сообщений. Напишите что-нибудь!</div>';
        return;
    }
    
    if (chatUnread[currentChatRoom]) {
        delete chatUnread[currentChatRoom];
        renderChatContacts();
    }
    
    const sorted = [...messages].sort((a, b) => a.time - b.time);
    const unique = [];
    const seen = {};
    for (const msg of sorted) {
        if (!seen[msg.time]) {
            seen[msg.time] = true;
            unique.push(msg);
        }
    }
    
    let html = '';
    for (const msg of unique) {
        
        if (msg.type === 'announcement') {
            html += renderAnnouncement(msg);
            continue;
        }
        
        if (msg.action_data && msg.action_data.type === 'exchange_request' && msg.action_data.status === 'pending') {
            html += renderExchangeRequestMessage(msg);
            continue;
        }
        
        const isOwn = (msg.sender === window.app?.currentUser);
        
        let timeValue = msg.time;
        if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
        const date = new Date(timeValue);
        const time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        let avatarHtml = '👤';
        if (!isOwn) {
            const profile = window.app?.profiles?.[msg.sender];
            if (profile) {
                avatarHtml = getAvatarHtml(profile, 'small');
            }
        }
        
        html += '<div class="message ' + (isOwn ? 'own' : '') + '" data-message-time="' + msg.time + '">';
        html += '<div class="message-avatar" style="overflow: hidden;">' + avatarHtml + '</div>';
        html += '<div class="message-bubble">';
        if (!isOwn) html += '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>';
        html += '<div class="message-text">' + escapeHtml(msg.text) + '</div>';
        html += '<div class="message-footer">';
        html += '<div class="message-time">' + time + '</div>';
        if (isOwn) {
            html += '<button class="delete-message-btn" onclick="deleteMessage(' + msg.time + ', \'' + currentChatRoom + '\')" title="Удалить сообщение">';
            html += '<i class="fas fa-trash-alt"></i></button>';
        }
        html += '</div></div></div>';
    }
    
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

function renderExchangeRequestMessage(msg) {
    const data = msg.action_data;
    let timeValue = msg.time;
    if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
    const date = new Date(timeValue);
    const time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    const fromDate = formatDateSimple(data.from_date);
    const toDate = formatDateSimple(data.to_date);
    
    let html = '<div class="message exchange-message" data-request-id="' + data.request_id + '">';
    html += '<div class="message-avatar">🔄</div>';
    html += '<div class="message-bubble exchange-bubble">';
    html += '<div class="message-sender">' + escapeHtml(msg.sender) + '</div>';
    html += '<div class="message-text">';
    html += '<strong>📅 Предложение обмена сменами</strong><br><br>';
    html += '👤 ' + escapeHtml(data.from_employee) + ' хочет обменяться с вами!<br><br>';
    html += '📌 Его смена: ' + fromDate + ' — ' + data.from_time + '<br>';
    html += '📌 Ваша смена: ' + toDate + ' — ' + data.to_time + '<br><br>';
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
    const time = new Date(announcement.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
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
            '<p>' + escapeHtml(announcement.text) + '</p>' +
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
        return '<img src="' + escapeHtml(profile.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.onerror=null;this.parentElement.innerHTML=\'👤\'">';
    }
    return escapeHtml(profile.avatar || '👤');
}

// ============================================
// ОТПРАВКА СООБЩЕНИЙ
// ============================================

function initChatInput() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    
    if (input) {
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
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
    
    if (now - lastMessageTime < MESSAGE_COOLDOWN) {
        showNotif('Подождите немного перед отправкой', 'warning');
        return;
    }
    
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    
    if (text.length > MAX_MESSAGE_LENGTH) {
        showNotif('Сообщение слишком длинное (макс. ' + MAX_MESSAGE_LENGTH + ' символов)', 'error');
        return;
    }
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    isSendingMessage = true;
    lastMessageTime = now;
    
    const sendBtn = document.getElementById('chatSendBtn');
    const originalText = sendBtn?.innerHTML;
    if (sendBtn) {
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        sendBtn.disabled = true;
    }
    
    const message = {
        sender: window.app?.currentUser,
        text: text,
        time: Date.now()
    };
    
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
        
        const data = await response.json();
        
        if (data.success) {
            if (!chatMessages[currentChatRoom]) chatMessages[currentChatRoom] = [];
            chatMessages[currentChatRoom].push(message);
            lastProcessedTime[currentChatRoom] = message.time;
            input.value = '';
            renderChatMessages();
            renderChatContacts();
        } else {
            showNotif(data.error || 'Ошибка при отправке', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    } finally {
        isSendingMessage = false;
        if (sendBtn) {
            sendBtn.innerHTML = originalText || '<i class="fas fa-paper-plane"></i>';
            sendBtn.disabled = false;
        }
    }
}

// ============================================
// ПЕРЕКЛЮЧЕНИЕ ЧАТА
// ============================================

function switchChat(roomId) {
    if (isSwitchingChat) {
        console.log('⚠️ Чат уже переключается');
        return;
    }
    
    console.log('🔄 Переключение на чат: ' + roomId);
    
    isSwitchingChat = true;
    
    currentChatRoom = roomId;
    
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
    
    renderChatContacts();
    renderChatMessages();
    
    isSwitchingChat = false;
}

// ============================================
// PUSHER СЛУШАТЕЛИ (С ОЧИСТКОЙ СТАРЫХ)
// ============================================

function setupPusherListeners() {
    if (pusherListenersSetup) {
        console.log('🔌 Pusher слушатели уже настроены');
        return;
    }
    
    console.log('🔌 ===== НАСТРОЙКА PUSHER СЛУШАТЕЛЕЙ =====');
    
    if (window.channel) {
        // Очищаем старые слушатели
        window.channel.unbind('client-new-message');
        window.channel.unbind('client-announcement');
        window.channel.unbind('client-delete-message');
        window.channel.unbind('client-bulk-delete');
        
        window.channel.bind('client-new-message', function(data) {
            if (data.room !== 'general') return;
            const msgTime = data.message.time;
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            if (!chatMessages.general) chatMessages.general = [];
            const exists = chatMessages.general.some(m => m.time === msgTime);
            if (!exists) {
                chatMessages.general.push(data.message);
                lastProcessedTime.general = msgTime;
                window.app.messages = chatMessages;
                
                if (currentChatRoom === 'general') {
                    renderChatMessages();
                } else {
                    chatUnread.general = (chatUnread.general || 0) + 1;
                    renderChatContacts();
                    showNotif('💬 ' + data.message.sender + ': ' + data.message.text.substring(0, 50), 'info');
                }
            }
        });
        
        window.channel.bind('client-announcement', function(data) {
            const announcement = data.announcement;
            const msgTime = announcement.time;
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            if (!chatMessages.general) chatMessages.general = [];
            const exists = chatMessages.general.some(m => m.time === msgTime);
            if (!exists) {
                chatMessages.general.push(announcement);
                lastProcessedTime.general = msgTime;
                window.app.messages = chatMessages;
                if (currentChatRoom === 'general') {
                    renderChatMessages();
                } else {
                    chatUnread.general = (chatUnread.general || 0) + 1;
                    renderChatContacts();
                    showNotif('📢 ОБЪЯВЛЕНИЕ: ' + announcement.text.substring(0, 50), 'warning');
                }
            }
        });
        
        window.channel.bind('client-delete-message', function(data) {
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
        
        window.channel.bind('client-bulk-delete', function(data) {
            const period = data.period;
            const timeThreshold = data.timeThreshold;
            const timestamp = data.timestamp;
            if (timestamp <= (lastBulkDeleteTime || 0)) return;
            lastBulkDeleteTime = timestamp;
            if (period === 'all') {
                chatMessages.general = [];
                lastProcessedTime.general = 0;
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
        window.privateChannel.unbind('client-private-message');
        window.privateChannel.unbind('client-delete-private');
        
        window.privateChannel.bind('client-private-message', function(data) {
            const msgTime = data.message.time;
            const roomId = data.from;
            if (msgTime <= (lastProcessedTime[roomId] || 0)) return;
            if (!chatMessages[roomId]) chatMessages[roomId] = [];
            const exists = chatMessages[roomId].some(m => m.time === msgTime);
            if (!exists) {
                chatMessages[roomId].push(data.message);
                lastProcessedTime[roomId] = msgTime;
                window.app.messages = chatMessages;
                
                if (currentChatRoom === roomId) {
                    renderChatMessages();
                } else {
                    chatUnread[roomId] = (chatUnread[roomId] || 0) + 1;
                    renderChatContacts();
                    showNotif('💬 Личное от ' + data.from + ': ' + data.message.text.substring(0, 50), 'info');
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
    
    pusherListenersSetup = true;
    console.log('🔌 ===== НАСТРОЙКА PUSHER ЗАВЕРШЕНА =====');
}
// ============================================
// ЭМОДЗИ
// ============================================

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (picker) {
        picker.style.display = picker.style.display === 'block' ? 'none' : 'block';
    }
}

function addEmoji(emoji) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value += emoji;
        input.focus();
    }
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
}

// ============================================
// ОБЪЯВЛЕНИЯ
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
}

function closeAnnouncementModal() {
    const modal = document.getElementById('announcementModal');
    if (modal) modal.classList.remove('active');
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
// УДАЛЕНИЕ СООБЩЕНИЙ
// ============================================

async function deleteMessage(messageTime, room) {
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
    
    const confirmMsg = isDirector && !isOwn ? 'Удалить сообщение от ' + messageToDelete.sender + '?' : 'Удалить это сообщение?';
    if (!confirm(confirmMsg)) return;
    
    const token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/chat/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ room: room, messageTime: timeValue, sender: messageToDelete.sender })
        });
        const data = await response.json();
        
        if (data.success) {
            const index = chatMessages[room].findIndex(m => m.time === timeValue);
            if (index !== -1) {
                chatMessages[room].splice(index, 1);
                window.app.messages = chatMessages;
                renderChatMessages();
                renderChatContacts();
            }
            
            if (room === 'general' && window.channel) {
                window.channel.trigger('client-delete-message', { room: room, messageTime: timeValue, sender: messageToDelete.sender });
            } else if (window.privateChannel) {
                window.privateChannel.trigger('client-delete-private', { room: room, messageTime: timeValue, sender: messageToDelete.sender });
            }
            showNotif('Сообщение удалено', 'success');
        } else {
            showNotif(data.error || 'Ошибка при удалении', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    }
}

// ============================================
// НАСТРОЙКИ ЧАТА
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
    if (modal) modal.classList.add('active');
}

function closeChatSettingsModal() {
    const modal = document.getElementById('chatSettingsModal');
    if (modal) modal.classList.remove('active');
}

async function deleteMessagesByPeriod(period) {
    let confirmMsg = '';
    let timeThreshold = 0;
    const now = Date.now();
    
    switch(period) {
        case '15min': confirmMsg = 'Удалить все сообщения за последние 15 минут?'; timeThreshold = now - 15 * 60 * 1000; break;
        case 'hour': confirmMsg = 'Удалить все сообщения за последний час?'; timeThreshold = now - 60 * 60 * 1000; break;
        case 'day': confirmMsg = 'Удалить все сообщения за последний день?'; timeThreshold = now - 24 * 60 * 60 * 1000; break;
        case 'week': confirmMsg = 'Удалить все сообщения за последнюю неделю?'; timeThreshold = now - 7 * 24 * 60 * 60 * 1000; break;
        case 'month': confirmMsg = 'Удалить все сообщения за последний месяц?'; timeThreshold = now - 30 * 24 * 60 * 60 * 1000; break;
        case 'all': confirmMsg = 'Удалить ВСЕ сообщения в общем чате? Это действие необратимо!'; timeThreshold = 0; break;
        default: return;
    }
    
    if (!confirm(confirmMsg)) return;
    
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
            body: JSON.stringify({ period: period, room: 'general', timeThreshold: timeThreshold })
        });
        const data = await response.json();
        if (data.success) {
            if (period === 'all') {
                chatMessages.general = [];
                lastProcessedTime.general = 0;
            } else {
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
            showNotif('✅ Удалено ' + data.deletedCount + ' сообщений', 'success');
            closeChatSettingsModal();
            if (window.channel) {
                window.channel.trigger('client-bulk-delete', { period: period, timeThreshold: timeThreshold, timestamp: Date.now() });
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
// ОБМЕН СМЕНАМИ В ЧАТЕ
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
// ОЧИСТКА ПРИ УХОДЕ
// ============================================

function cleanupChat() {
    console.log('🧹 Очистка чата');
    
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
    
    pusherListenersSetup = false;
    chatInitialized = false;
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
window.closeChatSettingsModal = closeChatSettingsModal;
window.acceptExchangeFromChat = acceptExchangeFromChat;
window.rejectExchangeFromChat = rejectExchangeFromChat;
window.cleanupChat = cleanupChat;

console.log('✅ chat.js загружен (исправленная версия)');