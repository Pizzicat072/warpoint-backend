// public/js/employees.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.2
// Исправлена инициализация и рендер

(function() {
    'use strict';
    
    // ============================================
    // ЛОКАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ============================================
    let currentProfileEmployee = null;
    let pendingAvatarBase64 = null;
    let isOpeningProfile = false;
    let isRendering = false;
    let lastRenderTime = 0;
    const RENDER_DEBOUNCE = 100;
    let employeesInitialized = false;
    
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
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        const map = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
            '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
        };
        return String(str).replace(/[&<>"'`=/]/g, (m) => map[m]);
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
        console.log(`[${type}] ${message}`);
    }

    async function apiCall(endpoint, method = 'GET', body = null) {
        if (typeof window.originalApiCall === 'function') {
            return window.originalApiCall(endpoint, method, body);
        }
        if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) {
            return window.apiCall(endpoint, method, body);
        }
        const token = localStorage.getItem('token');
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (token) options.headers['Authorization'] = `Bearer ${token}`;
        if (body) options.body = JSON.stringify(body);
        try {
            const response = await fetch(`/api${endpoint}`, options);
            return await response.json();
        } catch (e) {
            console.error('Fetch error:', e);
            return { success: false, error: 'Ошибка соединения' };
        }
    }
    
    function getEmployees() { return window.app?.employees || []; }
    function getProfiles() { return window.app?.profiles || {}; }
    function getSchedule() { return window.app?.schedule || {}; }
    function getTasks() { return window.app?.tasks || []; }
    function getFines() { return window.app?.fines || []; }
    function getStickers() { return window.app?.stickers || {}; }
    function getCurrentUser() { return window.app?.currentUser; }
    function getLastActivity() { return window.app?.lastActivity || {}; }
    function getUserAchievements() { return window.app?.userAchievements || {}; }
    function getChatUnread() { return window.chatUnread || {}; }
    
    // ============================================
    // СТАТУСЫ "НА СМЕНЕ" И "В СЕТИ"
    // ============================================
    function isOnShiftNow(emp) {
        const today = getTobolskNow().toISOString().split('T')[0];
        const schedule = getSchedule();
        const shift = schedule[today]?.[emp];
        const profile = getProfiles()[emp];
        
        if (profile?.role === 'director' || profile?.role === 'manager') return false;
        if (!shift || !shift.time) return false;
        if (shift.status && shift.status !== 'working') return false;
        
        const now = getTobolskNow();
        const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
        const shiftStartMinutes = (parseInt(shift.time.split(':')[0]) || 10) * 60;
        
        let shiftEndMinutes = 22 * 60;
        if (shift.is_special && shift.special_end_time) {
            if (!shift.special_end_time.startsWith('exchange_')) {
                const endHour = parseInt(shift.special_end_time.split(':')[0]) || 22;
                shiftEndMinutes = endHour * 60;
            }
        }
        
        return currentTimeMinutes >= shiftStartMinutes && currentTimeMinutes < shiftEndMinutes;
    }
    
    function isOnlineNow(emp) {
        const lastActivity = getLastActivity();
        const last = lastActivity[emp];
        if (!last) return false;
        
        const now = getTobolskNow();
        const lastTime = new Date(last);
        const diffMs = now.getTime() - lastTime.getTime();
        const diffMinutes = diffMs / (1000 * 60);
        
        return diffMinutes < 5;
    }
    
    function getCompletedShifts(emp) {
        const schedule = getSchedule();
        const now = getTobolskNow();
        let count = 0;
        for (const [date, shifts] of Object.entries(schedule)) {
            const shiftDate = new Date(date);
            shiftDate.setHours(23, 59, 59);
            if (shiftDate < now && shifts[emp]?.time && (!shifts[emp]?.status || shifts[emp]?.status === 'working')) {
                count++;
            }
        }
        return count;
    }
    
    function getRoleName(role) {
        const names = { 
            director: '👑 Директор', 
            manager: '📋 Управляющий', 
            admin: '⚙️ Администратор', 
            operator: '👤 Оператор' 
        };
        return names[role] || '👤 Оператор';
    }
    
    function getRoleShortName(role) {
        const names = { 
            director: 'Директор', 
            manager: 'Управляющий', 
            admin: 'Админ', 
            operator: 'Оператор' 
        };
        return names[role] || 'Оператор';
    }
    
    function isBirthdaySoon(birthday) {
        if (!birthday) return false;
        const birthDate = new Date(birthday);
        if (isNaN(birthDate.getTime())) return false;
        const today = getTobolskNow();
        const nextBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
        if (nextBirthday < today) nextBirthday.setFullYear(today.getFullYear() + 1);
        const daysDiff = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
        return daysDiff <= 7 && daysDiff >= 0;
    }
    
    function isBirthdayToday(birthday) {
        if (!birthday) return false;
        const birthDate = new Date(birthday);
        if (isNaN(birthDate.getTime())) return false;
        const today = getTobolskNow();
        return birthDate.getDate() === today.getDate() && birthDate.getMonth() === today.getMonth();
    }
    
    function getGiftIcon(giftId) {
        const icons = { 
            flower: '🌸', chocolate: '🍫', star: '⭐', trophy: '🏆', honey: '🍯',
            pizza: '🍕', crown: '👑', trash: '🗑️', socks: '🧦', brick: '🧱',
            abibas: '👟', poop: '💩'
        };
        return icons[giftId] || '🎁';
    }
    
    function getGiftName(giftId) {
        const names = { 
            flower: 'Букет цветов', chocolate: 'Шоколад', star: 'Золотая звезда', 
            trophy: 'Трофей', honey: 'Мёд', pizza: 'Пицца', crown: 'Корона',
            trash: 'Мешок мусора', socks: 'Носки с дыркой', brick: 'Кирпич',
            abibas: 'Кеды Abibas', poop: 'Шоколадный сюрприз'
        };
        return names[giftId] || giftId;
    }
    
    function safeRenderEmployees() {
        const now = Date.now();
        if (isRendering) return;
        if (now - lastRenderTime < RENDER_DEBOUNCE) {
            setTimeout(() => safeRenderEmployees(), RENDER_DEBOUNCE);
            return;
        }
        
        isRendering = true;
        lastRenderTime = now;
        
        requestAnimationFrame(() => {
            try {
                renderEmployees();
            } finally {
                isRendering = false;
            }
        });
    }

    // ============================================
    // РЕНДЕР КАРТОЧЕК
    // ============================================
    function renderEmployees() {
        const grid = document.getElementById('employeesGrid');
        if (!grid) {
            console.warn('⚠️ employeesGrid не найден');
            return;
        }
        
        const employees = getEmployees();
        const profiles = getProfiles();
        const currentUser = getCurrentUser();
        const tasks = getTasks();
        const fines = getFines();
        const stickers = getStickers();
        const userAchievements = getUserAchievements();
        const chatUnread = getChatUnread();
        
        console.log(`👥 Рендер сотрудников: ${employees.length} чел.`);
        
        if (!employees.length) {
            grid.innerHTML = `
                <div class="emp-empty-state">
                    <div class="emp-empty-icon">👥</div>
                    <h3>Загрузка сотрудников...</h3>
                    <p>Пожалуйста, подождите</p>
                </div>
            `;
            return;
        }
        
        const roleOrder = { director: 1, manager: 2, admin: 3, operator: 4 };
        const sorted = [...employees].sort((a, b) => {
            if (a === currentUser) return -1;
            if (b === currentUser) return 1;
            const roleA = profiles[a]?.role || 'operator';
            const roleB = profiles[b]?.role || 'operator';
            return (roleOrder[roleA] || 99) - (roleOrder[roleB] || 99);
        });
        
        grid.innerHTML = sorted.map(emp => {
            const p = profiles[emp] || {};
            const isCurrent = emp === currentUser;
            const isDirector = p.role === 'director';
            const isManager = p.role === 'manager';
            
            const empTasks = tasks.filter(t => t.executor === emp && !t.is_archived);
            const tasksDone = empTasks.filter(t => t.status === 'completed').length;
            const empFines = fines.filter(f => f.employee === emp && f.status === 'approved');
            
            const giftCounts = {};
            Object.values(stickers).forEach(s => {
                if (s.employee === emp) {
                    giftCounts[s.gift_id] = (giftCounts[s.gift_id] || 0) + (s.quantity || 0);
                }
            });
            const giftsReceived = Object.values(giftCounts).reduce((a, b) => a + b, 0);
            
            const onShift = isOnShiftNow(emp);
            const online = isOnlineNow(emp);
            const activeStatus = p.active_status || p.status || '💼 Работаю';
            const hasBirthdaySoon = isBirthdaySoon(p.birthday);
            const hasBirthdayToday = isBirthdayToday(p.birthday);
            const streak = p.bonus_streak || 1;
            const achievementsCount = userAchievements[emp]?.length || 0;
            const completedShifts = getCompletedShifts(emp);
            
            const unreadCount = chatUnread[emp] || 0;
            const unreadBadge = unreadCount > 0 
                ? `<span class="emp-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` 
                : '';
            
            let avatarHtml = '';
            if (p.avatar_url && p.avatar_url.startsWith('data:image')) {
                avatarHtml = `<img src="${escapeHtml(p.avatar_url)}" alt="${escapeHtml(emp)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`;
            } else if (p.avatar_url) {
                avatarHtml = `<img src="${escapeHtml(p.avatar_url)}" alt="${escapeHtml(emp)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<span style=&quot;font-size:32px;&quot;>${escapeHtml(p.avatar || '👤')}</span>'">`;
            } else {
                avatarHtml = `<span style="font-size:32px;">${escapeHtml(p.avatar || '👤')}</span>`;
            }
            
            const rating = p.rating || 0;
            const ratingClass = rating >= 0 ? 'good' : 'bad';
            const ratingPrefix = rating >= 0 ? '+' : '';
            
            let birthdayBadge = '';
            if (hasBirthdayToday) {
                birthdayBadge = '<span class="emp-birthday-today" title="День рождения сегодня!">🎂 СЕГОДНЯ</span>';
            } else if (hasBirthdaySoon) {
                birthdayBadge = '<span class="emp-birthday-badge" title="День рождения скоро!">🎂</span>';
            }
            
            return `
                <div class="emp-card ${isCurrent ? 'current-user' : ''}" onclick="openProfile('${escapeHtml(emp)}')">
                    <div class="emp-card-glow"></div>
                    ${unreadBadge}
                    
                    <div class="emp-rating-corner ${ratingClass}">
                        <i class="fas fa-star"></i>
                        <span>${ratingPrefix}${rating}</span>
                    </div>
                    
                    <div class="emp-card-top">
                        <div class="emp-avatar">
                            ${avatarHtml}
                            <div class="emp-avatar-ring"></div>
                        </div>
                        <div class="emp-info">
                            <div class="emp-name">
                                <h3>${escapeHtml(emp)}</h3>
                                ${isCurrent ? '<span class="emp-you-badge">ВЫ</span>' : ''}
                                ${birthdayBadge}
                            </div>
                            <div class="emp-role">
                                <i class="fas fa-briefcase"></i> ${getRoleShortName(p.role)}
                            </div>
                            <div class="emp-rating ${ratingClass}" title="Рейтинг сотрудника">
                                <i class="fas fa-star"></i> ${ratingPrefix}${rating}
                            </div>
                        </div>
                    </div>
                    
                    <div class="emp-status-row">
                        ${!isDirector && !isManager ? `
                            <div class="emp-status">
                                <span class="emp-status-dot ${onShift ? 'onshift' : 'offshift'}"></span>
                                <i class="fas fa-briefcase"></i>
                                <span>${onShift ? 'На смене' : 'Не на смене'}</span>
                            </div>
                        ` : ''}
                        <div class="emp-status">
                            <span class="emp-status-dot ${online ? 'online' : 'offline'}"></span>
                            <i class="fas fa-wifi"></i>
                            <span>${online ? 'В сети' : 'Не в сети'}</span>
                        </div>
                        <div class="emp-status">
                            <span class="emp-status-dot streak"></span>
                            <i class="fas fa-fire"></i>
                            <span>${streak} дн</span>
                        </div>
                    </div>
                    
                    <div class="emp-stats">
                        <div class="emp-stat-item">
                            <div class="emp-stat-icon">✅</div>
                            <div class="emp-stat-value">${tasksDone}</div>
                            <div class="emp-stat-label">Задач</div>
                        </div>
                        ${!isDirector && !isManager ? `
                            <div class="emp-stat-item">
                                <div class="emp-stat-icon">⚠️</div>
                                <div class="emp-stat-value">${empFines.length}</div>
                                <div class="emp-stat-label">Штрафов</div>
                            </div>
                            <div class="emp-stat-item">
                                <div class="emp-stat-icon">⏱️</div>
                                <div class="emp-stat-value">${completedShifts}</div>
                                <div class="emp-stat-label">Смен</div>
                            </div>
                        ` : `
                            <div class="emp-stat-item">
                                <div class="emp-stat-icon">🏆</div>
                                <div class="emp-stat-value">${achievementsCount}</div>
                                <div class="emp-stat-label">Достиж.</div>
                            </div>
                        `}
                        <div class="emp-stat-item">
                            <div class="emp-stat-icon">🎁</div>
                            <div class="emp-stat-value">${giftsReceived}</div>
                            <div class="emp-stat-label">Подарков</div>
                        </div>
                        <div class="emp-stat-item">
                            <div class="emp-stat-icon">💰</div>
                            <div class="emp-stat-value">${p.coins || 0}</div>
                            <div class="emp-stat-label">WP</div>
                        </div>
                    </div>
                    
                    <div class="emp-card-footer">
                        <span class="emp-active-status" title="${escapeHtml(activeStatus)}">
                            <i class="fas fa-circle" style="font-size: 6px; margin-right: 6px; color: #a78bfa;"></i>
                            ${escapeHtml(activeStatus)}
                        </span>
                        <button class="emp-chat-btn" onclick="event.stopPropagation(); openChatWithEmployee('${escapeHtml(emp)}')" title="Написать в чат">
                            <i class="fas fa-comment-dots"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    // ============================================
    // МОДАЛКА ПРОФИЛЯ
    // ============================================
    function openProfile(employeeName) {
        if (isOpeningProfile) return;
        isOpeningProfile = true;
        setTimeout(() => isOpeningProfile = false, 300);
        
        document.body.style.overflow = 'hidden';
        
        currentProfileEmployee = employeeName;
        const p = getProfiles()[employeeName];
        if (!p) {
            document.body.style.overflow = '';
            return;
        }
        
        const isDirector = p.role === 'director';
        const isManager = p.role === 'manager';
        const isOwnProfile = employeeName === getCurrentUser();
        const currentUserRole = window.app?.currentUserRole;
        const canEdit = isOwnProfile || currentUserRole === 'director';
        
        const tasks = getTasks();
        const fines = getFines();
        const stickers = getStickers();
        const achievements = getUserAchievements()[employeeName] || [];
        const completedShifts = getCompletedShifts(employeeName);
        
        const empTasks = tasks.filter(t => t.executor === employeeName && !t.is_archived);
        const tasksDone = empTasks.filter(t => t.status === 'completed').length;
        const tasksInProgress = empTasks.filter(t => t.status === 'in_progress').length;
        const tasksOverdue = empTasks.filter(t => t.status === 'overdue').length;
        const tasksTotal = empTasks.length;
        
        const empFines = fines.filter(f => f.employee === employeeName && f.status === 'approved');
        const finesCount = empFines.length;
        const finesTotal = empFines.reduce((sum, f) => sum + (f.amount || 0), 0);
        const finesCoinsTotal = empFines.reduce((sum, f) => sum + (f.coins || 0), 0);
        
        const giftCounts = {};
        Object.values(stickers).forEach(s => {
            if (s.employee === employeeName) {
                giftCounts[s.gift_id] = (giftCounts[s.gift_id] || 0) + (s.quantity || 0);
            }
        });
        const giftsReceived = Object.values(giftCounts).reduce((a, b) => a + b, 0);
        
        const onShift = isOnShiftNow(employeeName);
        const online = isOnlineNow(employeeName);
        const activeStatus = p.active_status || p.status || '💼 Работаю';
        const streak = p.bonus_streak || 1;
        
        let avatarHtml = '';
        if (p.avatar_url && p.avatar_url.startsWith('data:image')) {
            avatarHtml = `<img src="${escapeHtml(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover;">`;
        } else if (p.avatar_url) {
            avatarHtml = `<img src="${escapeHtml(p.avatar_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null;this.parentElement.innerHTML='<span style=&quot;font-size:32px;&quot;>${escapeHtml(p.avatar || '👤')}</span>'">`;
        } else {
            avatarHtml = `<span style="font-size:32px;">${escapeHtml(p.avatar || '👤')}</span>`;
        }
        
        const rating = p.rating || 0;
        const ratingPrefix = rating >= 0 ? '+' : '';
        const ratingColor = rating >= 0 ? '#10b981' : '#ef4444';
        
        const boughtStatuses = p.bought_statuses || [];
        
        const modalContent = document.getElementById('profileModalContent');
        if (!modalContent) {
            document.body.style.overflow = '';
            return;
        }
        
        sessionStorage.setItem('lastProfileEmployee', employeeName);
        
        modalContent.innerHTML = `
            <div class="emp-modal-header">
                <div class="emp-modal-avatar" onclick="${canEdit ? 'openAvatarModal()' : ''}" style="cursor: ${canEdit ? 'pointer' : 'default'};">
                    ${avatarHtml}
                </div>
                <div class="emp-modal-title">
                    <h3>${escapeHtml(employeeName)} ${isOwnProfile ? '<span class="emp-you-badge">ВЫ</span>' : ''}</h3>
                    <p>${getRoleName(p.role)}</p>
                    ${p.phone ? `<p class="emp-modal-phone"><i class="fas fa-phone"></i> ${escapeHtml(p.phone)}</p>` : ''}
                </div>
                <button class="emp-modal-close" onclick="closeProfileModal()">&times;</button>
            </div>
            
            <div class="emp-profile-tabs">
                <button class="emp-profile-tab active" data-tab="main" onclick="switchProfileTab('main')">
                    <i class="fas fa-user"></i> Основное
                </button>
                <button class="emp-profile-tab" data-tab="stats" onclick="switchProfileTab('stats')">
                    <i class="fas fa-chart-bar"></i> Статистика
                </button>
                <button class="emp-profile-tab" data-tab="achievements" onclick="switchProfileTab('achievements')">
                    <i class="fas fa-trophy"></i> Достижения
                </button>
                <button class="emp-profile-tab" data-tab="gifts" onclick="switchProfileTab('gifts')">
                    <i class="fas fa-gift"></i> Подарки
                </button>
                ${currentUserRole === 'director' ? `
                    <button class="emp-profile-tab" data-tab="actions" onclick="switchProfileTab('actions')">
                        <i class="fas fa-cog"></i> Действия
                    </button>
                ` : ''}
            </div>
            
            <div class="emp-modal-body">
                <div id="profileTabMain" class="emp-profile-tab-content active">
                    <div class="emp-info-grid">
                        ${p.phone ? `<div class="emp-info-card"><i class="fas fa-phone"></i><span>${escapeHtml(p.phone)}</span></div>` : ''}
                        ${p.birthday ? `<div class="emp-info-card"><i class="fas fa-calendar"></i><span>${new Date(p.birthday).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>` : ''}
                    </div>
                    
                    <div class="emp-stats-grid">
                        <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-value">${p.coins || 0}</div><div class="emp-stat-label">WP</div></div>
                        <div class="emp-stat-card"><div class="emp-stat-icon">⭐</div><div class="emp-stat-value" style="color: ${ratingColor};">${ratingPrefix}${rating}</div><div class="emp-stat-label">Рейтинг</div></div>
                        <div class="emp-stat-card"><div class="emp-stat-icon">🔥</div><div class="emp-stat-value">${streak}</div><div class="emp-stat-label">Стрик</div></div>
                        <div class="emp-stat-card"><div class="emp-stat-icon">🏆</div><div class="emp-stat-value">${achievements.length}</div><div class="emp-stat-label">Достиж.</div></div>
                    </div>
                    
                    <div class="emp-status-cards">
                        ${!isDirector && !isManager ? `<div class="emp-status-card ${onShift ? 'active' : ''}"><span class="emp-status-dot ${onShift ? 'onshift' : 'offshift'}"></span><span>${onShift ? 'На смене' : 'Не на смене'}</span></div>` : ''}
                        <div class="emp-status-card ${online ? 'active' : ''}"><span class="emp-status-dot ${online ? 'online' : 'offline'}"></span><span>${online ? 'В сети' : 'Не в сети'}</span></div>
                        <div class="emp-status-card active"><i class="fas fa-tag"></i><span>${escapeHtml(activeStatus)}</span></div>
                    </div>
                    
                    ${canEdit ? `
                        <div class="emp-action-buttons">
                            <button class="emp-btn-secondary" onclick="toggleProfileEdit()"><i class="fas fa-edit"></i> Редактировать</button>
                        </div>
                    ` : ''}
                </div>
                
                <div id="profileTabStats" class="emp-profile-tab-content">
                    <div class="emp-section">
                        <h4><i class="fas fa-tasks"></i> Задачи</h4>
                        <div class="emp-stats-row">
                            <div class="emp-stat-item-detailed"><span class="label">Всего</span><span class="value">${tasksTotal}</span></div>
                            <div class="emp-stat-item-detailed success"><span class="label">✅ Выполнено</span><span class="value">${tasksDone}</span></div>
                            <div class="emp-stat-item-detailed info"><span class="label">⏳ В процессе</span><span class="value">${tasksInProgress}</span></div>
                            <div class="emp-stat-item-detailed danger"><span class="label">⚠️ Просрочено</span><span class="value">${tasksOverdue}</span></div>
                        </div>
                    </div>
                    
                    ${!isDirector && !isManager ? `
                        <div class="emp-section">
                            <h4><i class="fas fa-exclamation-triangle"></i> Штрафы</h4>
                            <div class="emp-stats-row">
                                <div class="emp-stat-item-detailed"><span class="label">Количество</span><span class="value">${finesCount}</span></div>
                                <div class="emp-stat-item-detailed warning"><span class="label">Сумма (₽)</span><span class="value">${finesTotal.toLocaleString()} ₽</span></div>
                                <div class="emp-stat-item-detailed warning"><span class="label">Списано WP</span><span class="value">${finesCoinsTotal} WP</span></div>
                            </div>
                        </div>
                        <div class="emp-section">
                            <h4><i class="fas fa-clock"></i> Смены и часы</h4>
                            <div class="emp-stats-row">
                                <div class="emp-stat-item-detailed"><span class="label">Отработано смен</span><span class="value">${completedShifts}</span></div>
                                <div class="emp-stat-item-detailed"><span class="label">Отработано часов</span><span class="value">${p.hours || 0} ч</span></div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <div id="profileTabAchievements" class="emp-profile-tab-content">
                    <div class="emp-section-header"><h4>🏆 Достижения (${achievements.length})</h4></div>
                    ${achievements.length > 0 ? `
                        <div class="emp-achievements-list">
                            ${achievements.map(a => `
                                <div class="emp-achievement-item" style="border-left-color: ${a.color || '#fbbf24'};">
                                    <span class="emp-achievement-icon">${escapeHtml(a.icon || '🏆')}</span>
                                    <div class="emp-achievement-info">
                                        <div class="emp-achievement-name">${escapeHtml(a.name)}</div>
                                        <div class="emp-achievement-desc">${escapeHtml(a.description || '')}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `<div class="emp-empty-section"><i class="fas fa-trophy"></i><p>Пока нет достижений</p></div>`}
                </div>
                
                <div id="profileTabGifts" class="emp-profile-tab-content">
                    <div class="emp-section-header"><h4>🎁 Полученные подарки (${giftsReceived})</h4></div>
                    ${Object.keys(giftCounts).length > 0 ? `
                        <div class="emp-gifts-grid">
                            ${Object.entries(giftCounts).map(([id, count]) => `
                                <div class="emp-gift-card">
                                    <div class="emp-gift-icon">${getGiftIcon(id)}</div>
                                    <div class="emp-gift-name">${getGiftName(id)}</div>
                                    <div class="emp-gift-count">×${count}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `<div class="emp-empty-section"><i class="fas fa-gift"></i><p>Пока нет подарков</p></div>`}
                </div>
                
                ${currentUserRole === 'director' && !isDirector ? `
                    <div id="profileTabActions" class="emp-profile-tab-content">
                        <div class="emp-section">
                            <h4><i class="fas fa-gift"></i> Выдать бонус</h4>
                            <div class="emp-form-group"><label>Монеты WP</label><input type="number" id="bonusCoins" value="0" min="0"></div>
                            <div class="emp-form-group"><label>Рейтинг</label><input type="number" id="bonusRating" value="0"></div>
                            <button class="emp-btn-primary" onclick="giveBonus('${escapeHtml(employeeName)}')">Выдать</button>
                        </div>
                        <div class="emp-section">
                            <h4><i class="fas fa-user-tag"></i> Сменить должность</h4>
                            <select id="newRole" class="emp-select">
                                <option value="operator" ${p.role === 'operator' ? 'selected' : ''}>👤 Оператор</option>
                                <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>⚙️ Администратор</option>
                                <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>📋 Управляющий</option>
                            </select>
                            <button class="emp-btn-primary" onclick="changeRole('${escapeHtml(employeeName)}')" style="margin-top: 12px;">Сменить</button>
                        </div>
                        <div class="emp-section danger">
                            <h4><i class="fas fa-key"></i> Сбросить пароль</h4>
                            <div class="emp-form-group"><label>Новый пароль</label><input type="password" id="newPassword"></div>
                            <button class="emp-btn-primary" onclick="resetEmployeePassword('${escapeHtml(employeeName)}')">Сбросить пароль</button>
                        </div>
                        <div class="emp-section danger">
                            <h4><i class="fas fa-trash-alt"></i> Уволить</h4>
                            <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Это действие необратимо</p>
                            <button class="emp-btn-danger" onclick="deleteEmployee('${escapeHtml(employeeName)}')">Уволить сотрудника</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        
        document.getElementById('profileModal').classList.add('active');
    }

    function closeProfileModal() {
        document.getElementById('profileModal').classList.remove('active');
        document.body.style.overflow = '';
        currentProfileEmployee = null;
    }
    
    window.switchProfileTab = function(tabName) {
        document.querySelectorAll('.emp-profile-tab').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tabName) btn.classList.add('active');
        });
        document.querySelectorAll('.emp-profile-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        const activeContent = document.getElementById(`profileTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
        if (activeContent) {
            activeContent.classList.add('active');
        }
    };
    
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initEmployees() {
        if (employeesInitialized) {
            console.log('👥 Сотрудники уже инициализированы');
            const grid = document.getElementById('employeesGrid');
            if (grid && grid.children.length === 0) {
                safeRenderEmployees();
            }
            return;
        }
        
        console.log('👥 Инициализация команды');
        
        const grid = document.getElementById('employeesGrid');
        if (!grid) {
            setTimeout(initEmployees, 100);
            return;
        }
        
        // 🔥 ВАЖНО: загружаем данные перед рендером
        if (typeof loadEmployees === 'function') {
            loadEmployees().then(() => {
                safeRenderEmployees();
            });
        } else {
            safeRenderEmployees();
        }
        
        const createBtn = document.getElementById('createEmployeeBtn');
        if (createBtn) {
            createBtn.style.display = window.app?.currentUserRole === 'director' ? 'inline-flex' : 'none';
        }
        
        employeesInitialized = true;
    }
    
    // ============================================
    // ЭКСПОРТ
    // ============================================
    window.initEmployees = initEmployees;
    window.resetEmployeesState = resetEmployeesState;
    window.renderEmployees = renderEmployees;
    window.safeRenderEmployees = safeRenderEmployees;
    window.openProfile = openProfile;
    window.closeProfileModal = closeProfileModal;
    window.openMyProfile = function() {
        if (window.app?.currentUser) openProfile(window.app.currentUser);
    };
    window.openChatWithEmployee = function(employeeName) {
        if (typeof loadPage === 'function') {
            loadPage('chat');
            setTimeout(() => { 
                if (typeof switchChat === 'function') switchChat(employeeName); 
            }, 300);
        }
    };

    console.log('✅ employees.js загружен (v2.2)');
})();