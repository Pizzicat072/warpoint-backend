// public/js/admin.js - ПОЛНАЯ ВЕРСИЯ

let adminEmployeesList = [];

function initAdmin() {
    console.log('⚙️ Инициализация админки');
    
    if (window.app.currentUserRole !== 'director') {
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
    setupAdminTabs();
    loadCurrentTheme();
}

async function loadAdminData() {
    await loadEmployees();
    adminEmployeesList = window.app.employees || [];
    renderAdminEmployees();
    loadFundAmount();
}

function setupAdminTabs() {
    const tabs = document.querySelectorAll('.admin-tab');
    if (tabs.length === 0) return;
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.admin-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.querySelectorAll('.admin-tab').forEach(t => {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            const targetContent = document.getElementById(`adminTab${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

function renderAdminEmployees() {
    const container = document.getElementById('adminEmployeesList');
    if (!container) return;
    
    if (adminEmployeesList.length === 0) {
        container.innerHTML = '<div class="empty-state">Нет сотрудников</div>';
        return;
    }
    
    container.innerHTML = adminEmployeesList.map(emp => {
        const profile = window.app.profiles[emp];
        const roleName = roleNames[profile?.role] || 'Оператор';
        const isDirector = emp === 'Денис';
        
        return `
            <div class="admin-employee-card">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #6366f1, #ec4899); border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; font-size: 24px;">
                        ${profile?.avatar_url ? `<img src="${profile.avatar_url}" style="width: 100%; height: 100%; object-fit: cover;">` : (profile?.avatar || '👤')}
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
                        <input type="number" id="bonusCoins" class="edit-input" style="width: 100%;" value="0">
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
    
    const response = await apiCall('/admin/bonus/employee', 'POST', { name: employeeName, coins, rating });
    
    if (response && response.success) {
        showNotif(`Бонус выдан ${employeeName}`, 'success');
        closeBonusModal();
        await loadEmployees();
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
    } else {
        showNotif('Ошибка при выдаче бонуса', 'error');
    }
}

async function deleteEmployee(employeeName) {
    if (!confirm(`Удалить сотрудника ${employeeName}? Это необратимо.`)) return;
    
    const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}`, 'DELETE');
    
    if (response && response.success) {
        showNotif(`Сотрудник ${employeeName} удалён`, 'success');
        await loadEmployees();
        adminEmployeesList = window.app.employees || [];
        renderAdminEmployees();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showNotif('Ошибка при удалении', 'error');
    }
}

async function loadFundAmount() {
    try {
        const response = await apiCall('/fund');
        if (response && response.amount !== undefined) {
            const display = document.getElementById('fundDisplayAmount');
            if (display) display.textContent = response.amount.toLocaleString() + ' ₽';
        }
    } catch (err) {
        console.error('Ошибка загрузки фонда:', err);
    }
}

async function updateFund() {
    const amount = parseInt(document.getElementById('fundChangeAmount')?.value) || 0;
    if (!confirm(`Установить фонд в ${amount.toLocaleString()} ₽?`)) return;
    
    const response = await apiCall('/fund/update', 'POST', { amount: amount });
    if (response && response.success) {
        showNotif(`💰 Фонд установлен: ${amount.toLocaleString()} ₽`, 'success');
        loadFundAmount();
    } else {
        showNotif('Ошибка при обновлении фонда', 'error');
    }
}

async function addToFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) {
        showNotif('Введите сумму', 'warning');
        return;
    }
    
    const response = await apiCall('/fund/add', 'POST', { sum: amount });
    if (response && response.success) {
        showNotif(`💰 Добавлено ${amount.toLocaleString()} ₽`, 'success');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
    } else {
        showNotif('Ошибка при добавлении', 'error');
    }
}

async function subtractFromFund() {
    const amount = parseInt(document.getElementById('fundAddAmount')?.value) || 0;
    if (amount === 0) {
        showNotif('Введите сумму', 'warning');
        return;
    }
    
    const response = await apiCall('/fund/add', 'POST', { sum: -amount });
    if (response && response.success) {
        showNotif(`💰 Убавлено ${amount.toLocaleString()} ₽`, 'success');
        document.getElementById('fundAddAmount').value = 0;
        loadFundAmount();
    } else {
        showNotif('Ошибка при убавлении', 'error');
    }
}

async function resetFund() {
    if (!confirm('Сбросить фонд в 0?')) return;
    
    const response = await apiCall('/fund/update', 'POST', { reset: true });
    if (response && response.success) {
        showNotif('💰 Фонд обнулён', 'success');
        loadFundAmount();
    } else {
        showNotif('Ошибка при сбросе', 'error');
    }
}

// ============================================
// ГЛОБАЛЬНАЯ ТЕМА
// ============================================

async function setGlobalTheme(themeId) {
    if (window.app.currentUserRole !== 'director') {
        showNotif('Только директор может менять тему', 'error');
        return;
    }
    
    const themeNames = {
        'vr-portal': 'VR-портал',
        'hacker': 'Хакер',
        'glitch': 'Глитч',
        'explosion': 'Взрыв',
        'depth': 'Глубина',
        'charge': 'Заряд'
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
    themes.forEach(theme => {
        body.classList.remove(`global-${theme}`);
    });
    
    if (themeId && themeId !== 'vr-portal') {
        body.classList.add(`global-${themeId}`);
    } else {
        body.classList.add('global-vr-portal');
    }
    
    localStorage.setItem('globalTheme', themeId || 'vr-portal');
}

async function loadCurrentTheme() {
    const token = localStorage.getItem('token');
    if (!token) {
        applyGlobalTheme('vr-portal');
        return;
    }
    
    try {
        const response = await apiCall('/admin/theme');
        if (response && response.success && response.theme) {
            applyGlobalTheme(response.theme);
            const themeNames = {
                'vr-portal': 'VR-портал',
                'hacker': 'Хакер',
                'glitch': 'Глитч',
                'explosion': 'Взрыв',
                'depth': 'Глубина',
                'charge': 'Заряд'
            };
            const nameEl = document.getElementById('currentThemeName');
            if (nameEl) nameEl.textContent = themeNames[response.theme] || response.theme;
        } else {
            applyGlobalTheme('vr-portal');
        }
    } catch (err) {
        console.error('Ошибка загрузки темы:', err);
        applyGlobalTheme('vr-portal');
    }
}

// ============================================
// СБРОС ДАННЫХ
// ============================================

// ============================================
// СБРОС ДАННЫХ (РАБОЧИЕ ФУНКЦИИ)
// ============================================

async function resetAllData() {
    console.log('🧹 ===== КНОПКА "ЧИСТЫЙ ЛИСТ" НАЖАТА =====');
    
    if (!confirm('⚠️ ВНИМАНИЕ! Будут удалены ВСЕ сотрудники кроме директора и ВСЕ данные!\n\nЭто действие НЕОБРАТИМО. Продолжить?')) {
        console.log('❌ Отменено пользователем');
        return;
    }
    
    if (!confirm('Точно? Все задачи, график, достижения, чаты будут удалены.')) {
        console.log('❌ Отменено пользователем (второе подтверждение)');
        return;
    }
    
    showNotif('🧹 Сброс данных...', 'info');
    
    try {
        const token = localStorage.getItem('token');
        
        // 1. Получаем список ВСЕХ сотрудников
        console.log('📡 Запрос списка сотрудников...');
        const dataRes = await fetch('/api/data', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await dataRes.json();
        const employees = data.employees || [];
        
        console.log(`👥 Найдено сотрудников: ${employees.length}`);
        console.log('📋 Список:', employees);
        
        // 2. Удаляем каждого кроме директора
        let deletedCount = 0;
        let failedCount = 0;
        
        for (const emp of employees) {
            if (emp === 'Денис') {
                console.log(`⏭️ Пропущен: ${emp} (директор)`);
                continue;
            }
            
            console.log(`🗑️ Удаление сотрудника: ${emp}`);
            
            try {
                const delRes = await fetch(`/api/employees/${encodeURIComponent(emp)}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const delData = await delRes.json();
                
                if (delData.success) {
                    deletedCount++;
                    console.log(`   ✅ ${emp} успешно удалён`);
                } else {
                    failedCount++;
                    console.log(`   ❌ ${emp}: ${delData.error}`);
                }
            } catch (err) {
                failedCount++;
                console.log(`   ❌ ${emp}: ${err.message}`);
            }
        }
        
        console.log(`📊 Итог: удалено ${deletedCount}, ошибок ${failedCount}`);
        
        // 3. Вызываем серверный сброс для очистки таблиц
        console.log('📡 Вызов /api/admin/reset-all для очистки таблиц...');
        const resetRes = await fetch('/api/admin/reset-all', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token 
            }
        });
        const resetData = await resetRes.json();
        console.log('📡 Ответ сервера:', resetData);
        
        if (resetData.success) {
            showNotif('✅ ' + resetData.message, 'success');
        } else {
            showNotif('⚠️ Сотрудники удалены, но таблицы не очищены: ' + (resetData.error || ''), 'warning');
        }
        
        // 4. Перезагружаем страницу
        console.log('🔄 Перезагрузка страницы через 1.5 сек...');
        setTimeout(() => {
            location.reload();
        }, 1500);
        
    } catch (err) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', err);
        showNotif('❌ Ошибка соединения: ' + err.message, 'error');
    }
}

async function equalStart() {
    console.log('🚀 ===== КНОПКА "РАВНЫЙ СТАРТ" НАЖАТА =====');
    
    if (!confirm('🚀 Равный старт!\n\nОбнуляется:\n- Достижения\n- График\n- Задачи и штрафы\n- Статистика\n- Чат\n\nСохраняется:\n- Сотрудники\n- ВП, Зарплата, База знаний\n\nПродолжить?')) {
        console.log('❌ Отменено пользователем');
        return;
    }
    
    showNotif('🚀 Равный старт...', 'info');
    
    try {
        const token = localStorage.getItem('token');
        
        console.log('📡 Вызов /api/admin/equal-start...');
        const response = await fetch('/api/admin/equal-start', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token 
            }
        });
        const data = await response.json();
        console.log('📡 Ответ сервера:', data);
        
        if (data.success) {
            showNotif('✅ ' + data.message, 'success');
            console.log('🔄 Перезагрузка страницы через 1.5 сек...');
            setTimeout(() => {
                location.reload();
            }, 1500);
        } else {
            showNotif('❌ Ошибка: ' + (data.error || 'неизвестная'), 'error');
        }
    } catch (err) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', err);
        showNotif('❌ Ошибка соединения: ' + err.message, 'error');
    }
}
// Изменение роли сотрудника
async function changeEmployeeRole(employeeName, currentRole) {
    console.log(`👤 Изменение роли: ${employeeName} (текущая: ${currentRole})`);
    
    const roles = [
        { value: 'operator', name: '👤 Оператор' },
        { value: 'admin', name: '⚙️ Администратор' },
        { value: 'manager', name: '📋 Управляющий' }
    ];
    
    // Создаём модалку с выбором роли
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
                    <label style="display: block; margin-bottom: 8px; font-size: 13px; color: #94a3b8;">Новая должность</label>
                    <select id="newRoleSelect" class="edit-input" style="width: 100%;">
                        ${optionsHtml}
                    </select>
                    <div style="margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 12px;">
                        <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                            <strong>👤 Оператор</strong> — базовый доступ, может отмечать смены<br>
                            <strong>⚙️ Администратор</strong> — может управлять ВП мероприятиями<br>
                            <strong>📋 Управляющий</strong> — расширенные права, может редактировать график
                        </p>
                    </div>
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
    console.log(`📡 Изменение роли ${employeeName} → ${newRole}`);
    
    try {
        const response = await apiCall(`/employees/${encodeURIComponent(employeeName)}/role`, 'PUT', { role: newRole });
        
        if (response && response.success) {
            showNotif(`✅ ${response.message}`, 'success');
            closeRoleModal();
            
            // Обновляем данные
            await loadEmployees();
            adminEmployeesList = window.app.employees || [];
            renderAdminEmployees();
            
            if (typeof renderEmployees === 'function') renderEmployees();
        } else {
            showNotif('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        showNotif('❌ Ошибка соединения', 'error');
    }
}

// Экспорт
window.changeEmployeeRole = changeEmployeeRole;
window.closeRoleModal = closeRoleModal;
window.saveEmployeeRole = saveEmployeeRole;

// Экспорт
window.resetAllData = resetAllData;
window.equalStart = equalStart;
// Экспорт
window.resetAllData = resetAllData;
window.equalStart = equalStart;
// ============================================
// ЭКСПОРТ
// ============================================
window.initAdmin = initAdmin;
window.openBonusModal = openBonusModal;
window.closeBonusModal = closeBonusModal;
window.giveBonus = giveBonus;
window.deleteEmployee = deleteEmployee;
window.updateFund = updateFund;
window.addToFund = addToFund;
window.subtractFromFund = subtractFromFund;
window.resetFund = resetFund;
window.setGlobalTheme = setGlobalTheme;
window.loadCurrentTheme = loadCurrentTheme;
window.resetAllData = resetAllData;
window.equalStart = equalStart;