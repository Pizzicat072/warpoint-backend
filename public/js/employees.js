// public/js/employees.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

(function() {
    'use strict';
    
    // ============================================
    // ЛОКАЛЬНЫЕ ПЕРЕМЕННЫЕ
    // ============================================
    let currentProfileEmployee = null;
    let pendingAvatarBase64 = null;
    
    // ============================================
    // 🔥 ИСПРАВЛЕНО: getTobolskNow без рекурсии
    // ============================================
    function getTobolskNow() {
        if (typeof window.getTobolskNow === 'function' && window.getTobolskNow !== getTobolskNow) {
            return window.getTobolskNow();
        }
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
    }
    
    // ============================================
    // ПОЛУЧЕНИЕ ДАННЫХ ИЗ window.app
    // ============================================
    function getEmployees() { return window.app?.employees || []; }
    function getProfiles() { return window.app?.profiles || {}; }
    function getSchedule() { return window.app?.schedule || {}; }
    function getTasks() { return window.app?.tasks || []; }
    function getFines() { return window.app?.fines || []; }
    function getStickers() { return window.app?.stickers || {}; }
    function getCurrentUser() { return window.app?.currentUser; }
    function getLastActivity() { return window.app?.lastActivity || {}; }
    function getAchievements() { return window.app?.achievements || {}; }
    
    // ============================================
    // СТАТУСЫ "НА СМЕНЕ" И "В СЕТИ"
    // ============================================
    function isOnShiftNow(emp) {
        const today = getTobolskNow().toISOString().split('T')[0];
        const schedule = getSchedule();
        const shift = schedule[today]?.[emp];
        const profile = getProfiles()[emp];
        
        if (profile?.role === 'director') return false;
        if (!shift || !shift.time) return false;
        if (shift.status && shift.status !== 'working') return false;
        
        const now = getTobolskNow();
        const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
        const shiftStartMinutes = (parseInt(shift.time.split(':')[0]) || 10) * 60;
        const shiftEndMinutes = 22 * 60;
        
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
            if (new Date(date) < now && shifts[emp]?.time) count++;
        }
        return count;
    }
    
    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ
    // ============================================
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
    
    // ============================================
    // РЕНДЕР КАРТОЧЕК (С ПРОВЕРКОЙ DOM)
    // ============================================
    function renderEmployees() {
        const grid = document.getElementById('employeesGrid');
        if (!grid) {
            console.warn('⚠️ employeesGrid не найден, ждём...');
            return;
        }
        
        const employees = getEmployees();
        const profiles = getProfiles();
        const currentUser = getCurrentUser();
        const tasks = getTasks();
        const fines = getFines();
        const stickers = getStickers();
        
        if (!employees.length) {
            grid.innerHTML = `
                <div class="emp-empty-state">
                    <div class="emp-empty-icon">👥</div>
                    <h3>Нет сотрудников</h3>
                    <p>Добавьте первого сотрудника</p>
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
            
            const empTasks = tasks.filter(t => t.executor === emp);
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
            
            const avatarHtml = p.avatar_url 
                ? `<img src="${p.avatar_url}" alt="${emp}">` 
                : (p.avatar || '👤');
            
            const rating = p.rating || 0;
            const ratingClass = rating >= 0 ? 'good' : 'bad';
            const ratingPrefix = rating >= 0 ? '+' : '';
            
            return `
                <div class="emp-card ${isCurrent ? 'current-user' : ''}" onclick="openProfile('${emp}')">
                    <div class="emp-card-glow"></div>
                    
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
                                <h3>${emp}</h3>
                                ${isCurrent ? '<span class="emp-you-badge">ВЫ</span>' : ''}
                                ${hasBirthdaySoon ? '<span class="emp-birthday-badge">🎂</span>' : ''}
                            </div>
                            <div class="emp-role">
                                <i class="fas fa-briefcase"></i> ${getRoleShortName(p.role)}
                            </div>
                        </div>
                    </div>
                    
                    <div class="emp-status-row">
                        ${!isDirector ? `
                            <div class="emp-status">
                                <span class="emp-status-dot ${onShift ? 'onshift' : 'offshift'}"></span>
                                <span>${onShift ? 'На смене' : 'Не на смене'}</span>
                            </div>
                        ` : ''}
                        <div class="emp-status">
                            <span class="emp-status-dot ${online ? 'online' : 'offline'}"></span>
                            <span>${online ? 'В сети' : 'Не в сети'}</span>
                        </div>
                    </div>
                    
                    <div class="emp-stats">
                        <div class="emp-stat-item">
                            <div class="emp-stat-icon">✅</div>
                            <div class="emp-stat-value">${tasksDone}</div>
                            <div class="emp-stat-label">Задач</div>
                        </div>
                        ${!isDirector ? `
                            <div class="emp-stat-item">
                                <div class="emp-stat-icon">⚠️</div>
                                <div class="emp-stat-value">${empFines.length}</div>
                                <div class="emp-stat-label">Штрафов</div>
                            </div>
                        ` : `
                            <div class="emp-stat-item">
                                <div class="emp-stat-icon">⏱️</div>
                                <div class="emp-stat-value">${getCompletedShifts(emp)}</div>
                                <div class="emp-stat-label">Смен</div>
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
                        <span class="emp-active-status">
                            <i class="fas fa-circle" style="font-size: 6px; margin-right: 6px; color: #a78bfa;"></i>
                            ${activeStatus}
                        </span>
                        <button class="emp-chat-btn" onclick="event.stopPropagation(); openChatWithEmployee('${emp}')" title="Написать">
                            <i class="fas fa-comment-dots"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // ============================================
    // МОДАЛКА ПРОФИЛЯ (С ПРОВЕРКОЙ DOM)
    // ============================================
    function openProfile(employeeName) {
        currentProfileEmployee = employeeName;
        const p = getProfiles()[employeeName];
        if (!p) return;
        
        const isDirector = p.role === 'director';
        const isOwnProfile = employeeName === getCurrentUser();
        const currentUserRole = window.app?.currentUserRole;
        const canEdit = isOwnProfile || currentUserRole === 'director';
        
        const tasks = getTasks();
        const fines = getFines();
        const stickers = getStickers();
        const achievements = getAchievements()[employeeName] || [];
        const completedShifts = getCompletedShifts(employeeName);
        
        const empTasks = tasks.filter(t => t.executor === employeeName);
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
        
        const avatarHtml = p.avatar_url 
            ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;">` 
            : (p.avatar || '👤');
        
        const rating = p.rating || 0;
        const ratingPrefix = rating >= 0 ? '+' : '';
        const ratingColor = rating >= 0 ? '#10b981' : '#ef4444';
        
        const modalContent = document.getElementById('profileModalContent');
        if (!modalContent) {
            console.warn('⚠️ profileModalContent не найден');
            return;
        }
        
        modalContent.innerHTML = `
            <div class="emp-modal-header">
                <div class="emp-modal-avatar">
                    ${avatarHtml}
                    <div class="emp-modal-avatar-ring"></div>
                </div>
                <div class="emp-modal-title">
                    <h3>${employeeName} ${isOwnProfile ? '<span class="emp-you-badge">ВЫ</span>' : ''}</h3>
                    <p>${getRoleName(p.role)}</p>
                    ${p.phone ? `<p class="emp-modal-phone"><i class="fas fa-phone"></i> ${p.phone}</p>` : ''}
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
                        ${p.phone ? `<div class="emp-info-card"><i class="fas fa-phone"></i><span>${p.phone}</span></div>` : ''}
                        ${p.birthday ? `<div class="emp-info-card"><i class="fas fa-calendar"></i><span>${new Date(p.birthday).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>` : ''}
                    </div>
                    
                    <div class="emp-stats-grid">
                        <div class="emp-stat-card"><div class="emp-stat-icon">💰</div><div class="emp-stat-value">${p.coins || 0}</div><div class="emp-stat-label">WP</div></div>
                        <div class="emp-stat-card"><div class="emp-stat-icon">⭐</div><div class="emp-stat-value" style="color: ${ratingColor};">${ratingPrefix}${rating}</div><div class="emp-stat-label">Рейтинг</div></div>
                        ${!isDirector ? `
                            <div class="emp-stat-card"><div class="emp-stat-icon">📅</div><div class="emp-stat-value">${completedShifts}</div><div class="emp-stat-label">Смен</div></div>
                            <div class="emp-stat-card"><div class="emp-stat-icon">⏱️</div><div class="emp-stat-value">${p.hours || 0}ч</div><div class="emp-stat-label">Часов</div></div>
                        ` : `
                            <div class="emp-stat-card"><div class="emp-stat-icon">🔥</div><div class="emp-stat-value">${p.bonus_streak || 1}</div><div class="emp-stat-label">Стрик</div></div>
                            <div class="emp-stat-card"><div class="emp-stat-icon">🏆</div><div class="emp-stat-value">${achievements.length}</div><div class="emp-stat-label">Достижений</div></div>
                        `}
                    </div>
                    
                    <div class="emp-status-cards">
                        ${!isDirector ? `<div class="emp-status-card ${onShift ? 'active' : ''}"><span class="emp-status-dot ${onShift ? 'onshift' : 'offshift'}"></span><span>${onShift ? 'На смене' : 'Не на смене'}</span></div>` : ''}
                        <div class="emp-status-card ${online ? 'active' : ''}"><span class="emp-status-dot ${online ? 'online' : 'offline'}"></span><span>${online ? 'В сети' : 'Не в сети'}</span></div>
                        <div class="emp-status-card active"><i class="fas fa-tag"></i><span>${activeStatus}</span></div>
                    </div>
                    
                    ${canEdit ? `
                        <div class="emp-action-buttons">
                            ${isOwnProfile ? `<button class="emp-btn-secondary" onclick="closeProfileModal(); openAvatarModal()"><i class="fas fa-camera"></i> Сменить аватар</button>` : ''}
                            <button class="emp-btn-secondary" onclick="toggleProfileEdit()"><i class="fas fa-edit"></i> Редактировать</button>
                        </div>
                        <div id="profileEditFields" class="emp-edit-fields" style="display: none;">
                            <div class="emp-form-group"><label><i class="fas fa-user"></i> Имя</label><input type="text" id="editName" value="${employeeName}"></div>
                            <div class="emp-form-group"><label><i class="fas fa-phone"></i> Телефон</label><input type="tel" id="editPhone" value="${p.phone || ''}" placeholder="+7 (___) ___-__-__"></div>
                            <div class="emp-form-group"><label><i class="fas fa-calendar"></i> Дата рождения</label><input type="date" id="editBirthday" value="${p.birthday || ''}"></div>
                            <div class="emp-form-group"><label><i class="fas fa-tag"></i> Статус</label>
                                <select id="editStatus">
                                    <option value="💼 Работаю" ${p.status === '💼 Работаю' ? 'selected' : ''}>💼 Работаю</option>
                                    <option value="☕ Перерыв" ${p.status === '☕ Перерыв' ? 'selected' : ''}>☕ Перерыв</option>
                                    <option value="🎯 В фокусе" ${p.status === '🎯 В фокусе' ? 'selected' : ''}>🎯 В фокусе</option>
                                    <option value="⭐ MVP" ${p.status === '⭐ MVP' ? 'selected' : ''}>⭐ MVP</option>
                                    <option value="🚀 Взлёт" ${p.status === '🚀 Взлёт' ? 'selected' : ''}>🚀 Взлёт</option>
                                </select>
                            </div>
                            <div class="emp-edit-actions">
                                <button class="emp-btn-primary" onclick="saveProfileChanges()">💾 Сохранить</button>
                                <button class="emp-btn-secondary" onclick="cancelProfileEdit()">↩️ Отмена</button>
                            </div>
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
                        ${tasksTotal > 0 ? `<div class="emp-progress-bar"><div class="emp-progress-fill" style="width: ${(tasksDone / tasksTotal) * 100}%;"></div></div>` : ''}
                    </div>
                    
                    ${!isDirector ? `
                        <div class="emp-section">
                            <h4><i class="fas fa-exclamation-triangle"></i> Штрафы</h4>
                            <div class="emp-stats-row">
                                <div class="emp-stat-item-detailed"><span class="label">Количество</span><span class="value">${finesCount}</span></div>
                                <div class="emp-stat-item-detailed warning"><span class="label">Сумма (₽)</span><span class="value">${finesTotal} ₽</span></div>
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
                                    <span class="emp-achievement-icon">${a.icon}</span>
                                    <div class="emp-achievement-info">
                                        <div class="emp-achievement-name">${a.name}</div>
                                        <div class="emp-achievement-desc">${a.description || ''}</div>
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
                
                ${currentUserRole === 'director' ? `
                    <div id="profileTabActions" class="emp-profile-tab-content">
                        <div class="emp-section">
                            <h4><i class="fas fa-gift"></i> Выдать бонус</h4>
                            <div class="emp-form-group"><label>Монеты WP</label><input type="number" id="bonusCoins" value="0"></div>
                            <div class="emp-form-group"><label>Рейтинг</label><input type="number" id="bonusRating" value="0"></div>
                            <button class="emp-btn-primary" onclick="giveBonus('${employeeName}')"><i class="fas fa-check"></i> Выдать</button>
                        </div>
                        ${!isDirector ? `
                            <div class="emp-section">
                                <h4><i class="fas fa-user-tag"></i> Сменить должность</h4>
                                <select id="newRole" class="emp-select">
                                    <option value="operator" ${p.role === 'operator' ? 'selected' : ''}>👤 Оператор</option>
                                    <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>⚙️ Администратор</option>
                                    <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>📋 Управляющий</option>
                                </select>
                                <button class="emp-btn-primary" onclick="changeRole('${employeeName}')" style="margin-top: 12px;">Сменить</button>
                            </div>
                            <div class="emp-section danger">
                                <h4><i class="fas fa-trash-alt"></i> Уволить</h4>
                                <p style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">Это действие необратимо</p>
                                <button class="emp-btn-danger" onclick="deleteEmployee('${employeeName}')">Уволить сотрудника</button>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
        
        document.getElementById('profileModal').classList.add('active');
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
        if (activeContent) activeContent.classList.add('active');
    };
    
    function closeProfileModal() {
        document.getElementById('profileModal').classList.remove('active');
        currentProfileEmployee = null;
    }
    
    function toggleProfileEdit() {
        const editFields = document.getElementById('profileEditFields');
        if (editFields) editFields.style.display = editFields.style.display === 'none' ? 'block' : 'none';
    }
    
    async function saveProfileChanges() {
        const name = document.getElementById('editName')?.value;
        const phone = document.getElementById('editPhone')?.value;
        const birthday = document.getElementById('editBirthday')?.value;
        const status = document.getElementById('editStatus')?.value;
        
        const updates = {};
        if (name && name !== currentProfileEmployee) updates.name = name;
        if (phone !== undefined) updates.phone = phone;
        if (birthday !== undefined) updates.birthday = birthday;
        if (status !== undefined) updates.status = status;
        
        if (Object.keys(updates).length === 0) {
            closeProfileModal();
            return;
        }
        
        const res = await apiCall(`/profiles/${encodeURIComponent(currentProfileEmployee)}`, 'PUT', updates);
        
        if (res?.success) {
            showNotif('✅ Профиль обновлён', 'success');
            await loadEmployees();
            closeProfileModal();
            renderEmployees();
        } else {
            showNotif('❌ Ошибка обновления', 'error');
        }
    }
    
    function cancelProfileEdit() {
        toggleProfileEdit();
    }
    
    function openAvatarModal() {
        const grid = document.getElementById('avatarGrid');
        if (!grid) return;
        
        const avatars = ['👤', '😎', '🔥', '⚡', '🎯', '🏆', '🦸', '👑'];
        grid.innerHTML = avatars.map(a => `<div class="emp-avatar-item" onclick="selectAvatar('${a}')">${a}</div>`).join('');
        
        document.getElementById('avatarModal').classList.add('active');
    }
    
    function closeAvatarModal() { 
        document.getElementById('avatarModal').classList.remove('active'); 
    }
    
    async function selectAvatar(avatar) {
        if (currentProfileEmployee && currentProfileEmployee === getCurrentUser()) {
            const success = await updateEmployeeAvatar(currentProfileEmployee, avatar);
            if (success) {
                showNotif('Аватар изменён', 'success');
                renderEmployees();
                closeAvatarModal();
                if (typeof window.updateHeaderAvatar === 'function') window.updateHeaderAvatar(null, avatar);
            }
        }
    }
    
    function openAvatarUploadModal() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { 
                showNotif('Файл слишком большой (макс. 2MB)', 'error'); 
                return; 
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                pendingAvatarBase64 = event.target.result;
                document.getElementById('avatarPreviewImg').src = pendingAvatarBase64;
                document.getElementById('avatarPreviewModal').classList.add('active');
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
    
    function closeAvatarPreviewModal() { 
        document.getElementById('avatarPreviewModal').classList.remove('active'); 
        pendingAvatarBase64 = null; 
    }
    
    async function confirmAvatarUpload() {
        if (currentProfileEmployee && currentProfileEmployee === getCurrentUser() && pendingAvatarBase64) {
            const success = await updateEmployeeAvatarBase64(currentProfileEmployee, pendingAvatarBase64);
            if (success) {
                showNotif('Аватар обновлён', 'success');
                renderEmployees();
                closeAvatarPreviewModal();
            }
        }
        pendingAvatarBase64 = null;
    }
    
    function openChatWithEmployee(employeeName) {
        if (typeof loadPage === 'function') {
            loadPage('chat');
            setTimeout(() => { if (typeof switchChat === 'function') switchChat(employeeName); }, 300);
        }
    }
    
    function openMyProfile() {
        if (window.app?.currentUser) openProfile(window.app.currentUser);
    }
    
    function openCreateEmployeeModal() {
        document.getElementById('createEmployeeModal').classList.add('active');
        selectRole('operator');
    }
    
    function closeCreateEmployeeModal() {
        document.getElementById('createEmployeeModal').classList.remove('active');
        document.getElementById('newEmpName').value = '';
        document.getElementById('newEmpPassword').value = '';
        document.getElementById('newEmpBirthday').value = '';
        document.getElementById('newEmpPhone').value = '';
    }
    
    function selectRole(role) {
        document.getElementById('newEmpRole').value = role;
        document.querySelectorAll('.emp-role-option').forEach(opt => {
            opt.classList.remove('active');
            const radio = opt.querySelector('input[type="radio"]');
            if (radio && radio.value === role) {
                opt.classList.add('active');
                radio.checked = true;
            }
        });
    }
    
    async function createEmployee() {
        const name = document.getElementById('newEmpName')?.value.trim();
        const password = document.getElementById('newEmpPassword')?.value;
        const role = document.getElementById('newEmpRole')?.value;
        const birthday = document.getElementById('newEmpBirthday')?.value;
        const phone = document.getElementById('newEmpPhone')?.value;
        
        if (!name || !password) {
            showNotif('Заполните имя и пароль', 'error');
            return;
        }
        
        const response = await apiCall('/employees', 'POST', { name, role, password, birthday, phone });
        
        if (response && response.success) {
            showNotif(`✅ Сотрудник ${name} создан`, 'success');
            closeCreateEmployeeModal();
            await loadEmployees();
            renderEmployees();
        } else {
            showNotif('❌ Ошибка при создании', 'error');
        }
    }
    
    async function giveBonus(employeeName) {
        const coins = parseInt(document.getElementById('bonusCoins')?.value) || 0;
        const rating = parseInt(document.getElementById('bonusRating')?.value) || 0;
        
        if (coins === 0 && rating === 0) {
            showNotif('Укажите сумму', 'warning');
            return;
        }
        
        const res = await apiCall('/admin/bonus/employee', 'POST', { name: employeeName, coins, rating });
        if (res?.success) {
            showNotif('✅ Бонус выдан', 'success');
            closeProfileModal();
            await loadEmployees();
            renderEmployees();
            if (typeof refreshAllBalanceDisplays === 'function') refreshAllBalanceDisplays();
        } else {
            showNotif('❌ Ошибка', 'error');
        }
    }
    
    async function changeRole(employeeName) {
        const role = document.getElementById('newRole')?.value;
        if (!role) return;
        
        const res = await apiCall(`/employees/${encodeURIComponent(employeeName)}/role`, 'PUT', { role });
        if (res?.success) {
            showNotif('✅ Роль изменена', 'success');
            closeProfileModal();
            await loadEmployees();
            renderEmployees();
        } else {
            showNotif('❌ Ошибка', 'error');
        }
    }
    
    async function deleteEmployee(employeeName) {
        if (!confirm(`Уволить ${employeeName}?`)) return;
        
        const res = await apiCall(`/employees/${encodeURIComponent(employeeName)}`, 'DELETE');
        if (res?.success) {
            showNotif(`✅ ${employeeName} уволен`, 'success');
            closeProfileModal();
            await loadEmployees();
            renderEmployees();
        } else {
            showNotif('❌ Ошибка', 'error');
        }
    }
    
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ (С ОЖИДАНИЕМ DOM)
    // ============================================
    function initEmployees() {
        console.log('👥 Инициализация команды');
        
        const grid = document.getElementById('employeesGrid');
        if (!grid) {
            console.warn('⚠️ employeesGrid не найден, ждём...');
            setTimeout(initEmployees, 100);
            return;
        }
        
        renderEmployees();
        
        const createBtn = document.getElementById('createEmployeeBtn');
        if (createBtn) {
            createBtn.style.display = window.app?.currentUserRole === 'director' ? 'inline-flex' : 'none';
        }
    }
    
    window.addEventListener('dataUpdate', () => renderEmployees());
    
    // ============================================
    // ЭКСПОРТ
    // ============================================
    window.initEmployees = initEmployees;
    window.renderEmployees = renderEmployees;
    window.openProfile = openProfile;
    window.closeProfileModal = closeProfileModal;
    window.toggleProfileEdit = toggleProfileEdit;
    window.saveProfileChanges = saveProfileChanges;
    window.cancelProfileEdit = cancelProfileEdit;
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
    window.deleteEmployee = deleteEmployee;
    
})();