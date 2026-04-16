// public/js/knowledge.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

let knowledgeCategories = [];
let knowledgeArticles = [];
let knowledgeSearchQuery = '';
let editingArticleId = null;
let editingCategoryId = null;
let isLoadingKnowledge = false;

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
// РАСШИРЕННЫЙ WYSIWYG РЕДАКТОР (С XSS-ЗАЩИТОЙ)
// ============================================

function applyFormat(command, value = null) {
    document.execCommand(command, false, value);
    document.getElementById('articleContent')?.focus();
}

function setFontSize(size) {
    document.execCommand('fontSize', false, size);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const span = document.createElement('span');
        const sizes = { '1': '10px', '2': '12px', '3': '16px', '4': '18px', '5': '24px', '6': '32px', '7': '48px' };
        span.style.fontSize = sizes[size] || '16px';
        range.surroundContents(span);
    }
    document.getElementById('articleContent')?.focus();
}

function setFontFamily(font) {
    document.execCommand('fontName', false, font);
    document.getElementById('articleContent')?.focus();
}

function setTextColor(color) {
    document.execCommand('foreColor', false, color);
    document.getElementById('articleContent')?.focus();
}

function setBackgroundColor(color) {
    document.execCommand('backColor', false, color);
    document.getElementById('articleContent')?.focus();
}

function setTextAlign(align) {
    document.execCommand('justify' + align.charAt(0).toUpperCase() + align.slice(1), false, null);
    document.getElementById('articleContent')?.focus();
}

function insertLink() {
    const url = prompt('Введите URL ссылки:', 'https://');
    if (url) {
        // 🔥 Валидация URL для предотвращения javascript: и data:
        const lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) {
            showNotif('❌ Недопустимый тип ссылки', 'error');
            return;
        }
        const text = prompt('Введите текст ссылки:', 'Ссылка');
        if (text) {
            document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #a78bfa; text-decoration: none;">${escapeHtml(text)}</a>`);
        } else {
            document.execCommand('createLink', false, escapeHtml(url));
        }
    }
    document.getElementById('articleContent')?.focus();
}

function insertImage() {
    const url = prompt('Введите URL изображения:', 'https://');
    if (url) {
        const lowerUrl = url.toLowerCase().trim();
        if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('data:')) {
            showNotif('❌ Недопустимый тип URL', 'error');
            return;
        }
        document.execCommand('insertImage', false, escapeHtml(url));
    }
    document.getElementById('articleContent')?.focus();
}

function insertVideo() {
    const url = prompt('Введите URL видео (YouTube/Vimeo):', 'https://www.youtube.com/watch?v=');
    if (url) {
        let embedUrl = url;
        if (url.includes('youtube.com/watch?v=')) {
            const videoId = url.split('v=')[1]?.split('&')[0];
            if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
        } else if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1]?.split('?')[0];
            if (videoId) embedUrl = `https://www.youtube.com/embed/${escapeHtml(videoId)}`;
        }
        const iframe = `<iframe width="100%" height="400" src="${escapeHtml(embedUrl)}" frameborder="0" allowfullscreen style="border-radius: 12px;"></iframe><br>`;
        document.execCommand('insertHTML', false, iframe);
    }
    document.getElementById('articleContent')?.focus();
}

function insertUnorderedList() {
    document.execCommand('insertUnorderedList', false, null);
    document.getElementById('articleContent')?.focus();
}

function insertOrderedList() {
    document.execCommand('insertOrderedList', false, null);
    document.getElementById('articleContent')?.focus();
}

function insertHorizontalRule() {
    document.execCommand('insertHorizontalRule', false, null);
    document.getElementById('articleContent')?.focus();
}

function insertTable() {
    const rows = prompt('Количество строк:', '3');
    const cols = prompt('Количество столбцов:', '3');
    if (rows && cols) {
        let table = '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden;">';
        for (let i = 0; i < parseInt(rows); i++) {
            table += '<tr>';
            for (let j = 0; j < parseInt(cols); j++) {
                const isHeader = i === 0;
                const tag = isHeader ? 'th' : 'td';
                table += `<${tag} style="border: 1px solid #475569; padding: 10px 12px; text-align: left; ${isHeader ? 'background: rgba(99,102,241,0.15); font-weight: 600;' : ''}">${isHeader ? `Заголовок ${j+1}` : `Ячейка ${i+1},${j+1}`}</${tag}>`;
            }
            table += '</tr>';
        }
        table += '</table></div><br>';
        document.execCommand('insertHTML', false, table);
    }
    document.getElementById('articleContent')?.focus();
}

function insertCode() {
    const code = prompt('Введите код:');
    if (code) {
        const pre = `<pre style="background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 12px; overflow-x: auto; font-family: 'Courier New', monospace; font-size: 13px;"><code>${escapeHtml(code)}</code></pre>`;
        document.execCommand('insertHTML', false, pre);
    }
    document.getElementById('articleContent')?.focus();
}

function insertQuote() {
    document.execCommand('formatBlock', false, 'blockquote');
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const blockquote = range.commonAncestorContainer.closest('blockquote');
        if (blockquote) {
            blockquote.style.borderLeft = '4px solid #a78bfa';
            blockquote.style.margin = '16px 0';
            blockquote.style.padding = '12px 20px';
            blockquote.style.background = 'rgba(99,102,241,0.08)';
            blockquote.style.borderRadius = '12px';
            blockquote.style.fontStyle = 'italic';
        }
    }
    document.getElementById('articleContent')?.focus();
}

function insertHeading(level) {
    document.execCommand('formatBlock', false, `h${level}`);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const heading = range.commonAncestorContainer.closest(`h${level}`);
        if (heading) {
            const sizes = { 1: '32px', 2: '28px', 3: '24px', 4: '20px', 5: '18px', 6: '16px' };
            heading.style.fontSize = sizes[level];
            heading.style.color = '#f1f5f9';
            heading.style.margin = '20px 0 12px';
            heading.style.fontWeight = '700';
        }
    }
    document.getElementById('articleContent')?.focus();
}

function insertAlert(type) {
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    const colors = { info: '#3b82f6', success: '#10b981', warning: '#f59e0b', error: '#ef4444' };
    const text = prompt('Введите текст уведомления:', 'Текст сообщения');
    if (text) {
        const alertHtml = `
            <div style="background: ${colors[type]}15; border-left: 4px solid ${colors[type]}; border-radius: 12px; padding: 16px 20px; margin: 16px 0; display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">${icons[type]}</span>
                <span style="color: #e2e8f0;">${escapeHtml(text)}</span>
            </div>
        `;
        document.execCommand('insertHTML', false, alertHtml);
    }
    document.getElementById('articleContent')?.focus();
}

function insertCard() {
    const title = prompt('Введите заголовок карточки:', 'Заголовок');
    const content = prompt('Введите содержание карточки:', 'Текст карточки');
    if (title && content) {
        const cardHtml = `
            <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 16px; padding: 20px; margin: 16px 0; border: 1px solid rgba(99,102,241,0.3);">
                <h4 style="color: #a78bfa; margin: 0 0 12px; font-size: 18px;">📌 ${escapeHtml(title)}</h4>
                <p style="color: #cbd5e1; margin: 0;">${escapeHtml(content)}</p>
            </div>
        `;
        document.execCommand('insertHTML', false, cardHtml);
    }
    document.getElementById('articleContent')?.focus();
}

function insertDivider() {
    const dividerHtml = '<hr style="margin: 24px 0; border: none; height: 1px; background: linear-gradient(90deg, transparent, #a78bfa, transparent);">';
    document.execCommand('insertHTML', false, dividerHtml);
    document.getElementById('articleContent')?.focus();
}

function clearFormatting() {
    document.execCommand('removeFormat', false, null);
    document.getElementById('articleContent')?.focus();
}

function insertEmoji(emoji) {
    document.execCommand('insertText', false, emoji);
    document.getElementById('articleContent')?.focus();
}

// ============================================
// СПИСОК ИКОНОК И ЭМОДЗИ
// ============================================

const iconList = [
    { icon: '📁', name: 'Общая / База' },
    { icon: '📖', name: 'Инструкции' },
    { icon: '📜', name: 'Правила' },
    { icon: '❓', name: 'Вопросы / FAQ' },
    { icon: '💡', name: 'Идеи / Советы' },
    { icon: '🔧', name: 'Настройки' },
    { icon: '⚙️', name: 'Техника' },
    { icon: '🎮', name: 'Игры' },
    { icon: '🏆', name: 'Турниры / Рейтинг' },
    { icon: '⭐', name: 'Избранное / Топ' },
    { icon: '🔥', name: 'Важное / Срочно' },
    { icon: '✅', name: 'Готово / Выполнено' },
    { icon: '❌', name: 'Ошибки / Проблемы' },
    { icon: '⚠️', name: 'Внимание' },
    { icon: 'ℹ️', name: 'Справка / Инфо' },
    { icon: '📅', name: 'Календарь / События' },
    { icon: '🎧', name: 'VR-шлемы' },
    { icon: '🎮', name: 'Контроллеры' },
    { icon: '📡', name: 'Wi-Fi / Сеть' },
    { icon: '🧹', name: 'Уборка / Дезинфекция' },
    { icon: '👋', name: 'Встреча гостей' },
    { icon: '💬', name: 'Общение / Скрипты' },
    { icon: '🎫', name: 'Бронирования' },
    { icon: '🆕', name: 'Онбординг / Новичкам' },
    { icon: '💰', name: 'Финансы' },
    { icon: '📊', name: 'Отчёты' },
    { icon: '🌍', name: 'О WARPOINT' },
    { icon: '📢', name: 'Новости' },
    { icon: '🤝', name: 'Команда' }
];

const emojiList = ['😀', '😎', '🔥', '💪', '🎉', '✨', '💡', '⭐', '❤️', '👍', '👏', '🤝', '🚀', '🎯', '🏆', '💎', '🔔', '📌', '💬', '🤔'];

// ============================================
// ПРЕДУСТАНОВЛЕННЫЕ КАТЕГОРИИ
// ============================================

const presetCategories = [
    { icon: '⚔️', name: 'Мясорубка' },
    { icon: '👥', name: 'Командный бой' },
    { icon: '🔫', name: 'Свободная игра' },
    { icon: '🧟', name: 'Кооператив' },
    { icon: '👤', name: 'VR-станция' },
    { icon: '🎢', name: 'VR-экстрим' },
    { icon: '🏆', name: 'Турниры' },
    { icon: '⚔️', name: 'WARPOINT BATTLE' },
    { icon: '📊', name: 'Рейтинг' },
    { icon: '🎯', name: 'Тактика' },
    { icon: '🎂', name: 'День рождения' },
    { icon: '🏢', name: 'Корпоратив' },
    { icon: '🎓', name: 'Выпускной' },
    { icon: '🎈', name: 'Праздники' },
    { icon: '🎧', name: 'VR-шлемы' },
    { icon: '🎮', name: 'Контроллеры' },
    { icon: '📡', name: 'Wi-Fi' },
    { icon: '🧹', name: 'Дезинфекция' },
    { icon: '👋', name: 'Встреча' },
    { icon: '💬', name: 'Скрипты' },
    { icon: '⭐', name: 'Отзывы' },
    { icon: '🎫', name: 'Бронирования' },
    { icon: '🆕', name: 'Онбординг' },
    { icon: '📜', name: 'Правила' },
    { icon: '🔥', name: 'Горячие темы' },
    { icon: '💰', name: 'Финансы' },
    { icon: '📊', name: 'Отчёты' },
    { icon: '🌍', name: 'О WARPOINT' },
    { icon: '📢', name: 'Новости' },
    { icon: '🤝', name: 'Команда' },
    { icon: '💡', name: 'Фишки' }
];

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function isCategoryExists(name, excludeId = null) {
    return knowledgeCategories.some(cat => 
        cat.name.toLowerCase() === name.toLowerCase() && cat.id !== excludeId
    );
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ (С ПРОВЕРКОЙ DOM)
// ============================================

function initKnowledge() {
    console.log('📚 Инициализация базы знаний');
    
    const container = document.getElementById('knowledgeContainer');
    if (!container) {
        console.warn('⚠️ knowledgeContainer не найден, ждём...');
        setTimeout(initKnowledge, 100);
        return;
    }
    
    console.log('👤 Роль пользователя:', window.app?.currentUserRole);
    console.log('📝 Может управлять категориями:', canManageCategories());
    console.log('📄 Может управлять статьями:', canManageArticles());
    
    loadKnowledgeData();
    
    const searchInput = document.getElementById('knowledgeSearch');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            knowledgeSearchQuery = e.target.value.toLowerCase();
            renderKnowledge();
        });
    }
    
    setupActionButtons();
}

function setupActionButtons() {
    const actionButtons = document.getElementById('actionButtons');
    if (!actionButtons) return;
    
    if (canManageCategories()) {
        actionButtons.innerHTML = `
            <button class="btn-secondary" onclick="openCreateCategoryModal()">
                <i class="fas fa-folder-plus"></i> Новая категория
            </button>
            <button class="btn-secondary" onclick="showAddPresetModal()">
                <i class="fas fa-magic"></i> Готовые категории
            </button>
        `;
    } else if (canManageArticles()) {
        actionButtons.innerHTML = `
            <span style="font-size: 12px; color: #64748b;">
                <i class="fas fa-info-circle"></i> Вы можете добавлять статьи
            </span>
        `;
    } else {
        actionButtons.innerHTML = '';
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadKnowledgeData() {
    if (isLoadingKnowledge) return;
    isLoadingKnowledge = true;
    
    console.log('🔄 Загрузка данных...');
    
    const container = document.getElementById('knowledgeContainer');
    if (container) {
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
    }
    
    try {
        const categoriesRes = await apiCall('/knowledge/categories');
        const articlesRes = await apiCall('/knowledge/articles');
        
        if (categoriesRes && categoriesRes.success) {
            knowledgeCategories = categoriesRes.data || [];
        } else if (Array.isArray(categoriesRes)) {
            knowledgeCategories = categoriesRes;
        } else {
            knowledgeCategories = [];
        }
        
        if (articlesRes && articlesRes.success) {
            knowledgeArticles = articlesRes.data || [];
        } else if (Array.isArray(articlesRes)) {
            knowledgeArticles = articlesRes;
        } else {
            knowledgeArticles = [];
        }
        
        console.log(`✅ Категорий: ${knowledgeCategories.length}, Статей: ${knowledgeArticles.length}`);
        
        renderKnowledge();
        
    } catch (err) {
        console.error('❌ Ошибка:', err);
        if (container) {
            container.innerHTML = `
                <div class="empty-knowledge">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Ошибка загрузки</h3>
                    <button class="btn-primary" onclick="loadKnowledgeData()">🔄 Повторить</button>
                </div>
            `;
        }
    } finally {
        isLoadingKnowledge = false;
    }
}

// ============================================
// ОСНОВНОЙ РЕНДЕРИНГ
// ============================================

function renderKnowledge() {
    const container = document.getElementById('knowledgeContainer');
    if (!container) return;
    
    let filteredArticles = [...knowledgeArticles];
    if (knowledgeSearchQuery) {
        filteredArticles = filteredArticles.filter(a => 
            (a.title && a.title.toLowerCase().includes(knowledgeSearchQuery)) ||
            (a.content && a.content.toLowerCase().includes(knowledgeSearchQuery))
        );
    }
    
    const categoriesWithArticles = knowledgeCategories.map(cat => ({
        ...cat,
        articles: filteredArticles.filter(a => a.category_id === cat.id)
    }));
    
    const canEditCategories = canManageCategories();
    const canEditArticles = canManageArticles();
    
    if (knowledgeCategories.length === 0) {
        if (canEditCategories) {
            renderPresetSelector(container);
        } else {
            container.innerHTML = `
                <div class="empty-knowledge">
                    <i class="fas fa-folder-open"></i>
                    <h3>База знаний пуста</h3>
                    <p>Категории ещё не созданы. Обратитесь к руководителю.</p>
                </div>
            `;
        }
        return;
    }
    
    let html = '';
    
    for (const cat of categoriesWithArticles) {
        const hasArticles = cat.articles.length > 0;
        
        html += `
            <div class="knowledge-category" data-category-id="${cat.id}">
                <div class="category-header" onclick="toggleCategory(${cat.id})">
                    <div class="category-title">
                        <div class="category-icon">${escapeHtml(cat.icon || '📁')}</div>
                        <div class="category-name">${escapeHtml(cat.name)}</div>
                        <div class="category-count">${cat.articles.length}</div>
                    </div>
                    <div class="category-actions">
                        ${canEditCategories ? `
                            <button class="category-edit" onclick="event.stopPropagation(); openEditCategoryModal(${cat.id}, '${escapeHtml(cat.name)}', '${escapeHtml(cat.icon || '📁')}')" title="Редактировать категорию">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon-delete" onclick="event.stopPropagation(); deleteCategory(${cat.id})" title="Удалить категорию">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        ` : ''}
                        <div class="category-arrow">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                </div>
                <div class="category-content" style="display: none;">
                    ${hasArticles ? cat.articles.map(article => `
                        <div class="knowledge-article" data-article-id="${article.id}">
                            <div class="article-info" onclick="openArticle(${article.id})">
                                <div class="article-title">
                                    <i class="fas fa-file-alt"></i> ${escapeHtml(article.title)}
                                </div>
                                <div class="article-meta">
                                    <span><i class="fas fa-eye"></i> ${article.views || 0} просмотров</span>
                                    <span><i class="fas fa-calendar-alt"></i> ${formatDate(article.created_at)}</span>
                                </div>
                            </div>
                            ${canEditArticles ? `
                                <div class="article-actions">
                                    <button class="article-edit" onclick="event.stopPropagation(); openEditArticleModal(${article.id})" title="Редактировать статью">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="btn-icon-delete" onclick="event.stopPropagation(); deleteArticle(${article.id})" title="Удалить статью">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `).join('') : `
                        <div class="empty-category-message">
                            <i class="fas fa-info-circle"></i> В этой категории пока нет статей
                        </div>
                    `}
                    ${canEditArticles ? `
                        <button class="add-article-btn" onclick="event.stopPropagation(); openCreateArticleModal(${cat.id})">
                            <i class="fas fa-plus"></i> Добавить статью
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    if (canEditCategories) {
        html += `
            <div class="action-buttons-bottom">
                <button class="btn-secondary" onclick="openCreateCategoryModal()">
                    <i class="fas fa-folder-plus"></i> Новая категория
                </button>
                <button class="btn-secondary" onclick="showAddPresetModal()">
                    <i class="fas fa-magic"></i> Добавить готовые категории
                </button>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    try {
        const openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');
        openCategories.forEach(catId => {
            const content = document.querySelector(`.knowledge-category[data-category-id="${catId}"] .category-content`);
            const arrow = document.querySelector(`.knowledge-category[data-category-id="${catId}"] .category-arrow i`);
            if (content) {
                content.style.display = 'flex';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            }
        });
    } catch(e) {}
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU');
}

function toggleCategory(categoryId) {
    const category = document.querySelector(`.knowledge-category[data-category-id="${categoryId}"]`);
    const content = category?.querySelector('.category-content');
    const arrow = category?.querySelector('.category-arrow i');
    
    if (!content) return;
    
    let openCategories = [];
    try {
        openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');
    } catch(e) {}
    
    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'flex';
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        if (!openCategories.includes(categoryId)) {
            openCategories.push(categoryId);
        }
    } else {
        content.style.display = 'none';
        if (arrow) arrow.style.transform = 'rotate(0deg)';
        openCategories = openCategories.filter(id => id !== categoryId);
    }
    
    localStorage.setItem('knowledgeOpenCategories', JSON.stringify(openCategories));
}
// ============================================
// ПРЕСЕТЫ
// ============================================

function renderPresetSelector(container) {
    let rowsHtml = '';
    for (let i = 0; i < presetCategories.length; i += 6) {
        const rowCategories = presetCategories.slice(i, i + 6);
        rowsHtml += `
            <div class="preset-row">
                ${rowCategories.map(cat => `
                    <div class="preset-item" onclick="createCategoryFromPreset('${escapeHtml(cat.name)}', '${escapeHtml(cat.icon)}')">
                        <div class="preset-item-icon">${escapeHtml(cat.icon)}</div>
                        <div class="preset-item-name">${escapeHtml(cat.name)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    container.innerHTML = `
        <div class="preset-selector">
            <div class="preset-header">
                <i class="fas fa-magic"></i>
                <h2>Создайте базу знаний WARPOINT</h2>
                <p>Нажмите на категорию, чтобы добавить её</p>
            </div>
            <div class="preset-grid">
                ${rowsHtml}
            </div>
            <div class="action-buttons-bottom">
                <button class="btn-create-all" onclick="createAllCategoriesWithProgress()">
                    <i class="fas fa-plus-circle"></i> Создать все категории (${presetCategories.length})
                </button>
                <button class="btn-secondary" onclick="openCreateCategoryModal()">
                    <i class="fas fa-plus"></i> Создать свою категорию
                </button>
            </div>
        </div>
    `;
}

function showAddPresetModal() {
    let rowsHtml = '';
    for (let i = 0; i < presetCategories.length; i += 6) {
        const rowCategories = presetCategories.slice(i, i + 6);
        rowsHtml += `
            <div class="preset-row">
                ${rowCategories.map(cat => `
                    <div class="preset-item" onclick="createCategoryFromPresetAndClose('${escapeHtml(cat.name)}', '${escapeHtml(cat.icon)}')">
                        <div class="preset-item-icon">${escapeHtml(cat.icon)}</div>
                        <div class="preset-item-name">${escapeHtml(cat.name)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    const modalHtml = `
        <div id="presetModal" class="modal active">
            <div class="modal-window" style="max-width: 700px; max-height: 80vh; overflow-y: auto;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>🎨 Добавить готовые категории</h3>
                </div>
                <div style="padding: 20px;">
                    <div class="preset-grid">${rowsHtml}</div>
                    <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px;">
                        <button class="btn-create-all" onclick="createAllCategoriesWithProgress(); closePresetModal();">
                            <i class="fas fa-plus-circle"></i> Создать все категории
                        </button>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-secondary" onclick="closePresetModal()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closePresetModal() {
    const modal = document.getElementById('presetModal');
    if (modal) modal.remove();
}

async function createCategoryFromPreset(name, icon) {
    if (isCategoryExists(name)) {
        showNotif(`❌ Категория "${name}" уже существует!`, 'error');
        return;
    }
    
    const response = await apiCall('/knowledge/categories', 'POST', { name, icon });
    if (response && response.success) {
        showNotif(`✅ Категория "${name}" создана`, 'success');
        await loadKnowledgeData();
    } else {
        showNotif(`❌ Ошибка при создании "${name}"`, 'error');
    }
}

async function createCategoryFromPresetAndClose(name, icon) {
    await createCategoryFromPreset(name, icon);
    closePresetModal();
}

async function createAllCategoriesWithProgress() {
    const total = presetCategories.length;
    let created = 0;
    let skipped = 0;
    
    showNotif(`⏳ Создание ${total} категорий...`, 'info');
    
    for (const cat of presetCategories) {
        if (isCategoryExists(cat.name)) {
            skipped++;
            continue;
        }
        
        const response = await apiCall('/knowledge/categories', 'POST', { name: cat.name, icon: cat.icon });
        if (response && response.success) created++;
        await new Promise(r => setTimeout(r, 20));
    }
    
    showNotif(`✅ Создано: ${created}, Пропущено: ${skipped}`, created > 0 ? 'success' : 'info');
    await loadKnowledgeData();
}

// ============================================
// КАТЕГОРИИ
// ============================================

function openCreateCategoryModal() {
    if (!canManageCategories()) {
        showNotif('У вас нет прав на создание категорий', 'error');
        return;
    }
    
    editingCategoryId = null;
    
    const iconOptions = iconList.map(item => 
        `<option value="${escapeHtml(item.icon)}">${escapeHtml(item.icon)} ${escapeHtml(item.name)}</option>`
    ).join('');
    
    const modalHtml = `
        <div id="categoryModal" class="modal active">
            <div class="modal-window" style="max-width: 450px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>📁 Создать категорию</h3>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label>Название категории</label>
                        <input type="text" id="categoryName" class="edit-input" style="width: 100%;" placeholder="Например: Инструкции">
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label>Иконка</label>
                        <select id="categoryIcon" class="styled-select" style="width: 100%;">${iconOptions}</select>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-primary" onclick="saveCategory()">💾 Создать</button>
                    <button class="btn-secondary" onclick="closeCategoryModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openEditCategoryModal(id, name, icon) {
    if (!canManageCategories()) {
        showNotif('У вас нет прав на редактирование категорий', 'error');
        return;
    }
    
    editingCategoryId = id;
    
    const iconOptions = iconList.map(item => 
        `<option value="${escapeHtml(item.icon)}" ${item.icon === icon ? 'selected' : ''}>${escapeHtml(item.icon)} ${escapeHtml(item.name)}</option>`
    ).join('');
    
    const modalHtml = `
        <div id="categoryModal" class="modal active">
            <div class="modal-window" style="max-width: 450px;">
                <div style="padding: 20px; border-bottom: 1px solid rgba(99,102,241,0.15);">
                    <h3>✏️ Редактировать категорию</h3>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <label>Название категории</label>
                        <input type="text" id="categoryName" class="edit-input" style="width: 100%;" value="${escapeHtml(name)}">
                    </div>
                    <div style="margin-bottom: 16px;">
                        <label>Иконка</label>
                        <select id="categoryIcon" class="styled-select" style="width: 100%;">${iconOptions}</select>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px; border-top: 1px solid rgba(99,102,241,0.1);">
                    <button class="btn-primary" onclick="saveCategory()">💾 Сохранить</button>
                    <button class="btn-delete" onclick="deleteCategoryWithClose(${id})">
                        <i class="fas fa-trash-alt"></i> Удалить
                    </button>
                    <button class="btn-secondary" onclick="closeCategoryModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeCategoryModal() {
    const modal = document.getElementById('categoryModal');
    if (modal) modal.remove();
    editingCategoryId = null;
}

async function saveCategory() {
    const name = document.getElementById('categoryName')?.value.trim();
    const icon = document.getElementById('categoryIcon')?.value || '📁';
    
    if (!name) {
        showNotif('Введите название категории', 'error');
        return;
    }
    
    if (!editingCategoryId && isCategoryExists(name)) {
        showNotif(`❌ Категория "${name}" уже существует!`, 'error');
        return;
    }
    
    if (editingCategoryId && isCategoryExists(name, editingCategoryId)) {
        showNotif(`❌ Категория с именем "${name}" уже существует!`, 'error');
        return;
    }
    
    let response;
    if (editingCategoryId) {
        response = await apiCall(`/knowledge/categories/${editingCategoryId}`, 'PUT', { name, icon });
    } else {
        response = await apiCall('/knowledge/categories', 'POST', { name, icon });
    }
    
    if (response && response.success) {
        showNotif(editingCategoryId ? '✅ Категория обновлена' : '✅ Категория создана', 'success');
        closeCategoryModal();
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная ошибка'), 'error');
    }
}

async function deleteCategoryWithClose(categoryId) {
    const category = knowledgeCategories.find(c => c.id === categoryId);
    const articlesCount = knowledgeArticles.filter(a => a.category_id === categoryId).length;
    
    let msg = `Удалить категорию "${category?.name}"?`;
    if (articlesCount > 0) msg += `\n\n⚠️ В категории ${articlesCount} статей. Они тоже будут удалены.`;
    
    if (!confirm(msg)) return;
    
    const response = await apiCall(`/knowledge/categories/${categoryId}`, 'DELETE');
    if (response && response.success) {
        showNotif('✅ Категория удалена', 'success');
        closeCategoryModal();
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка при удалении', 'error');
    }
}

async function deleteCategory(categoryId) {
    if (!canManageCategories()) {
        showNotif('У вас нет прав на удаление категорий', 'error');
        return;
    }
    
    const category = knowledgeCategories.find(c => c.id === categoryId);
    const articlesCount = knowledgeArticles.filter(a => a.category_id === categoryId).length;
    
    let msg = `Удалить категорию "${category?.name}"?`;
    if (articlesCount > 0) msg += `\n\n⚠️ В категории ${articlesCount} статей. Они тоже будут удалены.`;
    
    if (!confirm(msg)) return;
    
    const response = await apiCall(`/knowledge/categories/${categoryId}`, 'DELETE');
    if (response && response.success) {
        showNotif('✅ Категория удалена', 'success');
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка при удалении', 'error');
    }
}

// ============================================
// СТАТЬИ
// ============================================

async function openArticle(articleId) {
    const article = knowledgeArticles.find(a => a.id === articleId);
    if (!article) {
        showNotif('Статья не найдена', 'error');
        return;
    }
    
    await apiCall(`/knowledge/articles/${articleId}/view`, 'POST');
    article.views = (article.views || 0) + 1;
    
    renderKnowledge();
    
    const category = knowledgeCategories.find(c => c.id === article.category_id);
    
    const modalHtml = `
        <div id="articleModal" class="modal active">
            <div class="modal-window" style="max-width: 1400px; width: 95%; max-height: 95vh; overflow-y: auto; padding: 0;">
                <div style="position: sticky; top: 0; background: linear-gradient(135deg, #1a1f2e, #0f1222); padding: 24px 32px; border-bottom: 1px solid rgba(99,102,241,0.15); z-index: 10;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 16px; background: rgba(99,102,241,0.15); padding: 6px 16px; border-radius: 40px;">
                                <span>${escapeHtml(category?.icon || '📁')}</span>
                                <span>${escapeHtml(category?.name || 'Статья')}</span>
                            </div>
                            <h1 style="margin: 0; font-size: 36px; font-weight: 700; background: linear-gradient(135deg, #fff, #a78bfa); -webkit-background-clip: text; background-clip: text; color: transparent;">${escapeHtml(article.title)}</h1>
                        </div>
                        <button onclick="closeArticleModal()" style="background: rgba(255,255,255,0.05); border: none; color: #94a3b8; font-size: 24px; cursor: pointer; width: 44px; height: 44px; border-radius: 50%;">&times;</button>
                    </div>
                </div>
                <div style="padding: 40px 48px;">
                    <div class="article-view-content" style="line-height: 1.8; color: #cbd5e1; font-size: 16px; max-width: 1100px; margin: 0 auto;">
                        ${article.content || '<p style="color: #64748b; text-align: center; padding: 60px;">Содержание не указано</p>'}
                    </div>
                    <div class="article-footer" style="margin-top: 48px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; gap: 32px; font-size: 13px; color: #64748b; justify-content: center;">
                        <span><i class="fas fa-eye"></i> ${article.views || 0} просмотров</span>
                        <span><i class="fas fa-calendar-alt"></i> Создано: ${formatDate(article.created_at)}</span>
                        ${article.updated_at ? `<span><i class="fas fa-edit"></i> Обновлено: ${formatDate(article.updated_at)}</span>` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 20px 32px; border-top: 1px solid rgba(99,102,241,0.1); background: #0f1222;">
                    ${canManageArticles() ? `
                        <button class="btn-primary" onclick="closeArticleModal(); openEditArticleModal(${article.id})">
                            <i class="fas fa-edit"></i> Редактировать
                        </button>
                        <button class="btn-delete" onclick="deleteArticleConfirm(${article.id})">
                            <i class="fas fa-trash-alt"></i> Удалить
                        </button>
                    ` : ''}
                    <button class="btn-secondary" onclick="closeArticleModal()">Закрыть</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeArticleModal() {
    const modal = document.getElementById('articleModal');
    if (modal) modal.remove();
}

function openCreateArticleModal(categoryId) {
    if (!canManageArticles()) {
        showNotif('У вас нет прав на создание статей', 'error');
        return;
    }
    
    editingArticleId = null;
    
    const modalHtml = `
        <div id="articleEditModal" class="modal active">
            <div class="modal-window" style="max-width: 1400px; width: 95%; max-height: 95vh; overflow-y: auto; padding: 0;">
                <div style="position: sticky; top: 0; background: linear-gradient(135deg, #1a1f2e, #0f1222); padding: 20px 28px; border-bottom: 1px solid rgba(99,102,241,0.15); z-index: 10;">
                    <h3 style="margin: 0; font-size: 24px;">📝 Создать статью</h3>
                </div>
                <div style="padding: 28px 32px;">
                    <input type="hidden" id="articleCategoryId" value="${categoryId}">
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: #a78bfa;">Название статьи</label>
                        <input type="text" id="articleTitle" class="edit-input" style="width: 100%; font-size: 20px; padding: 16px;" placeholder="Введите название статьи...">
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: #a78bfa;">Редактор статьи</label>
                        <div class="editor-toolbar" style="display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; background: #0d1016; border-radius: 12px 12px 0 0;">
                            <button type="button" class="toolbar-btn" onclick="applyFormat('bold')"><b>B</b></button>
                            <button type="button" class="toolbar-btn" onclick="applyFormat('italic')"><i>I</i></button>
                            <button type="button" class="toolbar-btn" onclick="applyFormat('underline')"><u>U</u></button>
                            <button type="button" class="toolbar-btn" onclick="insertLink()">🔗</button>
                            <button type="button" class="toolbar-btn" onclick="insertImage()">🖼️</button>
                            <button type="button" class="toolbar-btn" onclick="insertUnorderedList()">• 📋</button>
                            <button type="button" class="toolbar-btn" onclick="insertOrderedList()">1. 📝</button>
                            <button type="button" class="toolbar-btn" onclick="insertQuote()">💬</button>
                            <button type="button" class="toolbar-btn" onclick="insertCode()">&lt;/&gt;</button>
                            <button type="button" class="toolbar-btn" onclick="clearFormatting()">🗑️</button>
                        </div>
                        <div id="editorContainer" style="border: 1px solid #1e2430; border-radius: 0 0 16px 16px; background: #0d1016; min-height: 400px;">
                            <div id="articleContent" contenteditable="true" style="min-height: 400px; padding: 20px; color: #e2e8f0; font-size: 15px; line-height: 1.7; outline: none; overflow-y: auto;"></div>
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 20px 28px; border-top: 1px solid rgba(99,102,241,0.1); background: #0f1222;">
                    <button class="btn-primary" onclick="saveArticle()">💾 Сохранить статью</button>
                    <button class="btn-secondary" onclick="closeArticleEditModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openEditArticleModal(articleId) {
    if (!canManageArticles()) {
        showNotif('У вас нет прав на редактирование статей', 'error');
        return;
    }
    
    const article = knowledgeArticles.find(a => a.id === articleId);
    if (!article) return;
    
    editingArticleId = articleId;
    
    const modalHtml = `
        <div id="articleEditModal" class="modal active">
            <div class="modal-window" style="max-width: 1400px; width: 95%; max-height: 95vh; overflow-y: auto; padding: 0;">
                <div style="position: sticky; top: 0; background: linear-gradient(135deg, #1a1f2e, #0f1222); padding: 20px 28px; border-bottom: 1px solid rgba(99,102,241,0.15); z-index: 10;">
                    <h3 style="margin: 0; font-size: 24px;">✏️ Редактировать статью</h3>
                </div>
                <div style="padding: 28px 32px;">
                    <input type="hidden" id="articleCategoryId" value="${article.category_id}">
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: #a78bfa;">Название статьи</label>
                        <input type="text" id="articleTitle" class="edit-input" style="width: 100%; font-size: 20px; padding: 16px;" value="${escapeHtml(article.title)}">
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: #a78bfa;">Редактор статьи</label>
                        <div class="editor-toolbar" style="display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; background: #0d1016; border-radius: 12px 12px 0 0;">
                            <button type="button" class="toolbar-btn" onclick="applyFormat('bold')"><b>B</b></button>
                            <button type="button" class="toolbar-btn" onclick="applyFormat('italic')"><i>I</i></button>
                            <button type="button" class="toolbar-btn" onclick="applyFormat('underline')"><u>U</u></button>
                            <button type="button" class="toolbar-btn" onclick="insertLink()">🔗</button>
                            <button type="button" class="toolbar-btn" onclick="insertImage()">🖼️</button>
                            <button type="button" class="toolbar-btn" onclick="insertUnorderedList()">• 📋</button>
                            <button type="button" class="toolbar-btn" onclick="insertOrderedList()">1. 📝</button>
                            <button type="button" class="toolbar-btn" onclick="insertQuote()">💬</button>
                            <button type="button" class="toolbar-btn" onclick="insertCode()">&lt;/&gt;</button>
                            <button type="button" class="toolbar-btn" onclick="clearFormatting()">🗑️</button>
                        </div>
                        <div id="editorContainer" style="border: 1px solid #1e2430; border-radius: 0 0 16px 16px; background: #0d1016; min-height: 400px;">
                            <div id="articleContent" contenteditable="true" style="min-height: 400px; padding: 20px; color: #e2e8f0; font-size: 15px; line-height: 1.7; outline: none; overflow-y: auto;">${article.content || ''}</div>
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; padding: 20px 28px; border-top: 1px solid rgba(99,102,241,0.1); background: #0f1222;">
                    <button class="btn-primary" onclick="saveArticle()">💾 Сохранить</button>
                    <button class="btn-delete" onclick="deleteArticleWithClose(${articleId})">
                        <i class="fas fa-trash-alt"></i> Удалить
                    </button>
                    <button class="btn-secondary" onclick="closeArticleEditModal()">Отмена</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeArticleEditModal() {
    const modal = document.getElementById('articleEditModal');
    if (modal) modal.remove();
    editingArticleId = null;
}

async function saveArticle() {
    const categoryId = document.getElementById('articleCategoryId')?.value;
    const title = document.getElementById('articleTitle')?.value.trim();
    const content = document.getElementById('articleContent')?.innerHTML;
    
    if (!title) {
        showNotif('Введите название статьи', 'error');
        return;
    }
    
    if (!categoryId || categoryId === '0') {
        showNotif('Выберите категорию', 'error');
        return;
    }
    
    let response;
    if (editingArticleId) {
        response = await apiCall(`/knowledge/articles/${editingArticleId}`, 'PUT', { title, content });
    } else {
        response = await apiCall('/knowledge/articles', 'POST', { category_id: parseInt(categoryId), title, content });
    }
    
    if (response && response.success) {
        showNotif(editingArticleId ? '✅ Статья обновлена' : '✅ Статья создана', 'success');
        closeArticleEditModal();
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка: ' + (response?.error || 'неизвестная ошибка'), 'error');
    }
}

function deleteArticleConfirm(articleId) {
    if (confirm('Удалить эту статью? Это действие нельзя отменить.')) {
        deleteArticleWithClose(articleId);
    }
}

async function deleteArticleWithClose(articleId) {
    const response = await apiCall(`/knowledge/articles/${articleId}`, 'DELETE');
    if (response && response.success) {
        showNotif('✅ Статья удалена', 'success');
        closeArticleEditModal();
        closeArticleModal();
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка при удалении', 'error');
    }
}

async function deleteArticle(articleId) {
    if (!canManageArticles()) {
        showNotif('У вас нет прав на удаление статей', 'error');
        return;
    }
    
    if (!confirm('Удалить статью?')) return;
    
    const response = await apiCall(`/knowledge/articles/${articleId}`, 'DELETE');
    if (response && response.success) {
        showNotif('✅ Статья удалена', 'success');
        await loadKnowledgeData();
    } else {
        showNotif('❌ Ошибка при удалении', 'error');
    }
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initKnowledge = initKnowledge;
window.toggleCategory = toggleCategory;
window.openArticle = openArticle;
window.closeArticleModal = closeArticleModal;
window.openCreateCategoryModal = openCreateCategoryModal;
window.openEditCategoryModal = openEditCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.saveCategory = saveCategory;
window.deleteCategory = deleteCategory;
window.deleteCategoryWithClose = deleteCategoryWithClose;
window.openCreateArticleModal = openCreateArticleModal;
window.openEditArticleModal = openEditArticleModal;
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

// Экспорт функций редактора
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

console.log('✅ knowledge.js загружен (исправленная версия)');