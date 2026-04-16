// public/js/admin.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

let adminEmployeesList = [];
let isLoadingAdmin = false;

// ============================================
// ИНИЦИАЛИЗАЦИЯ (С ПРОВЕРКОЙ DOM)
// ============================================

function initAdmin() {
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
    
    // Настройка табов
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`adminTab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`)?.classList.add('active');
        });
    });
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
                        <button class="btn-small btn-danger" onclick="deleteEmployee('${escapeHtml(emp)}')">🗑️ Удалить</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
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
        showNotif('Сумма монет не может быть отрицательной', 'error');
        return;
    }
    
    const response = await apiCall('/admin/bonus/employee', 'POST', { name: employeeName, coins, rating });
    
    if (response && response.success) {
        showNotif(`Бонус выдан ${employeeName}`, 'success');
        closeBonusModal();
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof refreshAllBalanceDisplays === 'function') refreshAllBalanceDisplays();
    } else {
        showNotif('Ошибка при выдаче бонуса', 'error');
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
        showNotif(`✅ Роль изменена`, 'success');
        closeRoleModal();
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
    }
}

async function deleteEmployee(employeeName) {
    if (!confirm(`Удалить сотрудника ${employeeName}? Это необратимо.`)) return;
    
    const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}`, 'DELETE');
    
    if (response && response.success) {
        showNotif(`Сотрудник ${employeeName} удалён`, 'success');
        await loadEmployees();
        adminEmployeesList = window.app?.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showNotif('Ошибка при удалении', 'error');
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
            if (display) display.textContent = response.amount.toLocaleString() + ' ₽';
            window.fundAmount = response.amount;
        }
    } catch (err) {
        console.error('Ошибка загрузки фонда:', err);
    }
}

async function updateFund() {
    const amount = parseInt(document.getElementById('fundChangeAmount')?.value) || 0;
    if (amount < 0) {
        showNotif('Сумма не может быть отрицательной', 'error');
        return;
    }
    if (!confirm(`Установить фонд в ${amount.toLocaleString()} ₽?`)) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: amount });
    if (response && response.success) {
        showNotif(`💰 Фонд установлен: ${amount.toLocaleString()} ₽`, 'success');
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('Ошибка при обновлении фонда', 'error');
    }
}

async function addToFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) { showNotif('Введите сумму', 'warning'); return; }
    
    const response = await apiCall('/fund/add', 'POST', { sum: amount });
    if (response && response.success) {
        showNotif(`💰 Добавлено ${amount.toLocaleString()} ₽`, 'success');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('Ошибка при добавлении', 'error');
    }
}

async function subtractFromFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) { showNotif('Введите сумму', 'warning'); return; }
    
    const response = await apiCall('/fund/add', 'POST', { sum: -amount });
    if (response && response.success) {
        showNotif(`💰 Убавлено ${amount.toLocaleString()} ₽`, 'success');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('Ошибка при убавлении', 'error');
    }
}

async function resetFund() {
    if (!confirm('Сбросить фонд в 0?')) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: 0 });
    if (response && response.success) {
        showNotif('💰 Фонд обнулён', 'success');
        loadFundAmount();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('Ошибка при сбросе', 'error');
    }
}

// ============================================
// ТЕМА
// ============================================

async function setGlobalTheme(themeId) {
    if (window.app?.currentUserRole !== 'director') {
        showNotif('Только директор может менять тему', 'error');
        return;
    }
    
    const themeNames = {
        'vr-portal': 'VR-портал', 'hacker': 'Хакер', 'glitch': 'Глитч',
        'explosion': 'Взрыв', 'depth': 'Глубина', 'charge': 'Заряд'
    };
    
    try {
        const response = await apiCall('/admin/theme', 'POST', { theme: themeId });
        if (response && response.success) {
            showNotif(`🎨 Тема изменена на ${themeNames[themeId]}`, 'success');
            applyGlobalTheme(themeId);
            const nameEl = document.getElementById('currentThemeName');
            if (nameEl) nameEl.textContent = themeNames[themeId];
        } else {
            showNotif('Ошибка при смене темы', 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('Ошибка соединения', 'error');
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
    } catch (err) {
        console.error('Ошибка загрузки темы:', err);
    }
}

// ============================================
// СБРОС ДАННЫХ
// ============================================

async function resetAllData() {
    if (!confirm('⚠️ ВНИМАНИЕ! Будут удалены ВСЕ сотрудники кроме директора и ВСЕ данные!\n\nЭто действие НЕОБРАТИМО. Продолжить?')) return;
    if (!confirm('Точно? Все задачи, график, достижения, чаты будут удалены.')) return;
    
    showNotif('🧹 Сброс данных...', 'info');
    
    try {
        const response = await apiCall('/admin/reset-all', 'POST');
        if (response && response.success) {
            showNotif('✅ ' + response.message, 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        showNotif('❌ Ошибка соединения', 'error');
    }
}

async function equalStart() {
    if (!confirm('🚀 Равный старт!\n\nОбнуляется статистика, сохраняются сотрудники.\n\nПродолжить?')) return;
    
    showNotif('🚀 Равный старт...', 'info');
    
    try {
        const response = await apiCall('/admin/equal-start', 'POST');
        if (response && response.success) {
            showNotif('✅ ' + response.message, 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        showNotif('❌ Ошибка соединения', 'error');
    }
}

async function initAchievementsAdmin() {
    if (!confirm('Переинициализировать достижения?')) return;
    
    try {
        const response = await apiCall('/admin/init-achievements', 'POST');
        if (response && response.success) {
            showNotif('✅ ' + response.message, 'success');
        } else {
            showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('Ошибка:', err);
        showNotif('❌ Ошибка соединения', 'error');
    }
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initAdmin = initAdmin;
window.openBonusModal = openBonusModal;
window.closeBonusModal = closeBonusModal;
window.giveBonus = giveBonus;
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

console.log('✅ admin.js загружен (исправленная версия)');