// public/js/chat.js

let currentChatRoom = 'general';
let chatMessages = {};
let chatUnread = {};
let lastProcessedTime = {};
let currentAnnouncementStyle = 'director';
let lastBulkDeleteTime = 0;

function initChat() {
    console.log('💬 Инициализация чата');
    var picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
    loadChatHistory();
    setupEmojiPickerClose();
    initAnnouncementButton();
    initChatSettings();
}

function setupEmojiPickerClose() {
    document.addEventListener('click', function(e) {
        var picker = document.getElementById('emojiPicker');
        var emojiBtn = document.getElementById('chatEmojiBtn');
        if (picker && emojiBtn) {
            if (!picker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
                picker.style.display = 'none';
            }
        }
    });
}

async function loadChatHistory() {
    console.log('📜 Загрузка истории чата...');
    var token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        var generalRes = await fetch('/api/chat/history/general', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (generalRes.ok) {
            var messages = await generalRes.json();
            messages = messages.map(function(msg) {
                if (msg.text && msg.text.startsWith('{') && msg.text.indexOf('"type":"announcement"') !== -1) {
                    try {
                        var parsed = JSON.parse(msg.text);
                        if (parsed.type === 'announcement') return parsed;
                    } catch(e) {}
                }
                return msg;
            });
            chatMessages.general = messages;
            if (chatMessages.general.length > 0) {
                var times = chatMessages.general.map(function(m) { return m.time; });
                lastProcessedTime.general = Math.max.apply(Math, times);
            }
            console.log('📩 Общий чат: ' + chatMessages.general.length + ' сообщений');
        }
        
        var employees = window.app.employees || [];
        var currentUser = window.app.currentUser;
        
        for (var i = 0; i < employees.length; i++) {
            var emp = employees[i];
            if (emp !== currentUser) {
                var privRes = await fetch('/api/chat/history/' + encodeURIComponent(emp), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (privRes.ok) {
                    var privMessages = await privRes.json();
                    if (privMessages.length > 0) {
                        chatMessages[emp] = privMessages;
                        var privTimes = privMessages.map(function(m) { return m.time; });
                        lastProcessedTime[emp] = Math.max.apply(Math, privTimes);
                        console.log('📩 Чат с ' + emp + ': ' + privMessages.length + ' сообщений');
                    }
                }
            }
        }
        
        window.app.messages = chatMessages;
        
    } catch (err) {
        console.error('Ошибка загрузки:', err);
    }
    
    renderChatContacts();
    renderChatMessages();
    initChatInput();
    setupPusherListeners();
}

function renderChatContacts() {
    var container = document.getElementById('chatContacts');
    if (!container) return;
    
    var employees = window.app.employees || [];
    var currentUser = window.app.currentUser;
    
    var contacts = [
        { id: 'general', name: 'Общий чат', icon: '💬', type: 'general' }
    ];
    
    for (var i = 0; i < employees.length; i++) {
        var emp = employees[i];
        if (emp !== currentUser) {
            contacts.push({ id: emp, name: emp, icon: '👤', type: 'private' });
        }
    }
    
    var html = '';
    for (var j = 0; j < contacts.length; j++) {
        var contact = contacts[j];
        var unreadCount = chatUnread[contact.id] || 0;
        var isActive = (currentChatRoom === contact.id);
        var msgCount = (chatMessages[contact.id] ? chatMessages[contact.id].length : 0);
        
        var avatarHtml = contact.icon;
        if (contact.type === 'private') {
            var profile = window.app.profiles[contact.name];
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

function renderChatMessages() {
    var container = document.getElementById('chatMessages');
    var headerName = document.getElementById('chatHeaderName');
    var headerStatus = document.getElementById('chatHeaderStatus');
    
    if (!container) return;
    
    var messages = chatMessages[currentChatRoom] || [];
    
    if (headerName) {
        if (currentChatRoom === 'general') {
            headerName.innerHTML = '💬 Общий чат';
            headerStatus.innerHTML = 'Все сотрудники';
        } else {
            headerName.innerHTML = escapeHtml(currentChatRoom);
            var profile = window.app.profiles[currentChatRoom];
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
    
    var sorted = messages.slice().sort(function(a, b) { return a.time - b.time; });
    var unique = [];
    var seen = {};
    for (var i = 0; i < sorted.length; i++) {
        var msg = sorted[i];
        if (!seen[msg.time]) {
            seen[msg.time] = true;
            unique.push(msg);
        }
    }
    
    var html = '';
    for (var j = 0; j < unique.length; j++) {
        var msg = unique[j];
        
        if (msg.type === 'announcement') {
            html += renderAnnouncement(msg);
            continue;
        }
        
        if (msg.action_data && msg.action_data.type === 'exchange_request' && msg.action_data.status === 'pending') {
            html += renderExchangeRequestMessage(msg);
            continue;
        }
        
        var isOwn = (msg.sender === window.app.currentUser);
        
        var timeValue = msg.time;
        if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
        var date = new Date(timeValue);
        var time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        var avatarHtml = '👤';
        if (!isOwn) {
            var profile = window.app.profiles[msg.sender];
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
    var data = msg.action_data;
    var timeValue = msg.time;
    if (typeof timeValue === 'string') timeValue = parseInt(timeValue);
    var date = new Date(timeValue);
    var time = isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
    var fromDate = formatDateSimple(data.from_date);
    var toDate = formatDateSimple(data.to_date);
    
    var html = '<div class="message exchange-message" data-request-id="' + data.request_id + '">';
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

async function acceptExchangeFromChat(requestId, room, messageTime) {
    try {
        const response = await apiCall('/exchange/accept/' + requestId, 'POST');
        if (response && response.success) {
            showNotif('✅ Обмен смен подтверждён! Смены автоматически обменяны.', 'success');
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
    
    var index = -1;
    for (var i = 0; i < chatMessages[room].length; i++) {
        if (chatMessages[room][i].time === messageTime) {
            index = i;
            break;
        }
    }
    
    if (index !== -1) {
        var msg = chatMessages[room][index];
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

function renderAnnouncement(announcement) {
    var roleIcon = '📢';
    var roleName = 'Объявление';
    
    if (announcement.role === 'director') {
        roleIcon = '👑';
        roleName = 'Директор';
    } else if (announcement.role === 'manager') {
        roleIcon = '📋';
        roleName = 'Управляющий';
    }
    
    var styleClass = 'announcement-' + announcement.style;
    var time = new Date(announcement.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    
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

function initChatInput() {
    var input = document.getElementById('chatInput');
    var sendBtn = document.getElementById('chatSendBtn');
    
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
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text) return;
    
    var token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    var message = {
        sender: window.app.currentUser,
        text: text,
        time: Date.now()
    };
    
    try {
        var response;
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
        
        var data = await response.json();
        
        if (data.success) {
            if (!chatMessages[currentChatRoom]) chatMessages[currentChatRoom] = [];
            chatMessages[currentChatRoom].push(message);
            lastProcessedTime[currentChatRoom] = message.time;
            input.value = '';
            renderChatMessages();
            renderChatContacts();
        } else {
            showNotif('Ошибка при отправке', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    }
}

function switchChat(roomId) {
    console.log('🔄 Переключение на чат: ' + roomId);
    currentChatRoom = roomId;
    
    var picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
    
    var announcementBtn = document.getElementById('announcementBtn');
    if (announcementBtn) {
        if (roomId === 'general') {
            var role = window.app.currentUserRole;
            announcementBtn.style.display = (role === 'director' || role === 'manager') ? 'flex' : 'none';
        } else {
            announcementBtn.style.display = 'none';
        }
    }
    
    var settingsBtn = document.getElementById('chatSettingsBtn');
    if (settingsBtn) {
        if (roomId === 'general' && window.app.currentUserRole === 'director') {
            settingsBtn.style.display = 'flex';
        } else {
            settingsBtn.style.display = 'none';
        }
    }
    
    renderChatContacts();
    renderChatMessages();
}

function setupPusherListeners() {
    console.log('🔌 ===== НАСТРОЙКА PUSHER СЛУШАТЕЛЕЙ =====');
    
    if (window.channel) {
        console.log('✅ Настраиваем ОБЩИЙ канал');
        
        window.channel.unbind('client-new-message');
        window.channel.bind('client-new-message', function(data) {
            if (data.room !== 'general') return;
            var msgTime = data.message.time;
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            if (!chatMessages.general) chatMessages.general = [];
            var exists = chatMessages.general.some(function(m) { return m.time === msgTime; });
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
        
        window.channel.unbind('client-announcement');
        window.channel.bind('client-announcement', function(data) {
            var announcement = data.announcement;
            var msgTime = announcement.time;
            if (msgTime <= (lastProcessedTime.general || 0)) return;
            if (!chatMessages.general) chatMessages.general = [];
            var exists = chatMessages.general.some(function(m) { return m.time === msgTime; });
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
        
        window.channel.unbind('client-delete-message');
        window.channel.bind('client-delete-message', function(data) {
            console.log('🗑️ Удаление сообщения:', data);
            var room = data.room;
            var messageTime = data.messageTime;
            if (chatMessages[room]) {
                var index = chatMessages[room].findIndex(function(m) { return m.time === messageTime; });
                if (index !== -1) {
                    chatMessages[room].splice(index, 1);
                    renderChatMessages();
                    renderChatContacts();
                }
            }
        });
        
        window.channel.unbind('client-bulk-delete');
        window.channel.bind('client-bulk-delete', function(data) {
            console.log('🗑️ Массовое удаление:', data);
            var period = data.period;
            var timeThreshold = data.timeThreshold;
            var timestamp = data.timestamp;
            if (timestamp <= (lastBulkDeleteTime || 0)) return;
            lastBulkDeleteTime = timestamp;
            if (period === 'all') {
                chatMessages.general = [];
                lastProcessedTime.general = 0;
            } else if (timeThreshold) {
                var oldMessages = chatMessages.general || [];
                chatMessages.general = oldMessages.filter(function(msg) { return msg.time < timeThreshold; });
                if (chatMessages.general.length === 0) {
                    lastProcessedTime.general = 0;
                } else {
                    var times = chatMessages.general.map(function(m) { return m.time; });
                    lastProcessedTime.general = Math.max.apply(Math, times);
                }
            }
            window.app.messages = chatMessages;
            if (currentChatRoom === 'general') renderChatMessages();
            showNotif('📋 Сообщения в общем чате обновлены', 'info');
        });
    }
    
    if (window.privateChannel) {
        console.log('✅ Настраиваем ЛИЧНЫЙ канал');
        window.privateChannel.unbind('client-private-message');
        window.privateChannel.bind('client-private-message', function(data) {
            console.log('📨 Личное сообщение получено:', data);
            var msgTime = data.message.time;
            var roomId = data.from;
            if (msgTime <= (lastProcessedTime[roomId] || 0)) return;
            if (!chatMessages[roomId]) chatMessages[roomId] = [];
            var exists = chatMessages[roomId].some(function(m) { return m.time === msgTime; });
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
        
        window.privateChannel.unbind('client-delete-private');
        window.privateChannel.bind('client-delete-private', function(data) {
            console.log('🗑️ Удаление личного сообщения:', data);
            var room = data.room;
            var messageTime = data.messageTime;
            if (chatMessages[room]) {
                var index = chatMessages[room].findIndex(function(m) { return m.time === messageTime; });
                if (index !== -1) {
                    chatMessages[room].splice(index, 1);
                    renderChatMessages();
                    renderChatContacts();
                }
            }
        });
    }
    
    console.log('🔌 ===== НАСТРОЙКА PUSHER ЗАВЕРШЕНА =====');
}

function toggleEmojiPicker() {
    var picker = document.getElementById('emojiPicker');
    if (picker) {
        picker.style.display = picker.style.display === 'block' ? 'none' : 'block';
    }
}

function addEmoji(emoji) {
    var input = document.getElementById('chatInput');
    if (input) {
        input.value += emoji;
        input.focus();
    }
    var picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
}

function initAnnouncementButton() {
    var btn = document.getElementById('announcementBtn');
    if (!btn) return;
    var role = window.app.currentUserRole;
    if (role === 'director' || role === 'manager') {
        btn.style.display = 'flex';
        btn.onclick = function() { openAnnouncementModal(); };
    } else {
        btn.style.display = 'none';
    }
}

function openAnnouncementModal() {
    var modal = document.getElementById('announcementModal');
    if (!modal) return;
    modal.classList.add('active');
    
    var role = window.app.currentUserRole;
    var styleOptions = document.querySelectorAll('.style-option');
    
    for (var i = 0; i < styleOptions.length; i++) {
        var opt = styleOptions[i];
        var style = opt.dataset.style;
        
        if (role === 'director') {
            if (style === 'manager') {
                opt.style.display = 'none';
            } else {
                opt.style.display = 'inline-flex';
            }
        } else if (role === 'manager') {
            if (style === 'director') {
                opt.style.display = 'none';
            } else {
                opt.style.display = 'inline-flex';
            }
        } else {
            opt.style.display = 'none';
        }
    }
    
    var defaultStyle = '';
    if (role === 'director') {
        defaultStyle = 'director';
    } else if (role === 'manager') {
        defaultStyle = 'manager';
    }
    
    for (var j = 0; j < styleOptions.length; j++) {
        var opt2 = styleOptions[j];
        opt2.classList.remove('active');
        if (opt2.dataset.style === defaultStyle) {
            opt2.classList.add('active');
            currentAnnouncementStyle = defaultStyle;
        }
    }
    
    if (!defaultStyle) {
        for (var k = 0; k < styleOptions.length; k++) {
            var opt3 = styleOptions[k];
            if (opt3.style.display !== 'none') {
                opt3.classList.add('active');
                currentAnnouncementStyle = opt3.dataset.style;
                break;
            }
        }
    }
}

function closeAnnouncementModal() {
    document.getElementById('announcementModal').classList.remove('active');
    document.getElementById('announcementText').value = '';
}

async function sendAnnouncement() {
    var text = document.getElementById('announcementText').value.trim();
    if (!text) {
        showNotif('Введите текст объявления', 'error');
        return;
    }
    var token = localStorage.getItem('token');
    if (!token) return;
    var announcement = {
        type: 'announcement',
        style: currentAnnouncementStyle,
        sender: window.app.currentUser,
        role: window.app.currentUserRole,
        text: text,
        time: Date.now()
    };
    try {
        var response = await fetch('/api/chat/announcement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ announcement: announcement })
        });
        var data = await response.json();
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
            showNotif('Ошибка при отправке', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
    }
}

async function deleteMessage(messageTime, room) {
    console.log('🗑️ deleteMessage вызван: time=' + messageTime + ', room=' + room);
    
    var timeValue = typeof messageTime === 'string' ? parseInt(messageTime) : messageTime;
    var messages = chatMessages[room] || [];
    var messageToDelete = null;
    
    for (var i = 0; i < messages.length; i++) {
        if (messages[i].time === timeValue) {
            messageToDelete = messages[i];
            break;
        }
    }
    
    if (!messageToDelete) {
        showNotif('Сообщение не найдено', 'error');
        return;
    }
    
    var isOwn = (messageToDelete.sender === window.app.currentUser);
    var isDirector = (window.app.currentUserRole === 'director');
    
    if (!isOwn && !isDirector) {
        showNotif('Можно удалять только свои сообщения', 'error');
        return;
    }
    
    var confirmMsg = isDirector && !isOwn ? 'Удалить сообщение от ' + messageToDelete.sender + '?' : 'Удалить это сообщение?';
    if (!confirm(confirmMsg)) return;
    
    var token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    try {
        var response = await fetch('/api/chat/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ room: room, messageTime: timeValue, sender: messageToDelete.sender })
        });
        var data = await response.json();
        
        if (data.success) {
            var index = -1;
            for (var j = 0; j < chatMessages[room].length; j++) {
                if (chatMessages[room][j].time === timeValue) {
                    index = j;
                    break;
                }
            }
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

function initChatSettings() {
    var settingsBtn = document.getElementById('chatSettingsBtn');
    if (!settingsBtn) return;
    if (window.app.currentUserRole === 'director') {
        settingsBtn.style.display = 'flex';
        settingsBtn.onclick = function() { openChatSettingsModal(); };
        console.log('⚙️ Кнопка настроек чата добавлена для директора');
    } else {
        settingsBtn.style.display = 'none';
    }
}

function openChatSettingsModal() {
    document.getElementById('chatSettingsModal').classList.add('active');
}

function closeChatSettingsModal() {
    document.getElementById('chatSettingsModal').classList.remove('active');
}

async function deleteMessagesByPeriod(period) {
    var confirmMsg = '';
    var timeThreshold = 0;
    var now = Date.now();
    
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
    
    var token = localStorage.getItem('token');
    if (!token) {
        showNotif('Ошибка: не авторизован', 'error');
        return;
    }
    
    showNotif('⏳ Удаление сообщений...', 'info');
    
    try {
        var response = await fetch('/api/chat/delete-bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ period: period, room: 'general', timeThreshold: timeThreshold })
        });
        var data = await response.json();
        if (data.success) {
            if (period === 'all') {
                chatMessages.general = [];
                lastProcessedTime.general = 0;
            } else {
                var oldMessages = chatMessages.general || [];
                chatMessages.general = oldMessages.filter(function(msg) { return msg.time < timeThreshold; });
                if (chatMessages.general.length === 0) {
                    lastProcessedTime.general = 0;
                } else {
                    var times = chatMessages.general.map(function(m) { return m.time; });
                    lastProcessedTime.general = Math.max.apply(Math, times);
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

function formatDateSimple(dateStr) {
    if (!dateStr) return '—';
    var parts = dateStr.split('-');
    var day = parseInt(parts[2]);
    var month = parseInt(parts[1]);
    var monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return day + ' ' + monthNames[month - 1];
}

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