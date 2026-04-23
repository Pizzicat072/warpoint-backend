// public/js/knowledge.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ v1.1
// Добавлены все уведомления

(function() {
    'use strict';
    
    let knowledgeCategories = [];
    let knowledgeArticles = [];
    let knowledgeSearchQuery = '';
    let editingArticleId = null;
    let editingCategoryId = null;
    let isLoadingKnowledge = false;
    let activeEditor = null;
    let knowledgeInitialized = false;

    // ============================================
    // СБРОС СОСТОЯНИЯ
    // ============================================
    function resetKnowledgeState() {
        console.log('🧹 Сброс состояния базы знаний');
        knowledgeInitialized = false;
        editingArticleId = null;
        editingCategoryId = null;
        activeEditor = null;
    }

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
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) {
            showSystemNotification('❌ Недопустимый тип ссылки', 'error');
            return;
        }
        const text = prompt('Введите текст ссылки:', 'Ссылка');
        if (text) {
            execCommand('insertHTML', `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #a78bfa; text-decoration: none;">${escapeHtml(text)}</a>`);
        } else {
            execCommand('createLink', escapeHtml(url));
        }
        showSystemNotification('🔗 Ссылка добавлена', 'info');
    }

    function insertImage() {
        const url = prompt('Введите URL изображения:', 'https://');
        if (!url) return;
        const lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) {
            showSystemNotification('❌ Недопустимый тип URL', 'error');
            return;
        }
        execCommand('insertImage', escapeHtml(url));
        showSystemNotification('🖼️ Изображение добавлено', 'info');
    }

    function insertVideo() {
        const url = prompt('Введите URL видео (YouTube):', 'https://www.youtube.com/watch?v=');
        if (!url) return;
        let embedUrl = url;
        if (url.includes('youtube.com/watch?v=')) {
            const videoId = url.split('v=')[1]?.split('&')[0];
            if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
        } else if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1]?.split('?')[0];
            if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
        }
        execCommand('insertHTML', `<div style="margin:20px 0;"><iframe width="100%" height="400" src="${escapeHtml(embedUrl)}" frameborder="0" allowfullscreen style="border-radius:16px;"></iframe></div>`);
        showSystemNotification('🎬 Видео добавлено', 'info');
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
        showSystemNotification('📊 Таблица добавлена', 'info');
    }

    function insertCode() {
        const code = prompt('Введите код:');
        if (!code) return;
        execCommand('insertHTML', `<pre style="background:#1e1e1e;color:#d4d4d4;padding:20px;border-radius:16px;overflow-x:auto;font-family:'Courier New',monospace;font-size:13px;line-height:1.5;margin:20px 0;"><code>${escapeHtml(code)}</code></pre>`);
        showSystemNotification('💻 Код добавлен', 'info');
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
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initKnowledge() {
        if (knowledgeInitialized) {
            console.log('📚 База знаний уже инициализирована');
            return;
        }
        
        console.log('📚 Инициализация базы знаний');
        const container = document.getElementById('knowledgeContainer');
        if (!container) { setTimeout(initKnowledge, 100); return; }
        loadKnowledgeData();
        const searchInput = document.getElementById('knowledgeSearch');
        if (searchInput) searchInput.addEventListener('input', (e) => { knowledgeSearchQuery = e.target.value.toLowerCase(); renderKnowledge(); });
        setupActionButtons();
        
        knowledgeInitialized = true;
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
            showSystemNotification(`📚 Загружено ${knowledgeCategories.length} категорий, ${knowledgeArticles.length} статей`, 'info');
            renderKnowledge();
        } catch (err) {
            if (container) container.innerHTML = `<div class="empty-knowledge"><i class="fas fa-exclamation-triangle"></i><h3>Ошибка загрузки</h3><button class="btn-primary" onclick="loadKnowledgeData()">🔄 Повторить</button></div>`;
            showSystemNotification('❌ Ошибка загрузки базы знаний', 'error');
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
    
    async function createCategoryFromPreset(name, icon) {
        if (isCategoryExists(name)) { showSystemNotification(`❌ Категория "${name}" уже существует!`, 'error'); return; }
        const response = await apiCall('/knowledge/categories', 'POST', { name, icon });
        if (response?.success) { showSystemNotification(`✅ Категория "${name}" создана`, 'success'); await loadKnowledgeData(); } 
        else { showSystemNotification(`❌ Ошибка при создании`, 'error'); }
    }
    
    async function createCategoryFromPresetAndClose(name, icon) { await createCategoryFromPreset(name, icon); closePresetModal(); }
    
    async function createAllCategoriesWithProgress() {
        let created = 0, skipped = 0;
        showSystemNotification(`⏳ Создание категорий...`, 'info');
        for (const cat of presetCategories) {
            if (isCategoryExists(cat.name)) { skipped++; continue; }
            const response = await apiCall('/knowledge/categories', 'POST', { name: cat.name, icon: cat.icon });
            if (response?.success) created++;
            await new Promise(r => setTimeout(r, 20));
        }
        showSystemNotification(`✅ Создано: ${created}, Пропущено: ${skipped}`, created > 0 ? 'success' : 'info');
        await loadKnowledgeData();
    }

    function isCategoryExists(name) {
        return knowledgeCategories.some(cat => cat.name.toLowerCase() === name.toLowerCase());
    }

    // ============================================
    // КАТЕГОРИИ
    // ============================================
    function openCreateCategoryModal() {
        const modalHtml = `<div id="categoryModal" class="modal active"><div class="modal-window" style="max-width:450px;"><div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h3>➕ Новая категория</h3></div><div style="padding:20px;"><div class="form-group"><label><i class="fas fa-tag"></i> Название</label><input type="text" id="categoryName" class="form-input" placeholder="Введите название"></div><div class="form-group"><label><i class="fas fa-icons"></i> Иконка</label><div class="icon-selector" style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;max-height:200px;overflow-y:auto;padding:8px;background:#0d1016;border-radius:12px;">${iconList.map(i => `<div class="icon-option" onclick="selectIcon('${i.icon}')" style="font-size:24px;cursor:pointer;padding:8px;text-align:center;border-radius:8px;">${i.icon}</div>`).join('')}</div><input type="hidden" id="categoryIcon" value="📁"></div></div><div style="display:flex;gap:12px;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);"><button class="btn-primary" onclick="saveCategory()">Создать</button><button class="btn-secondary" onclick="closeCategoryModal()">Отмена</button></div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        window.selectIcon = function(icon) { document.getElementById('categoryIcon').value = icon; document.querySelectorAll('.icon-option').forEach(el => el.style.background = ''); event.target.style.background = 'rgba(99,102,241,0.3)'; };
    }

    function openEditCategoryModal(id, name, icon) {
        editingCategoryId = id;
        const modalHtml = `<div id="categoryModal" class="modal active"><div class="modal-window" style="max-width:450px;"><div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h3>✏️ Редактировать категорию</h3></div><div style="padding:20px;"><div class="form-group"><label><i class="fas fa-tag"></i> Название</label><input type="text" id="categoryName" class="form-input" value="${escapeHtml(name)}"></div><div class="form-group"><label><i class="fas fa-icons"></i> Иконка</label><div class="icon-selector" style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;max-height:200px;overflow-y:auto;padding:8px;background:#0d1016;border-radius:12px;">${iconList.map(i => `<div class="icon-option" onclick="selectIcon('${i.icon}')" style="font-size:24px;cursor:pointer;padding:8px;text-align:center;border-radius:8px;${i.icon === icon ? 'background:rgba(99,102,241,0.3);' : ''}">${i.icon}</div>`).join('')}</div><input type="hidden" id="categoryIcon" value="${escapeHtml(icon)}"></div></div><div style="display:flex;gap:12px;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);"><button class="btn-primary" onclick="saveCategory()">Сохранить</button><button class="btn-secondary" onclick="closeCategoryModal()">Отмена</button></div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        window.selectIcon = function(ic) { document.getElementById('categoryIcon').value = ic; document.querySelectorAll('.icon-option').forEach(el => el.style.background = ''); event.target.style.background = 'rgba(99,102,241,0.3)'; };
    }

    function closeCategoryModal() { const modal = document.getElementById('categoryModal'); if (modal) modal.remove(); editingCategoryId = null; }
    
    async function saveCategory() {
        const name = document.getElementById('categoryName')?.value.trim();
        const icon = document.getElementById('categoryIcon')?.value || '📁';
        if (!name) { showSystemNotification('❌ Введите название', 'error'); return; }
        if (!editingCategoryId && isCategoryExists(name)) { showSystemNotification(`❌ Категория "${name}" уже существует`, 'error'); return; }
        
        const response = editingCategoryId 
            ? await apiCall(`/knowledge/categories/${editingCategoryId}`, 'PUT', { name, icon })
            : await apiCall('/knowledge/categories', 'POST', { name, icon });
            
        if (response?.success) {
            showSystemNotification(editingCategoryId ? '✅ Категория обновлена' : '✅ Категория создана', 'success');
            closeCategoryModal();
            await loadKnowledgeData();
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }
    
    async function deleteCategory(categoryId) {
        if (!canManageCategories()) { showSystemNotification('❌ Нет прав', 'error'); return; }
        if (!confirm('Удалить категорию и все статьи в ней?')) return;
        const response = await apiCall(`/knowledge/categories/${categoryId}`, 'DELETE');
        if (response?.success) { showSystemNotification('🗑️ Категория удалена', 'warning'); await loadKnowledgeData(); }
        else { showSystemNotification('❌ Ошибка', 'error'); }
    }

    // ============================================
    // СТАТЬИ
    // ============================================
    function openCreateArticleModal(categoryId) { editingArticleId = null; openArticleModalInternal(categoryId, null); }
    function openEditArticleModal(articleId) { editingArticleId = articleId; const article = knowledgeArticles.find(a => a.id === articleId); if (article) openArticleModalInternal(article.category_id, article); }
    
    function openArticleModalInternal(categoryId, article) {
        const modalHtml = `<div id="articleEditModal" class="modal active"><div class="modal-window" style="max-width:900px;width:95%;"><div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h3>${article ? '✏️ Редактировать статью' : '➕ Новая статья'}</h3></div><div style="padding:20px;"><div class="form-group"><label><i class="fas fa-heading"></i> Заголовок</label><input type="text" id="articleTitle" class="form-input" value="${escapeHtml(article?.title || '')}" placeholder="Введите заголовок"></div><div class="form-group"><label><i class="fas fa-edit"></i> Содержание</label><div class="editor-toolbar">${renderEditorToolbar()}</div><div id="articleContent" class="editor-content" contenteditable="true" onfocus="initEditor(this)">${article?.content || ''}</div></div></div><div style="display:flex;gap:12px;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);"><button class="btn-primary" onclick="saveArticle(${categoryId})">${article ? 'Сохранить' : 'Создать'}</button><button class="btn-secondary" onclick="closeArticleEditModal()">Отмена</button>${article ? `<button class="btn-danger" onclick="deleteArticleConfirm(${article.id})">🗑️ Удалить</button>` : ''}</div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function renderEditorToolbar() {
        return `<button onclick="applyFormat('bold')" title="Жирный"><i class="fas fa-bold"></i></button><button onclick="applyFormat('italic')" title="Курсив"><i class="fas fa-italic"></i></button><button onclick="applyFormat('underline')" title="Подчёркнутый"><i class="fas fa-underline"></i></button><select onchange="setFontSize(this.value)"><option value="3">Размер</option><option value="1">12px</option><option value="2">14px</option><option value="3">16px</option><option value="4">18px</option><option value="5">20px</option><option value="6">24px</option><option value="7">28px</option></select><select onchange="setFontFamily(this.value)"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="'Courier New'">Courier</option><option value="'Times New Roman'">Times</option></select><input type="color" onchange="setTextColor(this.value)" title="Цвет текста"><input type="color" onchange="setBackgroundColor(this.value)" title="Цвет фона"><button onclick="setTextAlign('left')" title="По левому краю"><i class="fas fa-align-left"></i></button><button onclick="setTextAlign('center')" title="По центру"><i class="fas fa-align-center"></i></button><button onclick="setTextAlign('right')" title="По правому краю"><i class="fas fa-align-right"></i></button><button onclick="insertLink()" title="Ссылка"><i class="fas fa-link"></i></button><button onclick="insertImage()" title="Изображение"><i class="fas fa-image"></i></button><button onclick="insertVideo()" title="Видео"><i class="fas fa-video"></i></button><button onclick="insertUnorderedList()" title="Маркированный список"><i class="fas fa-list-ul"></i></button><button onclick="insertOrderedList()" title="Нумерованный список"><i class="fas fa-list-ol"></i></button><button onclick="insertTable()" title="Таблица"><i class="fas fa-table"></i></button><button onclick="insertCode()" title="Код"><i class="fas fa-code"></i></button><button onclick="insertQuote()" title="Цитата"><i class="fas fa-quote-right"></i></button><button onclick="insertHeading(2)" title="Заголовок"><i class="fas fa-heading"></i></button><button onclick="insertDivider()" title="Разделитель"><i class="fas fa-minus"></i></button><button onclick="insertAlert('info')" title="Инфо"><i class="fas fa-info-circle"></i></button><button onclick="insertAlert('success')" title="Успех"><i class="fas fa-check-circle"></i></button><button onclick="insertAlert('warning')" title="Предупреждение"><i class="fas fa-exclamation-triangle"></i></button><button onclick="insertAlert('error')" title="Ошибка"><i class="fas fa-times-circle"></i></button><button onclick="insertCard()" title="Карточка"><i class="fas fa-square"></i></button><button onclick="clearFormatting()" title="Очистить форматирование"><i class="fas fa-remove-format"></i></button>`;
    }

    async function openArticle(articleId) {
        await apiCall(`/knowledge/articles/${articleId}/view`, 'POST');
        const article = knowledgeArticles.find(a => a.id === articleId);
        if (!article) return;
        const modalHtml = `<div id="articleModal" class="modal active"><div class="modal-window" style="max-width:800px;max-height:85vh;overflow-y:auto;"><div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h2>${escapeHtml(article.title)}</h2><p style="font-size:12px;color:#64748b;margin-top:8px;"><i class="fas fa-eye"></i> ${(article.views || 0) + 1} просмотров · <i class="fas fa-calendar"></i> ${formatDate(article.created_at)} · <i class="fas fa-user"></i> ${escapeHtml(article.created_by || '—')}</p></div><div style="padding:20px;"><div class="article-content">${article.content || '<p style="color:#64748b;">Нет содержания</p>'}</div></div><div style="display:flex;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);"><button class="btn-secondary" onclick="closeArticleModal()">Закрыть</button>${canManageArticles() ? `<button class="btn-primary" onclick="closeArticleModal();openEditArticleModal(${article.id})"><i class="fas fa-edit"></i> Редактировать</button>` : ''}</div></div></div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        await loadKnowledgeData();
    }

    function closeArticleModal() { const modal = document.getElementById('articleModal'); if (modal) modal.remove(); }
    function closeArticleEditModal() { const modal = document.getElementById('articleEditModal'); if (modal) modal.remove(); editingArticleId = null; }
    
    async function saveArticle(categoryId) {
        const title = document.getElementById('articleTitle')?.value.trim();
        const content = document.getElementById('articleContent')?.innerHTML || '';
        if (!title) { showSystemNotification('❌ Введите заголовок', 'error'); return; }
        
        const response = editingArticleId
            ? await apiCall(`/knowledge/articles/${editingArticleId}`, 'PUT', { title, content })
            : await apiCall('/knowledge/articles', 'POST', { category_id: categoryId, title, content });
            
        if (response?.success) {
            showSystemNotification(editingArticleId ? '✅ Статья обновлена' : '✅ Статья создана', 'success');
            closeArticleEditModal();
            await loadKnowledgeData();
        } else {
            showSystemNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }
    
    function deleteArticleConfirm(articleId) { if (confirm('Удалить эту статью?')) deleteArticle(articleId); }
    
    async function deleteArticle(articleId) {
        if (!canManageArticles()) { showSystemNotification('❌ Нет прав', 'error'); return; }
        const response = await apiCall(`/knowledge/articles/${articleId}`, 'DELETE');
        if (response?.success) {
            showSystemNotification('🗑️ Статья удалена', 'warning');
            closeArticleEditModal();
            closeArticleModal();
            await loadKnowledgeData();
        } else {
            showSystemNotification('❌ Ошибка', 'error');
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    window.initKnowledge = initKnowledge;
    window.resetKnowledgeState = resetKnowledgeState;
    window.toggleCategory = toggleCategory;
    window.openArticle = openArticle;
    window.closeArticleModal = closeArticleModal;
    window.closeArticleEditModal = closeArticleEditModal;
    window.saveArticle = saveArticle;
    window.deleteArticle = deleteArticle;
    window.deleteArticleConfirm = deleteArticleConfirm;
    window.loadKnowledgeData = loadKnowledgeData;
    window.createCategoryFromPreset = createCategoryFromPreset;
    window.createCategoryFromPresetAndClose = createCategoryFromPresetAndClose;
    window.createAllCategoriesWithProgress = createAllCategoriesWithProgress;
    window.showAddPresetModal = showAddPresetModal;
    window.closePresetModal = closePresetModal;
    window.openCreateCategoryModal = openCreateCategoryModal;
    window.openEditCategoryModal = openEditCategoryModal;
    window.closeCategoryModal = closeCategoryModal;
    window.saveCategory = saveCategory;
    window.deleteCategory = deleteCategory;
    window.selectIcon = function(icon) { document.getElementById('categoryIcon').value = icon; };
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
    window.initEditor = initEditor;
// В конец knowledge.js перед console.log
window.openCreateArticleModal = openCreateArticleModal;
window.openEditArticleModal = openEditArticleModal;
window.deleteArticle = deleteArticle;
window.deleteArticleConfirm = deleteArticleConfirm;
window.toggleCategory = toggleCategory;
window.openArticle = openArticle;
window.closeArticleModal = closeArticleModal;
window.saveArticle = saveArticle;
    console.log('✅ knowledge.js загружен (v1.1 — с уведомлениями)');
})();