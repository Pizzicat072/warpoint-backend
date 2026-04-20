// public/js/fines.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v1.1
// Добавлены все уведомления

(function() {
    'use strict';
    
    let finesData = [];
    let currentFineStatusFilter = 'all';
    let currentFineEmployeeFilter = 'all';
    let currentFineTypeFilter = 'all';
    let currentFineMonthFilter = 'all';
    let isLoadingFines = false;
    let isSavingFine = false;
    let finesInitialized = false;

    const fineTypes = {
        late: { name: 'Опоздание', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        task: { name: 'Невыполнение задачи', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        rudeness: { name: 'Грубость', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        damage: { name: 'Повреждение инвентаря', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        phone: { name: 'Телефон на смене', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        task_overdue: { name: 'Просрочка задачи', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 },
        other: { name: 'Другое', defaultAmount: 0, defaultCoins: 0, defaultRating: 0 }
    };

    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================

    function resetFinesState() {
        console.log('🧹 Сброс состояния штрафов');
        finesInitialized = false;
    }

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================

    function escapeHtml(str) {
        if (!str) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, m => map[m]);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU');
    }

    function showSystemNotification(message, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
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

    function initFines() {
        if (finesInitialized) {
            console.log('⚠️ Штрафы уже инициализированы');
            return;
        }
        
        console.log('⚠️ Инициализация нарушений');
        
        const tbody = document.getElementById('finesTableBody');
        if (!tbody) {
            console.warn('⚠️ finesTableBody не найден, ждём...');
            setTimeout(initFines, 100);
            return;
        }
        
        loadFinesData();
        
        const searchInput = document.getElementById('fineSearch');
        const statusFilter = document.getElementById('fineStatusFilter');
        const employeeFilter = document.getElementById('fineEmployeeFilter');
        const typeFilter = document.getElementById('fineTypeFilter');
        const monthFilter = document.getElementById('fineMonthFilter');
        
        if (searchInput) searchInput.addEventListener('input', () => renderFinesTable());
        if (statusFilter) statusFilter.addEventListener('change', (e) => { currentFineStatusFilter = e.target.value; renderFinesTable(); });
        if (employeeFilter) employeeFilter.addEventListener('change', (e) => { currentFineEmployeeFilter = e.target.value; renderFinesTable(); });
        if (typeFilter) typeFilter.addEventListener('change', (e) => { currentFineTypeFilter = e.target.value; renderFinesTable(); });
        if (monthFilter) monthFilter.addEventListener('change', (e) => { currentFineMonthFilter = e.target.value; renderFinesTable(); });
        
        populateFineFilters();
        
        finesInitialized = true;
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================

    async function loadFinesData() {
        if (isLoadingFines) return;
        isLoadingFines = true;
        
        try {
            const data = await apiCall('/fines');
            if (data && Array.isArray(data)) {
                finesData = data;
                showSystemNotification(`📊 Загружено ${finesData.length} нарушений`, 'info');
                updateFinesStats();
                renderFinesTable();
            } else {
                showSystemNotification('❌ Ошибка загрузки нарушений', 'error');
            }
        } catch (err) {
            console.error('Ошибка загрузки нарушений:', err);
            showSystemNotification('❌ Ошибка загрузки нарушений', 'error');
        } finally {
            isLoadingFines = false;
        }
    }

    function updateFinesStats() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        const monthlyFines = finesData.filter(f => {
            const fineDate = new Date(f.date);
            return fineDate.getMonth() === currentMonth && fineDate.getFullYear() === currentYear;
        });
        
        const total = finesData.length;
        const monthlyTotal = monthlyFines.length;
        const pending = finesData.filter(f => f.status === 'pending').length;
        const approved = finesData.filter(f => f.status === 'approved').length;
        const rejected = finesData.filter(f => f.status === 'rejected').length;
        const totalMoney = finesData.filter(f => f.status === 'approved').reduce((sum, f) => sum + (f.amount || 0), 0);
        const totalCoins = finesData.filter(f => f.status === 'approved').reduce((sum, f) => sum + (f.coins || 0), 0);
        
        document.getElementById('statTotal').textContent = total;
        document.getElementById('statMonthly').textContent = monthlyTotal;
        document.getElementById('statPending').textContent = pending;
        document.getElementById('statApproved').textContent = approved;
        document.getElementById('statRejected').textContent = rejected;
        document.getElementById('statMoneyAmount').textContent = totalMoney.toLocaleString() + ' ₽';
        document.getElementById('statCoinsAmount').textContent = totalCoins;
    }

    function populateFineFilters() {
        const employeeFilter = document.getElementById('fineEmployeeFilter');
        const monthFilter = document.getElementById('fineMonthFilter');
        
        if (employeeFilter) {
            const employees = window.app?.employees || [];
            let options = '<option value="all">Все сотрудники</option>';
            employees.forEach(emp => { options += `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`; });
            employeeFilter.innerHTML = options;
        }
        
        if (monthFilter) {
            const months = [];
            finesData.forEach(fine => {
                const date = new Date(fine.date);
                const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
                if (!months.includes(key)) months.push(key);
            });
            months.sort().reverse();
            
            let options = '<option value="all">Все месяцы</option>';
            months.forEach(monthKey => {
                const [year, month] = monthKey.split('-');
                const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
                options += `<option value="${monthKey}">${monthNames[parseInt(month) - 1]} ${year}</option>`;
            });
            monthFilter.innerHTML = options;
        }
    }

    function formatPenalty(fine) {
        const parts = [];
        if (fine.amount > 0) parts.push(`${fine.amount} ₽`);
        if (fine.coins > 0) parts.push(`${fine.coins} WP`);
        if (fine.rating < 0) parts.push(`${Math.abs(fine.rating)} ⭐`);
        return parts.length > 0 ? parts.join(' + ') : '—';
    }

    // ============================================
    // РЕНДЕР ТАБЛИЦЫ
    // ============================================

    function renderFinesTable() {
        const tbody = document.getElementById('finesTableBody');
        if (!tbody) return;
        
        const search = document.getElementById('fineSearch')?.value.toLowerCase() || '';
        
        let filtered = [...finesData];
        
        if (search) filtered = filtered.filter(f => f.employee.toLowerCase().includes(search));
        if (currentFineStatusFilter !== 'all') filtered = filtered.filter(f => f.status === currentFineStatusFilter);
        if (currentFineEmployeeFilter !== 'all') filtered = filtered.filter(f => f.employee === currentFineEmployeeFilter);
        if (currentFineMonthFilter !== 'all') {
            filtered = filtered.filter(f => {
                const date = new Date(f.date);
                const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
                return key === currentFineMonthFilter;
            });
        }
        if (currentFineTypeFilter !== 'all') {
            if (currentFineTypeFilter === 'money') filtered = filtered.filter(f => f.amount > 0);
            else if (currentFineTypeFilter === 'coins') filtered = filtered.filter(f => f.coins > 0);
            else if (currentFineTypeFilter === 'rating') filtered = filtered.filter(f => f.rating !== 0);
        }
        
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px;">Нет нарушений</td></tr>';
            return;
        }
        
        const canManage = window.app?.currentUserRole === 'director' || window.app?.currentUserRole === 'manager';
        const canDelete = window.app?.currentUserRole === 'director';
        
        tbody.innerHTML = filtered.map(fine => {
            const statusClass = {
                'pending': 'status-pending', 'approved': 'status-approved', 'rejected': 'status-rejected', 'appeal': 'status-appeal'
            }[fine.status] || 'status-pending';
            
            const statusText = {
                'pending': 'На рассмотрении', 'approved': 'Подтверждено', 'rejected': 'Отклонено', 'appeal': 'Апелляция'
            }[fine.status] || 'На рассмотрении';
            
            const typeName = fineTypes[fine.type]?.name || fine.type || 'Другое';
            const penaltyText = formatPenalty(fine);
            const showApproveReject = canManage && (fine.status === 'pending' || fine.status === 'appeal');
            const isSystemFine = fine.created_by === '🤖 Система';
            const systemBadge = isSystemFine ? '<span class="system-badge">🤖 Система</span>' : '';
            
            return `
                <tr class="${isSystemFine ? 'fine-system-created' : ''}">
                    <td>${formatDate(fine.date)}</td>
                    <td><strong>${escapeHtml(fine.employee)} ${systemBadge}</strong></td>
                    <td>${escapeHtml(typeName)}</td>
                    <td class="penalty-cell">${penaltyText}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td style="white-space: nowrap;">
                        ${showApproveReject ? `<button class="btn-small" onclick="openFineModal(${fine.id})">Рассмотреть</button>` : ''}
                        ${fine.status === 'approved' || fine.status === 'rejected' ? `<button class="btn-small" onclick="viewFineDetails(${fine.id})">Просмотр</button>` : ''}
                        ${canDelete ? `<button class="btn-small btn-delete" onclick="deleteFine(${fine.id})">Удалить</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ============================================
    // УДАЛЕНИЕ
    // ============================================

    async function deleteFine(fineId) {
        if (!confirm('Удалить нарушение?')) return;
        
        const response = await apiCall(`/fines/${fineId}`, 'DELETE');
        if (response && response.success) {
            showSystemNotification('🗑️ Нарушение удалено', 'warning');
            await loadFinesData();
            if (typeof loadEmployees === 'function') await loadEmployees();
            if (typeof renderEmployees === 'function') renderEmployees();
        } else {
            showSystemNotification('❌ Ошибка при удалении', 'error');
        }
    }

    // ============================================
    // МОДАЛКА ШТРАФА
    // ============================================

    function openFineModal(fineId = null) {
        const fine = fineId ? finesData.find(f => f.id === fineId) : null;
        const isSystemFine = fine?.created_by === '🤖 Система';
        const isPending = fine?.status === 'pending' || fine?.status === 'appeal';
        
        const statusClass = fine ? {
            'pending': 'status-pending', 'approved': 'status-approved', 'rejected': 'status-rejected', 'appeal': 'status-appeal'
        }[fine.status] || 'status-pending' : '';
        
        const statusText = fine ? {
            'pending': 'На рассмотрении', 'approved': 'Подтверждено', 'rejected': 'Отклонено', 'appeal': 'Апелляция'
        }[fine.status] || 'На рассмотрении' : '';
        
        const modalHtml = `
            <div id="fineModal" class="modal active">
                <div class="modal-window" style="max-width: 480px; padding: 0;">
                    <div style="padding: 16px 20px; border-bottom: 1px solid #2a3240; background: #1a1f2e; border-radius: 20px 20px 0 0;">
                        <h3 style="margin: 0; font-size: 18px;">${fine ? 'Рассмотрение нарушения' : 'Новое нарушение'}</h3>
                    </div>
                    
                    <div style="padding: 20px;">
                        ${!fine ? `
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #94a3b8;">Сотрудник</label>
                                <select id="fineEmployee" class="form-select" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                                    <option value="">Выберите сотрудника</option>
                                    ${(window.app?.employees || []).map(emp => `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`).join('')}
                                </select>
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #94a3b8;">Тип нарушения</label>
                                <select id="fineType" class="form-select" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                                    ${Object.entries(fineTypes).map(([key, val]) => `<option value="${key}">${val.name}</option>`).join('')}
                                </select>
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #94a3b8;">Тип штрафа</label>
                                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                    <label><input type="radio" name="penaltyType" value="money" checked onchange="togglePenaltyFields()"> 💵 Деньги</label>
                                    <label><input type="radio" name="penaltyType" value="coins" onchange="togglePenaltyFields()"> 💰 WP</label>
                                    <label><input type="radio" name="penaltyType" value="rating" onchange="togglePenaltyFields()"> ⭐ Рейтинг</label>
                                    <label><input type="radio" name="penaltyType" value="all" onchange="togglePenaltyFields()"> 💵💰⭐ Всё</label>
                                </div>
                            </div>
                            
                            <div id="moneyFields" style="margin-bottom: 15px;">
                                <input type="number" id="fineAmount" class="form-input" value="0" step="100" min="0" placeholder="Сумма (₽)" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                            </div>
                            <div id="coinsFields" style="margin-bottom: 15px; display: none;">
                                <input type="number" id="fineCoins" class="form-input" value="0" step="10" min="0" placeholder="WP" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                            </div>
                            <div id="ratingFields" style="margin-bottom: 15px; display: none;">
                                <input type="number" id="fineRating" class="form-input" value="0" step="5" min="0" placeholder="Рейтинг (отрицательный)" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <textarea id="fineDescription" class="form-textarea" rows="3" placeholder="Описание нарушения..." style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff; resize: vertical;"></textarea>
                            </div>
                        ` : `
                            <div style="background: #0d1016; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                                    <span style="font-weight: 600;">${escapeHtml(fineTypes[fine.type]?.name || fine.type)}</span>
                                    <span class="status-badge ${statusClass}">${statusText}</span>
                                </div>
                                <div style="margin-bottom: 8px;"><span style="color: #94a3b8;">Сотрудник:</span> ${escapeHtml(fine.employee)}</div>
                                <div style="margin-bottom: 8px;"><span style="color: #94a3b8;">Дата:</span> ${formatDate(fine.date)}</div>
                                <div style="margin-bottom: 8px;"><span style="color: #94a3b8;">Описание:</span><br>${escapeHtml(fine.description || '—')}</div>
                                <div><span style="color: #94a3b8;">Создал:</span> ${escapeHtml(fine.created_by || '—')} · ${new Date(fine.created_at).toLocaleDateString()}</div>
                            </div>
                            
                            ${isPending ? `
                                ${isSystemFine ? `
                                    <div style="background: #0d1016; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                                        <div style="margin-bottom: 10px; font-weight: 600; color: #a78bfa;">Назначить штраф</div>
                                        <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                                            <label><input type="radio" name="penaltyType" value="money" checked onchange="togglePenaltyFields()"> 💵 Деньги</label>
                                            <label><input type="radio" name="penaltyType" value="coins" onchange="togglePenaltyFields()"> 💰 WP</label>
                                            <label><input type="radio" name="penaltyType" value="rating" onchange="togglePenaltyFields()"> ⭐ Рейтинг</label>
                                            <label><input type="radio" name="penaltyType" value="all" onchange="togglePenaltyFields()"> 💵💰⭐ Всё</label>
                                        </div>
                                        <div id="moneyFields"><input type="number" id="fineAmount" class="form-input" value="0" step="100" min="0" placeholder="Сумма ₽" style="width: 100%; padding: 8px;"></div>
                                        <div id="coinsFields" style="display: none;"><input type="number" id="fineCoins" class="form-input" value="0" step="10" min="0" placeholder="WP" style="width: 100%; padding: 8px;"></div>
                                        <div id="ratingFields" style="display: none;"><input type="number" id="fineRating" class="form-input" value="0" step="5" min="0" placeholder="Рейтинг" style="width: 100%; padding: 8px;"></div>
                                    </div>
                                ` : (fine.amount > 0 || fine.coins > 0 || fine.rating !== 0) ? `
                                    <div style="background: #0d1016; border-radius: 10px; padding: 15px; margin-bottom: 20px; border-left: 3px solid #fbbf24;">
                                        <div style="color: #fbbf24; margin-bottom: 5px;">💰 Предложенный штраф</div>
                                        <div style="font-size: 18px; font-weight: 700; color: #fbbf24;">${formatPenalty(fine)}</div>
                                        <div style="font-size: 12px; color: #64748b;">Сумма предложена сотрудником</div>
                                    </div>
                                ` : `
                                    <div style="background: #0d1016; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                                        <div style="color: #64748b;">💰 Штраф не предложен</div>
                                    </div>
                                `}
                                
                                <div style="margin-bottom: 15px;">
                                    <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #94a3b8;">Решение</label>
                                    <select id="fineDecision" class="form-select" style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff;">
                                        <option value="approved">✅ Подтвердить</option>
                                        <option value="rejected">❌ Отклонить</option>
                                    </select>
                                </div>
                                
                                <div>
                                    <textarea id="fineComment" class="form-textarea" rows="2" placeholder="Комментарий..." style="width: 100%; padding: 10px; background: #0d1016; border: 1px solid #2a3240; border-radius: 8px; color: #fff; resize: vertical;"></textarea>
                                </div>
                            ` : `
                                <div style="background: #0d1016; border-radius: 10px; padding: 15px; margin-bottom: 20px;">
                                    <div style="margin-bottom: 10px;">
                                        <span style="color: #94a3b8;">Штраф:</span>
                                        <span style="color: #fbbf24; font-weight: 600;">${formatPenalty(fine)}</span>
                                    </div>
                                    ${fine.director_comment ? `<div><span style="color: #94a3b8;">Комментарий:</span><br>${escapeHtml(fine.director_comment)}</div>` : ''}
                                </div>
                            `}
                        `}
                    </div>
                    
                    <div style="display: flex; gap: 10px; justify-content: flex-end; padding: 15px 20px; border-top: 1px solid #2a3240; background: #1a1f2e; border-radius: 0 0 20px 20px;">
                        <button onclick="closeFineModal()" style="padding: 8px 20px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid #2a3240; color: #94a3b8; cursor: pointer;">Отмена</button>
                        <button onclick="saveFine(${fine?.id || 'null'})" style="padding: 8px 24px; border-radius: 8px; background: #ef4444; border: none; color: white; font-weight: 600; cursor: pointer;">Сохранить</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        if (!fine) togglePenaltyFields();
    }

    function togglePenaltyFields() {
        const selected = document.querySelector('input[name="penaltyType"]:checked')?.value;
        const moneyFields = document.getElementById('moneyFields');
        const coinsFields = document.getElementById('coinsFields');
        const ratingFields = document.getElementById('ratingFields');
        
        if (moneyFields) moneyFields.style.display = 'none';
        if (coinsFields) coinsFields.style.display = 'none';
        if (ratingFields) ratingFields.style.display = 'none';
        
        if (selected === 'money' && moneyFields) moneyFields.style.display = 'block';
        else if (selected === 'coins' && coinsFields) coinsFields.style.display = 'block';
        else if (selected === 'rating' && ratingFields) ratingFields.style.display = 'block';
        else if (selected === 'all') {
            if (moneyFields) moneyFields.style.display = 'block';
            if (coinsFields) coinsFields.style.display = 'block';
            if (ratingFields) ratingFields.style.display = 'block';
        }
    }

    function closeFineModal() {
        const modal = document.getElementById('fineModal');
        if (modal) modal.remove();
    }

    // ============================================
    // СОХРАНЕНИЕ ШТРАФА
    // ============================================

    async function saveFine(fineId) {
        if (isSavingFine) return;
        isSavingFine = true;
        
        const saveBtn = document.querySelector('#fineModal button[onclick*="saveFine"]');
        const originalText = saveBtn?.innerHTML;
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            saveBtn.disabled = true;
        }
        
        try {
            if (fineId) {
                const decision = document.getElementById('fineDecision')?.value;
                const comment = document.getElementById('fineComment')?.value;
                
                const currentFine = finesData.find(f => f.id === fineId);
                
                let amount = currentFine?.amount || 0;
                let coins = currentFine?.coins || 0;
                let rating = currentFine?.rating || 0;
                
                if (currentFine?.created_by === '🤖 Система') {
                    const amountInput = document.getElementById('fineAmount');
                    const coinsInput = document.getElementById('fineCoins');
                    const ratingInput = document.getElementById('fineRating');
                    
                    let penaltyType = 'money';
                    const penaltyRadios = document.querySelectorAll('input[name="penaltyType"]');
                    for (let radio of penaltyRadios) {
                        if (radio.checked) { penaltyType = radio.value; break; }
                    }
                    
                    amount = 0; coins = 0; rating = 0;
                    
                    if (penaltyType === 'money') amount = amountInput ? Math.abs(parseInt(amountInput.value) || 0) : 0;
                    else if (penaltyType === 'coins') coins = coinsInput ? Math.abs(parseInt(coinsInput.value) || 0) : 0;
                    else if (penaltyType === 'rating') rating = ratingInput ? -Math.abs(parseInt(ratingInput.value) || 0) : 0;
                    else if (penaltyType === 'all') {
                        amount = amountInput ? Math.abs(parseInt(amountInput.value) || 0) : 0;
                        coins = coinsInput ? Math.abs(parseInt(coinsInput.value) || 0) : 0;
                        rating = ratingInput ? -Math.abs(parseInt(ratingInput.value) || 0) : 0;
                    }
                }
                
                const response = await apiCall(`/fines/${fineId}`, 'PUT', { 
                    status: decision, director_comment: comment, amount, coins, rating
                });
                
                if (response && response.success) {
                    showSystemNotification('✅ Нарушение рассмотрено', 'success');
                    closeFineModal();
                    await loadFinesData();
                    if (typeof loadEmployees === 'function') await loadEmployees();
                    if (typeof renderEmployees === 'function') renderEmployees();
                    if (typeof updateDashboardStats === 'function') updateDashboardStats();
                } else {
                    showSystemNotification('❌ Ошибка при рассмотрении', 'error');
                }
            } else {
                const employee = document.getElementById('fineEmployee')?.value;
                const type = document.getElementById('fineType')?.value;
                const description = document.getElementById('fineDescription')?.value;
                
                if (!employee) {
                    showSystemNotification('❌ Выберите сотрудника', 'error');
                    return;
                }
                
                const amountInput = document.getElementById('fineAmount');
                const coinsInput = document.getElementById('fineCoins');
                const ratingInput = document.getElementById('fineRating');
                
                const amount = amountInput ? Math.abs(parseInt(amountInput.value) || 0) : 0;
                const coins = coinsInput ? Math.abs(parseInt(coinsInput.value) || 0) : 0;
                let rating = ratingInput ? parseInt(ratingInput.value) || 0 : 0;
                if (rating > 0) rating = -rating;
                
                const fineData = {
                    date: new Date().toISOString().split('T')[0],
                    employee, type, amount, coins, rating, description,
                    createdBy: window.app?.currentUser, status: 'pending'
                };
                
                const response = await apiCall('/fines', 'POST', { fine: fineData });
                if (response && response.success) {
                    showSystemNotification('✅ Нарушение добавлено', 'success');
                    closeFineModal();
                    await loadFinesData();
                    if (typeof updateDashboardStats === 'function') updateDashboardStats();
                } else {
                    showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная ошибка'), 'error');
                }
            }
        } finally {
            isSavingFine = false;
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    // ============================================
    // ПРОСМОТР ДЕТАЛЕЙ
    // ============================================

    function viewFineDetails(fineId) {
        const fine = finesData.find(f => f.id === fineId);
        if (!fine) return;
        
        const statusClass = {
            'pending': 'status-pending', 'approved': 'status-approved', 'rejected': 'status-rejected', 'appeal': 'status-appeal'
        }[fine.status] || 'status-pending';
        
        const statusText = {
            'pending': 'На рассмотрении', 'approved': 'Подтверждено', 'rejected': 'Отклонено', 'appeal': 'Апелляция'
        }[fine.status] || 'На рассмотрении';
        
        const modalHtml = `
            <div id="fineDetailsModal" class="modal active">
                <div class="modal-window" style="max-width: 400px; padding: 0;">
                    <div style="padding: 15px 20px; border-bottom: 1px solid #2a3240; background: #1a1f2e; border-radius: 20px 20px 0 0;">
                        <h3 style="margin: 0; font-size: 16px;">Детали нарушения</h3>
                    </div>
                    <div style="padding: 20px;">
                        <div style="margin-bottom: 10px;"><strong>Сотрудник:</strong> ${escapeHtml(fine.employee)}</div>
                        <div style="margin-bottom: 10px;"><strong>Дата:</strong> ${formatDate(fine.date)}</div>
                        <div style="margin-bottom: 10px;"><strong>Тип:</strong> ${escapeHtml(fineTypes[fine.type]?.name || fine.type)}</div>
                        <div style="margin-bottom: 10px;"><strong>Штраф:</strong> <span style="color: #fbbf24;">${formatPenalty(fine)}</span></div>
                        <div style="margin-bottom: 10px;"><strong>Описание:</strong> ${escapeHtml(fine.description || '—')}</div>
                        <div style="margin-bottom: 10px;"><strong>Статус:</strong> <span class="status-badge ${statusClass}">${statusText}</span></div>
                        <div><strong>Кто создал:</strong> ${escapeHtml(fine.created_by || '—')}</div>
                        ${fine.director_comment ? `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #2a3240;"><strong>Комментарий:</strong><br>${escapeHtml(fine.director_comment)}</div>` : ''}
                    </div>
                    <div style="display: flex; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid #2a3240; background: #1a1f2e;">
                        <button onclick="closeFineDetailsModal()" style="padding: 6px 16px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid #2a3240; color: #94a3b8; cursor: pointer;">Закрыть</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function closeFineDetailsModal() {
        const modal = document.getElementById('fineDetailsModal');
        if (modal) modal.remove();
    }

    // ============================================
    // СБРОС ФИЛЬТРОВ
    // ============================================

    function resetFineFilters() {
        document.getElementById('fineSearch').value = '';
        document.getElementById('fineStatusFilter').value = 'all';
        document.getElementById('fineEmployeeFilter').value = 'all';
        document.getElementById('fineTypeFilter').value = 'all';
        document.getElementById('fineMonthFilter').value = 'all';
        
        currentFineStatusFilter = 'all';
        currentFineEmployeeFilter = 'all';
        currentFineTypeFilter = 'all';
        currentFineMonthFilter = 'all';
        
        showSystemNotification('🔄 Фильтры сброшены', 'info');
        renderFinesTable();
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    window.initFines = initFines;
    window.resetFinesState = resetFinesState;
    window.loadFinesData = loadFinesData;
    window.renderFinesTable = renderFinesTable;
    window.openFineModal = openFineModal;
    window.closeFineModal = closeFineModal;
    window.saveFine = saveFine;
    window.togglePenaltyFields = togglePenaltyFields;
    window.deleteFine = deleteFine;
    window.viewFineDetails = viewFineDetails;
    window.closeFineDetailsModal = closeFineDetailsModal;
    window.resetFineFilters = resetFineFilters;

    console.log('✅ fines.js загружен (v1.1 — с уведомлениями)');
})();