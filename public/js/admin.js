// public/js/admin.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.1
// Добавлены все уведомления

let adminEmployeesList = [];
let isLoadingAdmin = false;
let adminInitialized = false;

// ============================================
// СБРОС СОСТОЯНИЯ
// ============================================

function resetAdminState() {
    console.log('🧹 Сброс состояния админки');
    adminInitialized = false;
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
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

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initAdmin() {
    if (adminInitialized) {
        console.log('⚙️ Админка уже инициализирована');
        return;
    }
    
    console.log('⚙️ Инициализация админки');
    
    if (window.app?.currentUserRole !== 'director') {
        const container = document.getElementById('adminTabEmployees');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔒</div>
                    <h3>Доступ запрещён</h3>
                    <p>Эта страница доступна только директору</p>
                </div>
            `;
        }
        return;
    }
    
    loadAdminData();
    loadCurrentTheme();
    
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`adminTab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`)?.classList.add('active');
        });
    });
    
    adminInitialized = true;
}

async function loadAdminData() {
    if (isLoadingAdmin) return;
    isLoadingAdmin = true;
    
    await loadEmployees();
    adminEmployeesList = window.app?.employees || [];
    renderAdminEmployees();
    loadFundAmount();
    
    isLoadingAdmin = false;
}

function renderAdminEmployees() {
    const container = document.getElementById('adminEmployeesList');
    if (!container) return;
    
    if (adminEmployeesList.length === 0) {
        container.innerHTML = '<div class="empty-state">Нет сотрудников</div>';
        return;
    }
    
    const roleNames = {
        director: 'Директор',
        manager: 'Управляющий',
        admin: 'Админ',
        operator: 'Оператор'
    };
    
    container.innerHTML = adminEmployeesList.map(emp => {
        const profile = window.app?.profiles?.[emp];
        const roleName = roleNames[profile?.role] || 'Оператор';
        const isDirector = emp === 'Денис';
        
        return `
            <div class="admin-employee-card">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #6366f1, #ec4899); border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 24px;">
                        ${profile?.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" style="width: 100%; height: 100%; object-fit: cover;">` : (escapeHtml(profile?.avatar) || '👤')}
                    </div>
                    <div>
                        <div style="font-weight: 600;">${escapeHtml(emp)} ${isDirector ? '👑' : ''}</div>
                        <div style="font-size: 12px; color: #64748b;">${roleName}</div>
                        <div style="font-size: 11px;">💰 ${profile?.coins || 0} монет | ⭐ ${profile?.rating || 0} рейтинг</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-small" onclick="openBonusModal('${escapeHtml(emp)}')">🎁 Бонус</button>
                    ${!isDirector ? `
                        <button class="btn-small" onclick="changeEmployeeRole('${escapeHtml(emp)}', '${profile?.role || 'operator'}')" style="background: rgba(139,92,246,0.2); border-color: #8b5cf6; color: #a78bfa;">👔 Должность</button>
                        <button class="btn-small" onclick="openResetPasswordModal('${escapeHtml(emp)}')" style="background: rgba(59,130,246,0.2); border-color: #3b82f6; color: #60a5fa;">🔑 Пароль</button>
                        <button class="btn-small btn-danger" onclick="deleteEmployee('${escapeHtml(emp)}')">🗑️ Удалить</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// СБРОС ПАРОЛЯ
// ============================================

function openResetPasswordModal(employeeName) {
    const modalHtml = `
        <div id="resetPasswordModal" class="modal active">
            <div class="modal-window" style="max-width: 400px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>🔑 Сбросить пароль</h3>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Сотрудник: ${escapeHtml(employeeName)}</p>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label>Новый пароль</label>
                        <input type="password" id="newPasswordInput" class="edit-input" style="width: 100%;" placeholder="Введите новый пароль" minlength="3">
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label>Подтвердите пароль</label>
                        <input type="password" id="confirmPasswordInput" class="edit-input" style="width: 100%;" placeholder="Повторите пароль">
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-primary" onclick="resetPassword('${escapeHtml(employeeName)}')">💾 Сохранить</button>
                    <button class="btn-secondary" onclick="closeResetPasswordModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeResetPasswordModal() {
    const modal = document.getElementById('resetPasswordModal');
    if (modal) modal.remove();
}

async function resetPassword(employeeName) {
    const newPassword = document.getElementById('newPasswordInput')?.value;
    const confirmPassword = document.getElementById('confirmPasswordInput')?.value;
    
    if (!newPassword || newPassword.length < 3) {
        showSystemNotification('❌ Пароль должен быть не менее 3 символов', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showSystemNotification('❌ Пароли не совпадают', 'error');
        return;
    }
    
    const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}/password`, 'PUT', { password: newPassword });
    
    if (response && response.success) {
        showSystemNotification(`✅ Пароль для ${employeeName} изменён`, 'success');
        closeResetPasswordModal();
    } else {
        showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

// ============================================
// БОНУС
// ============================================

function openBonusModal(employeeName) {
    const modalHtml = `
        <div id="bonusModal" class="modal active">
            <div class="modal-window" style="max-width: 400px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>🎁 Выдать бонус</h3>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Сотрудник: ${escapeHtml(employeeName)}</p>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label>💰 Монеты</label>
                        <input type="number" id="bonusCoins" class="edit-input" style="width: 100%;" value="0" min="0">
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label>⭐ Рейтинг</label>
                        <input type="number" id="bonusRating" class="edit-input" style="width: 100%;" value="0">
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-primary" onclick="giveBonus('${escapeHtml(employeeName)}')">Выдать</button>
                    <button class="btn-secondary" onclick="closeBonusModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeBonusModal() {
    const modal = document.getElementById('bonusModal');
    if (modal) modal.remove();
}

async function giveBonus(employeeName) {
    const coins = parseInt(document.getElementById('bonusCoins')?.value) || 0;
    const rating = parseInt(document.getElementById('bonusRating')?.value) || 0;
    
    if (coins < 0) {
        showSystemNotification('❌ Сумма монет не может быть отрицательной', 'error');
        return;
    }
    
    if (coins === 0 && rating === 0) {
        showSystemNotification('⚠️ Укажите сумму или рейтинг', 'warning');
        return;
    }
    
    const response = await apiCall('/admin/bonus/employee', 'POST', { name: employeeName, coins, rating });
    
    if (response && response.success) {
        let msg = '✅ Бонус выдан: ';
        if (coins > 0) msg += `+${coins} WP `;
        if (rating !== 0) msg += `${rating > 0 ? '+' : ''}${rating} рейтинга`;
        showSystemNotification(msg, 'success');
        closeBonusModal();
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof refreshAllBalanceDisplays === 'function') refreshAllBalanceDisplays();
        
        if (typeof window.sendEvent === 'function' && coins > 0) {
            window.sendEvent('bonus_received', { coins, reason: 'Бонус от директора' }, employeeName);
        }
    } else {
        showSystemNotification('❌ Ошибка при выдаче бонуса', 'error');
    }
}

// ============================================
// РОЛЬ
// ============================================

async function changeEmployeeRole(employeeName, currentRole) {
    const roles = [
        { value: 'operator', name: '👤 Оператор' },
        { value: 'admin', name: '⚙️ Администратор' },
        { value: 'manager', name: '📋 Управляющий' }
    ];
    
    const optionsHtml = roles.map(r => 
        `<option value="${r.value}" ${r.value === currentRole ? 'selected' : ''}>${r.name}</option>`
    ).join('');
    
    const modalHtml = `
        <div id="roleModal" class="modal active">
            <div class="modal-window" style="max-width: 400px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>👤 Изменить должность</h3>
                    <p style="margin: 4px 0 0; font-size: 12px; color: #64748b;">Сотрудник: ${escapeHtml(employeeName)}</p>
                </div>
                <div style="padding: 20px;">
                    <label>Новая должность</label>
                    <select id="newRoleSelect" class="edit-input" style="width: 100%;">${optionsHtml}</select>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-primary" onclick="saveEmployeeRole('${escapeHtml(employeeName)}')">💾 Сохранить</button>
                    <button class="btn-secondary" onclick="closeRoleModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeRoleModal() {
    const modal = document.getElementById('roleModal');
    if (modal) modal.remove();
}

async function saveEmployeeRole(employeeName) {
    const select = document.getElementById('newRoleSelect');
    if (!select) return;
    
    const newRole = select.value;
    const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}/role`, 'PUT', { role: newRole });
    
    if (response && response.success) {
        showSystemNotification(`✅ Роль изменена`, 'success');
        closeRoleModal();
        
        if (employeeName === window.app?.currentUser) {
            window.app.currentUserRole = newRole;
            window.app.currentUserPermissions = window.rolesMap?.[newRole] || window.rolesMap?.operator;
            
            if (typeof renderMainMenu === 'function') {
                renderMainMenu();
            }
        }
        
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

async function deleteEmployee(employeeName) {
    if (!confirm(`⚠️ ВНИМАНИЕ!\n\nВы уверены, что хотите УВОЛИТЬ сотрудника "${employeeName}"?\n\nЭто действие НЕОБРАТИМО! Все данные сотрудника будут удалены.`)) return;
    if (!confirm('Точно? Данные нельзя будет восстановить.')) return;
    
    const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}`, 'DELETE');
    
    if (response && response.success) {
        showSystemNotification(`✅ Сотрудник ${employeeName} уволен`, 'warning');
        
        if (window.app) {
            window.app.employees = window.app.employees.filter(e => e !== employeeName);
            delete window.app.profiles[employeeName];
        }
        
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
    }
}

// ============================================
// ФОНД
// ============================================

async function loadFundAmount() {
    try {
        const response = await apiCall('/fund');
        if (response && response.amount !== undefined) {
            const display = document.getElementById('fundDisplayAmount');
            if (display) {
                display.textContent = response.amount.toLocaleString() + ' ₽';
            }
            window.fundAmount = response.amount;
        }
    } catch (err) {
        console.error('Ошибка загрузки фонда:', err);
    }
}

async function updateFund() {
    const amount = parseInt(document.getElementById('fundChangeAmount')?.value) || 0;
    if (amount < 0) {
        showSystemNotification('❌ Сумма не может быть отрицательной', 'error');
        return;
    }
    if (!confirm(`Установить фонд в ${amount.toLocaleString()} ₽?`)) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: amount });
    if (response && response.success) {
        showSystemNotification(`💰 Фонд установлен: ${amount.toLocaleString()} ₽`, 'success');
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
    } else {
        showSystemNotification('❌ Ошибка при обновлении фонда', 'error');
    }
}

async function addToFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) { showSystemNotification('⚠️ Введите сумму', 'warning'); return; }
    
    const response = await apiCall('/fund/add', 'POST', { sum: amount });
    if (response && response.success) {
        showSystemNotification(`💰 Добавлено ${amount.toLocaleString()} ₽`, 'success');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
    } else {
        showSystemNotification('❌ Ошибка при добавлении', 'error');
    }
}

async function subtractFromFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) { showSystemNotification('⚠️ Введите сумму', 'warning'); return; }
    
    const response = await apiCall('/fund/add', 'POST', { sum: -amount });
    if (response && response.success) {
        showSystemNotification(`💰 Убавлено ${amount.toLocaleString()} ₽`, 'warning');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
    } else {
        showSystemNotification('❌ Ошибка при убавлении', 'error');
    }
}

async function resetFund() {
    if (!confirm('Сбросить фонд в 0?')) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: 0 });
    if (response && response.success) {
        showSystemNotification('💰 Фонд обнулён', 'warning');
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        window.dispatchEvent(new CustomEvent('dataUpdate', { detail: { type: 'fund' } }));
    } else {
        showSystemNotification('❌ Ошибка при сбросе', 'error');
    }
}

// ============================================
// ТЕМА
// ============================================

async function setGlobalTheme(themeId) {
    if (window.app?.currentUserRole !== 'director') {
        showSystemNotification('❌ Только директор может менять тему', 'error');
        return;
    }
    
    const themeNames = {
        'vr-portal': 'VR-портал', 'hacker': 'Хакер', 'glitch': 'Глитч',
        'explosion': 'Взрыв', 'depth': 'Глубина', 'charge': 'Заряд'
    };
    
    try {
        const response = await apiCall('/admin/theme', 'POST', { theme: themeId });
        if (response && response.success) {
            showSystemNotification(`🎨 Тема изменена на ${themeNames[themeId]}`, 'success');
            applyGlobalTheme(themeId);
            const nameEl = document.getElementById('currentThemeName');
            if (nameEl) nameEl.textContent = themeNames[themeId];
        } else {
            showSystemNotification('❌ Ошибка при смене темы', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showSystemNotification('❌ Ошибка соединения', 'error');
    }
}

function applyGlobalTheme(themeId) {
    const body = document.body;
    const themes = ['vr-portal', 'hacker', 'glitch', 'explosion', 'depth', 'charge'];
    themes.forEach(theme => body.classList.remove(`global-${theme}`));
    if (themeId && themeId !== 'vr-portal') {
        body.classList.add(`global-${themeId}`);
    }
    localStorage.setItem('globalTheme', themeId || 'vr-portal');
}

async function loadCurrentTheme() {
    try {
        const response = await apiCall('/admin/theme');
        if (response && response.success && response.theme) {
            applyGlobalTheme(response.theme);
            const themeNames = {
                'vr-portal': 'VR-портал', 'hacker': 'Хакер', 'glitch': 'Глитч',
                'explosion': 'Взрыв', 'depth': 'Глубина', 'charge': 'Заряд'
            };
            const nameEl = document.getElementById('currentThemeName');
            if (nameEl) nameEl.textContent = themeNames[response.theme] || response.theme;
        }
    } catch (16) {
        console.error('Ошибка загрузки темы:', err);
    }
}

// ============================================
// СБРОС ДАННЫХ
// ============================================

async function resetAllData() {
    if (!confirm('⚠️ ВНИМАНИЕ! Будут удалены ВСЕ сотрудники кроме директора и ВСЕ данные!\n\nЭто действие НЕОБРАТИМО. Продолжить?')) return;
    if (!confirm('Точно? Все задачи, график, достижения, чаты будут удалены.')) return;
    
    showSystemNotification('🧹 Сброс данных...', 'info');
    
    try {
        const response = await apiCall('/admin/reset-all', 'POST');
        if (response && response.success) {
            showSystemNotification('✅ ' + response.message, 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        showSystemNotification('❌ Ошибка соединения', 'error');
    }
}

async function equalStart() {
    if (!confirm('🚀 Равный старт!\n\nОбнуляется статистика, сохраняются сотрудники.\n\nПродолжить?')) return;
    
    showSystemNotification('🚀 Равный старт...', 'info');
    
    try {
        const response = await apiCall('/admin/equal-start', 'POST');
        if (response && response.success) {
            showSystemNotification('✅ ' + response.message, 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        showSystemNotification('❌ Ошибка соединения', 'error');
    }
}

async function initAchievementsAdmin() {
    if (!confirm('Переинициализировать достижения?')) return;
    
    try {
        const response = await apiCall('/admin/init-achievements', 'POST');
        if (response && response.success) {
            showSystemNotification('✅ ' + response.message, 'success');
        } else {
            showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showSystemNotification('❌ Ошибка соединения', 'error');
    }
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initAdmin = initAdmin;
window.resetAdminState = resetAdminState;
window.openBonusModal = openBonusModal;
window.closeBonusModal = closeBonusModal;
window.giveBonus = giveBonus;
window.openResetPasswordModal = openResetPasswordModal;
window.closeResetPasswordModal = closeResetPasswordModal;
window.resetPassword = resetPassword;
window.changeEmployeeRole = changeEmployeeRole;
window.closeRoleModal = closeRoleModal;
window.saveEmployeeRole = saveEmployeeRole;
window.deleteEmployee = deleteEmployee;
window.updateFund = updateFund;
window.addToFund = addToFund;
window.subtractFromFund = subtractFromFund;
window.resetFund = resetFund;
window.setGlobalTheme = setGlobalTheme;
window.loadCurrentTheme = loadCurrentTheme;
window.resetAllData = resetAllData;
window.equalStart = equalStart;
window.initAchievementsAdmin = initAchievementsAdmin;

console.log('✅ admin.js загружен (v2.1 — с уведомлениями)');