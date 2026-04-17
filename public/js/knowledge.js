// public/js/knowledge.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ
(function() {
    'use strict';
    
    let knowledgeCategories = [];
    let knowledgeArticles = [];
    let knowledgeSearchQuery = '';
    let editingArticleId = null;
    let editingCategoryId = null;
    let isLoadingKnowledge = false;
    let activeEditor = null;

    // ============================================
    // ПРОВЕРКА ПРАВ ДОСТУПА
    // ============================================
    function canManageCategories() {
        const role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager';
    }

    function canManageArticles() {
        const role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager' || role === 'admin' || role === 'operator';
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ РЕДАКТОРА
    // ============================================
    function initEditor(editorElement) {
        activeEditor = editorElement;
        if (!editorElement.innerHTML || editorElement.innerHTML === '<br>') {
            editorElement.innerHTML = '';
        }
        setTimeout(() => editorElement.focus(), 100);
    }

    function execCommand(command, value = null) {
        if (!activeEditor) activeEditor = document.getElementById('articleContent');
        if (!activeEditor) return;
        activeEditor.focus();
        try { document.execCommand(command, false, value); } catch (e) {}
    }

    // ============================================
    // ФУНКЦИИ РЕДАКТОРА
    // ============================================
    function applyFormat(command, value = null) { execCommand(command, value); }

    function setFontSize(size) {
        if (!activeEditor) activeEditor = document.getElementById('articleContent');
        if (!activeEditor) return;
        activeEditor.focus();
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const span = document.createElement('span');
            const sizes = { '1': '12px', '2': '14px', '3': '16px', '4': '18px', '5': '20px', '6': '24px', '7': '28px' };
            span.style.fontSize = sizes[size] || '16px';
            try { range.surroundContents(span); } catch (e) {
                const selectedText = range.toString();
                if (selectedText) { span.textContent = selectedText; range.deleteContents(); range.insertNode(span); }
            }
        }
        selection.removeAllRanges();
        activeEditor.focus();
    }

    function setFontFamily(font) { execCommand('fontName', font); }
    function setTextColor(color) { execCommand('foreColor', color); }
    function setBackgroundColor(color) { execCommand('backColor', color); }
    function setTextAlign(align) { execCommand('justify' + align.charAt(0).toUpperCase() + align.slice(1)); }

    function insertLink() {
        const url = prompt('Введите URL ссылки:', 'https://');
        if (!url) return;
        const lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) { showNotif('❌ Недопустимый тип ссылки', 'error'); return; }
        const text = prompt('Введите текст ссылки:', 'Ссылка');
        if (text) {
            execCommand('insertHTML', `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #a78bfa; text-decoration: none;">${escapeHtml(text)}</a>`);
        } else {
            execCommand('createLink', escapeHtml(url));
        }
    }

    function insertImage() {
        const url = prompt('Введите URL изображения:', 'https://');
        if (!url) return;
        const lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) { showNotif('❌ Недопустимый тип URL', 'error'); return; }
        execCommand('insertImage', escapeHtml(url));
    }

    function insertVideo() {
        const url = prompt('Введите URL видео (YouTube):', 'https://www.youtube.com/watch?v=');
        if (!url) return;
        let embedUrl = url;
        if (url.includes('youtube.com/watch?v=')) { const videoId = url.split('v=')[1]?.split('&')[0]; if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`; }
        else if (url.includes('youtu.be/')) { const videoId = url.split('youtu.be/')[1]?.split('?')[0]; if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`; }
        execCommand('insertHTML', `<div style="margin:20px 0;"><iframe width="100%" height="400" src="${escapeHtml(embedUrl)}" frameborder="0" allowfullscreen style="border-radius:16px;"></iframe></div>`);
    }

    function insertUnorderedList() { execCommand('insertUnorderedList'); }
    function insertOrderedList() { execCommand('insertOrderedList'); }
    function insertHorizontalRule() { execCommand('insertHorizontalRule'); }

    function insertTable() {
        const rows = prompt('Количество строк:', '3');
        const cols = prompt('Количество столбцов:', '3');
        if (!rows || !cols) return;
        let table = '<div style="overflow-x:auto;margin:20px 0;"><table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:16px;overflow:hidden;">';
        for (let i = 0; i < parseInt(rows); i++) {
            table += '<tr>';
            for (let j = 0; j < parseInt(cols); j++) {
                const isHeader = i === 0;
                const tag = isHeader ? 'th' : 'td';
                const bgStyle = isHeader ? 'background:rgba(99,102,241,0.15);font-weight:600;' : '';
                table += `<${tag} style="border:1px solid #475569;padding:12px 16px;text-align:left;${bgStyle}">${isHeader ? `Заголовок ${j+1}` : `Ячейка ${i+1},${j+1}`}</${tag}>`;
            }
            table += '</tr>';
        }
        table += '</table></div>';
        execCommand('insertHTML', table);
    }

    function insertCode() {
        const code = prompt('Введите код:');
        if (!code) return;
        execCommand('insertHTML', `<pre style="background:#1e1e1e;color:#d4d4d4;padding:20px;border-radius:16px;overflow-x:auto;font-family:'Courier New',monospace;font-size:13px;line-height:1.5;margin:20px 0;"><code>${escapeHtml(code)}</code></pre>`);
    }

    function insertQuote() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const selectedText = range.toString();
            if (selectedText) {
                execCommand('insertHTML', `<blockquote style="border-left:4px solid #a78bfa;margin:20px 0;padding:12px 20px;background:rgba(99,102,241,0.08);border-radius:16px;font-style:italic;color:#cbd5e1;">${escapeHtml(selectedText)}</blockquote>`);
                return;
            }
        }
        execCommand('insertHTML', `<blockquote style="border-left:4px solid #a78bfa;margin:20px 0;padding:12px 20px;background:rgba(99,102,241,0.08);border-radius:16px;font-style:italic;color:#cbd5e1;">Введите цитату...</blockquote>`);
    }

    function insertHeading(level) { execCommand('formatBlock', `h${level}`); }
    function insertDivider() { execCommand('insertHTML', '<hr style="margin:32px 0;border:none;height:1px;background:linear-gradient(90deg,transparent,#a78bfa,transparent);">'); }
    function clearFormatting() { execCommand('removeFormat'); }

    function insertEmoji(emoji) {
        if (!activeEditor) activeEditor = document.getElementById('articleContent');
        if (!activeEditor) return;
        activeEditor.focus();
        execCommand('insertText', emoji);
    }

    function insertAlert(type) {
        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        const colors = { info: '#3b82f6', success: '#10b981', warning: '#f59e0b', error: '#ef4444' };
        const text = prompt('Введите текст уведомления:', 'Текст сообщения');
        if (!text) return;
        execCommand('insertHTML', `<div style="background:${colors[type]}15;border-left:4px solid ${colors[type]};border-radius:16px;padding:16px 20px;margin:20px 0;display:flex;align-items:center;gap:12px;"><span style="font-size:24px;">${icons[type]}</span><span style="color:#e2e8f0;">${escapeHtml(text)}</span></div>`);
    }

    function insertCard() {
        const title = prompt('Введите заголовок карточки:', 'Заголовок');
        const content = prompt('Введите содержание карточки:', 'Текст карточки');
        if (!title || !content) return;
        execCommand('insertHTML', `<div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:20px;padding:24px;margin:20px 0;border:1px solid rgba(99,102,241,0.3);"><h4 style="color:#a78bfa;margin:0 0 16px;font-size:20px;font-weight:600;">📌 ${escapeHtml(title)}</h4><p style="color:#cbd5e1;margin:0;line-height:1.7;">${escapeHtml(content)}</p></div>`);
    }

    // ============================================
    // СПИСОК ИКОНОК И ЭМОДЗИ
    // ============================================
    const iconList = [
        { icon: '📁', name: 'Общая / База' }, { icon: '📖', name: 'Инструкции' }, { icon: '📜', name: 'Правила' },
        { icon: '❓', name: 'Вопросы / FAQ' }, { icon: '💡', name: 'Идеи / Советы' }, { icon: '🔧', name: 'Настройки' },
        { icon: '⚙️', name: 'Техника' }, { icon: '🎮', name: 'Игры' }, { icon: '🏆', name: 'Турниры / Рейтинг' },
        { icon: '⭐', name: 'Избранное / Топ' }, { icon: '🔥', name: 'Важное / Срочно' }, { icon: '✅', name: 'Готово / Выполнено' },
        { icon: '❌', name: 'Ошибки / Проблемы' }, { icon: '⚠️', name: 'Внимание' }, { icon: 'ℹ️', name: 'Справка / Инфо' },
        { icon: '📅', name: 'Календарь / События' }, { icon: '🎧', name: 'VR-шлемы' }, { icon: '🎮', name: 'Контроллеры' },
        { icon: '📡', name: 'Wi-Fi / Сеть' }, { icon: '🧹', name: 'Уборка / Дезинфекция' }, { icon: '👋', name: 'Встреча гостей' },
        { icon: '💬', name: 'Общение / Скрипты' }, { icon: '🎫', name: 'Бронирования' }, { icon: '🆕', name: 'Онбординг / Новичкам' },
        { icon: '💰', name: 'Финансы' }, { icon: '📊', name: 'Отчёты' }, { icon: '🌍', name: 'О WARPOINT' },
        { icon: '📢', name: 'Новости' }, { icon: '🤝', name: 'Команда' }
    ];

    const presetCategories = [
        { icon: '⚔️', name: 'Мясорубка' }, { icon: '👥', name: 'Командный бой' }, { icon: '🔫', name: 'Свободная игра' },
        { icon: '🧟', name: 'Кооператив' }, { icon: '👤', name: 'VR-станция' }, { icon: '🎢', name: 'VR-экстрим' },
        { icon: '🏆', name: 'Турниры' }, { icon: '⚔️', name: 'WARPOINT BATTLE' }, { icon: '📊', name: 'Рейтинг' },
        { icon: '🎯', name: 'Тактика' }, { icon: '🎂', name: 'День рождения' }, { icon: '🏢', name: 'Корпоратив' },
        { icon: '🎓', name: 'Выпускной' }, { icon: '🎈', name: 'Праздники' }, { icon: '🎧', name: 'VR-шлемы' },
        { icon: '🎮', name: 'Контроллеры' }, { icon: '📡', name: 'Wi-Fi' }, { icon: '🧹', name: 'Дезинфекция' },
        { icon: '👋', name: 'Встреча' }, { icon: '💬', name: 'Скрипты' }, { icon: '⭐', name: 'Отзывы' },
        { icon: '🎫', name: 'Бронирования' }, { icon: '🆕', name: 'Онбординг' }, { icon: '📜', name: 'Правила' },
        { icon: '🔥', name: 'Горячие темы' }, { icon: '💰', name: 'Финансы' }, { icon: '📊', name: 'Отчёты' },
        { icon: '🌍', name: 'О WARPOINT' }, { icon: '📢', name: 'Новости' }, { icon: '🤝', name: 'Команда' },
        { icon: '💡', name: 'Фишки' }
    ];

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    function isCategoryExists(name, excludeId = null) {
        return knowledgeCategories.some(cat => cat.name.toLowerCase() === name.toLowerCase() && cat.id !== excludeId);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU');
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initKnowledge() {
        console.log('📚 Инициализация базы знаний');
        const container = document.getElementById('knowledgeContainer');
        if (!container) { setTimeout(initKnowledge, 100); return; }
        loadKnowledgeData();
        const searchInput = document.getElementById('knowledgeSearch');
        if (searchInput) searchInput.addEventListener('input', (e) => { knowledgeSearchQuery = e.target.value.toLowerCase(); renderKnowledge(); });
        setupActionButtons();
    }

    function setupActionButtons() {
        const actionButtons = document.getElementById('actionButtons');
        if (!actionButtons) return;
        if (canManageCategories()) {
            actionButtons.innerHTML = `<button class="btn-secondary" onclick="openCreateCategoryModal()"><i class="fas fa-folder-plus"></i> Новая категория</button><button class="btn-secondary" onclick="showAddPresetModal()"><i class="fas fa-magic"></i> Готовые категории</button>`;
        } else if (canManageArticles()) {
            actionButtons.innerHTML = `<span style="font-size:12px;color:#64748b;"><i class="fas fa-info-circle"></i> Вы можете добавлять статьи</span>`;
        } else { actionButtons.innerHTML = ''; }
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================
    async function loadKnowledgeData() {
        if (isLoadingKnowledge) return;
        isLoadingKnowledge = true;
        const container = document.getElementById('knowledgeContainer');
        if (container) container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
        try {
            const categoriesRes = await apiCall('/knowledge/categories');
            const articlesRes = await apiCall('/knowledge/articles');
            knowledgeCategories = (categoriesRes && categoriesRes.success) ? categoriesRes.data : (Array.isArray(categoriesRes) ? categoriesRes : []);
            knowledgeArticles = (articlesRes && articlesRes.success) ? articlesRes.data : (Array.isArray(articlesRes) ? articlesRes : []);
            renderKnowledge();
        } catch (err) {
            if (container) container.innerHTML = `<div class="empty-knowledge"><i class="fas fa-exclamation-triangle"></i><h3>Ошибка загрузки</h3><button class="btn-primary" onclick="loadKnowledgeData()">🔄 Повторить</button></div>`;
        } finally { isLoadingKnowledge = false; }
    }

    // ============================================
    // РЕНДЕР
    // ============================================
    function renderKnowledge() {
        const container = document.getElementById('knowledgeContainer');
        if (!container) return;
        let filteredArticles = [...knowledgeArticles];
        if (knowledgeSearchQuery) filteredArticles = filteredArticles.filter(a => (a.title && a.title.toLowerCase().includes(knowledgeSearchQuery)) || (a.content && a.content.toLowerCase().includes(knowledgeSearchQuery)));
        const categoriesWithArticles = knowledgeCategories.map(cat => ({ ...cat, articles: filteredArticles.filter(a => a.category_id === cat.id) }));
        const canEditCategories = canManageCategories();
        const canEditArticles = canManageArticles();
        
        if (knowledgeCategories.length === 0) {
            if (canEditCategories) renderPresetSelector(container);
            else container.innerHTML = `<div class="empty-knowledge"><i class="fas fa-folder-open"></i><h3>База знаний пуста</h3><p>Категории ещё не созданы. Обратитесь к руководителю.</p></div>`;
            return;
        }
        
        let html = '';
        for (const cat of categoriesWithArticles) {
            const hasArticles = cat.articles.length > 0;
            html += `<div class="knowledge-category" data-category-id="${cat.id}"><div class="category-header" onclick="toggleCategory(${cat.id})"><div class="category-title"><div class="category-icon">${escapeHtml(cat.icon || '📁')}</div><div class="category-name">${escapeHtml(cat.name)}</div><div class="category-count">${cat.articles.length}</div></div><div class="category-actions">${canEditCategories ? `<button class="category-edit" onclick="event.stopPropagation(); openEditCategoryModal(${cat.id}, '${escapeHtml(cat.name)}', '${escapeHtml(cat.icon || '📁')}')" title="Редактировать"><i class="fas fa-edit"></i></button><button class="btn-icon-delete" onclick="event.stopPropagation(); deleteCategory(${cat.id})" title="Удалить"><i class="fas fa-trash-alt"></i></button>` : ''}<div class="category-arrow"><i class="fas fa-chevron-down"></i></div></div></div><div class="category-content" style="display:none;">`;
            if (hasArticles) {
                html += cat.articles.map(article => `<div class="knowledge-article" data-article-id="${article.id}"><div class="article-info" onclick="openArticle(${article.id})"><div class="article-title"><i class="fas fa-file-alt"></i> ${escapeHtml(article.title)}</div><div class="article-meta"><span><i class="fas fa-eye"></i> ${article.views || 0}</span><span><i class="fas fa-calendar-alt"></i> ${formatDate(article.created_at)}</span></div></div>${canEditArticles ? `<div class="article-actions"><button class="article-edit" onclick="event.stopPropagation(); openEditArticleModal(${article.id})"><i class="fas fa-edit"></i></button><button class="btn-icon-delete" onclick="event.stopPropagation(); deleteArticle(${article.id})"><i class="fas fa-trash-alt"></i></button></div>` : ''}</div>`).join('');
            } else {
                html += `<div class="empty-category-message"><i class="fas fa-info-circle"></i> В этой категории пока нет статей</div>`;
            }
            if (canEditArticles) html += `<button class="add-article-btn" onclick="event.stopPropagation(); openCreateArticleModal(${cat.id})"><i class="fas fa-plus"></i> Добавить статью</button>`;
            html += `</div></div>`;
        }
        if (canEditCategories) html += `<div class="action-buttons-bottom"><button class="btn-secondary" onclick="openCreateCategoryModal()"><i class="fas fa-folder-plus"></i> Новая категория</button><button class="btn-secondary" onclick="showAddPresetModal()"><i class="fas fa-magic"></i> Готовые категории</button></div>`;
        container.innerHTML = html;
        
        try {
            const openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');
            openCategories.forEach(catId => { const content = document.querySelector(`.knowledge-category[data-category-id="${catId}"] .category-content`); const arrow = document.querySelector(`.knowledge-category[data-category-id="${catId}"] .category-arrow i`); if (content) { content.style.display = 'flex'; if (arrow) arrow.style.transform = 'rotate(180deg)'; } });
        } catch(e) {}
    }

    function toggleCategory(categoryId) {
        const category = document.querySelector(`.knowledge-category[data-category-id="${categoryId}"]`);
        const content = category?.querySelector('.category-content');
        const arrow = category?.querySelector('.category-arrow i');
        if (!content) return;
        let openCategories = [];
        try { openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]'); } catch(e) {}
        if (content.style.display === 'none' || content.style.display === '') { content.style.display = 'flex'; if (arrow) arrow.style.transform = 'rotate(180deg)'; if (!openCategories.includes(categoryId)) openCategories.push(categoryId); }
        else { content.style.display = 'none'; if (arrow) arrow.style.transform = 'rotate(0deg)'; openCategories = openCategories.filter(id => id !== categoryId); }
        localStorage.setItem('knowledgeOpenCategories', JSON.stringify(openCategories));
    }

    // ============================================
    // ПРЕСЕТЫ
    // ============================================
    function renderPresetSelector(container) {
        let rowsHtml = '';
        for (let i = 0; i < presetCategories.length; i += 6) {
            const rowCategories = presetCategories.slice(i, i + 6);
            rowsHtml += `<div class="preset-row">${rowCategories.map(cat => `<div class="preset-item" onclick="createCategoryFromPreset('${escapeHtml(cat.name)}', '${escapeHtml(cat.icon)}')"><div class="preset-item-icon">${escapeHtml(cat.icon)}</div><div class="preset-item-name">${escapeHtml(cat.name)}</div></div>`).join('')}</div>`;
        }
        container.innerHTML = `<div class="preset-selector"><div class="preset-header"><i class="fas fa-magic"></i><h2>Создайте базу знаний WARPOINT</h2><p>Нажмите на категорию, чтобы добавить её</p></div><div class="preset-grid">${rowsHtml}</div><div class="action-buttons-bottom"><button class="btn-create-all" onclick="createAllCategoriesWithProgress()"><i class="fas fa-plus-circle"></i> Создать все категории (${presetCategories.length})</button><button class="btn-secondary" onclick="openCreateCategoryModal()"><i class="fas fa-plus"></i> Создать свою категорию</button></div></div>`;
    }

    function showAddPresetModal() {
        let rowsHtml = '';
        for (let i = 0; i < presetCategories.length; i += 6) {
            const rowCategories = presetCategories.slice(i, i + 6);
            rowsHtml += `<div class="preset-row">${rowCategories.map(cat => `<div class="preset-item" onclick="createCategoryFromPresetAndClose('${escapeHtml(cat.name)}', '${escapeHtml(cat.icon)}')"><div class="preset-item-icon">${escapeHtml(cat.icon)}</div><div class="preset-item-name">${escapeHtml(cat.name)}</div></div>`).join('')}</div>`;
        }
        const modalHtml = `<div id="presetModal" class="modal active"><div class="modal-window" style="max-width:700px;max-height:80vh;overflow-y:auto;"><div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h3>🎨 Добавить готовые категории</h3></div><div style="padding:20px;"><div class="preset-grid">${rowsHtml}</div><div style="display:flex;gap:12px;justify-content:center;margin-top:16px;"><button class="btn-create-all" onclick="createAllCategoriesWithProgress();closePresetModal();"><i class="fas fa-plus-circle"></i> Создать все категории</button></div></div><div style="display:flex;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);"><button class="btn-secondary" onclick="closePresetModal()">Закрыть</button></div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function closePresetModal() { const modal = document.getElementById('presetModal'); if (modal) modal.remove(); }
    async function createCategoryFromPreset(name, icon) { if (isCategoryExists(name)) { showNotif(`❌ Категория "${name}" уже существует!`, 'error'); return; } const response = await apiCall('/knowledge/categories', 'POST', { name, icon }); if (response?.success) { showNotif(`✅ Категория "${name}" создана`, 'success'); await loadKnowledgeData(); } else { showNotif(`❌ Ошибка при создании`, 'error'); } }
    async function createCategoryFromPresetAndClose(name, icon) { await createCategoryFromPreset(name, icon); closePresetModal(); }
    async function createAllCategoriesWithProgress() { let created = 0, skipped = 0; showNotif(`⏳ Создание категорий...`, 'info'); for (const cat of presetCategories) { if (isCategoryExists(cat.name)) { skipped++; continue; } const response = await apiCall('/knowledge/categories', 'POST', { name: cat.name, icon: cat.icon }); if (response?.success) created++; await new Promise(r => setTimeout(r, 20)); } showNotif(`✅ Создано: ${created}, Пропущено: ${skipped}`, created > 0 ? 'success' : 'info'); await loadKnowledgeData(); }

    // ============================================
    // КАТЕГОРИИ
    // ============================================
    function openCreateCategoryModal() { /* ... код без изменений ... */ }
    function openEditCategoryModal(id, name, icon) { /* ... код без изменений ... */ }
    function closeCategoryModal() { const modal = document.getElementById('categoryModal'); if (modal) modal.remove(); editingCategoryId = null; }
    async function saveCategory() { /* ... код без изменений ... */ }
    async function deleteCategoryWithClose(categoryId) { /* ... код без изменений ... */ }
    async function deleteCategory(categoryId) { /* ... код без изменений ... */ }

    // ============================================
    // СТАТЬИ
    // ============================================
    async function openArticle(articleId) { /* ... код без изменений ... */ }
    function closeArticleModal() { const modal = document.getElementById('articleModal'); if (modal) modal.remove(); }
    function closeArticleEditModal() { const modal = document.getElementById('articleEditModal'); if (modal) modal.remove(); editingArticleId = null; }
    async function saveArticle() { /* ... код без изменений ... */ }
    function deleteArticleConfirm(articleId) { if (confirm('Удалить эту статью?')) deleteArticleWithClose(articleId); }
    async function deleteArticleWithClose(articleId) { const response = await apiCall(`/knowledge/articles/${articleId}`, 'DELETE'); if (response?.success) { showNotif('✅ Статья удалена', 'success'); closeArticleEditModal(); closeArticleModal(); await loadKnowledgeData(); } else { showNotif('❌ Ошибка при удалении', 'error'); } }
    async function deleteArticle(articleId) { if (!canManageArticles()) { showNotif('Нет прав', 'error'); return; } if (!confirm('Удалить статью?')) return; const response = await apiCall(`/knowledge/articles/${articleId}`, 'DELETE'); if (response?.success) { showNotif('✅ Статья удалена', 'success'); await loadKnowledgeData(); } else { showNotif('❌ Ошибка', 'error'); } }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    window.initKnowledge = initKnowledge;
    window.toggleCategory = toggleCategory;
    window.openArticle = openArticle;
    window.closeArticleModal = closeArticleModal;
    window.closeArticleEditModal = closeArticleEditModal;
    window.saveArticle = saveArticle;
    window.deleteArticle = deleteArticle;
    window.deleteArticleWithClose = deleteArticleWithClose;
    window.deleteArticleConfirm = deleteArticleConfirm;
    window.loadKnowledgeData = loadKnowledgeData;
    window.createCategoryFromPreset = createCategoryFromPreset;
    window.createCategoryFromPresetAndClose = createCategoryFromPresetAndClose;
    window.createAllCategoriesWithProgress = createAllCategoriesWithProgress;
    window.showAddPresetModal = showAddPresetModal;
    window.closePresetModal = closePresetModal;
    window.applyFormat = applyFormat;
    window.setFontSize = setFontSize;
    window.setFontFamily = setFontFamily;
    window.setTextColor = setTextColor;
    window.setBackgroundColor = setBackgroundColor;
    window.setTextAlign = setTextAlign;
    window.insertLink = insertLink;
    window.insertImage = insertImage;
    window.insertVideo = insertVideo;
    window.insertUnorderedList = insertUnorderedList;
    window.insertOrderedList = insertOrderedList;
    window.insertHorizontalRule = insertHorizontalRule;
    window.insertTable = insertTable;
    window.insertCode = insertCode;
    window.insertQuote = insertQuote;
    window.insertHeading = insertHeading;
    window.insertAlert = insertAlert;
    window.insertCard = insertCard;
    window.insertDivider = insertDivider;
    window.insertEmoji = insertEmoji;
    window.clearFormatting = clearFormatting;

    console.log('✅ knowledge.js загружен');
})();