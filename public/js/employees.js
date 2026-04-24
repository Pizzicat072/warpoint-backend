// public/js/employees.js — ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ v3.1
// Исправлены: модалки, рендер, closeProfileModal, switchProfileTab

(function() {
    'use strict';
    
    // ============================================
    // ЛОКАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ============================================
    var currentProfileEmployee = null;
    var pendingAvatarBase64 = null;
    var isOpeningProfile = false;
    var isRendering = false;
    var lastRenderTime = 0;
    var RENDER_DEBOUNCE = 100;
    var employeesInitialized = false;
    
    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================
    function resetEmployeesState() {
        console.log('🧹 Сброс состояния сотрудников');
        employeesInitialized = false;
        currentProfileEmployee = null;
        pendingAvatarBase64 = null;
        isRendering = false;
    }

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    function getTobolskNow() {
        if (typeof window.getTobolskNow === 'function' && window.getTobolskNow !== getTobolskNow) {
            return window.getTobolskNow();
        }
        var now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        var map = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
            '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
        };
        return String(str).replace(/[&<>"'`=/]/g, function(m) { return map[m]; });
    }
    
    function showSystemNotification(message, type) {
        if (typeof window.showSystemNotification === 'function' && window.showSystemNotification !== showSystemNotification) {
            window.showSystemNotification(message, type);
            return;
        }
        if (typeof window.showNotif === 'function' && window.showNotif !== showSystemNotification) {
            window.showNotif(message, type);
            return;
        }
        console.log('[' + type + '] ' + message);
    }

    async function apiCall(endpoint, method, body) {
        if (method === undefined) method = 'GET';
        if (body === undefined) body = null;
        if (typeof window.originalApiCall === 'function') return window.originalApiCall(endpoint, method, body);
        if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) return window.apiCall(endpoint, method, body);
        var token = localStorage.getItem('token');
        var options = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        if (body) options.body = JSON.stringify(body);
        try {
            var response = await fetch('/api' + endpoint, options);
            return await response.json();
        } catch (e) {
            console.error('Fetch error:', e);
            return { success: false, error: 'Ошибка соединения' };
        }
    }
    
    function getEmployees() { return window.app ? window.app.employees || [] : []; }
    function getProfiles() { return window.app ? window.app.profiles || {} : {}; }
    function getSchedule() { return window.app ? window.app.schedule || {} : {}; }
    function getTasks() { return window.app ? window.app.tasks || [] : []; }
    function getFines() { return window.app ? window.app.fines || [] : []; }
    function getStickers() { return window.app ? window.app.stickers || {} : {}; }
    function getCurrentUser() { return window.app ? window.app.currentUser : null; }
    function getLastActivity() { return window.app ? window.app.lastActivity || {} : {}; }
    function getUserAchievements() { return window.app ? window.app.userAchievements || {} : {}; }
    function getChatUnread() { return window.chatUnread || {}; }
    
    // ============================================
    // СТАТУСЫ
    // ============================================
    function isOnShiftNow(emp) {
        var today = getTobolskNow().toISOString().split('T')[0];
        var schedule = getSchedule();
        var shift = schedule[today] ? schedule[today][emp] : null;
        var profile = getProfiles()[emp];
        if (profile && (profile.role === 'director' || profile.role === 'manager')) return false;
        if (!shift || !shift.time) return false;
        if (shift.status && shift.status !== 'working') return false;
        var now = getTobolskNow();
        var currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
        var shiftStartMinutes = (parseInt(shift.time.split(':')[0]) || 10) * 60;
        var shiftEndMinutes = 22 * 60;
        if (shift.is_special && shift.special_end_time && !shift.special_end_time.startsWith('exchange_')) {
            shiftEndMinutes = (parseInt(shift.special_end_time.split(':')[0]) || 22) * 60;
        }
        return currentTimeMinutes >= shiftStartMinutes && currentTimeMinutes < shiftEndMinutes;
    }
    
    function isOnlineNow(emp) {
        var lastActivity = getLastActivity();
        var last = lastActivity[emp];
        if (!last) return false;
        var now = getTobolskNow();
        var diffMinutes = (now.getTime() - last) / (1000 * 60);
        return diffMinutes < 5;
    }
    
    function getCompletedShifts(emp) {
        var schedule = getSchedule();
        var now = getTobolskNow();
        var count = 0;
        var dates = Object.keys(schedule);
        for (var i = 0; i < dates.length; i++) {
            var date = dates[i];
            var shiftDate = new Date(date);
            shiftDate.setHours(23, 59, 59);
            if (shiftDate < now && schedule[date][emp] && schedule[date][emp].time && (!schedule[date][emp].status || schedule[date][emp].status === 'working')) {
                count++;
            }
        }
        return count;
    }
    
    function getRoleName(role) {
        var names = { director: '👑 Директор', manager: '📋 Управляющий', admin: '⚙️ Администратор', operator: '👤 Оператор' };
        return names[role] || '👤 Оператор';
    }
    
    function getRoleShortName(role) {
        var names = { director: 'Директор', manager: 'Управляющий', admin: 'Админ', operator: 'Оператор' };
        return names[role] || 'Оператор';
    }
    
    function isBirthdaySoon(birthday) {
        if (!birthday) return false;
        var birthDate = new Date(birthday);
        if (isNaN(birthDate.getTime())) return false;
        var today = getTobolskNow();
        var nextBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        if (nextBirthday < today) nextBirthday.setFullYear(today.getFullYear() + 1);
        var daysDiff = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
        return daysDiff <= 7 && daysDiff >= 0;
    }
    
    function isBirthdayToday(birthday) {
        if (!birthday) return false;
        var birthDate = new Date(birthday);
        if (isNaN(birthDate.getTime())) return false;
        var today = getTobolskNow();
        return birthDate.getDate() === today.getDate() && birthDate.getMonth() === today.getMonth();
    }
    
    function getGiftIcon(giftId) {
        var icons = { flower: '🌸', star: '⭐', trophy: '🏆', pizza: '🍕', crown: '👑', trash: '🗑️', socks: '🧦', brick: '🧱', abibas: '👟', poop: '💩' };
        return icons[giftId] || '🎁';
    }
    
    function getGiftName(giftId) {
        var names = { flower: 'Букет цветов', star: 'Золотая звезда', trophy: 'Трофей', pizza: 'Пицца', crown: 'Корона', trash: 'Мешок мусора', socks: 'Носки с дыркой', brick: 'Кирпич', abibas: 'Кеды Abibas', poop: 'Шоколадный сюрприз' };
        return names[giftId] || giftId;
    }
    
    function safeRenderEmployees() {
        var now = Date.now();
        if (isRendering) return;
        if (now - lastRenderTime < RENDER_DEBOUNCE) {
            setTimeout(function() { safeRenderEmployees(); }, RENDER_DEBOUNCE);
            return;
        }
        isRendering = true;
        lastRenderTime = now;
        requestAnimationFrame(function() {
            try { renderEmployees(); } finally { isRendering = false; }
        });
    }

    // ============================================
    // РЕНДЕР КАРТОЧЕК СОТРУДНИКОВ
    // ============================================
    function renderEmployees() {
        var grid = document.getElementById('employeesGrid');
        if (!grid) { console.warn('⚠️ employeesGrid не найден'); return; }
        
        var employees = getEmployees();
        var profiles = getProfiles();
        var currentUser = getCurrentUser();
        var tasks = getTasks();
        var fines = getFines();
        var stickers = getStickers();
        var userAchievements = getUserAchievements();
        var chatUnread = getChatUnread();
        
        console.log('👥 Рендер: ' + employees.length + ' сотрудников, профилей: ' + Object.keys(profiles).length);
        
        if (!employees.length) {
            grid.innerHTML = '<div class="emp-empty-state"><div class="emp-empty-icon">👥</div><h3>Загрузка сотрудников...</h3><p>Пожалуйста, подождите</p></div>';
            return;
        }
        
        var roleOrder = { director: 1, manager: 2, admin: 3, operator: 4 };
        var sorted = employees.slice().sort(function(a, b) {
            if (a === currentUser) return -1;
            if (b === currentUser) return 1;
            var roleA = profiles[a] ? profiles[a].role : 'operator';
            var roleB = profiles[b] ? profiles[b].role : 'operator';
            return (roleOrder[roleA] || 99) - (roleOrder[roleB] || 99);
        });
        
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var emp = sorted[i];
            var p = profiles[emp] || {};
            var isCurrent = emp === currentUser;
            var isDirector = p.role === 'director';
            var isManager = p.role === 'manager';
            
            var empTasks = tasks.filter(function(t) { return t.executor === emp && !t.is_archived; });
            var tasksDone = empTasks.filter(function(t) { return t.status === 'completed'; }).length;
            var empFines = fines.filter(function(f) { return f.employee === emp && f.status === 'approved'; });
            
            var giftCounts = {};
            var stickerValues = Object.values(stickers);
            for (var j = 0; j < stickerValues.length; j++) {
                var s = stickerValues[j];
                if (s && s.employee === emp) {
                    giftCounts[s.gift_id] = (giftCounts[s.gift_id] || 0) + (s.quantity || 0);
                }
            }
            var giftsReceived = Object.values(giftCounts).reduce(function(a, b) { return a + b; }, 0);
            
            var onShift = isOnShiftNow(emp);
            var online = isOnlineNow(emp);
            var activeStatus = p.active_status || p.status || '💼 Работаю';
            var hasBirthdayToday = isBirthdayToday(p.birthday);
            var hasBirthdaySoon = isBirthdaySoon(p.birthday);
            var streak = p.bonus_streak || 1;
            var achievementsCount = userAchievements[emp] ? userAchievements[emp].length : 0;
            var completedShifts = getCompletedShifts(emp);
            
            var unreadCount = chatUnread[emp] || 0;
            var unreadBadge = unreadCount > 0 ? '<span class="emp-unread-badge">' + (unreadCount > 99 ? '99+' : unreadCount) + '</span>' : '';
            
            var avatarHtml = '';
            if (p.avatar_url && p.avatar_url.startsWith('data:image')) {
                avatarHtml = '<img src="' + escapeHtml(p.avatar_url) + '" alt="' + escapeHtml(emp) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">';
            } else if (p.avatar_url) {
                avatarHtml = '<img src="' + escapeHtml(p.avatar_url) + '" alt="' + escapeHtml(emp) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span style=&quot;font-size:32px;&quot;>' + escapeHtml(p.avatar || '👤') + '</span>\'">';
            } else {
                avatarHtml = '<span style="font-size:32px;">' + escapeHtml(p.avatar || '👤') + '</span>';
            }
            
            var rating = p.rating || 0;
            var ratingClass = rating >= 0 ? 'good' : 'bad';
            var ratingPrefix = rating >= 0 ? '+' : '';
            
            var birthdayBadge = '';
            if (hasBirthdayToday) {
                birthdayBadge = '<span class="emp-birthday-today" title="День рождения сегодня!">🎂 СЕГОДНЯ</span>';
            } else if (hasBirthdaySoon) {
                birthdayBadge = '<span class="emp-birthday-badge" title="День рождения скоро!">🎂</span>';
            }
            
            html += '<div class="emp-card ' + (isCurrent ? 'current-user' : '') + '" onclick="openProfile(\'' + escapeHtml(emp) + '\')" style="cursor:pointer;">' +
                unreadBadge +
                '<div class="emp-rating-corner ' + ratingClass + '"><i class="fas fa-star"></i><span>' + ratingPrefix + rating + '</span></div>' +
                '<div class="emp-card-top">' +
                    '<div class="emp-avatar">' + avatarHtml + '</div>' +
                    '<div class="emp-info">' +
                        '<div class="emp-name"><h3>' + escapeHtml(emp) + '</h3>' + (isCurrent ? '<span class="emp-you-badge">ВЫ</span>' : '') + birthdayBadge + '</div>' +
                        '<div class="emp-role"><i class="fas fa-briefcase"></i> ' + getRoleShortName(p.role) + '</div>' +
                        '<div class="emp-rating ' + ratingClass + '" title="Рейтинг сотрудника"><i class="fas fa-star"></i> ' + ratingPrefix + rating + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="emp-status-row">' +
                    (!isDirector && !isManager ? '<div class="emp-status"><span class="emp-status-dot ' + (onShift ? 'onshift' : 'offshift') + '"></span><i class="fas fa-briefcase"></i><span>' + (onShift ? 'На смене' : 'Не на смене') + '</span></div>' : '') +
                    '<div class="emp-status"><span class="emp-status-dot ' + (online ? 'online' : 'offline') + '"></span><i class="fas fa-wifi"></i><span>' + (online ? 'В сети' : 'Не в сети') + '</span></div>' +
                    '<div class="emp-status"><span class="emp-status-dot streak"></span><i class="fas fa-fire"></i><span>' + streak + ' дн</span></div>' +
                '</div>' +
                '<div class="emp-stats">' +
                    '<div class="emp-stat-item"><div class="emp-stat-icon">✅</div><div class="emp-stat-value">' + tasksDone + '</div><div class="emp-stat-label">Задач</div></div>' +
                    (!isDirector && !isManager ? '<div class="emp-stat-item"><div class="emp-stat-icon">⚠️</div><div class="emp-stat-value">' + empFines.length + '</div><div class="emp-stat-label">Штрафов</div></div>' +
                    '<div class="emp-stat-item"><div class="emp-stat-icon">⏱️</div><div class="emp-stat-value">' + completedShifts + '</div><div class="emp-stat-label">Смен</div></div>' :
                    '<div class="emp-stat-item"><div class="emp-stat-icon">🏆</div><div class="emp-stat-value">' + achievementsCount + '</div><div class="emp-stat-label">Достиж.</div></div>') +
                    '<div class="emp-stat-item"><div class="emp-stat-icon">🎁</div><div class="emp-stat-value">' + giftsReceived + '</div><div class="emp-stat-label">Подарков</div></div>' +
                    '<div class="emp-stat-item"><div class="emp-stat-icon">💰</div><div class="emp-stat-value">' + (p.coins || 0) + '</div><div class="emp-stat-label">WP</div></div>' +
                '</div>' +
                '<div class="emp-card-footer">' +
                    '<span class="emp-active-status" title="' + escapeHtml(activeStatus) + '"><i class="fas fa-circle" style="font-size:6px;margin-right:6px;color:#a78bfa;"></i>' + escapeHtml(activeStatus) + '</span>' +
                    '<button class="emp-chat-btn" onclick="event.stopPropagation();openChatWithEmployee(\'' + escapeHtml(emp) + '\')" title="Написать в чат"><i class="fas fa-comment-dots"></i></button>' +
                '</div>' +
            '</div>';
        }
        
        grid.innerHTML = html;
        console.log('✅ Рендер завершён');
    }

    // ============================================
    // МОДАЛКА ПРОФИЛЯ
    // ============================================
    function openProfile(employeeName) {
        if (isOpeningProfile) { console.log('⚠️ Профиль уже открывается'); return; }
        isOpeningProfile = true;
        setTimeout(function() { isOpeningProfile = false; }, 300);

        document.body.style.overflow = 'hidden';
        currentProfileEmployee = employeeName;

        var p = getProfiles()[employeeName];
        if (!p) {
            console.error('❌ Профиль не найден для:', employeeName);
            document.body.style.overflow = '';
            showSystemNotification('❌ Профиль не найден', 'error');
            return;
        }

        var isDirector = p.role === 'director';
        var isManager = p.role === 'manager';
        var isOwnProfile = employeeName === getCurrentUser();
        var currentUserRole = window.app ? window.app.currentUserRole : null;
        var canEdit = isOwnProfile || currentUserRole === 'director';

        var tasks = getTasks();
        var fines = getFines();
        var stickers = getStickers();
        var achievements = getUserAchievements()[employeeName] || [];
        var completedShifts = getCompletedShifts(employeeName);

        var empTasks = tasks.filter(function(t) { return t.executor === employeeName && !t.is_archived; });
        var tasksDone = empTasks.filter(function(t) { return t.status === 'completed'; }).length;
        var tasksInProgress = empTasks.filter(function(t) { return t.status === 'in_progress'; }).length;
        var tasksOverdue = empTasks.filter(function(t) { return t.status === 'overdue'; }).length;
        var tasksTotal = empTasks.length;

        var empFines = fines.filter(function(f) { return f.employee === employeeName && f.status === 'approved'; });
        var finesCount = empFines.length;
        var finesTotal = empFines.reduce(function(sum, f) { return sum + (f.amount || 0); }, 0);
        var finesCoinsTotal = empFines.reduce(function(sum, f) { return sum + (f.coins || 0); }, 0);

        var giftCounts = {};
        var stickerValues = Object.values(stickers);
        for (var i = 0; i < stickerValues.length; i++) {
            var s = stickerValues[i];
            if (s && s.employee === employeeName) {
                giftCounts[s.gift_id] = (giftCounts[s.gift_id] || 0) + (s.quantity || 0);
            }
        }
        var giftsReceived = Object.values(giftCounts).reduce(function(a, b) { return a + b; }, 0);

        var onShift = isOnShiftNow(employeeName);
        var online = isOnlineNow(employeeName);
        var activeStatus = p.active_status || p.status || '💼 Работаю';
        var streak = p.bonus_streak || 1;

        var avatarHtml = '';
        if (p.avatar_url && p.avatar_url.startsWith('data:image')) {
            avatarHtml = '<img src="' + escapeHtml(p.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;">';
        } else if (p.avatar_url) {
            avatarHtml = '<img src="' + escapeHtml(p.avatar_url) + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span style=&quot;font-size:32px;&quot;>' + escapeHtml(p.avatar || '👤') + '</span>\'">';
        } else {
            avatarHtml = '<span style="font-size:32px;">' + escapeHtml(p.avatar || '👤') + '</span>';
        }

        var rating = p.rating || 0;
        var ratingPrefix = rating >= 0 ? '+' : '';
        var ratingColor = rating >= 0 ? '#10b981' : '#ef4444';

        var modalContent = document.getElementById('profileModalContent');
        if (!modalContent) {
            console.error('❌ profileModalContent не найден, пробуем создать...');
            var modalForContent = document.getElementById('profileModal');
            if (modalForContent) {
                var windowEl = modalForContent.querySelector('.emp-modal-window');
                if (windowEl) {
                    var div = document.createElement('div');
                    div.id = 'profileModalContent';
                    windowEl.appendChild(div);
                    modalContent = div;
                }
            }
            if (!modalContent) {
                console.error('❌ Не удалось создать profileModalContent');
                document.body.style.overflow = '';
                return;
            }
        }

        sessionStorage.setItem('lastProfileEmployee', employeeName);

        modalContent.innerHTML = '' +
        '<div class="emp-modal-header">' +
            '<div class="emp-modal-avatar" onclick="' + (canEdit ? 'openAvatarModal()' : '') + '" style="cursor:' + (canEdit ? 'pointer' : 'default') + ';">' + avatarHtml + '</div>' +
            '<div class="emp-modal-title">' +
                '<h3>' + escapeHtml(employeeName) + ' ' + (isOwnProfile ? '<span class="emp-you-badge">ВЫ</span>' : '') + '</h3>' +
                '<p>' + getRoleName(p.role) + '</p>' +
                (p.phone ? '<p class="emp-modal-phone"><i class="fas fa-phone"></i> ' + escapeHtml(p.phone) + '</p>' : '') +
            '</div>' +
            '<button class="emp-modal-close" onclick="closeProfileModal()">&times;</button>' +
        '</div>' +
        '<div class="emp-profile-tabs">' +
            '<button class="emp-profile-tab active" data-tab="main" onclick="switchProfileTab(\'main\')"><i class="fas fa-user"></i> Основное</button>' +
            '<button class="emp-profile-tab" data-tab="stats" onclick="switchProfileTab(\'stats\')"><i class="fas fa-chart-bar"></i> Статистика</button>' +
            '<button class="emp-profile-tab" data-tab="achievements" onclick="switchProfileTab(\'achievements\')"><i class="fas fa-trophy"></i> Достижения</button>' +
            '<button class="emp-profile-tab" data-tab="gifts" onclick="switchProfileTab(\'gifts\')"><i class="fas fa-gift"></i> Подарки</button>' +
            (currentUserRole === 'director' ? '<button class="emp-profile-tab" data-tab="actions" onclick="switchProfileTab(\'actions\')"><i class="fas fa-cog"></i> Действия</button>' : '') +
        '</div>' +
        '<div class="emp-modal-body">' +
            '<div id="profileTabMain" class="emp-profile-tab-content active">' +
                '<div class="emp-info-grid">' +
                    (p.phone ? '<div class="emp-info-card"><i class="fas fa-phone"></i><span>' + escapeHtml(p.phone) + '</span></div>' : '') +
                    (p.birthday ? '<div class="emp-info-card"><i class="fas fa-calendar"></i><span>' + new Date(p.birthday).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + '</span></div>' : '') +
                '</div>' +
                '<div class="emp-stats-grid">' +
                    '<div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-value">' + (p.coins || 0) + '</div><div class="emp-stat-label">WP</div></div>' +
                    '<div class="emp-stat-card"><div class="emp-stat-icon">⭐</div><div class="emp-stat-value" style="color:' + ratingColor + ';">' + ratingPrefix + rating + '</div><div class="emp-stat-label">Рейтинг</div></div>' +
                    '<div class="emp-stat-card"><div class="emp-stat-icon">🔥</div><div class="emp-stat-value">' + streak + '</div><div class="emp-stat-label">Стрик</div></div>' +
                    '<div class="emp-stat-card"><div class="emp-stat-icon">🏆</div><div class="emp-stat-value">' + achievements.length + '</div><div class="emp-stat-label">Достиж.</div></div>' +
                '</div>' +
                '<div class="emp-status-cards">' +
                    (!isDirector && !isManager ? '<div class="emp-status-card ' + (onShift ? 'active' : '') + '"><span class="emp-status-dot ' + (onShift ? 'onshift' : 'offshift') + '"></span><span>' + (onShift ? 'На смене' : 'Не на смене') + '</span></div>' : '') +
                    '<div class="emp-status-card ' + (online ? 'active' : '') + '"><span class="emp-status-dot ' + (online ? 'online' : 'offline') + '"></span><span>' + (online ? 'В сети' : 'Не в сети') + '</span></div>' +
                    '<div class="emp-status-card active"><i class="fas fa-tag"></i><span>' + escapeHtml(activeStatus) + '</span></div>' +
                '</div>' +
            '</div>' +
            '<div id="profileTabStats" class="emp-profile-tab-content">' +
                '<div class="emp-section">' +
                    '<h4><i class="fas fa-tasks"></i> Задачи</h4>' +
                    '<div class="emp-stats-row">' +
                        '<div class="emp-stat-item-detailed"><span class="label">Всего</span><span class="value">' + tasksTotal + '</span></div>' +
                        '<div class="emp-stat-item-detailed success"><span class="label">✅ Выполнено</span><span class="value">' + tasksDone + '</span></div>' +
                        '<div class="emp-stat-item-detailed info"><span class="label">⏳ В процессе</span><span class="value">' + tasksInProgress + '</span></div>' +
                        '<div class="emp-stat-item-detailed danger"><span class="label">⚠️ Просрочено</span><span class="value">' + tasksOverdue + '</span></div>' +
                    '</div>' +
                '</div>' +
                (!isDirector && !isManager ? '' +
                '<div class="emp-section">' +
                    '<h4><i class="fas fa-exclamation-triangle"></i> Штрафы</h4>' +
                    '<div class="emp-stats-row">' +
                        '<div class="emp-stat-item-detailed"><span class="label">Количество</span><span class="value">' + finesCount + '</span></div>' +
                        '<div class="emp-stat-item-detailed warning"><span class="label">Сумма (₽)</span><span class="value">' + finesTotal.toLocaleString() + ' ₽</span></div>' +
                        '<div class="emp-stat-item-detailed warning"><span class="label">Списано WP</span><span class="value">' + finesCoinsTotal + ' WP</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="emp-section">' +
                    '<h4><i class="fas fa-clock"></i> Смены и часы</h4>' +
                    '<div class="emp-stats-row">' +
                        '<div class="emp-stat-item-detailed"><span class="label">Смен</span><span class="value">' + completedShifts + '</span></div>' +
                        '<div class="emp-stat-item-detailed"><span class="label">Часов</span><span class="value">' + (p.hours || 0) + ' ч</span></div>' +
                    '</div>' +
                '</div>' : '') +
            '</div>' +
            '<div id="profileTabAchievements" class="emp-profile-tab-content">' +
                '<div class="emp-section-header"><h4>🏆 Достижения (' + achievements.length + ')</h4></div>' +
                (achievements.length > 0 ? '<div class="emp-achievements-list">' + achievements.map(function(a) {
                    return '<div class="emp-achievement-item" style="border-left-color:' + (a.color || '#fbbf24') + ';">' +
                        '<span class="emp-achievement-icon">' + escapeHtml(a.icon || '🏆') + '</span>' +
                        '<div class="emp-achievement-info"><div class="emp-achievement-name">' + escapeHtml(a.name) + '</div><div class="emp-achievement-desc">' + escapeHtml(a.description || '') + '</div></div>' +
                    '</div>';
                }).join('') + '</div>' : '<div class="emp-empty-section"><i class="fas fa-trophy"></i><p>Пока нет достижений</p></div>') +
            '</div>' +
            '<div id="profileTabGifts" class="emp-profile-tab-content">' +
                '<div class="emp-section-header"><h4>🎁 Полученные подарки (' + giftsReceived + ')</h4></div>' +
                (Object.keys(giftCounts).length > 0 ? '<div class="emp-gifts-grid">' + Object.entries(giftCounts).map(function(entry) {
                    return '<div class="emp-gift-card"><div class="emp-gift-icon">' + getGiftIcon(entry[0]) + '</div><div class="emp-gift-name">' + getGiftName(entry[0]) + '</div><div class="emp-gift-count">×' + entry[1] + '</div></div>';
                }).join('') + '</div>' : '<div class="emp-empty-section"><i class="fas fa-gift"></i><p>Пока нет подарков</p></div>') +
            '</div>' +
            (currentUserRole === 'director' && !isDirector ? '' +
            '<div id="profileTabActions" class="emp-profile-tab-content">' +
                '<div class="emp-section"><h4><i class="fas fa-gift"></i> Выдать бонус</h4>' +
                    '<div class="emp-form-group"><label>Монеты WP</label><input type="number" id="bonusCoins" value="0" min="0"></div>' +
                    '<div class="emp-form-group"><label>Рейтинг</label><input type="number" id="bonusRating" value="0"></div>' +
                    '<button class="emp-btn-primary" onclick="giveBonus(\'' + escapeHtml(employeeName) + '\')">Выдать</button>' +
                '</div>' +
                '<div class="emp-section"><h4><i class="fas fa-user-tag"></i> Сменить должность</h4>' +
                    '<select id="newRole" class="emp-select">' +
                        '<option value="operator"' + (p.role === 'operator' ? ' selected' : '') + '>👤 Оператор</option>' +
                        '<option value="admin"' + (p.role === 'admin' ? ' selected' : '') + '>⚙️ Администратор</option>' +
                        '<option value="manager"' + (p.role === 'manager' ? ' selected' : '') + '>📋 Управляющий</option>' +
                    '</select>' +
                    '<button class="emp-btn-primary" onclick="changeRole(\'' + escapeHtml(employeeName) + '\')" style="margin-top:12px;">Сменить</button>' +
                '</div>' +
                '<div class="emp-section danger"><h4><i class="fas fa-key"></i> Сбросить пароль</h4>' +
                    '<div class="emp-form-group"><label>Новый пароль</label><input type="password" id="newPassword"></div>' +
                    '<button class="emp-btn-primary" onclick="resetEmployeePassword(\'' + escapeHtml(employeeName) + '\')">Сбросить пароль</button>' +
                '</div>' +
                '<div class="emp-section danger"><h4><i class="fas fa-trash-alt"></i> Уволить</h4>' +
                    '<p style="font-size:12px;color:#94a3b8;margin-bottom:12px;">Это действие необратимо</p>' +
                    '<button class="emp-btn-danger" onclick="deleteEmployee(\'' + escapeHtml(employeeName) + '\')">Уволить сотрудника</button>' +
                '</div>' +
            '</div>' : '') +
        '</div>';

        // 🔥 ПРИНУДИТЕЛЬНО ПОКАЗЫВАЕМ МОДАЛКУ
        var modal = document.getElementById('profileModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            modal.classList.add('active');
            console.log('✅ Модалка открыта для:', employeeName);
        } else {
            console.error('❌ profileModal не найден в DOM');
            var modals = document.querySelectorAll('.emp-modal');
            for (var i = 0; i < modals.length; i++) {
                if (modals[i].id === 'profileModal') {
                    modals[i].style.display = 'flex';
                    modals[i].classList.add('active');
                    console.log('✅ Модалка показана через селектор');
                    break;
                }
            }
        }
    }

    function closeProfileModal() {
        var modal = document.getElementById('profileModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
        var modals = document.querySelectorAll('.emp-modal.active');
        for (var i = 0; i < modals.length; i++) {
            modals[i].style.display = 'none';
            modals[i].classList.remove('active');
        }
        document.body.style.overflow = '';
        currentProfileEmployee = null;
        sessionStorage.removeItem('lastProfileEmployee');
    }

    window.switchProfileTab = function(tabName) {
        document.querySelectorAll('.emp-profile-tab').forEach(function(btn) {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabName) btn.classList.add('active');
        });
        document.querySelectorAll('.emp-profile-tab-content').forEach(function(content) {
            content.classList.remove('active');
        });
        var activeContent = document.getElementById('profileTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
        if (activeContent) activeContent.classList.add('active');
    };

    // ============================================
    // АВАТАРЫ
    // ============================================
    function openAvatarModal() {
        var modal = document.getElementById('avatarModal');
        if (!modal) return;
        var grid = document.getElementById('avatarGrid');
        if (!grid) return;
        var avatars = ['👤','😎','🔥','⚡','🎯','🏆','🦸','👑','🐱','🐶','🦊','🐼','🐨','🐸','🐙','🦄','🤖','👻'];
        grid.innerHTML = '<div class="emp-avatar-item upload" onclick="openAvatarUploadModal()"><i class="fas fa-camera"></i><span>Загрузить</span></div>' + avatars.map(function(a) { return '<div class="emp-avatar-item" onclick="selectAvatar(\'' + a + '\')">' + a + '</div>'; }).join('');
        modal.classList.add('active');
    }
    function closeAvatarModal() { var m = document.getElementById('avatarModal'); if (m) m.classList.remove('active'); }

    async function selectAvatar(avatar) {
        if (!currentProfileEmployee || currentProfileEmployee !== getCurrentUser()) { showSystemNotification('❌ Можно менять только свой аватар', 'warning'); return; }
        var success = await updateEmployeeAvatar(currentProfileEmployee, avatar);
        if (success) { if (window.app.profiles[currentProfileEmployee]) { window.app.profiles[currentProfileEmployee].avatar = avatar; window.app.profiles[currentProfileEmployee].avatar_url = null; } showSystemNotification('✅ Аватар изменён', 'success'); safeRenderEmployees(); closeAvatarModal(); }
        else showSystemNotification('❌ Ошибка при смене аватара', 'error');
    }

    function openAvatarUploadModal() {
        var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.onchange = async function(e) { var file = e.target.files[0]; if (!file) return; if (file.size > 2*1024*1024) { showSystemNotification('❌ Файл слишком большой (макс. 2MB)', 'error'); return; } var reader = new FileReader(); reader.onload = function(event) { pendingAvatarBase64 = event.target.result; document.getElementById('avatarPreviewImg').src = pendingAvatarBase64; document.getElementById('avatarPreviewModal').classList.add('active'); closeAvatarModal(); }; reader.readAsDataURL(file); };
        input.click();
    }
    function closeAvatarPreviewModal() { var m = document.getElementById('avatarPreviewModal'); if (m) m.classList.remove('active'); pendingAvatarBase64 = null; }

    async function confirmAvatarUpload() {
        if (!pendingAvatarBase64) return;
        var success = await updateEmployeeAvatarBase64(currentProfileEmployee, pendingAvatarBase64);
        if (success) { if (window.app.profiles[currentProfileEmployee]) { window.app.profiles[currentProfileEmployee].avatar_url = pendingAvatarBase64; window.app.profiles[currentProfileEmployee].avatar = null; } showSystemNotification('✅ Аватар обновлён', 'success'); safeRenderEmployees(); closeAvatarPreviewModal(); }
        else showSystemNotification('❌ Ошибка при загрузке', 'error');
        pendingAvatarBase64 = null;
    }

    async function updateEmployeeAvatar(name, avatar) {
        var response = await apiCall('/profiles/' + encodeURIComponent(name), 'PUT', { avatar: avatar });
        return response && response.success;
    }
    async function updateEmployeeAvatarBase64(name, base64) {
        var response = await apiCall('/profiles/' + encodeURIComponent(name), 'PUT', { avatar_url: base64 });
        return response && response.success;
    }

    // ============================================
    // ЧАТ С СОТРУДНИКОМ
    // ============================================
    function openChatWithEmployee(employeeName) {
        if (typeof loadPage === 'function') {
            loadPage('chat');
            setTimeout(function() { if (typeof switchChat === 'function') switchChat(employeeName); }, 300);
        }
    }
    function openMyProfile() { if (window.app && window.app.currentUser) openProfile(window.app.currentUser); }

    // ============================================
    // СОЗДАНИЕ СОТРУДНИКА
    // ============================================
    function openCreateEmployeeModal() {
        var modal = document.getElementById('createEmployeeModal');
        if (!modal) return;
        modal.classList.add('active');
        selectRole('operator');
    }
    function closeCreateEmployeeModal() {
        var m = document.getElementById('createEmployeeModal');
        if (m) m.classList.remove('active');
        ['newEmpName','newEmpPassword','newEmpBirthday','newEmpPhone'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    }
    function selectRole(role) {
        var roleInput = document.getElementById('newEmpRole');
        if (roleInput) roleInput.value = role;
        document.querySelectorAll('.emp-role-option').forEach(function(opt) { opt.classList.remove('active'); var radio = opt.querySelector('input'); if (radio && radio.value === role) { opt.classList.add('active'); radio.checked = true; } });
    }

    async function createEmployee() {
        var name = document.getElementById('newEmpName') ? document.getElementById('newEmpName').value.trim() : '';
        var password = document.getElementById('newEmpPassword') ? document.getElementById('newEmpPassword').value : '';
        var role = document.getElementById('newEmpRole') ? document.getElementById('newEmpRole').value : 'operator';
        var birthday = document.getElementById('newEmpBirthday') ? document.getElementById('newEmpBirthday').value : '';
        var phone = document.getElementById('newEmpPhone') ? document.getElementById('newEmpPhone').value : '';
        if (!name || !password) { showSystemNotification('❌ Заполните имя и пароль', 'error'); return; }
        var response = await apiCall('/employees', 'POST', { name: name, password: password, role: role, birthday: birthday, phone: phone });
        if (response && response.success) { showSystemNotification('✅ ' + name + ' создан', 'success'); closeCreateEmployeeModal(); await loadEmployees(); safeRenderEmployees(); }
        else showSystemNotification('❌ ' + (response ? response.error : 'Ошибка'), 'error');
    }

    // ============================================
    // БОНУСЫ, РОЛИ, ПАРОЛИ, УДАЛЕНИЕ
    // ============================================
    async function giveBonus(employeeName) {
        var coins = parseInt(document.getElementById('bonusCoins') ? document.getElementById('bonusCoins').value : 0) || 0;
        var rating = parseInt(document.getElementById('bonusRating') ? document.getElementById('bonusRating').value : 0) || 0;
        if (coins === 0 && rating === 0) { showSystemNotification('⚠️ Укажите сумму или рейтинг', 'warning'); return; }
        var res = await apiCall('/admin/bonus/employee', 'POST', { name: employeeName, coins: coins, rating: rating });
        if (res && res.success) { showSystemNotification('✅ Бонус выдан', 'success'); closeProfileModal(); await loadEmployees(); safeRenderEmployees(); }
        else showSystemNotification('❌ ' + (res ? res.error : 'Ошибка'), 'error');
    }
    async function changeRole(employeeName) {
        var role = document.getElementById('newRole') ? document.getElementById('newRole').value : '';
        if (!role) return;
        var res = await apiCall('/employees/' + encodeURIComponent(employeeName) + '/role', 'PUT', { role: role });
        if (res && res.success) { showSystemNotification('✅ Роль изменена', 'success'); closeProfileModal(); await loadEmployees(); safeRenderEmployees(); }
        else showSystemNotification('❌ ' + (res ? res.error : 'Ошибка'), 'error');
    }
    async function resetEmployeePassword(employeeName) {
        var newPassword = document.getElementById('newPassword') ? document.getElementById('newPassword').value : '';
        if (!newPassword) { showSystemNotification('⚠️ Введите пароль', 'warning'); return; }
        if (!confirm('Сбросить пароль для ' + employeeName + '?')) return;
        var res = await apiCall('/employees/' + encodeURIComponent(employeeName) + '/password', 'PUT', { password: newPassword });
        if (res && res.success) showSystemNotification('✅ Пароль изменён', 'success');
        else showSystemNotification('❌ ' + (res ? res.error : 'Ошибка'), 'error');
    }
    async function deleteEmployee(employeeName) {
        if (!confirm('Уволить ' + employeeName + '?')) return;
        var res = await apiCall('/employees/' + encodeURIComponent(employeeName), 'DELETE');
        if (res && res.success) { showSystemNotification('✅ ' + employeeName + ' уволен', 'warning'); if (window.app) { window.app.employees = window.app.employees.filter(function(e) { return e !== employeeName; }); delete window.app.profiles[employeeName]; } closeProfileModal(); safeRenderEmployees(); }
        else showSystemNotification('❌ ' + (res ? res.error : 'Ошибка'), 'error');
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initEmployees() {
        if (employeesInitialized) { console.log('👥 Уже инициализированы'); var grid = document.getElementById('employeesGrid'); if (grid && grid.children.length === 0) safeRenderEmployees(); return; }
        console.log('👥 Инициализация команды');
        var grid = document.getElementById('employeesGrid');
        if (!grid) { setTimeout(initEmployees, 100); return; }
        if (typeof loadEmployees === 'function') { loadEmployees().then(function() { console.log('✅ Данные загружены'); safeRenderEmployees(); }); }
        else safeRenderEmployees();
        var createBtn = document.getElementById('createEmployeeBtn');
        if (createBtn) createBtn.style.display = window.app && window.app.currentUserRole === 'director' ? 'inline-flex' : 'none';
        employeesInitialized = true;
    }

    // ============================================
    // ЭКСПОРТ ВСЕХ ФУНКЦИЙ В WINDOW
    // ============================================
    window.initEmployees = initEmployees;
    window.resetEmployeesState = resetEmployeesState;
    window.renderEmployees = renderEmployees;
    window.safeRenderEmployees = safeRenderEmployees;
    window.openProfile = openProfile;
    window.closeProfileModal = closeProfileModal;
    window.switchProfileTab = window.switchProfileTab;
    window.openAvatarModal = openAvatarModal;
    window.closeAvatarModal = closeAvatarModal;
    window.selectAvatar = selectAvatar;
    window.openAvatarUploadModal = openAvatarUploadModal;
    window.closeAvatarPreviewModal = closeAvatarPreviewModal;
    window.confirmAvatarUpload = confirmAvatarUpload;
    window.openChatWithEmployee = openChatWithEmployee;
    window.openMyProfile = openMyProfile;
    window.openCreateEmployeeModal = openCreateEmployeeModal;
    window.closeCreateEmployeeModal = closeCreateEmployeeModal;
    window.selectRole = selectRole;
    window.createEmployee = createEmployee;
    window.giveBonus = giveBonus;
    window.changeRole = changeRole;
    window.resetEmployeePassword = resetEmployeePassword;
    window.deleteEmployee = deleteEmployee;

    console.log('✅ employees.js v3.1 загружен (полный, исправленный)');
})();