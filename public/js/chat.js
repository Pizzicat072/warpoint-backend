// public/js/chat.js — WARPOINT CHAT v9.0 ULTIMATE
// Полностью совместим с chat.html v9.0

(function() {
    'use strict';

    // ============================================
    // КОНФИГ
    // ============================================
    var CONFIG = {
        MSG_COOLDOWN: 500,
        MAX_LENGTH: 2000,
        MAX_PER_MIN: 30,
        DEBOUNCE: 100,
        MAX_VISIBLE: 500,
        TYPING_TIMEOUT: 2000,
        TYPING_SHOW: 2500
    };

    // ============================================
    // СОСТОЯНИЕ
    // ============================================
    var currentRoom = 'general';
    var messages = {};
    var unread = {};
    var lastTime = {};
    var deletedUntil = {};
    var announceStyle = 'director';
    var lastBulk = 0;

    var initialized = false;
    var loadingHist = false;
    var sending = false;
    var switching = false;
    var pusherReady = false;

    var lastMsgTime = 0;
    var msgPerMin = 0;
    var msgTimer = null;

    var abortCtrl = null;
    var pending = [];
    var processing = false;

    var renderTimer = null;
    var typingTimer = null;
    var typing = false;

    window.chatUnread = unread;
    window.chatCurrentRoom = currentRoom;

    // Восстановление
    var saved = sessionStorage.getItem('chatRoom');
    if (saved) currentRoom = saved;

    // ============================================
    // СБРОС
    // ============================================
    function resetState() {
        initialized = false;
        pusherReady = false;
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
        if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
        if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    }

    // ============================================
    // ХЕЛПЕРЫ
    // ============================================
    function esc(str) {
        if (!str && str !== 0) return '';
        str = String(str);
        var m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return str.replace(/[&<>"']/g, function(c) { return m[c]; });
    }

    function notify(msg, type) {
        if (typeof window.showSystemNotification === 'function') window.showSystemNotification(msg, type);
        else if (typeof window.showNotif === 'function') window.showNotif(msg, type);
    }

    function toNum(ts) {
        if (ts === null || ts === undefined) return Date.now();
        if (typeof ts === 'string') ts = parseInt(ts, 10);
        if (isNaN(ts) || ts <= 0) return Date.now();
        return ts;
    }

    function fmtTime(ts) {
        var d = new Date(toNum(ts));
        if (isNaN(d.getTime())) return '--:--';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function fmtAgo(ts) {
        var t = toNum(ts);
        var diff = Date.now() - t;
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' мин';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч';
        return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }

    function fmtDateHeader(ts) {
        var d = new Date(toNum(ts));
        if (isNaN(d.getTime())) return '—';
        var now = new Date();
        var yes = new Date(now); yes.setDate(yes.getDate() - 1);
        if (d.toDateString() === now.toDateString()) return 'Сегодня';
        if (d.toDateString() === yes.toDateString()) return 'Вчера';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    }

    function fmtDateSimple(str) {
        if (!str) return '—';
        var p = str.split('-');
        if (p.length !== 3) return str;
        var m = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
        return parseInt(p[2]) + ' ' + m[parseInt(p[1]) - 1];
    }

    function avatarHTML(profile) {
        if (!profile) return '<span style="font-size:18px;">👤</span>';
        if (profile.avatar_url) return '<img src="' + esc(profile.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
        return esc(profile.avatar || '👤');
    }

    function initials(name) {
        if (!name) return '?';
        return name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
    }

    function roleName(role) {
        var n = { director: 'Директор', manager: 'Управляющий', admin: 'Админ', operator: 'Оператор' };
        return n[role] || 'Сотрудник';
    }

    // ============================================
    // API
    // ============================================
    async function api(endpoint, method, body) {
        if (!method) method = 'GET';
        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        if (body) opts.body = JSON.stringify(body);
        try {
            var res = await fetch('/api' + endpoint, opts);
            return await res.json();
        } catch(e) {
            return { success: false, error: e.message };
        }
    }
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initChat() {
        if (initialized) {
            renderMessages();
            renderContacts();
            return;
        }
        var c = document.getElementById('chatMessages');
        if (!c) { setTimeout(initChat, 100); return; }
        initialized = true;
        loadHistory();
        setupPusher();
        initComposer();
        setupOffline();
        setupRateLimit();
        initAnnounceBtn();
        initSettingsBtn();
        showChatPanel();
        switchChat('general', true);
    }

    function setupOffline() {
        window.addEventListener('online', function() {
            notify('📡 Соединение восстановлено', 'success');
            var b = document.getElementById('offlineBanner');
            if (b) b.style.display = 'none';
            processPending();
            loadRecent();
        });
        window.addEventListener('offline', function() {
            var b = document.getElementById('offlineBanner');
            if (b) b.style.display = 'flex';
        });
    }

    function setupRateLimit() {
        msgTimer = setInterval(function() { msgPerMin = 0; }, 60000);
    }

    function initAnnounceBtn() {
        var btn = document.getElementById('announcementBtn');
        if (btn && window.app) {
            var r = window.app.currentUserRole;
            btn.style.display = (r === 'director' || r === 'manager') ? 'flex' : 'none';
        }
    }

    function initSettingsBtn() {
        var btn = document.getElementById('chatSettingsBtn');
        if (btn && window.app && window.app.currentUserRole === 'director') {
            btn.style.display = 'flex';
        }
    }

    function showChatPanel() {
        if (typeof window.showChatPanel === 'function') window.showChatPanel();
    }

    // ============================================
    // ЗАГРУЗКА ИСТОРИИ
    // ============================================
    async function loadHistory() {
        if (loadingHist) return;
        var token = localStorage.getItem('token');
        if (!token) return;
        loadingHist = true;
        if (abortCtrl) abortCtrl.abort();
        abortCtrl = new AbortController();

        try {
            var res = await fetch('/api/chat/history/general', {
                headers: { 'Authorization': 'Bearer ' + token },
                signal: abortCtrl.signal
            });
            if (res.ok) {
                var data = await res.json();
                messages.general = data.map(function(m) {
                    if (m.text && m.text.indexOf('"type":"announcement"') !== -1) {
                        try { var p = JSON.parse(m.text); if (p.type === 'announcement') return p; } catch(e) {}
                    }
                    return m;
                });
                if (messages.general.length > 0) {
                    var ts = messages.general.map(function(m) { return toNum(m.time); });
                    lastTime.general = Math.max.apply(null, ts);
                }
            }

            var emps = (window.app && window.app.employees) ? window.app.employees : [];
            var me = window.app ? window.app.currentUser : null;
            for (var i = 0; i < emps.length; i++) {
                if (emps[i] === me) continue;
                try {
                    var pr = await fetch('/api/chat/history/' + encodeURIComponent(emps[i]), {
                        headers: { 'Authorization': 'Bearer ' + token },
                        signal: abortCtrl.signal
                    });
                    if (pr.ok) {
                        var pd = await pr.json();
                        if (pd.length > 0) {
                            messages[emps[i]] = pd;
                            var pts = pd.map(function(m) { return toNum(m.time); });
                            lastTime[emps[i]] = Math.max.apply(null, pts);
                        }
                    }
                } catch(e) {}
            }
            window.app.messages = messages;
        } catch(e) {
            if (e.name !== 'AbortError') console.error(e);
        } finally {
            loadingHist = false;
            abortCtrl = null;
        }
        renderContacts();
        renderMessages();
    }

    async function loadRoomHistory(roomId) {
        if (roomId === 'general' || messages[roomId]) return;
        var token = localStorage.getItem('token');
        if (!token) return;
        try {
            var res = await fetch('/api/chat/history/' + encodeURIComponent(roomId), {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
                var data = await res.json();
                messages[roomId] = data;
                if (data.length > 0) {
                    var ts = data.map(function(m) { return toNum(m.time); });
                    lastTime[roomId] = Math.max.apply(null, ts);
                }
            }
        } catch(e) {}
    }

    async function loadRecent() {
        var rooms = Object.keys(messages);
        var token = localStorage.getItem('token');
        for (var i = 0; i < rooms.length; i++) {
            var room = rooms[i];
            try {
                var res = await fetch('/api/chat/history/' + encodeURIComponent(room) + '?after=' + (lastTime[room] || 0), {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    var data = await res.json();
                    for (var j = 0; j < data.length; j++) {
                        var dup = false;
                        if (!messages[room]) messages[room] = [];
                        for (var k = 0; k < messages[room].length; k++) {
                            if (toNum(messages[room][k].time) === toNum(data[j].time) && messages[room][k].sender === data[j].sender) {
                                dup = true; break;
                            }
                        }
                        if (!dup) { messages[room].push(data[j]); lastTime[room] = Math.max(lastTime[room] || 0, toNum(data[j].time)); }
                    }
                }
            } catch(e) {}
        }
        renderMessages();
        renderContacts();
    }

    // ============================================
    // РЕНДЕР КОНТАКТОВ
    // ============================================
    function renderContacts() {
        var c = document.getElementById('chatContacts');
        if (!c) return;
        var emps = (window.app && window.app.employees) ? window.app.employees : [];
        var me = window.app ? window.app.currentUser : null;
        var contacts = [{ id: 'general', name: 'Общий чат', type: 'general' }];
        for (var i = 0; i < emps.length; i++) {
            if (emps[i] !== me) contacts.push({ id: emps[i], name: emps[i], type: 'private' });
        }
        contacts.sort(function(a, b) {
            if (a.id === 'general') return -1;
            if (b.id === 'general') return 1;
            var am = messages[a.id] || [], bm = messages[b.id] || [];
            return toNum(bm.length ? bm[bm.length-1].time : 0) - toNum(am.length ? am[am.length-1].time : 0);
        });

        var html = '';
        for (var j = 0; j < contacts.length; j++) {
            var ct = contacts[j];
            var un = unread[ct.id] || 0;
            var active = currentRoom === ct.id;
            var cnt = messages[ct.id] ? messages[ct.id].length : 0;
            var lastMsg = cnt > 0 ? messages[ct.id][cnt-1] : null;
            var preview = lastMsg ? esc((lastMsg.text || '').substring(0, 40)) : 'Нет сообщений';
            var avatarClass = ct.type === 'general' ? 'msg-dialog-avatar-general' : 'msg-dialog-avatar-private';

            html += '<div class="msg-dialog-item' + (active ? ' active' : '') + '" onclick="switchChat(\'' + esc(ct.id) + '\')">';
            html += '<div class="msg-dialog-avatar ' + avatarClass + '">';
            if (ct.type === 'private') {
                var prof = (window.app && window.app.profiles) ? window.app.profiles[ct.name] : null;
                html += avatarHTML(prof);
            } else { html += '<i class="fas fa-users"></i>'; }
            html += '</div>';
            html += '<div class="msg-dialog-content">';
            html += '<div class="msg-dialog-top"><span class="msg-dialog-name">' + esc(ct.name) + '</span>';
            if (lastMsg) html += '<span class="msg-dialog-time">' + fmtAgo(lastMsg.time) + '</span>';
            html += '</div>';
            html += '<div class="msg-dialog-bottom"><span class="msg-dialog-preview">' + preview + '</span>';
            if (un > 0) html += '<span class="msg-dialog-badge">' + (un > 99 ? '99+' : un) + '</span>';
            html += '</div></div></div>';
        }
        c.innerHTML = html || '<div class="msg-empty">Нет диалогов</div>';
    }
    // ============================================
    // РЕНДЕР СООБЩЕНИЙ
    // ============================================
    function debounceRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(function() { renderMessages(); renderTimer = null; }, CONFIG.DEBOUNCE);
    }

    function renderMessages() {
        var container = document.getElementById('chatMessages');
        if (!container) return;
        updateChatHeader();
        updatePageTitle();

        var msgs = messages[currentRoom] || [];
        if (msgs.length === 0) {
            container.innerHTML = '<div class="msg-empty-chat-state"><div class="msg-empty-chat-icon">💬</div><h3>Нет сообщений</h3><p>Напишите первое сообщение</p></div>';
            return;
        }

        if (unread[currentRoom]) { delete unread[currentRoom]; window.chatUnread = unread; renderContacts(); }

        // Фильтрация
        var filtered = msgs.filter(function(m) { return !m.deleted; });
        filtered.sort(function(a, b) { return toNum(a.time) - toNum(b.time); });

        // Уникальность
        var unique = [];
        var seen = {};
        for (var i = 0; i < filtered.length; i++) {
            var key = toNum(filtered[i].time) + '_' + filtered[i].sender;
            if (!seen[key]) { seen[key] = true; unique.push(filtered[i]); }
        }
        if (unique.length > CONFIG.MAX_VISIBLE) {
            messages[currentRoom] = unique.slice(-CONFIG.MAX_VISIBLE);
            unique = messages[currentRoom];
        }

        var html = '';
        var lastDate = null;
        var me = window.app ? window.app.currentUser : null;

        for (var j = 0; j < unique.length; j++) {
            var msg = unique[j];
            var msgTime = toNum(msg.time);
            var dateStr = new Date(msgTime).toDateString();
            if (dateStr !== lastDate) {
                lastDate = dateStr;
                html += '<div class="msg-date-divider"><span>' + fmtDateHeader(msgTime) + '</span></div>';
            }

            // Объявление
            if (msg.type === 'announcement') {
                html += renderAnnouncement(msg);
                continue;
            }

            // Обмен
            if (msg.action_data && msg.action_data.type === 'exchange_request' && msg.action_data.status === 'pending') {
                html += renderExchange(msg);
                continue;
            }

            var own = msg.sender === me;
            var cls = 'msg-message' + (own ? ' own' : '');
            var timeStr = fmtTime(msgTime);
            var fullTime = new Date(msgTime).toLocaleString();

            // Аватар (только для чужих)
            var avHtml = '';
            if (!own) {
                var senderProf = (window.app && window.app.profiles) ? window.app.profiles[msg.sender] : null;
                avHtml = '<div class="msg-message-avatar" style="background:linear-gradient(135deg,#6366f1,#ec4899);">' + avatarHTML(senderProf) + '</div>';
            }

            var bubbleContent = '';
            // Проверка на голосовое
            if (msg.voice_url || msg.type === 'voice') {
                bubbleContent = renderVoiceBubble(msg, own);
            } else {
                if (!own) bubbleContent += '<div class="msg-message-sender">' + esc(msg.sender) + '</div>';
                bubbleContent += '<div class="msg-message-text">' + esc(msg.text || '') + '</div>';
            }

            html += '<div class="' + cls + '" data-msg-time="' + msgTime + '">';
            html += avHtml;
            html += '<div class="msg-message-body">';
            html += '<div class="msg-message-bubble' + (msg.type === 'voice' ? ' voice-message' : '') + '">';
            html += bubbleContent;
            html += '</div>';
            html += '<div class="msg-message-footer">';
            html += '<span class="msg-message-time" title="' + fullTime + '">' + timeStr + '</span>';
            if (own) {
                html += '<span class="msg-message-status read">✓✓</span>';
                html += '<button class="msg-message-delete" onclick="deleteMessage(\'' + msgTime + '\',\'' + currentRoom + '\')" title="Удалить"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '</div></div></div>';
        }

        container.innerHTML = html;
        scrollToBottom();
    }

    function renderVoiceBubble(msg, own) {
        var dur = msg.voice_duration || 0;
        var mins = Math.floor(dur / 60);
        var secs = dur % 60;
        var durStr = mins + ':' + (secs < 10 ? '0' : '') + secs;
        var bars = '';
        for (var i = 0; i < 20; i++) {
            var h = Math.floor(Math.random() * 20 + 8);
            bars += '<div class="msg-voice-waveform-bar" style="height:' + h + 'px;"></div>';
        }
        return '<div class="msg-voice-play-btn" onclick="playVoiceMessage(\'' + msg.id + '\')"><i class="fas fa-play"></i></div>' +
               '<div class="msg-voice-waveform">' + bars + '</div>' +
               '<span class="msg-voice-duration">' + durStr + '</span>';
    }

    function renderAnnouncement(msg) {
        var style = msg.style || 'director';
        var icon = '📢', role = 'Объявление';
        if (msg.role === 'director') { icon = '👑'; role = 'Директор'; }
        else if (msg.role === 'manager') { icon = '📋'; role = 'Управляющий'; }
        return '<div class="msg-announcement ' + style + '">' +
            '<div class="msg-announcement-header">' +
                '<div class="msg-announcement-role">' + icon + ' ' + esc(msg.sender) + ' · ' + role + '</div>' +
                '<div class="msg-announcement-time">' + fmtTime(msg.time) + '</div>' +
            '</div>' +
            '<div class="msg-announcement-body">' + esc(msg.text || '') + '</div>' +
        '</div>';
    }

    function renderExchange(msg) {
        var d = msg.action_data;
        return '<div class="msg-exchange-request">' +
            '<div class="msg-exchange-request-title">🔄 ' + esc(d.from_employee) + ' предлагает обмен</div>' +
            '<div class="msg-exchange-request-details">' +
                '📌 Смена: ' + fmtDateSimple(d.from_date) + ' ' + esc(d.from_time || '') + ' → ' + fmtDateSimple(d.to_date) + ' ' + esc(d.to_time || '') +
            '</div>' +
            '<div class="msg-exchange-actions">' +
                '<button class="msg-exchange-accept" onclick="acceptExchange(' + d.request_id + ')">✅ Принять</button>' +
                '<button class="msg-exchange-reject" onclick="rejectExchange(' + d.request_id + ')">❌ Отклонить</button>' +
            '</div>' +
        '</div>';
    }

    function updateChatHeader() {
        var nameEl = document.getElementById('chatHeaderName');
        var statusEl = document.getElementById('chatHeaderStatus');
        var avatarEl = document.getElementById('chatHeaderAvatar');
        var membersEl = document.getElementById('chatHeaderMembers');

        if (!nameEl) return;

        if (currentRoom === 'general') {
            nameEl.textContent = 'Общий чат';
            if (statusEl) statusEl.textContent = 'Все сотрудники';
            if (avatarEl) avatarEl.innerHTML = '<i class="fas fa-users" style="font-size:20px;"></i>';
            if (membersEl) membersEl.textContent = (window.app && window.app.employees) ? window.app.employees.length + ' участников' : '';
        } else {
            nameEl.textContent = currentRoom;
            var prof = (window.app && window.app.profiles) ? window.app.profiles[currentRoom] : null;
            if (statusEl) statusEl.textContent = prof ? roleName(prof.role) : 'Сотрудник';
            if (avatarEl) avatarEl.innerHTML = avatarHTML(prof);
            if (membersEl) membersEl.textContent = '';
        }
    }

    function updatePageTitle() {
        var total = 0;
        Object.keys(unread).forEach(function(k) { total += unread[k] || 0; });
        document.title = total > 0 ? '(' + total + ') WARPOINT' : 'WARPOINT — Чат';
    }

    function scrollToBottom() {
        var scroll = document.getElementById('msgMessagesScroll');
        if (scroll) setTimeout(function() { scroll.scrollTop = scroll.scrollHeight; }, 80);
    }

    // ============================================
    // ПЕРЕКЛЮЧЕНИЕ ЧАТА
    // ============================================
    async function switchChat(roomId, silent) {
        if (switching || currentRoom === roomId) return;
        if (roomId && roomId !== 'general') {
            var emps = (window.app && window.app.employees) ? window.app.employees : [];
            if (emps.indexOf(roomId) === -1) return;
        }

        switching = true;
        if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }

        currentRoom = roomId || 'general';
        sessionStorage.setItem('chatRoom', currentRoom);
        window.chatCurrentRoom = currentRoom;

        if (!messages[currentRoom] && currentRoom !== 'general') await loadRoomHistory(currentRoom);

        renderContacts();
        renderMessages();
        showChatPanel();

        if (window.innerWidth > 768) {
            var input = document.getElementById('chatInput');
            if (input) setTimeout(function() { input.focus(); }, 150);
        }

        switching = false;
    }
    // ============================================
    // КОМПОЗЕР (ПОЛЕ ВВОДА)
    // ============================================
    function initComposer() {
        var input = document.getElementById('chatInput');
        var sendBtn = document.getElementById('chatSendBtn');
        var charCount = document.getElementById('charCount');

        if (input) {
            input.addEventListener('input', function() {
                if (sendBtn) sendBtn.disabled = !this.value.trim();
                if (charCount) {
                    charCount.textContent = this.value.length + ' / ' + CONFIG.MAX_LENGTH;
                    charCount.style.color = this.value.length > CONFIG.MAX_LENGTH * 0.9 ? '#ef4444' : '';
                }
                autoResize(this);
            });
        }
        if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    }

    function autoResize(ta) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }

    async function sendMessage() {
        if (sending) return;
        var now = Date.now();
        if (now - lastMsgTime < CONFIG.MSG_COOLDOWN) return;
        if (msgPerMin >= CONFIG.MAX_PER_MIN) { notify('⚠️ Слишком много сообщений', 'warning'); return; }

        var input = document.getElementById('chatInput');
        var text = input ? input.value.trim() : '';
        if (!text || text.length > CONFIG.MAX_LENGTH) return;

        var token = localStorage.getItem('token');
        if (!token) return;
        if (!window.app || !window.app.currentUser) return;

        sending = true; lastMsgTime = now; msgPerMin++;
        var btn = document.getElementById('chatSendBtn');
        if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; }

        var msg = { sender: window.app.currentUser, text: text, time: Date.now() };

        try {
            if (currentRoom === 'general') {
                await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ room: 'general', message: msg })
                });
            } else {
                await fetch('/api/chat/private', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ to: currentRoom, message: msg })
                });
            }
            if (!messages[currentRoom]) messages[currentRoom] = [];
            messages[currentRoom].push(msg);
            lastTime[currentRoom] = msg.time;
            window.app.messages = messages;
            input.value = '';
            autoResize(input);
            renderMessages();
            renderContacts();
        } catch(e) { console.error(e); } finally {
            sending = false;
            if (btn) { btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; btn.disabled = false; }
        }
    }

    // ============================================
    // ГОЛОСОВЫЕ СООБЩЕНИЯ
    // ============================================
    async function sendVoiceMessage(blob, duration) {
        var token = localStorage.getItem('token');
        if (!token) return;
        var reader = new FileReader();
        reader.onload = async function() {
            var msg = {
                sender: window.app.currentUser,
                type: 'voice',
                text: '🎤 Голосовое сообщение',
                voice_data: reader.result,
                voice_duration: duration,
                time: Date.now()
            };
            try {
                if (currentRoom === 'general') {
                    await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ room: 'general', message: msg })
                    });
                } else {
                    await fetch('/api/chat/private', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ to: currentRoom, message: msg })
                    });
                }
                if (!messages[currentRoom]) messages[currentRoom] = [];
                messages[currentRoom].push(msg);
                lastTime[currentRoom] = msg.time;
                window.app.messages = messages;
                renderMessages();
                renderContacts();
            } catch(e) {}
        };
        reader.readAsDataURL(blob);
    }

    function playVoiceMessage(msgId) {
        var msg = null;
        var msgs = messages[currentRoom] || [];
        for (var i = 0; i < msgs.length; i++) {
            if (msgs[i].id === msgId || toNum(msgs[i].time) === parseInt(msgId)) { msg = msgs[i]; break; }
        }
        if (!msg || !msg.voice_data) return;
        var audio = new Audio(msg.voice_data);
        audio.play();
        notify('🔊 Воспроизведение...', 'info');
    }

    // ============================================
    // УДАЛЕНИЕ СООБЩЕНИЙ
    // ============================================
    async function deleteMessage(messageTime, room) {
        var tv = parseInt(messageTime, 10);
        if (isNaN(tv) || tv <= 0) { notify('❌ Некорректное время', 'error'); return; }

        var msgs = messages[room] || [];
        var target = null;
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (toNum(msgs[i].time) === tv) { target = msgs[i]; break; }
        }
        if (!target) { notify('❌ Сообщение не найдено', 'error'); return; }

        var own = target.sender === (window.app ? window.app.currentUser : null);
        var dir = window.app && window.app.currentUserRole === 'director';
        if (!own && !dir) { notify('❌ Можно удалять только свои', 'error'); return; }

        if (!confirm(dir && !own ? 'Удалить сообщение от ' + target.sender + '?' : 'Удалить?')) return;

        var token = localStorage.getItem('token');
        try {
            await fetch('/api/chat/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ room: room, messageTime: tv, sender: target.sender })
            });
            var idx = -1;
            for (var j = 0; j < messages[room].length; j++) {
                if (toNum(messages[room][j].time) === tv) { idx = j; break; }
            }
            if (idx !== -1) { messages[room].splice(idx, 1); window.app.messages = messages; }
            renderMessages(); renderContacts();
            notify('🗑️ Удалено', 'info');
        } catch(e) { notify('❌ Ошибка', 'error'); }
    }

    // ============================================
    // PUSHER
    // ============================================
    function setupPusher() {
        if (pusherReady) return;
        if (window.pusher) {
            window.pusher.connection.bind('connected', function() {
                var b = document.getElementById('offlineBanner');
                if (b) b.style.display = 'none';
                loadRecent();
            });
            window.pusher.connection.bind('disconnected', function() {
                var b = document.getElementById('offlineBanner');
                if (b) b.style.display = 'flex';
            });
        }
        if (window.channel) {
            window.channel.bind('client-new-message', onNewMsg);
            window.channel.bind('client-announcement', onAnnounce);
            window.channel.bind('client-delete-message', onDelete);
        }
        if (window.privateChannel) {
            window.privateChannel.bind('client-private-message', onPrivateMsg);
        }
        pusherReady = true;
    }

    function onNewMsg(data) {
        if (!data || !data.message) return;
        var t = toNum(data.message.time);
        if (!messages.general) messages.general = [];
        for (var i = 0; i < messages.general.length; i++) {
            if (toNum(messages.general[i].time) === t && messages.general[i].sender === data.message.sender) return;
        }
        messages.general.push(data.message);
        lastTime.general = t;
        window.app.messages = messages;
        if (currentRoom === 'general') debounceRender();
        else { unread.general = (unread.general || 0) + 1; window.chatUnread = unread; renderContacts(); updatePageTitle(); }
        notify('💬 ' + esc(data.message.sender) + ': ' + esc((data.message.text || '').substring(0, 50)), 'info');
    }

    function onAnnounce(data) {
        if (!data || !data.announcement) return;
        var a = data.announcement;
        if (a.sender === (window.app ? window.app.currentUser : null)) return;
        if (!messages.general) messages.general = [];
        messages.general.push(a);
        lastTime.general = toNum(a.time);
        if (currentRoom === 'general') debounceRender();
        else { unread.general = (unread.general || 0) + 1; renderContacts(); }
        notify('📢 ' + esc((a.text || '').substring(0, 50)), 'warning');
    }

    function onDelete(data) {
        var msgs = messages[data.room] || [];
        for (var i = msgs.length - 1; i >= 0; i--) {
            if (toNum(msgs[i].time) === parseInt(data.messageTime)) { msgs.splice(i, 1); break; }
        }
        renderMessages(); renderContacts();
    }

    function onPrivateMsg(data) {
        if (!data || !data.message) return;
        var t = toNum(data.message.time);
        var from = data.from;
        if (!messages[from]) messages[from] = [];
        for (var i = 0; i < messages[from].length; i++) {
            if (toNum(messages[from][i].time) === t) return;
        }
        messages[from].push(data.message);
        lastTime[from] = t;
        if (currentRoom === from) debounceRender();
        else { unread[from] = (unread[from] || 0) + 1; renderContacts(); updatePageTitle(); }
        notify('💬 ' + esc(from) + ': ' + esc((data.message.text || '').substring(0, 50)), 'info');
    }

    // ============================================
    // ОТЛОЖЕННЫЕ
    // ============================================
    async function processPending() {
        if (processing || pending.length === 0) return;
        processing = true;
        var token = localStorage.getItem('token');
        while (pending.length > 0) {
            var item = pending.shift();
            try {
                if (item.room === 'general') {
                    await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ room: 'general', message: item.message })
                    });
                } else {
                    await fetch('/api/chat/private', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ to: item.room, message: item.message })
                    });
                }
            } catch(e) { pending.unshift(item); break; }
        }
        processing = false;
    }
    // ============================================
    // ОБЪЯВЛЕНИЯ
    // ============================================
    function openAnnounceModal() {
        var modal = document.getElementById('announcementModal');
        if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
        var ta = document.getElementById('announcementText');
        if (ta) setTimeout(function() { ta.focus(); }, 100);
        document.body.style.overflow = 'hidden';
    }

    function closeAnnounceModal() {
        var modal = document.getElementById('announcementModal');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
        document.body.style.overflow = '';
    }

    async function sendAnnouncement() {
        var ta = document.getElementById('announcementText');
        var text = ta ? ta.value.trim() : '';
        if (!text) { notify('❌ Введите текст', 'error'); return; }
        if (text.length > 1000) { notify('❌ Слишком длинный', 'error'); return; }

        var token = localStorage.getItem('token');
        var announcement = {
            type: 'announcement',
            style: announceStyle,
            sender: window.app ? window.app.currentUser : 'Система',
            role: window.app ? window.app.currentUserRole : 'director',
            text: text,
            time: Date.now()
        };
        try {
            var res = await fetch('/api/chat/announcement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ announcement: announcement })
            });
            if (res.ok) {
                closeAnnounceModal();
                if (!messages.general) messages.general = [];
                messages.general.push(announcement);
                lastTime.general = announcement.time;
                renderMessages();
                notify('📢 Опубликовано', 'success');
            }
        } catch(e) { notify('❌ Ошибка', 'error'); }
    }

    window.selectAnnouncementStyle = function(style) {
        announceStyle = style;
        document.querySelectorAll('.msg-style-option').forEach(function(o) {
            o.classList.remove('active');
            if (o.dataset.style === style) o.classList.add('active');
        });
    };

    // ============================================
    // НАСТРОЙКИ ЧАТА
    // ============================================
    function openChatSettingsModal() {
        var modal = document.getElementById('chatSettingsModal');
        if (modal) { modal.style.display = 'flex'; modal.classList.add('active'); }
        document.body.style.overflow = 'hidden';
    }

    function closeChatSettingsModal() {
        var modal = document.getElementById('chatSettingsModal');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
        document.body.style.overflow = '';
    }

    // ============================================
    // ОБМЕНЫ
    // ============================================
    async function acceptExchange(requestId) {
        var res = await api('/exchange/accept/' + requestId, 'POST');
        if (res && res.success) {
            notify('✅ Обмен подтверждён', 'success');
            if (typeof loadScheduleData === 'function') loadScheduleData();
        } else { notify('❌ Ошибка', 'error'); }
    }

    async function rejectExchange(requestId) {
        var res = await api('/exchange/reject/' + requestId, 'POST');
        if (res && res.success) notify('❌ Отклонено', 'info');
        else notify('❌ Ошибка', 'error');
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    function exportHistory() {
        var msgs = messages[currentRoom] || [];
        if (!msgs.length) { notify('⚠️ Нет сообщений', 'warning'); return; }
        var txt = 'Чат: ' + (currentRoom === 'general' ? 'Общий' : currentRoom) + '\n';
        txt += 'Экспорт: ' + new Date().toLocaleString() + '\n' + '='.repeat(50) + '\n\n';
        var ld = null;
        msgs.forEach(function(m) {
            var d = new Date(toNum(m.time)).toLocaleDateString('ru-RU');
            if (d !== ld) { ld = d; txt += '\n--- ' + d + ' ---\n'; }
            txt += '[' + fmtTime(m.time) + '] ' + m.sender + ': ' + m.text + '\n';
        });
        var blob = new Blob(['\uFEFF' + txt], { type: 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chat_' + currentRoom + '.txt';
        a.click();
        notify('📄 Экспортировано', 'success');
    }

    // ============================================
    // ОЧИСТКА
    // ============================================
    function cleanup() {
        if (window.channel) {
            window.channel.unbind('client-new-message');
            window.channel.unbind('client-announcement');
            window.channel.unbind('client-delete-message');
        }
        if (window.privateChannel) {
            window.privateChannel.unbind('client-private-message');
        }
        if (renderTimer) clearTimeout(renderTimer);
        if (msgTimer) clearInterval(msgTimer);
        if (abortCtrl) abortCtrl.abort();
        closeAnnounceModal();
        closeChatSettingsModal();
        initialized = false; pusherReady = false;
    }

    // ============================================
    // ЭКСПОРТ В WINDOW
    // ============================================
    window.initChat = initChat;
    window.resetChatState = resetState;
    window.switchChat = switchChat;
    window.sendChatMessage = sendMessage;
    window.sendVoiceMessage = sendVoiceMessage;
    window.playVoiceMessage = playVoiceMessage;
    window.deleteMessage = deleteMessage;
    window.openAnnouncementModal = openAnnounceModal;
    window.closeAnnouncementModal = closeAnnounceModal;
    window.sendAnnouncement = sendAnnouncement;
    window.openChatSettingsModal = openChatSettingsModal;
    window.closeChatSettingsModal = closeChatSettingsModal;
    window.acceptExchange = acceptExchange;
    window.rejectExchange = rejectExchange;
    window.exportChatHistory = exportHistory;
    window.cleanupChat = cleanup;
    window.chatUnread = unread;
    window.chatCurrentRoom = currentRoom;
    window.addEmoji = function(emoji) {
        var input = document.getElementById('chatInput');
        if (!input) return;
        var s = input.selectionStart || 0;
        var e = input.selectionEnd || 0;
        input.value = input.value.substring(0, s) + emoji + input.value.substring(e);
        input.selectionStart = input.selectionEnd = s + emoji.length;
        input.focus();
        var btn = document.getElementById('chatSendBtn');
        if (btn) btn.disabled = false;
        document.getElementById('emojiPicker').style.display = 'none';
    };

    setTimeout(function() {
        if (document.getElementById('chatMessages')) initChat();
    }, 300);

    console.log('✅ chat.js v9.0 ULTIMATE загружен');
})();