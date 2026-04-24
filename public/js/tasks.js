// public/js/tasks.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v2.1
// Добавлены все уведомления

(function() {
    'use strict';
    
    let tasksData = [];
    let subtasksTemp = [];
    let attachmentsTemp = [];
    let selectedExecutors = [];
    let showArchived = false;
    let isLoadingTasks = false;
    let isSavingTask = false;
    let tasksInitialized = false;

    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================

    function resetTasksState() {
        console.log('🧹 Сброс состояния задач');
        tasksInitialized = false;
        subtasksTemp = [];
        attachmentsTemp = [];
        selectedExecutors = [];
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

    function initTasks() {
        if (tasksInitialized) {
            console.log('📋 Задачи уже инициализированы');
            return;
        }
        
        console.log('📋 Инициализация задач');
        
        const container = document.getElementById('tasksList');
        if (!container) {
            console.warn('⚠️ tasksList не найден, ждём...');
            setTimeout(initTasks, 100);
            return;
        }
        
        loadTasksData();
        populateTaskSelects();
        
        const searchInput = document.getElementById('taskSearch');
        const statusFilter = document.getElementById('filterStatus');
        const executorFilter = document.getElementById('filterExecutor');
        const priorityFilter = document.getElementById('filterPriority');
        const typeFilter = document.getElementById('filterType');
        const showArchivedCheckbox = document.getElementById('showArchived');
        
        if (searchInput) searchInput.addEventListener('input', () => renderTasksTable());
        if (statusFilter) statusFilter.addEventListener('change', () => renderTasksTable());
        if (executorFilter) executorFilter.addEventListener('change', () => renderTasksTable());
        if (priorityFilter) priorityFilter.addEventListener('change', () => renderTasksTable());
        if (typeFilter) typeFilter.addEventListener('change', () => renderTasksTable());
        if (showArchivedCheckbox) {
            showArchivedCheckbox.addEventListener('change', (e) => {
                showArchived = e.target.checked;
                renderTasksTable();
            });
        }
        
        initMultiSelect();
        
        setInterval(() => { checkOverdueTasksAndCreateFines(); }, 5 * 60 * 1000);
        setInterval(() => autoArchiveCompletedTasks(), 6 * 60 * 60 * 1000);
        
        tasksInitialized = true;
    }

    function setTaskPriority(priority) {
        const priorityInput = document.getElementById('taskPriority');
        if (priorityInput) priorityInput.value = priority;
        
        document.querySelectorAll('.priority-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.priority === priority) btn.classList.add('active');
        });
    }

    function initMultiSelect() {
        const multiSelectContainer = document.getElementById('multiSelectContainer');
        const executorSelect = document.getElementById('taskExecutor');
        
        if (!multiSelectContainer) return;
        
        if (executorSelect) {
            executorSelect.addEventListener('change', () => {
                const value = executorSelect.value;
                if (value === '__MULTI_SELECT__') {
                    multiSelectContainer.style.display = 'block';
                } else {
                    multiSelectContainer.style.display = 'none';
                    selectedExecutors = [];
                    updateSelectedExecutorsDisplay();
                }
            });
        }
    }

    function updateSelectedExecutorsDisplay() {
        const container = document.getElementById('selectedExecutorsList');
        if (!container) return;
        
        if (selectedExecutors.length === 0) {
            container.innerHTML = '<span style="color: #64748b; font-size: 12px;">Никого не выбрано</span>';
            return;
        }
        
        container.innerHTML = selectedExecutors.map(emp => `
            <span class="selected-executor-tag">
                ${escapeHtml(emp)}
                <button type="button" onclick="removeSelectedExecutor('${escapeHtml(emp)}')">&times;</button>
            </span>
        `).join('');
    }

    function toggleExecutorSelection(emp, checkbox) {
        if (checkbox.checked) {
            if (!selectedExecutors.includes(emp)) selectedExecutors.push(emp);
        } else {
            const index = selectedExecutors.indexOf(emp);
            if (index > -1) selectedExecutors.splice(index, 1);
        }
        updateSelectedExecutorsDisplay();
    }

    function removeSelectedExecutor(emp) {
        const index = selectedExecutors.indexOf(emp);
        if (index > -1) selectedExecutors.splice(index, 1);
        
        const checkbox = document.querySelector(`#multiSelectOptions input[value="${escapeHtml(emp)}"]`);
        if (checkbox) checkbox.checked = false;
        updateSelectedExecutorsDisplay();
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================

    async function loadTasksData() {
        if (isLoadingTasks) return;
        isLoadingTasks = true;
        
        try {
            const data = await apiCall('/tasks');
            if (data && Array.isArray(data)) {
                tasksData = data;
                showSystemNotification(`📊 Загружено ${tasksData.length} задач`, 'info');
                checkOverdueTasksAndCreateFines();
                autoArchiveCompletedTasks();
                updateTasksStats();
                renderTasksTable();
            } else {
                showSystemNotification('❌ Не удалось загрузить задачи', 'error');
            }
        } catch (err) {
            console.error('Ошибка загрузки задач:', err);
            showSystemNotification('❌ Ошибка загрузки задач', 'error');
        } finally {
            isLoadingTasks = false;
        }
    }

    async function checkOverdueTasksAndCreateFines() {
        const today = new Date().toISOString().split('T')[0];
        let updated = false;
        let finesCreated = 0;
        
        for (const task of tasksData) {
            if (!task.is_archived && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'overdue') {
                if (task.deadline && task.deadline < today) {
                    const priorityNames = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
                    
                    let executors = [];
                    if (task.is_group_task === 'operators') {
                        const operators = window.app?.employees?.filter(emp => window.app.profiles[emp]?.role === 'operator') || [];
                        executors = operators;
                    } else if (task.is_group_task === 'admins') {
                        const admins = window.app?.employees?.filter(emp => window.app.profiles[emp]?.role === 'admin') || [];
                        executors = admins;
                    } else if (task.executor) {
                        executors = [task.executor];
                    }
                    
                    let deadlineFormatted = 'не указан';
                    if (task.deadline) {
                        const deadlineDate = new Date(task.deadline);
                        if (!isNaN(deadlineDate.getTime())) deadlineFormatted = deadlineDate.toLocaleDateString('ru-RU');
                    }
                    
                    const description = `📋 Просрочена задача: "${task.name}"\n📅 Дедлайн: ${deadlineFormatted}\n👤 Постановщик: ${task.author}\n⚡ Приоритет: ${priorityNames[task.priority] || 'Средний'}`;
                    
                    for (const executor of executors) {
                        const fineData = {
                            date: today,
                            employee: executor,
                            type: 'task_overdue',
                            amount: 0, coins: 0, rating: 0,
                            description: description,
                            createdBy: '🤖 Система',
                            status: 'pending'
                        };
                        
                        const response = await apiCall('/fines', 'POST', { fine: fineData });
                        if (response && response.success) finesCreated++;
                    }
                    
                    task.status = 'overdue';
                    updated = true;
                    await apiCall(`/tasks/${task.id}`, 'PUT', { ...task, status: 'overdue' });
                }
            }
        }
        
        if (finesCreated > 0) {
            showSystemNotification(`⚠️ Создано ${finesCreated} нарушений за просроченные задачи`, 'warning');
            if (typeof loadFinesData === 'function') loadFinesData();
        }
        
        if (updated) {
            window.dispatchDataUpdate('task', { action: 'overdue_check' });
            renderTasksTable();
        }
    }

    async function autoArchiveCompletedTasks() {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        let archivedCount = 0;
        
        for (const task of tasksData) {
            if (task.status === 'completed' && !task.is_archived && task.completed_at) {
                const completedDate = new Date(task.completed_at);
                if (completedDate <= threeDaysAgo) {
                    const response = await apiCall(`/tasks/${task.id}`, 'PUT', { 
                        ...task, is_archived: true, archived_at: new Date().toISOString()
                    });
                    if (response && response.success) archivedCount++;
                }
            }
        }
        
        if (archivedCount > 0) {
            console.log(`📦 Автоматически заархивировано ${archivedCount} выполненных задач`);
            await loadTasksData();
        }
    }

    function updateTasksStats() {
        const activeTasks = tasksData.filter(t => !t.is_archived);
        const total = activeTasks.length;
        const inProgress = activeTasks.filter(t => t.status === 'in_progress').length;
        const completed = activeTasks.filter(t => t.status === 'completed').length;
        const overdue = activeTasks.filter(t => t.status === 'overdue').length;
        const highPriority = activeTasks.filter(t => t.priority === 'high' && t.status !== 'completed' && !t.is_archived).length;
        
        document.getElementById('statTotal').textContent = total;
        document.getElementById('statProgress').textContent = inProgress;
        document.getElementById('statCompleted').textContent = completed;
        document.getElementById('statOverdue').textContent = overdue;
        document.getElementById('statHigh').textContent = highPriority;
    }

    function populateTaskSelects() {
        const employees = window.app?.employees || [];
        const employeesWithRoles = window.app?.profiles || {};
        const currentUserRole = window.app?.currentUserRole;
        const currentUser = window.app?.currentUser;
        
        const canSelectAuthor = currentUserRole === 'director' || currentUserRole === 'manager';
        
        const authorSelect = document.getElementById('taskAuthor');
        const executorSelect = document.getElementById('taskExecutor');
        const filterExecutor = document.getElementById('filterExecutor');
        const filterType = document.getElementById('filterType');
        const authorHint = document.getElementById('authorHint');
        const multiSelectOptions = document.getElementById('multiSelectOptions');
        
        const operators = employees.filter(emp => employeesWithRoles[emp]?.role === 'operator');
        const admins = employees.filter(emp => employeesWithRoles[emp]?.role === 'admin');
        
        let executorOptions = '<optgroup label="👥 ГРУППОВЫЕ ЗАДАЧИ">';
        if (operators.length > 0) executorOptions += '<option value="__GROUP_OPERATORS__">📢 Задача для операторов</option>';
        if (admins.length > 0) executorOptions += '<option value="__GROUP_ADMINS__">⚙️ Задача для администраторов</option>';
        executorOptions += '<option value="__MULTI_SELECT__">✅ Выбрать нескольких сотрудников</option>';
        executorOptions += '</optgroup>';
        
        if (operators.length > 0) {
            executorOptions += '<optgroup label="👤 ОПЕРАТОРЫ">';
            operators.forEach(emp => { executorOptions += `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`; });
            executorOptions += '</optgroup>';
        }
        
        if (admins.length > 0) {
            executorOptions += '<optgroup label="⚙️ АДМИНИСТРАТОРЫ">';
            admins.forEach(emp => { executorOptions += `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`; });
            executorOptions += '</optgroup>';
        }
        
        if (authorSelect) {
            if (canSelectAuthor) {
                let authorOptions = '<option value="">Выберите постановщика</option>';
                employees.forEach(emp => { authorOptions += `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`; });
                authorSelect.innerHTML = authorOptions;
                authorSelect.disabled = false;
                if (authorHint) authorHint.style.display = 'none';
            } else {
                authorSelect.innerHTML = `<option value="${escapeHtml(currentUser)}">${escapeHtml(currentUser)}</option>`;
                authorSelect.disabled = true;
                if (authorHint) authorHint.style.display = 'block';
            }
        }
        
        if (executorSelect) {
            executorSelect.innerHTML = '<option value="">Выберите исполнителя</option>' + executorOptions;
        }
        
        if (filterType) {
            filterType.innerHTML = `
                <option value="all">Все типы</option>
                <option value="personal">👤 Личные задачи</option>
                <option value="group_operators">📢 Задачи для операторов</option>
                <option value="group_admins">⚙️ Задачи для администраторов</option>
            `;
        }
        
        if (multiSelectOptions) {
            let checkboxesHtml = '';
            employees.forEach(emp => {
                const role = employeesWithRoles[emp]?.role;
                let roleIcon = '👤';
                if (role === 'operator') roleIcon = '👤';
                else if (role === 'admin') roleIcon = '⚙️';
                else if (role === 'manager') roleIcon = '📋';
                else if (role === 'director') roleIcon = '👑';
                checkboxesHtml += `<label class="multi-select-item"><input type="checkbox" value="${escapeHtml(emp)}" onchange="toggleExecutorSelection('${escapeHtml(emp)}', this)"><span>${roleIcon} ${escapeHtml(emp)}</span></label>`;
            });
            multiSelectOptions.innerHTML = checkboxesHtml;
        }
        
        if (filterExecutor) {
            let filterOptions = '<option value="all">Все исполнители</option>';
            employees.forEach(emp => { filterOptions += `<option value="${escapeHtml(emp)}">${escapeHtml(emp)}</option>`; });
            filterExecutor.innerHTML = filterOptions;
        }
    }

    // ============================================
    // РЕНДЕР ТАБЛИЦЫ
    // ============================================

    function renderTasksTable() {
        const container = document.getElementById('tasksList');
        if (!container) return;
        
        const search = document.getElementById('taskSearch')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('filterStatus')?.value || 'all';
        const executorFilter = document.getElementById('filterExecutor')?.value || 'all';
        const priorityFilter = document.getElementById('filterPriority')?.value || 'all';
        const typeFilter = document.getElementById('filterType')?.value || 'all';
        
        let filtered = [...tasksData];
        
        if (!showArchived) filtered = filtered.filter(t => !t.is_archived);
        else filtered = filtered.filter(t => t.is_archived === true);
        
        if (search) filtered = filtered.filter(t => t.name.toLowerCase().includes(search));
        if (statusFilter !== 'all') filtered = filtered.filter(t => t.status === statusFilter);
        if (executorFilter !== 'all') filtered = filtered.filter(t => t.executor === executorFilter);
        if (priorityFilter !== 'all') filtered = filtered.filter(t => t.priority === priorityFilter);
        
        if (typeFilter !== 'all') {
            if (typeFilter === 'personal') filtered = filtered.filter(t => !t.is_group_task);
            else if (typeFilter === 'group_operators') filtered = filtered.filter(t => t.is_group_task === 'operators');
            else if (typeFilter === 'group_admins') filtered = filtered.filter(t => t.is_group_task === 'admins');
        }
        
        if (filtered.length === 0) {
            const message = showArchived ? '📦 В архиве нет задач' : '📭 Нет активных задач';
            container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${showArchived ? '📦' : '📭'}</div><h3>${message}</h3><p>${showArchived ? 'Выполненные задачи попадают сюда через 3 дня' : 'Создайте первую задачу, нажав кнопку выше'}</p></div>`;
            return;
        }
        
        const currentUserRole = window.app?.currentUserRole;
        const currentUser = window.app?.currentUser;
        const canEditAll = currentUserRole === 'director' || currentUserRole === 'manager';
        
        let html = '';
        for (const task of filtered) {
            const isCompleted = task.status === 'completed';
            const isOverdue = task.status === 'overdue';
            const isArchived = task.is_archived;
            
            let cardClass = '';
            if (isArchived) cardClass = 'archived';
            else if (isCompleted) cardClass = 'completed';
            else if (isOverdue) cardClass = 'overdue';
            
            const priorityClass = { 'low': 'priority-low', 'medium': 'priority-medium', 'high': 'priority-high' }[task.priority] || '';
            const priorityText = { 'low': 'Низкий', 'medium': 'Средний', 'high': 'Высокий' }[task.priority] || 'Средний';
            
            const statusClass = { 'in_progress': 'status-in-progress', 'completed': 'status-completed', 'overdue': 'status-overdue' }[task.status] || 'status-in-progress';
            const statusText = { 'in_progress': 'В процессе', 'completed': 'Выполнено', 'overdue': 'Просрочено' }[task.status] || 'В процессе';
            
            let executorDisplay = task.executor;
            let isGroupTask = false;
            
            if (task.is_group_task === 'operators') { executorDisplay = '📢 Все операторы'; isGroupTask = true; }
            else if (task.is_group_task === 'admins') { executorDisplay = '⚙️ Все администраторы'; isGroupTask = true; }
            
            const canEdit = (canEditAll || task.author === currentUser) && !isArchived && !isCompleted;
            const canComplete = (canEditAll || task.executor === currentUser || task.author === currentUser) && task.status !== 'completed' && !isArchived;
            const canArchive = canEditAll && !isArchived && task.status === 'completed';
            const canDelete = canEditAll || (task.author === currentUser && task.status !== 'completed');
            const canRestore = canEditAll && isArchived;
            const showGroupManageBtn = isGroupTask && canEditAll && !isArchived && task.status !== 'completed';
            
            let subtasksHtml = '';
            if (task.subtasks && task.subtasks.length > 0) {
                subtasksHtml = '<div class="task-subtasks">';
                for (const sub of task.subtasks) {
                    subtasksHtml += `
                        <div class="task-subtask-item">
                            <input type="checkbox" ${sub.completed ? 'checked' : ''} disabled>
                            <span class="${sub.completed ? 'completed' : ''}">${escapeHtml(sub.name)}</span>
                        </div>
                    `;
                }
                subtasksHtml += '</div>';
            }
// ✅ ДОБАВИТЬ — отображение вложений
var attachmentsHtml = '';
if (task.attachments && task.attachments.length > 0) {
    attachmentsHtml = '<div class="task-attachments" style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);">';
    attachmentsHtml += '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;"><i class="fas fa-paperclip"></i> Вложения (' + task.attachments.length + ')</div>';
    for (var a = 0; a < task.attachments.length; a++) {
        var att = task.attachments[a];
        attachmentsHtml += '<div class="attachment-item" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(0,0,0,0.2);border-radius:10px;margin-bottom:6px;font-size:12px;">';
        attachmentsHtml += '<i class="fas fa-paperclip"></i>';
        attachmentsHtml += '<span>' + escapeHtml(att.file_name || att.name || 'Файл') + '</span>';
        if (att.file_size) attachmentsHtml += '<span style="color:#64748b;font-size:11px;">(' + Math.round(att.file_size / 1024) + ' KB)</span>';
        attachmentsHtml += '</div>';
    }
    attachmentsHtml += '</div>';
}
            
            html += `
                <div class="task-card ${cardClass}" data-task-id="${task.id}">
                    <div class="task-card-header" onclick="toggleTaskExpand(${task.id})">
                        <div class="task-card-header-left">
                            <div class="task-checkbox ${isCompleted ? 'completed' : ''}" onclick="event.stopPropagation(); markTaskComplete(${task.id})">
                                ${isCompleted ? '<i class="fas fa-check"></i>' : ''}
                            </div>
                            <div class="task-title ${isCompleted ? 'completed' : ''}">${escapeHtml(task.name)}</div>
                            <div class="task-badges">
                                ${!isArchived && !isCompleted ? `<span class="task-priority-badge ${priorityClass}">${priorityText}</span>` : ''}
                                ${!isArchived ? `<span class="task-status-badge ${statusClass}">${statusText}</span>` : ''}
                                ${isArchived ? '<span class="archived-badge">📦 В архиве</span>' : ''}
                            </div>
                        </div>
                        <div class="task-card-actions">
                            ${canComplete ? `<button class="task-action-icon complete" onclick="event.stopPropagation(); markTaskComplete(${task.id})" title="Выполнено"><i class="fas fa-check-circle"></i></button>` : ''}
                            ${canEdit ? `<button class="task-action-icon" onclick="event.stopPropagation(); openTaskModal(${task.id})" title="Редактировать"><i class="fas fa-edit"></i></button>` : ''}
                            ${canArchive ? `<button class="task-action-icon archive" onclick="event.stopPropagation(); archiveTask(${task.id})" title="В архив"><i class="fas fa-archive"></i></button>` : ''}
                            ${canRestore ? `<button class="task-action-icon restore" onclick="event.stopPropagation(); restoreTask(${task.id})" title="Восстановить"><i class="fas fa-undo-alt"></i></button>` : ''}
                            ${canDelete && !isArchived ? `<button class="task-action-icon delete" onclick="event.stopPropagation(); deleteTask(${task.id})" title="Удалить"><i class="fas fa-trash-alt"></i></button>` : ''}
                            ${showGroupManageBtn ? `<button class="task-action-icon" onclick="event.stopPropagation(); openGroupTaskModal(${task.id})" title="Управление группой"><i class="fas fa-users-cog"></i></button>` : ''}
                        </div>
                    </div>
                    <div class="task-card-body">
                        <div class="task-info-row">
                            <div class="task-info-item"><i class="fas fa-user"></i> Постановщик: ${escapeHtml(task.author)}</div>
                            <div class="task-info-item"><i class="fas fa-user-check"></i> Исполнитель: ${escapeHtml(executorDisplay)}</div>
                            <div class="task-info-item"><i class="fas fa-calendar-alt"></i> Дедлайн: ${task.deadline ? formatDate(task.deadline) : '—'}</div>
                            ${task.completed_at ? `<div class="task-info-item"><i class="fas fa-check-circle"></i> Выполнена: ${new Date(task.completed_at).toLocaleDateString('ru-RU')}</div>` : ''}
                        </div>
                        ${task.comment ? '<div class="task-info-item"><i class="fas fa-comment"></i> Комментарий: ' + escapeHtml(task.comment) + '</div>' : ''}
${subtasksHtml}
${attachmentsHtml}
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }

    function toggleTaskExpand(taskId) {
        const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
        if (card) card.classList.toggle('expanded');
    }

    // ============================================
    // ДЕЙСТВИЯ С ЗАДАЧАМИ
    // ============================================

    async function markTaskComplete(taskId) {
        const task = tasksData.find(t => t.id === taskId);
        if (!task) return;
        
        const response = await apiCall(`/tasks/${taskId}`, 'PUT', { 
            ...task, status: 'completed', completed_at: new Date().toISOString()
        });
        
        if (response && response.success) {
            showSystemNotification('✅ Задача отмечена как выполненная', 'success');
            await loadTasksData();
        } else {
            showSystemNotification('❌ Ошибка при отметке выполнения', 'error');
        }
    }

    async function archiveTask(taskId) {
        const task = tasksData.find(t => t.id === taskId);
        if (!task) return;
        
        const response = await apiCall(`/tasks/${taskId}`, 'PUT', { 
            ...task, is_archived: true, archived_at: new Date().toISOString()
        });
        
        if (response && response.success) {
            showSystemNotification('📦 Задача отправлена в архив', 'info');
            await loadTasksData();
        } else {
            showSystemNotification('❌ Ошибка при архивации', 'error');
        }
    }

    async function restoreTask(taskId) {
        const task = tasksData.find(t => t.id === taskId);
        if (!task) return;
        
        const response = await apiCall(`/tasks/${taskId}`, 'PUT', { 
            ...task, is_archived: false, restored_at: new Date().toISOString()
        });
        
        if (response && response.success) {
            showSystemNotification('📋 Задача восстановлена из архива', 'success');
            await loadTasksData();
        } else {
            showSystemNotification('❌ Ошибка при восстановлении', 'error');
        }
    }

    async function deleteTask(taskId) {
        const task = tasksData.find(t => t.id === taskId);
        if (!task) return;
        
        if (!confirm(`Вы уверены, что хотите НАВСЕГДА удалить задачу "${task.name}"?`)) return;
        
        const response = await apiCall(`/tasks/${taskId}`, 'DELETE');
        if (response && response.success) {
            showSystemNotification('🗑️ Задача удалена', 'warning');
            await loadTasksData();
        } else {
            showSystemNotification('❌ Ошибка при удалении', 'error');
        }
    }

    // ============================================
    // МОДАЛКА ЗАДАЧИ
    // ============================================

    function openTaskModal(taskId = null) {
        subtasksTemp = [];
        attachmentsTemp = [];
        selectedExecutors = [];
        
        const modal = document.getElementById('taskModal');
        const title = document.getElementById('taskModalTitle');
        const idField = document.getElementById('taskId');
        const nameField = document.getElementById('taskName');
        const authorField = document.getElementById('taskAuthor');
        const executorField = document.getElementById('taskExecutor');
        const deadlineField = document.getElementById('taskDeadline');
        const commentField = document.getElementById('taskComment');
        const recurringField = document.getElementById('taskRecurring');
        const authorHint = document.getElementById('authorHint');
        const multiSelectContainer = document.getElementById('multiSelectContainer');
        
        if (nameField) nameField.value = '';
        if (deadlineField) deadlineField.value = '';
        if (commentField) commentField.value = '';
        if (recurringField) recurringField.value = 'none';
        if (authorHint) authorHint.style.display = 'none';
        if (multiSelectContainer) multiSelectContainer.style.display = 'none';
        
        setTaskPriority('medium');
        
        document.querySelectorAll('#multiSelectOptions input[type="checkbox"]').forEach(cb => cb.checked = false);
        updateSelectedExecutorsDisplay();
        
        const currentUserRole = window.app?.currentUserRole;
        const canSelectAuthor = currentUserRole === 'director' || currentUserRole === 'manager';
        
        if (taskId) {
            const task = tasksData.find(t => t.id === taskId);
            if (task && !task.is_archived && task.status !== 'completed') {
                title.innerHTML = '✏️ Редактировать задачу';
                idField.value = task.id;
                nameField.value = task.name;
                
                if (task.is_group_task === 'operators') executorField.value = '__GROUP_OPERATORS__';
                else if (task.is_group_task === 'admins') executorField.value = '__GROUP_ADMINS__';
                else executorField.value = task.executor;
                
                setTaskPriority(task.priority || 'medium');
                deadlineField.value = task.deadline;
                commentField.value = task.comment || '';
                recurringField.value = task.recurring || 'none';
                
                if (canSelectAuthor) {
                    authorField.value = task.author;
                    authorField.disabled = false;
                } else {
                    authorField.innerHTML = `<option value="${escapeHtml(task.author)}">${escapeHtml(task.author)}</option>`;
                    authorField.disabled = true;
                    authorHint.style.display = 'block';
                }
                
                if (task.subtasks && task.subtasks.length) {
                    subtasksTemp = task.subtasks.map(s => ({ id: s.id, name: s.name, completed: s.completed }));
                }
                renderSubtasksList();
            } else if (task && task.status === 'completed') {
                showSystemNotification('❌ Нельзя редактировать выполненную задачу', 'error');
                return;
            } else if (task && task.is_archived) {
                showSystemNotification('❌ Нельзя редактировать архивную задачу', 'error');
                return;
            }
        } else {
            title.innerHTML = '➕ Создать задачу';
            idField.value = '';
            
            if (canSelectAuthor) {
                authorField.disabled = false;
                authorField.value = '';
            } else {
                authorField.innerHTML = `<option value="${escapeHtml(window.app?.currentUser)}">${escapeHtml(window.app?.currentUser)}</option>`;
                authorField.disabled = true;
                authorHint.style.display = 'block';
            }
            renderSubtasksList();
        }
        
        renderAttachmentsList();
        modal.classList.add('active');
    }

    function closeTaskModal() {
        document.getElementById('taskModal').classList.remove('active');
        selectedExecutors = [];
        updateSelectedExecutorsDisplay();
    }

    function addSubtask() {
        const name = prompt('Введите название подзадачи:');
        if (name && name.trim()) {
            subtasksTemp.push({ id: null, name: name.trim(), completed: false });
            renderSubtasksList();
            showSystemNotification('➕ Подзадача добавлена', 'info');
        }
    }

    function removeSubtask(index) {
        subtasksTemp.splice(index, 1);
        renderSubtasksList();
        showSystemNotification('➖ Подзадача удалена', 'info');
    }

    function toggleSubtaskComplete(index) {
        if (subtasksTemp[index]) {
            subtasksTemp[index].completed = !subtasksTemp[index].completed;
            renderSubtasksList();
        }
    }

    function renderSubtasksList() {
        const container = document.getElementById('subtasksList');
        if (!container) return;
        
        if (subtasksTemp.length === 0) {
            container.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 12px;">Нет подзадач</div>';
            return;
        }
        
        container.innerHTML = subtasksTemp.map((sub, idx) => `
            <div class="subtask-item">
                <input type="checkbox" class="subtask-checkbox" ${sub.completed ? 'checked' : ''} onchange="toggleSubtaskComplete(${idx})">
                <span class="subtask-name ${sub.completed ? 'completed' : ''}">${escapeHtml(sub.name)}</span>
                <button class="subtask-delete" onclick="removeSubtask(${idx})"><i class="fas fa-times-circle"></i></button>
            </div>
        `).join('');
    }

    function addTaskFileInput() {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file && file.size <= 5 * 1024 * 1024) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    attachmentsTemp.push({ name: file.name, size: file.size, data: event.target.result, type: file.type });
                    renderAttachmentsList();
                    showSystemNotification(`📎 Файл "${file.name}" добавлен`, 'info');
                };
                reader.readAsDataURL(file);
            } else if (file) {
                showSystemNotification('❌ Файл слишком большой (макс. 5MB)', 'error');
            }
        };
        input.click();
    }

    function removeAttachment(index) {
        attachmentsTemp.splice(index, 1);
        renderAttachmentsList();
    }

    function renderAttachmentsList() {
        const container = document.getElementById('taskAttachmentsList');
        if (!container) return;
        
        if (attachmentsTemp.length === 0) {
            container.innerHTML = '<div style="opacity: 0.5; text-align: center; padding: 8px;">Нет вложений</div>';
            return;
        }
        
        container.innerHTML = attachmentsTemp.map((att, idx) => `
            <div class="attachment-item">
                <i class="fas fa-paperclip"></i>
                <span>${escapeHtml(att.name)} (${Math.round(att.size / 1024)} KB)</span>
                <button class="attachment-remove" onclick="removeAttachment(${idx})"><i class="fas fa-trash-alt"></i></button>
            </div>
        `).join('');
    }

    // ============================================
    // СОХРАНЕНИЕ ЗАДАЧИ
    // ============================================

    async function saveTask() {
        if (isSavingTask) return;
        
        const taskId = document.getElementById('taskId')?.value;
        const name = document.getElementById('taskName')?.value.trim();
        let author = document.getElementById('taskAuthor')?.value;
        const executor = document.getElementById('taskExecutor')?.value;
        const priority = document.getElementById('taskPriority')?.value;
        const deadline = document.getElementById('taskDeadline')?.value;
        const comment = document.getElementById('taskComment')?.value;
        const recurring = document.getElementById('taskRecurring')?.value;
        
        if (!name) {
            showSystemNotification('❌ Введите название задачи', 'error');
            return;
        }
        if (!executor) {
            showSystemNotification('❌ Выберите исполнителя', 'error');
            return;
        }
        if (executor === '__MULTI_SELECT__' && selectedExecutors.length === 0) { 
            showSystemNotification('❌ Выберите хотя бы одного сотрудника', 'error');
            return;
        }
        
        if (deadline) {
            const today = new Date().toISOString().split('T')[0];
            if (deadline < today) {
                showSystemNotification('❌ Дедлайн не может быть в прошлом', 'error');
                return;
            }
        }
        
        const authorField = document.getElementById('taskAuthor');
        if (authorField && authorField.disabled && !author) author = window.app?.currentUser;
        
        isSavingTask = true;
        const saveBtn = document.querySelector('#taskModal .task-btn-save');
        const originalText = saveBtn?.innerHTML || 'Сохранить';
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';
            saveBtn.disabled = true;
        }
        
        try {
            const isGroupTask = executor === '__GROUP_OPERATORS__' || executor === '__GROUP_ADMINS__';
            let taskData;
            
            if (isGroupTask) {
                const employees = window.app?.employees || [];
                const profiles = window.app?.profiles || {};
                const groupMembers = executor === '__GROUP_OPERATORS__' 
                    ? employees.filter(emp => profiles[emp]?.role === 'operator').map(name => ({ name, completed: false }))
                    : employees.filter(emp => profiles[emp]?.role === 'admin').map(name => ({ name, completed: false }));
                
                taskData = {
                    name, author: author || window.app?.currentUser, executor, priority, deadline: deadline || null,
                    progress: 0, comment, recurring, status: 'in_progress',
                    subtasks: subtasksTemp.filter(s => s.name && s.name.trim()),
                    is_group_task: executor === '__GROUP_OPERATORS__' ? 'operators' : 'admins',
                    group_members: groupMembers
                };
            } else if (executor === '__MULTI_SELECT__') {
                taskData = {
                    name, author: author || window.app?.currentUser, executor, priority, deadline: deadline || null,
                    progress: 0, comment, recurring, status: 'in_progress',
                    subtasks: subtasksTemp.filter(s => s.name && s.name.trim()),
                    selected_executors: selectedExecutors
                };
            } else {
                taskData = {
                    name, author: author || window.app?.currentUser, executor, priority, deadline: deadline || null,
                    progress: 0, comment, recurring, status: 'in_progress',
                    subtasks: subtasksTemp.filter(s => s.name && s.name.trim())
                };
            }
            
            const response = await apiCall('/tasks', 'POST', { task: taskData });
            
            if (response && response.success) {
                showSystemNotification(taskId ? '✅ Задача обновлена' : '✅ Задача создана', 'success');
                closeTaskModal();
                await loadTasksData();
            } else {
                showSystemNotification('❌ Ошибка: ' + (response?.error || 'неизвестная ошибка'), 'error');
            }
        } catch (err) {
            console.error(err);
            showSystemNotification('❌ Ошибка соединения', 'error');
        } finally {
            isSavingTask = false;
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    // ============================================
    // ГРУППОВЫЕ ЗАДАЧИ
    // ============================================

    function openGroupTaskModal(taskId) {
        const task = tasksData.find(t => t.id === taskId);
        if (!task) return;
        
        let groupProgress = task.group_progress;
        if (typeof groupProgress === 'string') groupProgress = JSON.parse(groupProgress);
        
        const members = groupProgress?.members || [];
        const total = members.length;
        const completedCount = members.filter(m => m.completed).length;
        
        const modalHtml = `
            <div id="groupTaskModal" class="modal active">
                <div class="modal-window" style="max-width: 550px;">
                    <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                        <h3>📋 ${escapeHtml(task.name)}</h3>
                        <p style="font-size: 12px; color: #64748b; margin-top: 4px;">Отметьте, кто выполнил задачу</p>
                    </div>
                    <div style="padding: 20px; max-height: 400px; overflow-y: auto;">
                        <div style="margin-bottom: 16px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                <span>Прогресс выполнения</span>
                                <span style="color: #fbbf24;">${completedCount} / ${total}</span>
                            </div>
                            <div class="progress-bar" style="height: 8px;">
                                <div class="progress-fill" style="width: ${total > 0 ? (completedCount / total * 100) : 0}%; background: linear-gradient(90deg, #10b981, #34d399);"></div>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${members.map(member => `
                                <label class="group-task-member" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #0d1016; border-radius: 12px; cursor: pointer; border: 1px solid ${member.completed ? '#10b981' : 'rgba(99,102,241,0.2)'};">
                                    <input type="checkbox" class="member-checkbox" data-name="${escapeHtml(member.name)}" ${member.completed ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; accent-color: #10b981;">
                                    <span style="flex: 1; font-weight: 500;">${escapeHtml(member.name)}</span>
                                    <span class="member-status" style="font-size: 11px; ${member.completed ? 'color: #10b981;' : 'color: #f59e0b;'}">
                                        ${member.completed ? '✅ Выполнено' : '⏳ Ожидает'}
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div style="padding: 20px; border-top: 1px solid rgba(99,102,241,0.15); display: flex; gap: 12px; justify-content: flex-end;">
                        <button class="btn-primary" onclick="updateGroupTaskProgress(${taskId})">💾 Сохранить</button>
                        <button class="btn-secondary" onclick="closeGroupTaskModal()">❌ Закрыть</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function closeGroupTaskModal() {
        const modal = document.getElementById('groupTaskModal');
        if (modal) modal.remove();
    }

    async function updateGroupTaskProgress(taskId) {
        const checkboxes = document.querySelectorAll('#groupTaskModal .member-checkbox');
        const completedMembers = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.dataset.name);
        
        const response = await apiCall(`/tasks/${taskId}/group-progress`, 'PUT', { completed_members: completedMembers });
        
        if (response && response.success) {
            showSystemNotification('✅ Прогресс группы обновлён', 'success');
            closeGroupTaskModal();
            await loadTasksData();
            if (typeof updateDashboardStats === 'function') updateDashboardStats();
        } else {
            showSystemNotification('❌ Ошибка при обновлении', 'error');
        }
    }

    // ============================================
    // ФИЛЬТРЫ И ЭКСПОРТ
    // ============================================

    function resetFilters() {
        document.getElementById('taskSearch').value = '';
        document.getElementById('filterStatus').value = 'all';
        document.getElementById('filterExecutor').value = 'all';
        document.getElementById('filterPriority').value = 'all';
        document.getElementById('filterType').value = 'all';
        document.getElementById('showArchived').checked = false;
        showArchived = false;
        showSystemNotification('🔄 Фильтры сброшены', 'info');
        renderTasksTable();
    }

    function exportTasksToExcel() {
        const tasksToExport = showArchived ? tasksData : tasksData.filter(t => !t.is_archived);
        if (tasksToExport.length === 0) {
            showSystemNotification('⚠️ Нет задач для экспорта', 'warning');
            return;
        }
        
        const csvRows = [];
        const headers = ['ID', 'Название', 'Постановщик', 'Исполнитель', 'Приоритет', 'Статус', 'Дедлайн', 'Комментарий'];
        csvRows.push(headers.join(';'));
        
        for (const task of tasksToExport) {
            let executorDisplay = task.executor;
            if (task.is_group_task === 'operators') executorDisplay = 'Все операторы';
            else if (task.is_group_task === 'admins') executorDisplay = 'Все администраторы';
            
            const row = [
                task.id,
                `"${task.name.replace(/"/g, '""')}"`,
                task.author,
                executorDisplay,
                task.priority,
                task.status,
                task.deadline || '',
                `"${(task.comment || '').replace(/"/g, '""')}"`
            ];
            csvRows.push(row.join(';'));
        }
        
        const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', `tasks_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showSystemNotification(`📊 Экспортировано ${tasksToExport.length} задач`, 'success');
    }

    // ============================================
    // ШАБЛОНЫ
    // ============================================

    const taskTemplates = [
        { name: '🧹 Уборка', comment: 'Провести влажную уборку помещения', priority: 'medium' },
        { name: '🧴 Дезинфекция', comment: 'Обработать все шлемы и контроллеры', priority: 'high' },
        { name: '🔧 Ремонт оборудования', comment: 'Проверить и починить неисправности', priority: 'high' },
        { name: '📚 Обучение', comment: 'Изучить новые сценарии игр', priority: 'medium' },
        { name: '📸 Отчётность', comment: 'Заполнить ежедневный отчёт', priority: 'low' }
    ];

    function openTemplateModal() {
        let html = '<div style="display: flex; flex-direction: column; gap: 10px;">';
        
        for (const template of taskTemplates) {
            const priorityColor = template.priority === 'high' ? '#ef4444' : (template.priority === 'medium' ? '#f59e0b' : '#10b981');
            
            html += `
                <div class="template-item" onclick="useTemplate('${template.name.replace(/'/g, "\\'")}', '${template.comment.replace(/'/g, "\\'")}', '${template.priority}')" 
                     style="padding: 14px 16px; background: rgba(0,0,0,0.2); border-radius: 14px; cursor: pointer; border-left: 3px solid ${priorityColor};">
                    <div style="font-weight: 600; font-size: 15px;">${template.name}</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">${template.comment}</div>
                </div>
            `;
        }
        
        html += '</div>';
        
        const modalHtml = `
            <div id="templateModal" class="modal active">
                <div class="modal-window" style="max-width: 450px;">
                    <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                        <h3><i class="fas fa-copy"></i> Шаблоны задач</h3>
                    </div>
                    <div style="padding: 20px;">${html}</div>
                    <div style="padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                        <button class="btn-secondary" onclick="closeTemplateModal()">Закрыть</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function closeTemplateModal() {
        const modal = document.getElementById('templateModal');
        if (modal) modal.remove();
    }

    function useTemplate(name, comment, priority) {
        closeTemplateModal();
        openTaskModal();
        setTimeout(() => {
            document.getElementById('taskName').value = name;
            document.getElementById('taskComment').value = comment;
            setTaskPriority(priority);
            showSystemNotification(`📋 Шаблон "${name}" применён`, 'info');
        }, 100);
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    window.initTasks = initTasks;
    window.resetTasksState = resetTasksState;
    window.openTaskModal = openTaskModal;
    window.closeTaskModal = closeTaskModal;
    window.saveTask = saveTask;
    window.deleteTask = deleteTask;
    window.archiveTask = archiveTask;
    window.restoreTask = restoreTask;
    window.markTaskComplete = markTaskComplete;
    window.addSubtask = addSubtask;
    window.removeSubtask = removeSubtask;
    window.toggleSubtaskComplete = toggleSubtaskComplete;
    window.addTaskFileInput = addTaskFileInput;
    window.removeAttachment = removeAttachment;
    window.resetFilters = resetFilters;
    window.exportTasksToExcel = exportTasksToExcel;
    window.toggleExecutorSelection = toggleExecutorSelection;
    window.removeSelectedExecutor = removeSelectedExecutor;
    window.openGroupTaskModal = openGroupTaskModal;
    window.closeGroupTaskModal = closeGroupTaskModal;
    window.updateGroupTaskProgress = updateGroupTaskProgress;
    window.toggleTaskExpand = toggleTaskExpand;
    window.setTaskPriority = setTaskPriority;
    window.openTemplateModal = openTemplateModal;
    window.closeTemplateModal = closeTemplateModal;
    window.useTemplate = useTemplate;
    window.renderTasksTable = renderTasksTable;

    window.addEventListener('dataUpdate', (e) => { if (e.detail.type === 'task') loadTasksData(); });

    console.log('✅ tasks.js загружен (v2.1 — с уведомлениями)');
})();