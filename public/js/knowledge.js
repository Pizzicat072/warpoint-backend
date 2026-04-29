// ============================================
// WARPOINT KNOWLEDGE v6.0 — ПОЛНАЯ ЛОГИКА
// Статьи + Редактор + Лайки + Просмотры + Утилиты
// ============================================

(function() {
    'use strict';

    // ============================================
    // СОСТОЯНИЕ
    // ============================================
    var categories = [];
    var articles = [];
    var searchQuery = '';
    var editingArticleId = null;
    var editingCategoryId = null;
    var isLoading = false;
    var activeEditor = null;
    var initialized = false;
    var articleLikes = {};
    var viewedArticles = {};
    var toolsList = [];
    var toolsLoaded = false;
    var currentTab = 'articles';

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initKnowledge() {
        if (initialized) return;
        initialized = true;
        console.log('📚 Инициализация Базы Знаний v6.0');
        
        setupTabSwitcher();
        setupSearchListeners();
        setupModalListeners();
        loadData();
        loadToolsInBackground();
    }

    // ============================================
    // ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
    // ============================================
    function setupTabSwitcher() {
        var btnArticles = document.getElementById('kbTabArticles');
        var btnTools = document.getElementById('kbTabTools');
        var panelArticles = document.getElementById('kbPanelArticles');
        var panelTools = document.getElementById('kbPanelTools');

        if (btnArticles && btnTools) {
            btnArticles.onclick = function() { switchTab('articles'); };
            btnTools.onclick = function() { switchTab('tools'); };
        }
    }

    function switchTab(tab) {
        currentTab = tab;
        var btnA = document.getElementById('kbTabArticles');
        var btnT = document.getElementById('kbTabTools');
        var panelA = document.getElementById('kbPanelArticles');
        var panelT = document.getElementById('kbPanelTools');

        btnA.classList.toggle('active', tab === 'articles');
        btnT.classList.toggle('active', tab === 'tools');

        if (tab === 'articles') {
            panelA.style.display = 'block';
            panelT.style.display = 'none';
        } else {
            panelA.style.display = 'none';
            panelT.style.display = 'block';
            if (!toolsLoaded) loadToolsData();
        }
    }

    // ============================================
    // СЛУШАТЕЛИ МОДАЛОК
    // ============================================
    function setupModalListeners() {
        // Закрытие модалки статьи
        var articleCloseBtn = document.getElementById('kbArticleCloseBtn');
        var articleCloseFooterBtn = document.getElementById('kbArticleCloseFooterBtn');
        if (articleCloseBtn) articleCloseBtn.onclick = closeArticleModal;
        if (articleCloseFooterBtn) articleCloseFooterBtn.onclick = closeArticleModal;

        // Закрытие модалки редактора
        var editorCloseBtn = document.getElementById('kbEditorCloseBtn');
        var editorCancelBtn = document.getElementById('kbEditorCancelBtn');
        if (editorCloseBtn) editorCloseBtn.onclick = closeEditorModal;
        if (editorCancelBtn) editorCancelBtn.onclick = closeEditorModal;

        // Кнопка сохранения редактора
        var editorSaveBtn = document.getElementById('kbEditorSaveBtn');
        if (editorSaveBtn) editorSaveBtn.onclick = saveArticle;

        // Кнопка удаления в редакторе
        var editorDeleteBtn = document.getElementById('kbEditorDeleteBtn');
        if (editorDeleteBtn) editorDeleteBtn.onclick = deleteCurrentArticle;

        // Закрытие модалки категории
        var catCloseBtn = document.getElementById('kbCategoryCloseBtn');
        var catCancelBtn = document.getElementById('kbCategoryCancelBtn');
        if (catCloseBtn) catCloseBtn.onclick = closeCategoryModal;
        if (catCancelBtn) catCancelBtn.onclick = closeCategoryModal;

        // Сохранение категории
        var catSaveBtn = document.getElementById('kbCategorySaveBtn');
        if (catSaveBtn) catSaveBtn.onclick = saveCategory;

        // Закрытие пресетов
        var presetCloseBtn = document.getElementById('kbPresetCloseBtn');
        var presetCancelBtn = document.getElementById('kbPresetCancelBtn');
        if (presetCloseBtn) presetCloseBtn.onclick = closePresetModal;
        if (presetCancelBtn) presetCancelBtn.onclick = closePresetModal;

        // Утилиты
        var uploadBtn = document.getElementById('uploadToolBtn');
        if (uploadBtn) uploadBtn.onclick = openUploadToolModal;

        var uploadCloseBtn = document.getElementById('uploadToolCloseBtn');
        var uploadCancelBtn = document.getElementById('uploadToolCancelBtn');
        if (uploadCloseBtn) uploadCloseBtn.onclick = closeUploadToolModal;
        if (uploadCancelBtn) uploadCancelBtn.onclick = closeUploadToolModal;

        var uploadSaveBtn = document.getElementById('uploadToolSaveBtn');
        if (uploadSaveBtn) uploadSaveBtn.onclick = uploadTool;

        // Тип утилиты
        var toolTypeSelect = document.getElementById('toolType');
        if (toolTypeSelect) toolTypeSelect.onchange = toggleToolTypeInput;

        // Drop zone
        var dropZone = document.getElementById('toolDropZone');
        if (dropZone) {
            dropZone.onclick = function() { document.getElementById('toolFileInput').click(); };
            dropZone.ondragover = function(e) { e.preventDefault(); this.style.borderColor = '#a78bfa'; };
            dropZone.ondragleave = function(e) { e.preventDefault(); this.style.borderColor = ''; };
            dropZone.ondrop = function(e) {
                e.preventDefault();
                this.style.borderColor = '';
                var files = e.dataTransfer.files;
                if (files.length > 0) {
                    document.getElementById('toolFileInput').files = files;
                    showFileInfo(files[0]);
                }
            };
        }

        var fileInput = document.getElementById('toolFileInput');
        if (fileInput) {
            fileInput.onchange = function() {
                if (this.files && this.files[0]) showFileInfo(this.files[0]);
            };
        }

        // Поиск утилит
        var toolsSearch = document.getElementById('toolsSearch');
        if (toolsSearch) toolsSearch.oninput = renderToolsGrid;

        var toolsFilter = document.getElementById('toolsFilterType');
        if (toolsFilter) toolsFilter.onchange = renderToolsGrid;

        // Поиск статей
        var searchInput = document.getElementById('knowledgeSearch');
        var clearBtn = document.getElementById('clearSearchBtn');
        if (searchInput) {
            searchInput.oninput = function() {
                searchQuery = this.value.toLowerCase();
                if (clearBtn) clearBtn.style.display = this.value ? 'flex' : 'none';
                renderKnowledge();
            };
        }
        if (clearBtn) {
            clearBtn.onclick = function() {
                var si = document.getElementById('knowledgeSearch');
                if (si) si.value = '';
                searchQuery = '';
                clearBtn.style.display = 'none';
                renderKnowledge();
            };
        }

        // Escape
        document.onkeydown = function(e) {
            if (e.key === 'Escape') {
                closeArticleModal();
                closeEditorModal();
                closeCategoryModal();
                closeUploadToolModal();
                closePresetModal();
            }
        };
    }

    function setupSearchListeners() {
        // Уже сделано в setupModalListeners
    }

    // ============================================
    // МОДАЛКА СТАТЬИ
    // ============================================
    function openArticleModal(articleId) {
        var article = articles.find(function(a) { return a.id === articleId; });
        if (!article) return;

        trackArticleView(articleId);

        var category = categories.find(function(c) { return c.id === article.category_id; });
        var likes = articleLikes[articleId] || article.likes || 0;
        var liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        var canEdit = canManageArticles();

        document.getElementById('kbArticleCategory').innerHTML = (category ? category.icon + ' ' + category.name : '📁 Без категории');
        document.getElementById('kbArticleCategory').style.background = (category?.color || '#6366f1') + '20';
        document.getElementById('kbArticleCategory').style.color = category?.color || '#a78bfa';
        document.getElementById('kbArticleCategory').style.borderColor = (category?.color || '#6366f1') + '30';

        document.getElementById('kbArticleTitle').textContent = article.title;
        document.getElementById('kbArticleAuthor').innerHTML = '<i class="fas fa-user"></i> ' + escapeHTML(article.created_by || 'Система');
        document.getElementById('kbArticleDate').innerHTML = '<i class="fas fa-calendar"></i> ' + formatFullDate(article.created_at);
        document.getElementById('kbArticleTime').innerHTML = '<i class="fas fa-clock"></i> ' + formatTimeAgo(article.updated_at || article.created_at);
        document.getElementById('kbArticleViews').innerHTML = '<i class="fas fa-eye"></i> ' + ((article.views || 0) + 1) + ' просмотров';

        document.getElementById('kbArticleContent').innerHTML = article.content || '<p style="color:#94a3b8;text-align:center;padding:40px;">Нет содержания</p>';

        var likeBtn = document.getElementById('kbArticleLikeBtn');
        likeBtn.className = 'kb-like-btn' + (liked ? ' liked' : '');
        likeBtn.innerHTML = (liked ? '❤️' : '🤍') + ' <span>' + likes + '</span>';
        likeBtn.onclick = function() { toggleLike(articleId); };

        var editBtn = document.getElementById('kbArticleEditBtn');
        editBtn.style.display = canEdit ? 'inline-flex' : 'none';
        if (canEdit) editBtn.onclick = function() { closeArticleModal(); openEditorModal(articleId); };

        var modal = document.getElementById('kbArticleModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeArticleModal() {
        var modal = document.getElementById('kbArticleModal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
    }

    // ============================================
    // ПРОСМОТРЫ (АНТИ-СПАМ)
    // ============================================
    function canCountView(articleId) {
        var key = 'kb_view_' + articleId;
        var lastView = parseInt(localStorage.getItem(key) || '0');
        var now = Date.now();
        if (now - lastView > 300000) { // 5 минут
            localStorage.setItem(key, now.toString());
            return true;
        }
        return false;
    }

    async function trackArticleView(articleId) {
        if (!canCountView(articleId)) return;
        try {
            await apiCall('/knowledge/articles/' + articleId + '/view', 'POST');
            var article = articles.find(function(a) { return a.id === articleId; });
            if (article) article.views = (article.views || 0) + 1;
        } catch(e) {}
    }

    // ============================================
    // ЛАЙКИ
    // ============================================
    async function toggleLike(articleId) {
        var liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        var newLiked = !liked;
        localStorage.setItem('kb_like_' + articleId, newLiked.toString());
        articleLikes[articleId] = (articleLikes[articleId] || 0) + (newLiked ? 1 : -1);
        if (articleLikes[articleId] < 0) articleLikes[articleId] = 0;

        var likeBtn = document.getElementById('kbArticleLikeBtn');
        likeBtn.className = 'kb-like-btn' + (newLiked ? ' liked' : '');
        likeBtn.innerHTML = (newLiked ? '❤️' : '🤍') + ' <span>' + articleLikes[articleId] + '</span>';

        try {
            await apiCall('/knowledge/articles/' + articleId + '/like', 'POST', { like: newLiked });
        } catch(e) {}
    }

    // ============================================
    // ПОПУЛЯРНЫЕ СТАТЬИ
    // ============================================
    function renderPopularArticles() {
        var section = document.getElementById('kbPopularSection');
        if (!section) return;

        var popular = articles.filter(function(a) { return (a.views || 0) > 0; })
            .sort(function(a, b) { return (b.views || 0) - (a.views || 0); })
            .slice(0, 3);

        if (popular.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        section.innerHTML = '' +
        '<div class="kb-popular-header"><i class="fas fa-fire"></i> Популярные статьи</div>' +
        '<div class="kb-popular-list">' +
            popular.map(function(article, idx) {
                var author = article.created_by || 'Система';
                var cat = categories.find(function(c) { return c.id === article.category_id; });
                return '' +
                '<div class="kb-popular-item" onclick="window._kbOpenArticle(' + article.id + ')">' +
                    '<div class="kb-popular-rank">#' + (idx + 1) + '</div>' +
                    '<div class="kb-popular-info">' +
                        '<div class="kb-popular-title">' + escapeHTML(article.title) + '</div>' +
                        '<div class="kb-popular-meta">' +
                            '<span><i class="fas fa-user"></i> ' + escapeHTML(author) + '</span>' +
                            '<span><i class="fas fa-eye"></i> ' + (article.views || 0) + '</span>' +
                            (cat ? '<span>' + cat.icon + ' ' + escapeHTML(cat.name) + '</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="kb-popular-views">' + (article.views || 0) + ' 👁️</div>' +
                '</div>';
            }).join('') +
        '</div>';
    }
    // ============================================
    // РЕДАКТОР СТАТЬИ
    // ============================================
    function renderEditorToolbar() {
        var toolbar = document.getElementById('kbEditorToolbar');
        if (!toolbar) return;
        
        toolbar.innerHTML = '' +
        '<button onclick="document.execCommand(\'bold\',false,null)" title="Жирный (Ctrl+B)"><b>B</b></button>' +
        '<button onclick="document.execCommand(\'italic\',false,null)" title="Курсив (Ctrl+I)"><i>I</i></button>' +
        '<button onclick="document.execCommand(\'underline\',false,null)" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>' +
        '<button onclick="document.execCommand(\'strikeThrough\',false,null)" title="Зачёркнутый"><s>S</s></button>' +
        '<button onclick="document.execCommand(\'removeFormat\',false,null)" title="Очистить формат"><i class="fas fa-eraser"></i></button>' +
        '<span style="width:1px;background:rgba(99,102,241,0.15);margin:4px 6px;"></span>' +
        '<select onchange="document.execCommand(\'formatBlock\',false,this.value)" style="width:auto;">' +
            '<option value="p">Параграф</option>' +
            '<option value="h1">H1</option>' +
            '<option value="h2">H2</option>' +
            '<option value="h3">H3</option>' +
            '<option value="pre">Код</option>' +
            '<option value="blockquote">Цитата</option>' +
        '</select>' +
        '<span style="width:1px;background:rgba(99,102,241,0.15);margin:4px 6px;"></span>' +
        '<button onclick="document.execCommand(\'justifyLeft\',false,null)" title="Слева"><i class="fas fa-align-left"></i></button>' +
        '<button onclick="document.execCommand(\'justifyCenter\',false,null)" title="По центру"><i class="fas fa-align-center"></i></button>' +
        '<button onclick="document.execCommand(\'justifyRight\',false,null)" title="Справа"><i class="fas fa-align-right"></i></button>' +
        '<span style="width:1px;background:rgba(99,102,241,0.15);margin:4px 6px;"></span>' +
        '<button onclick="document.execCommand(\'insertUnorderedList\',false,null)" title="Список"><i class="fas fa-list-ul"></i></button>' +
        '<button onclick="document.execCommand(\'insertOrderedList\',false,null)" title="Нумерованный"><i class="fas fa-list-ol"></i></button>' +
        '<span style="width:1px;background:rgba(99,102,241,0.15);margin:4px 6px;"></span>' +
        '<button onclick="kbInsertLink()" title="Ссылка"><i class="fas fa-link"></i></button>' +
        '<button onclick="kbInsertImage()" title="Изображение"><i class="fas fa-image"></i></button>' +
        '<button onclick="kbInsertTable()" title="Таблица"><i class="fas fa-table"></i></button>' +
        '<button onclick="kbInsertDivider()" title="Разделитель"><i class="fas fa-minus"></i></button>' +
        '<button onclick="document.execCommand(\'insertHorizontalRule\',false,null)" title="Линия">—</button>';
    }

    function openEditorModal(articleId) {
        editingArticleId = articleId || null;
        
        document.getElementById('kbEditorTitle').textContent = articleId ? 'Редактировать статью' : 'Новая статья';
        document.getElementById('kbEditorArticleTitle').value = '';
        document.getElementById('kbEditorContent').innerHTML = '';
        document.getElementById('kbEditorDeleteBtn').style.display = articleId ? 'inline-flex' : 'none';
        
        if (articleId) {
            var article = articles.find(function(a) { return a.id === articleId; });
            if (article) {
                document.getElementById('kbEditorArticleTitle').value = article.title;
                document.getElementById('kbEditorContent').innerHTML = article.content || '';
            }
        }
        
        renderEditorToolbar();
        document.getElementById('kbEditorModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        setTimeout(function() {
            var editor = document.getElementById('kbEditorContent');
            if (editor) editor.focus();
        }, 200);
    }

    function closeEditorModal() {
        document.getElementById('kbEditorModal').style.display = 'none';
        document.body.style.overflow = '';
        editingArticleId = null;
    }

    async function saveArticle() {
        var title = document.getElementById('kbEditorArticleTitle').value.trim();
        var content = document.getElementById('kbEditorContent').innerHTML;
        
        if (!title) { showNotif('❌ Введите заголовок', 'error'); return; }
        
        var categoryId = prompt('ID категории (посмотрите в коде):', '1');
        if (!categoryId) return;
        
        var response;
        if (editingArticleId) {
            response = await apiCall('/knowledge/articles/' + editingArticleId, 'PUT', { title: title, content: content });
        } else {
            response = await apiCall('/knowledge/articles', 'POST', { category_id: parseInt(categoryId), title: title, content: content });
        }
        
        if (response && response.success) {
            showNotif(editingArticleId ? '✅ Статья обновлена' : '✅ Статья создана', 'success');
            closeEditorModal();
            loadData();
        } else {
            showNotif('❌ ' + ((response && response.error) || 'Ошибка'), 'error');
        }
    }

    async function deleteCurrentArticle() {
        if (!editingArticleId) return;
        if (!confirm('Удалить эту статью?')) return;
        
        var response = await apiCall('/knowledge/articles/' + editingArticleId, 'DELETE');
        if (response && response.success) {
            showNotif('🗑️ Статья удалена', 'warning');
            closeEditorModal();
            loadData();
        }
    }

    function kbInsertLink() {
        var url = prompt('URL ссылки:', 'https://');
        if (url) document.execCommand('createLink', false, url);
    }

    function kbInsertImage() {
        var url = prompt('URL изображения:', 'https://');
        if (url) document.execCommand('insertImage', false, url);
    }

    function kbInsertTable() {
        var html = '<table style="width:100%;border-collapse:collapse;margin:16px 0;"><tr><th style="border:1px solid rgba(99,102,241,0.2);padding:10px;">Заголовок 1</th><th style="border:1px solid rgba(99,102,241,0.2);padding:10px;">Заголовок 2</th></tr><tr><td style="border:1px solid rgba(99,102,241,0.2);padding:10px;">Ячейка</td><td style="border:1px solid rgba(99,102,241,0.2);padding:10px;">Ячейка</td></tr></table>';
        document.execCommand('insertHTML', false, html);
    }

    function kbInsertDivider() {
        document.execCommand('insertHTML', false, '<hr style="margin:24px 0;border:none;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent);">');
    }

    // ============================================
    // КАТЕГОРИИ
    // ============================================
    function openCategoryModal(id, name, icon) {
        editingCategoryId = id || null;
        document.getElementById('kbCategoryModalTitle').textContent = id ? 'Редактировать категорию' : 'Новая категория';
        document.getElementById('kbCategoryName').value = name || '';
        document.getElementById('kbCategoryIcon').value = icon || '📁';
        
        renderIconPicker(icon || '📁');
        document.getElementById('kbCategoryModal').style.display = 'flex';
    }

    function closeCategoryModal() {
        document.getElementById('kbCategoryModal').style.display = 'none';
        editingCategoryId = null;
    }

    function renderIconPicker(selectedIcon) {
        var picker = document.getElementById('kbIconPicker');
        if (!picker) return;
        
        var icons = ['📁','📖','📜','❓','💡','🔧','⚙️','🎮','🏆','⭐','🔥','✅','❌','⚠️','ℹ️','📅','🎧','📡','🧹','👋','💬','🎫','🆕','💰','📊','🌍','📢','🤝','🎯','🎂','🎓','🏢','🎈','🎧','🎮','📱','💻','🖥️','🔒','🔑','📸','📝','🎬'];
        
        picker.innerHTML = icons.map(function(ic) {
            return '<span class="kb-icon-option' + (ic === selectedIcon ? ' selected' : '') + '" onclick="window._kbSelectIcon(\'' + ic + '\')">' + ic + '</span>';
        }).join('');
    }

    window._kbSelectIcon = function(icon) {
        document.getElementById('kbCategoryIcon').value = icon;
        renderIconPicker(icon);
    };

    async function saveCategory() {
        var name = document.getElementById('kbCategoryName').value.trim();
        var icon = document.getElementById('kbCategoryIcon').value || '📁';
        
        if (!name) { showNotif('❌ Введите название', 'error'); return; }
        
        var response;
        if (editingCategoryId) {
            response = await apiCall('/knowledge/categories/' + editingCategoryId, 'PUT', { name: name, icon: icon });
        } else {
            response = await apiCall('/knowledge/categories', 'POST', { name: name, icon: icon });
        }
        
        if (response && response.success) {
            showNotif(editingCategoryId ? '✅ Категория обновлена' : '✅ Категория создана', 'success');
            closeCategoryModal();
            loadData();
        } else {
            showNotif('❌ ' + ((response && response.error) || 'Ошибка'), 'error');
        }
    }

    async function deleteCategory(id) {
        if (!confirm('Удалить категорию и все статьи в ней?')) return;
        var response = await apiCall('/knowledge/categories/' + id, 'DELETE');
        if (response && response.success) {
            showNotif('🗑️ Категория удалена', 'warning');
            loadData();
        }
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================
    async function loadData() {
        if (isLoading) return;
        isLoading = true;
        
        try {
            var catRes = await apiCall('/knowledge/categories');
            var artRes = await apiCall('/knowledge/articles');
            
            categories = (catRes && catRes.success) ? (catRes.data || []) : [];
            articles = (artRes && artRes.success) ? (artRes.data || []) : [];
            
            renderKnowledge();
            renderPopularArticles();
            setupActionButtons();
        } catch(e) {
            console.error('Ошибка загрузки:', e);
        } finally {
            isLoading = false;
        }
    }

    function setupActionButtons() {
        var container = document.getElementById('actionButtons');
        if (!container) return;
        
        var canManage = canManageCategories();
        container.innerHTML = canManage ?
            '<button class="btn-secondary" onclick="window._kbOpenCategory()"><i class="fas fa-folder-plus"></i> Категория</button>' +
            '<button class="btn-secondary" onclick="window._kbOpenPresets()"><i class="fas fa-magic"></i> Готовые</button>' +
            '<button class="btn-primary" onclick="window._kbNewArticle()"><i class="fas fa-plus"></i> Статья</button>' :
            (canManageArticles() ? '<button class="btn-primary" onclick="window._kbNewArticle()"><i class="fas fa-plus"></i> Статья</button>' : '');
    }

    function renderKnowledge() {
        var container = document.getElementById('knowledgeContainer');
        if (!container) return;
        
        var filtered = articles.slice();
        if (searchQuery) {
            filtered = filtered.filter(function(a) {
                return (a.title && a.title.toLowerCase().indexOf(searchQuery) !== -1) ||
                       (a.content && a.content.toLowerCase().indexOf(searchQuery) !== -1);
            });
        }
        
        if (categories.length === 0) {
            container.innerHTML = '<div class="kb-empty-state">' +
                '<div class="kb-empty-state-icon">📁</div>' +
                '<h3>Нет категорий</h3>' +
                '<p>Создайте первую категорию или используйте готовые шаблоны</p>' +
                (canManageCategories() ? '<button class="btn-primary" onclick="window._kbOpenPresets()"><i class="fas fa-magic"></i> Готовые категории</button>' : '') +
            '</div>';
            return;
        }
        
        var html = '';
        
        categories.forEach(function(cat) {
            var catArticles = filtered.filter(function(a) { return a.category_id === cat.id; });
            
            html += '' +
            '<div class="kb-category-card">' +
                '<div class="kb-category-header" onclick="window._kbToggleCategory(' + cat.id + ')">' +
                    '<div class="kb-category-title-group">' +
                        '<div class="kb-category-icon-box">' + (cat.icon || '📁') + '</div>' +
                        '<span class="kb-category-name">' + escapeHTML(cat.name) + '</span>' +
                        '<span class="kb-category-count">' + catArticles.length + '</span>' +
                    '</div>' +
                    '<div class="kb-category-actions-group">' +
                        (canManageCategories() ? '<button class="kb-category-edit-btn" onclick="event.stopPropagation();window._kbEditCategory(' + cat.id + ',\'' + escapeHTML(cat.name) + '\',\'' + (cat.icon || '📁') + '\')"><i class="fas fa-edit"></i></button>' : '') +
                        (canManageCategories() ? '<button class="kb-category-delete-btn" onclick="event.stopPropagation();window._kbDeleteCategory(' + cat.id + ')"><i class="fas fa-trash-alt"></i></button>' : '') +
                        '<span class="kb-category-arrow"><i class="fas fa-chevron-down"></i></span>' +
                    '</div>' +
                '</div>' +
                '<div class="kb-category-body" id="kbCatBody' + cat.id + '">';
            
            if (catArticles.length > 0) {
                catArticles.forEach(function(article) {
                    html += '' +
                    '<div class="kb-article-item">' +
                        '<div class="kb-article-item-info" onclick="window._kbOpenArticle(' + article.id + ')">' +
                            '<div class="kb-article-item-title"><i class="fas fa-file-alt"></i> ' + escapeHTML(article.title) + '</div>' +
                            '<div class="kb-article-item-meta">' +
                                '<span><i class="fas fa-eye"></i> ' + (article.views || 0) + '</span>' +
                                '<span><i class="fas fa-calendar-alt"></i> ' + formatDate(article.created_at) + '</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="kb-article-item-actions">' +
                            (canManageArticles() ? '<button class="kb-article-edit-btn" onclick="event.stopPropagation();window._kbEditArticle(' + article.id + ')"><i class="fas fa-edit"></i></button>' : '') +
                            (canManageArticles() ? '<button class="kb-article-delete-btn" onclick="event.stopPropagation();window._kbDeleteArticle(' + article.id + ')"><i class="fas fa-trash-alt"></i></button>' : '') +
                        '</div>' +
                    '</div>';
                });
            } else {
                html += '<div style="text-align:center;padding:20px;color:#64748b;font-size:13px;">Нет статей в этой категории</div>';
            }
            
            html += '</div></div>';
        });
        
        container.innerHTML = html;
        
        // Восстанавливаем открытые категории
        try {
            var openCats = JSON.parse(localStorage.getItem('kb_open_cats') || '[]');
            openCats.forEach(function(catId) {
                var body = document.getElementById('kbCatBody' + catId);
                if (body) { body.style.display = 'flex'; }
            });
        } catch(e) {}
    }

    window._kbToggleCategory = function(catId) {
        var body = document.getElementById('kbCatBody' + catId);
        if (!body) return;
        
        var isOpen = body.style.display === 'flex';
        body.style.display = isOpen ? 'none' : 'flex';
        
        var openCats = [];
        try { openCats = JSON.parse(localStorage.getItem('kb_open_cats') || '[]'); } catch(e) {}
        if (isOpen) {
            openCats = openCats.filter(function(id) { return id !== catId; });
        } else {
            if (openCats.indexOf(catId) === -1) openCats.push(catId);
        }
        localStorage.setItem('kb_open_cats', JSON.stringify(openCats));
    };

    // ============================================
    // УТИЛИТЫ
    // ============================================
    function loadToolsInBackground() {
        var token = getToken();
        if (!token) return;
        loadToolsData();
    }

    function loadToolsData() {
        if (toolsLoaded) { renderToolsGrid(); return; }
        
        fetch('/api/tools', { headers: { 'Authorization': 'Bearer ' + getToken() } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                toolsList = [];
                
                if (data && data.tools) {
                    data.tools.forEach(function(f) {
                        var ext = f.name.split('.').pop().toLowerCase();
                        var icons = { exe:'💻', msi:'📦', bat:'📜', cmd:'⬛', zip:'📚', pdf:'📄', png:'🖼️', jpg:'🖼️' };
                        toolsList.push({
                            id: 'f_' + f.name,
                            name: f.name.replace(/_\d{13}\./, '.'),
                            desc: formatFileSize(f.size) + ' — ' + new Date(f.uploadedAt).toLocaleDateString('ru-RU'),
                            type: ext,
                            icon: icons[ext] || '📁',
                            path: f.path,
                            size: f.size,
                            isServer: true
                        });
                    });
                }
                
                // Ссылки из localStorage
                try {
                    var saved = JSON.parse(localStorage.getItem('warpoint_tools_links') || '[]');
                    saved.forEach(function(s) {
                        toolsList.push({ id: s.id, name: s.name, desc: s.desc, type: 'url', icon: '🌐', path: s.path, isServer: false });
                    });
                } catch(e) {}
                
                toolsLoaded = true;
                if (currentTab === 'tools') renderToolsGrid();
            })
            .catch(function() {
                if (currentTab === 'tools') renderToolsGrid();
            });
    }

    function renderToolsGrid() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;

        var search = (document.getElementById('toolsSearch')?.value || '').toLowerCase();
        var filterType = document.getElementById('toolsFilterType')?.value || 'all';

        var filtered = toolsList.filter(function(t) {
            var matchSearch = !search || t.name.toLowerCase().indexOf(search) !== -1;
            var matchType = filterType === 'all' || t.type === filterType || (filterType === 'other' && ['exe','msi','bat','url'].indexOf(t.type) === -1);
            return matchSearch && matchType;
        });

        if (filtered.length === 0) {
            grid.innerHTML = '<div class="kb-empty-state" style="grid-column:1/-1;">' +
                '<div class="kb-empty-state-icon">📭</div>' +
                '<h3>Нет утилит</h3>' +
                '<p>Загрузите файл или добавьте ссылку</p>' +
            '</div>';
        } else {
            grid.innerHTML = filtered.map(function(t) {
                var badge = t.isServer ? '<span class="tool-badge badge-server">📁 Файл</span>' : '<span class="tool-badge badge-link">🔗 Ссылка</span>';
                var action = t.isServer
                    ? '<a href="' + t.path + '" download class="btn-launch">📥 Скачать</a>'
                    : '<a href="' + escapeHTML(t.path) + '" target="_blank" class="btn-launch btn-launch-link">🔗 Открыть</a>';
                
                return '<div class="tool-card">' +
                    '<div class="tool-card-icon">' + (t.icon || '📁') + '</div>' +
                    badge +
                    '<div class="tool-card-name">' + escapeHTML(t.name) + '</div>' +
                    '<div class="tool-card-desc">' + escapeHTML(t.desc || '') + '</div>' +
                    '<div class="tool-card-meta"><span>' + (t.type || 'file').toUpperCase() + '</span></div>' +
                    '<div class="tool-card-actions">' + action +
                        '<button class="btn-delete-tool" onclick="window._kbDeleteTool(\'' + t.id + '\')">🗑️</button>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        updateToolsStats();
    }

    function updateToolsStats() {
        var countEl = document.getElementById('toolsCount');
        var sizeEl = document.getElementById('toolsTotalSize');
        if (countEl) countEl.textContent = toolsList.length;
        if (sizeEl) {
            var totalSize = toolsList.reduce(function(s, t) { return s + (t.size || 0); }, 0);
            sizeEl.textContent = formatFileSize(totalSize);
        }
    }

    function openUploadToolModal() {
        document.getElementById('uploadToolModal').style.display = 'flex';
        document.getElementById('toolName').value = '';
        document.getElementById('toolDesc').value = '';
        document.getElementById('toolType').value = 'exe';
        document.getElementById('toolFileInput').value = '';
        document.getElementById('toolFileInfo').style.display = 'none';
        document.getElementById('toolPath').value = '';
        toggleToolTypeInput();
    }

    function closeUploadToolModal() {
        document.getElementById('uploadToolModal').style.display = 'none';
    }

    function toggleToolTypeInput() {
        var type = document.getElementById('toolType').value;
        document.getElementById('toolFileGroup').style.display = type === 'url' ? 'none' : 'block';
        document.getElementById('toolUrlGroup').style.display = type === 'url' ? 'block' : 'none';
    }

    function showFileInfo(file) {
        var info = document.getElementById('toolFileInfo');
        info.innerHTML = '📎 ' + file.name + ' (' + formatFileSize(file.size) + ')';
        info.style.display = 'block';
    }

    function uploadTool() {
        var name = document.getElementById('toolName').value.trim();
        var desc = document.getElementById('toolDesc').value.trim();
        var type = document.getElementById('toolType').value;

        if (!name) { showNotif('❌ Введите название', 'error'); return; }

        if (type === 'url') {
            var url = document.getElementById('toolPath').value.trim();
            if (!url) { showNotif('❌ Введите ссылку', 'error'); return; }
            
            toolsList.push({ id: 'l_' + Date.now(), name: name, desc: desc || url, type: 'url', icon: '🌐', path: url, size: 0, isServer: false });
            saveLinks();
            renderToolsGrid();
            closeUploadToolModal();
            showNotif('✅ Ссылка добавлена', 'success');
            return;
        }

        var file = document.getElementById('toolFileInput').files[0];
        if (!file) { showNotif('❌ Выберите файл', 'error'); return; }

        var fd = new FormData();
        fd.append('file', file);

        showNotif('⏳ Загрузка...', 'info');

        fetch('/api/tools/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getToken() },
            body: fd
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && data.success) {
                toolsList.push({
                    id: 'f_' + data.file.path,
                    name: name,
                    desc: desc || formatFileSize(data.file.size),
                    type: data.file.type.replace('.', ''),
                    icon: '📁',
                    path: data.file.path,
                    size: data.file.size,
                    isServer: true
                });
                renderToolsGrid();
                closeUploadToolModal();
                showNotif('✅ Файл загружен', 'success');
            }
        })
        .catch(function() { showNotif('❌ Ошибка', 'error'); });
    }

    window._kbDeleteTool = function(id) {
        if (!confirm('Удалить?')) return;
        var tool = toolsList.find(function(t) { return t.id === id; });
        if (tool && tool.isServer) {
            fetch('/api/tools/' + encodeURIComponent(tool.path.split('/').pop()), {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
        }
        toolsList = toolsList.filter(function(t) { return t.id !== id; });
        saveLinks();
        renderToolsGrid();
    };

    function saveLinks() {
        var links = toolsList.filter(function(t) { return !t.isServer; });
        localStorage.setItem('warpoint_tools_links', JSON.stringify(links));
    }

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ
    // ============================================
    function canManageCategories() {
        var role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager';
    }

    function canManageArticles() {
        var role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager' || role === 'admin' || role === 'operator';
    }

    function getToken() {
        return localStorage.getItem('token') || localStorage.getItem('warpoint_token') || '';
    }

    async function apiCall(endpoint, method, body) {
        if (method === undefined) method = 'GET';
        var options = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() } };
        if (body) options.body = JSON.stringify(body);
        try {
            var response = await fetch('/api' + endpoint, options);
            return await response.json();
        } catch(e) { return { success: false }; }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatFullDate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (diff < 60) return 'только что';
        if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
        if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
        return formatDate(dateStr);
    }

    function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function showNotif(msg, type) {
        if (typeof window.showSystemNotification === 'function') window.showSystemNotification(msg, type);
        else if (typeof window.showNotif === 'function') window.showNotif(msg, type);
    }

    // ============================================
    // ГЛОБАЛЬНЫЕ ССЫЛКИ
    // ============================================
    window._kbOpenArticle = openArticleModal;
    window._kbEditArticle = function(id) { openEditorModal(id); };
    window._kbNewArticle = function() { openEditorModal(null); };
    window._kbDeleteArticle = async function(id) {
        if (!confirm('Удалить статью?')) return;
        await apiCall('/knowledge/articles/' + id, 'DELETE');
        loadData();
    };
    window._kbOpenCategory = function() { openCategoryModal(null, '', '📁'); };
    window._kbEditCategory = openCategoryModal;
    window._kbDeleteCategory = deleteCategory;
    window._kbOpenPresets = function() { document.getElementById('kbPresetModal').style.display = 'flex'; };
    window._kbToggleCategory = window._kbToggleCategory;
    window._kbDeleteTool = window._kbDeleteTool;

    // ============================================
    // ЗАПУСК
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initKnowledge);
    } else {
        initKnowledge();
    }

    console.log('✅ knowledge.js v6.0 загружен');
})();