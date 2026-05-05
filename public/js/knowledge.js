// ============================================
// knowledge.js — WARPOINT KNOWLEDGE BASE v9.0
// ============================================

(function() {
    'use strict';
    
    let state = {
        categories: [],
        articles: [],
        searchQuery: '',
        editingArticleId: null,
        editingCategoryId: null,
        isLoading: false,
        isInitialized: false,
        activeEditor: null,
        likes: {},
        tools: [],
        toolsFilter: 'all',
        toolsSearch: '',
        toolsLoaded: false,
        isSaving: false
    };

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    function getElement(id) {
        const el = document.getElementById(id);
        if (!el) console.warn(`Element with ID "${id}" not found`);
        return el;
    }

    function canManageCategories() {
        let role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager';
    }

    function canManageArticles() {
        let role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager' || role === 'admin' || role === 'operator';
    }

    function canManageTools() {
        let role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager';
    }

    function escapeHtml(str) {
        if (!str) return '';
        let map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
        return String(str).replace(/[&<>"'/]/g, m => map[m]);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        let d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        let date = new Date(dateStr);
        let now = new Date();
        let diff = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diff < 0) return 'только что';
        if (diff < 60) return 'только что';
        if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
        if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
        if (diff < 2592000) return Math.floor(diff / 86400) + ' дн назад';
        return formatDate(dateStr);
    }

    function showNotification(message, type = 'info') {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    function getToken() {
        return localStorage.getItem('token');
    }

    async function apiCall(endpoint, method = 'GET', body = null) {
        let token = getToken();
        let options = {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        if (body) options.body = JSON.stringify(body);
        try {
            let response = await fetch('/api' + endpoint, options);
            let data = await response.json();
            if (!response.ok) {
                return { success: false, error: data.error || `HTTP ${response.status}` };
            }
            return data;
        } catch (e) {
            console.error('Fetch error:', e);
            return { success: false, error: 'Ошибка соединения с сервером' };
        }
    }

    // ============================================
    // ПРОСМОТРЫ И ЛАЙКИ
    // ============================================

    function canCountView(articleId) {
        let currentUser = window.app?.currentUser;
        if (!currentUser) return false;
        let key = 'kb_views_' + currentUser;
        let viewsData = {};
        try { viewsData = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) { viewsData = {}; }
        let articleKey = 'article_' + articleId;
        let lastView = viewsData[articleKey] || 0;
        let now = Date.now();
        let fiveMinutes = 5 * 60 * 1000;
        if (now - lastView > fiveMinutes) {
            viewsData[articleKey] = now;
            let oneHour = 60 * 60 * 1000;
            Object.keys(viewsData).forEach(k => {
                if (now - viewsData[k] > oneHour) delete viewsData[k];
            });
            localStorage.setItem(key, JSON.stringify(viewsData));
            return true;
        }
        return false;
    }

    async function trackArticleView(articleId) {
        if (!canCountView(articleId)) return;
        try {
            let response = await apiCall('/knowledge/articles/' + articleId + '/view', 'POST');
            if (response?.success) {
                let article = state.articles.find(a => a.id === articleId);
                if (article) {
                    article.views = (article.views || 0) + 1;
                    // Обновить счётчик в списке
                    let viewElement = document.querySelector(`.kb-article-item[data-article-id="${articleId}"] .kb-article-item-meta span:first-child`);
                    if (viewElement) {
                        viewElement.innerHTML = `<i class="fas fa-eye"></i> ${article.views}`;
                    }
                }
            }
        } catch(e) {
            console.error('Error tracking view:', e);
        }
    }

    async function toggleLike(articleId) {
        let key = 'kb_like_' + articleId;
        let liked = localStorage.getItem(key) === 'true';
        try {
            let response = await apiCall('/knowledge/articles/' + articleId + '/like', 'POST', { like: !liked });
            if (response?.success) {
                localStorage.setItem(key, (!liked).toString());
                state.likes[articleId] = response.likes || 0;
                renderKnowledge();
                showNotification(liked ? '💔 Лайк убран' : '❤️ Статья понравилась!', 'success');
                // Обновить кнопку лайка в модалке, если открыта
                updateLikeButton(articleId);
            }
        } catch (e) {
            showNotification('❌ ' + (e.message || 'Ошибка'), 'error');
        }
    }

    function updateLikeButton(articleId) {
        let likeBtn = getElement('kbArticleLikeBtn');
        if (!likeBtn) return;
        let likes = state.likes[articleId] || 0;
        let liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        likeBtn.className = 'kb-like-btn ' + (liked ? 'liked' : '');
        likeBtn.innerHTML = (liked ? '❤️' : '🤍') + ' <span>' + (likes || 0) + '</span>';
    }

    // ============================================
    // РЕДАКТОР
    // ============================================

    function renderEditorToolbar() {
        return `
        <div class="kb-editor-toolbar" id="kbEditorToolbar">
            <button onclick="window.kbExec('bold')" title="Жирный (Ctrl+B)"><b>B</b></button>
            <button onclick="window.kbExec('italic')" title="Курсив (Ctrl+I)"><i>I</i></button>
            <button onclick="window.kbExec('underline')" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
            <button onclick="window.kbExec('strikeThrough')" title="Зачёркнутый"><s>S</s></button>
            <button onclick="window.kbExec('removeFormat')" title="Очистить формат"><i class="fas fa-eraser"></i></button>
            
            <select onchange="window.kbExec('formatBlock', this.value)">
                <option value="p">📝 Параграф</option>
                <option value="h1">H1 Заголовок</option>
                <option value="h2">H2 Заголовок</option>
                <option value="h3">H3 Подзаголовок</option>
                <option value="h4">H4 Заголовок</option>
                <option value="pre">💻 Код</option>
                <option value="blockquote">💬 Цитата</option>
            </select>
            
            <select onchange="window.kbExec('fontSize', this.value)">
                <option value="1">8px</option>
                <option value="2">10px</option>
                <option value="3">12px</option>
                <option value="4" selected>14px</option>
                <option value="5">18px</option>
                <option value="6">24px</option>
                <option value="7">36px</option>
            </select>
            
            <input type="color" onchange="window.kbExec('foreColor', this.value)" value="#e2e8f0" title="Цвет текста">
            <input type="color" onchange="window.kbExec('hiliteColor', this.value)" value="#000000" title="Цвет фона">
            
            <button onclick="window.kbExec('justifyLeft')" title="По левому краю"><i class="fas fa-align-left"></i></button>
            <button onclick="window.kbExec('justifyCenter')" title="По центру"><i class="fas fa-align-center"></i></button>
            <button onclick="window.kbExec('justifyRight')" title="По правому краю"><i class="fas fa-align-right"></i></button>
            <button onclick="window.kbExec('justifyFull')" title="По ширине"><i class="fas fa-align-justify"></i></button>
            
            <button onclick="window.kbExec('insertUnorderedList')" title="Маркированный список"><i class="fas fa-list-ul"></i></button>
            <button onclick="window.kbExec('insertOrderedList')" title="Нумерованный список"><i class="fas fa-list-ol"></i></button>
            <button onclick="window.kbInsertChecklist()" title="Чек-лист"><i class="fas fa-check-square"></i></button>
            
            <button onclick="window.kbInsertLink()" title="Ссылка"><i class="fas fa-link"></i></button>
            <button onclick="window.kbInsertImage()" title="Изображение"><i class="fas fa-image"></i></button>
            <button onclick="window.kbInsertVideo()" title="Видео (YouTube)"><i class="fas fa-video"></i></button>
            <button onclick="window.kbInsertTable()" title="Таблица"><i class="fas fa-table"></i></button>
            <button onclick="window.kbInsertDivider()" title="Разделитель"><i class="fas fa-grip-lines"></i></button>
            
            <button onclick="window.kbInsertCallout('info')" title="Инфо" style="color:#3b82f6;"><i class="fas fa-info-circle"></i></button>
            <button onclick="window.kbInsertCallout('success')" title="Успех" style="color:#10b981;"><i class="fas fa-check-circle"></i></button>
            <button onclick="window.kbInsertCallout('warning')" title="Предупреждение" style="color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i></button>
            <button onclick="window.kbInsertCallout('error')" title="Ошибка" style="color:#ef4444;"><i class="fas fa-times-circle"></i></button>
            <button onclick="window.kbInsertCodeBlock()" title="Блок кода"><i class="fas fa-code"></i></button>
            
            <button onclick="window.kbToggleEmoji()" title="Эмодзи">😊</button>
            <button onclick="document.execCommand('undo')" title="Отменить (Ctrl+Z)"><i class="fas fa-undo"></i></button>
            <button onclick="document.execCommand('redo')" title="Повторить (Ctrl+Y)"><i class="fas fa-redo"></i></button>
        </div>
        <div id="kbEmojiPanel" style="display:none;padding:12px;background:rgba(0,0,0,0.3);border-top:1px solid rgba(99,102,241,0.1);">
            ${getEmojiList()}
        </div>`;
    }

    function getEmojiList() {
        let emojis = ['😀','😂','🤣','😍','🥰','😘','😎','🤩','😤','😢','😡','😱','🤔','😴','👍','👎','👏','🙌','💪','🤝','🎉','🔥','💯','✅','❌','⭐','🌟','🎮','🛒','💰','📅','📋','🏆','👑','🎁','🔄','📚','💡','🔧','⚙️','📸','📝','🎯','🚀','🎂','☕','🧹','📱','💻','🖥️','🎧','🎬','📊','📈','🔒','🔑','❤️','💔','🫶','🤌','🫡','🥇','🥈','🥉','🏅','🎖️','🔔','💬','🗨️','📢'];
        return emojis.map(e => `<span class="kb-emoji-item" onclick="window.kbInsertEmoji('${e}')" style="font-size:24px;cursor:pointer;padding:4px;border-radius:6px;transition:0.2s;" onmouseover="this.style.background='rgba(99,102,241,0.2)'" onmouseout="this.style.background=''">${e}</span>`).join('');
    }

    function kbExec(command, value = null) {
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        try {
            document.execCommand(command, false, value);
        } catch(e) {
            console.error('execCommand error:', e);
        }
    }

    function kbInitEditor(editorElement) {
        if (!editorElement) editorElement = getElement('kbEditorContent');
        if (!editorElement) return;
        state.activeEditor = editorElement;
        editorElement.setAttribute('data-placeholder', 'Начните писать здесь...');
        if (!editorElement.innerHTML.trim() || editorElement.innerHTML === '<br>') {
            editorElement.innerHTML = '';
            editorElement.classList.add('kb-editor-empty');
        }
        editorElement.addEventListener('input', function() {
            if (!this.innerHTML.trim() || this.innerHTML === '<br>') {
                this.classList.add('kb-editor-empty');
            } else {
                this.classList.remove('kb-editor-empty');
            }
        });
        editorElement.addEventListener('keydown', function(e) {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key.toLowerCase()) {
                    case 'b': e.preventDefault(); kbExec('bold'); break;
                    case 'i': e.preventDefault(); kbExec('italic'); break;
                    case 'u': e.preventDefault(); kbExec('underline'); break;
                    case 'k': e.preventDefault(); kbInsertLink(); break;
                    case 'z': e.preventDefault(); document.execCommand('undo'); break;
                    case 'y': e.preventDefault(); document.execCommand('redo'); break;
                }
            }
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                kbExec('indent');
            }
            if (e.key === 'Tab' && e.shiftKey) {
                e.preventDefault();
                kbExec('outdent');
            }
        });
        setTimeout(() => editorElement.focus(), 150);
    }

    function kbToggleEmoji() {
        let panel = getElement('kbEmojiPanel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function kbInsertEmoji(emoji) {
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        let sel = window.getSelection();
        if (sel.rangeCount > 0) {
            let range = sel.getRangeAt(0);
            range.deleteContents();
            let textNode = document.createTextNode(emoji);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            editor.innerHTML += emoji;
        }
        let panel = getElement('kbEmojiPanel');
        if (panel) panel.style.display = 'none';
    }

    function kbInsertLink() {
        let url = prompt('🔗 Введите URL ссылки:', 'https://');
        if (!url?.trim()) return;
        let text = prompt('📝 Текст ссылки (необязательно):', '');
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        if (text?.trim()) {
            document.execCommand('insertHTML', false,
                `<a href="${escapeHtml(url.trim())}" target="_blank" rel="noopener noreferrer" style="color:#a78bfa;text-decoration:underline;">${escapeHtml(text.trim())}</a>`
            );
        } else {
            document.execCommand('createLink', false, url.trim());
        }
        showNotification('🔗 Ссылка добавлена', 'info');
    }

    function kbInsertImage() {
        let url = prompt('🖼️ Введите URL изображения:', 'https://');
        if (!url?.trim()) return;
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, `
            <div style="margin:24px 0;text-align:center;position:relative;">
                <img src="${escapeHtml(url.trim())}" alt="Изображение" 
                     style="max-width:100%;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,0.4);cursor:pointer;transition:transform 0.3s;"
                     onclick="this.style.transform=this.style.transform==='scale(1.05)'?'scale(1)':'scale(1.05)'">
                <div style="margin-top:8px;font-size:11px;color:#64748b;">🖼️ Нажмите на изображение чтобы увеличить</div>
            </div>
        `);
        showNotification('🖼️ Изображение добавлено', 'info');
    }

    function kbInsertVideo() {
        let url = prompt('🎬 Введите ссылку на YouTube видео:', 'https://www.youtube.com/watch?v=');
        if (!url?.trim()) return;
        let videoId = '';
        try {
            let u = new URL(url.trim());
            videoId = u.searchParams.get('v') || u.pathname.split('/').pop();
        } catch(e) {
            videoId = url.trim().split('v=')[1]?.split('&')[0] || '';
        }
        if (!videoId) {
            showNotification('❌ Неверная ссылка на YouTube', 'error');
            return;
        }
        let embedUrl = 'https://www.youtube.com/embed/' + escapeHtml(videoId);
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, `
            <div style="margin:24px 0;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,0.4);">
                <iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:16px;" 
                        frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen>
                </iframe>
            </div>
        `);
        showNotification('🎬 Видео добавлено', 'info');
    }

    function kbInsertTable() {
        let rows = parseInt(prompt('Количество строк:', '3')) || 3;
        let cols = parseInt(prompt('Количество столбцов:', '3')) || 3;
        if (rows < 1 || cols < 1 || rows > 10 || cols > 8) {
            showNotification('❌ Строк: 1-10, Столбцов: 1-8', 'error');
            return;
        }
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        let table = `<div style="overflow-x:auto;margin:24px 0;border-radius:16px;border:1px solid rgba(99,102,241,0.2);">
            <table style="width:100%;border-collapse:collapse;background:rgba(0,0,0,0.2);">`;
        for (let i = 0; i < rows; i++) {
            table += '<tr>';
            for (let j = 0; j < cols; j++) {
                let isHeader = i === 0;
                let tag = isHeader ? 'th' : 'td';
                let style = isHeader ? 'background:rgba(99,102,241,0.2);font-weight:600;color:#a78bfa;' : 'background:rgba(0,0,0,0.1);';
                table += `<${tag} style="border:1px solid rgba(99,102,241,0.1);padding:12px 16px;text-align:left;${style}">${isHeader ? 'Колонка ' + (j+1) : '—'}</${tag}>`;
            }
            table += '</tr>';
        }
        table += '</table></div>';
        document.execCommand('insertHTML', false, table);
        showNotification('📊 Таблица добавлена', 'info');
    }

    function kbInsertDivider() {
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false,
            '<hr style="margin:32px 0;border:none;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent);">'
        );
    }

    function kbInsertCallout(type) {
        let config = {
            info: { icon: 'ℹ️', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', title: 'Информация' },
            success: { icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.08)', title: 'Успешно' },
            warning: { icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', title: 'Внимание' },
            error: { icon: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', title: 'Ошибка' }
        };
        let c = config[type] || config.info;
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, `
            <div style="background:${c.bg};border-left:4px solid ${c.color};border-radius:16px;padding:16px 20px;margin:24px 0;display:flex;align-items:flex-start;gap:14px;">
                <span style="font-size:24px;flex-shrink:0;">${c.icon}</span>
                <div style="flex:1;color:#e2e8f0;">
                    <div style="font-weight:600;color:${c.color};margin-bottom:6px;font-size:15px;">${c.title}</div>
                    <div style="line-height:1.6;">Введите текст сообщения здесь...</div>
                </div>
            </div>
        `);
        showNotification(c.icon + ' Блок добавлен', 'info');
    }

    function kbInsertCodeBlock() {
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, `
            <div style="margin:24px 0;position:relative;">
                <div style="background:#0d1016;border-radius:16px;border:1px solid rgba(99,102,241,0.2);overflow:hidden;">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:rgba(99,102,241,0.1);border-bottom:1px solid rgba(99,102,241,0.2);">
                        <div style="display:flex;gap:8px;">
                            <span style="width:10px;height:10px;border-radius:50%;background:#ef4444;"></span>
                            <span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;"></span>
                            <span style="width:10px;height:10px;border-radius:50%;background:#10b981;"></span>
                        </div>
                        <span style="font-size:11px;color:#64748b;">JavaScript</span>
                        <button onclick="navigator.clipboard.writeText(this.closest('.kb-code-wrapper')?.querySelector('code')?.textContent || '');" 
                                style="background:transparent;border:1px solid rgba(99,102,241,0.3);color:#a78bfa;padding:4px 12px;border-radius:20px;font-size:11px;cursor:pointer;">
                            📋 Копировать
                        </button>
                    </div>
                    <div class="kb-code-wrapper" style="padding:20px;">
                        <pre style="margin:0;overflow-x:auto;"><code style="color:#e2e8f0;font-family:'JetBrains Mono','Fira Code','Courier New',monospace;font-size:13px;line-height:1.6;">// Введите ваш код здесь
function hello() {
    console.log("Привет, WARPOINT!");
}</code></pre>
                    </div>
                </div>
            </div>
        `);
        showNotification('💻 Блок кода добавлен', 'info');
    }

    function kbInsertChecklist() {
        let editor = getElement('kbEditorContent');
        if (!editor) return;
        editor.focus();
        document.execCommand('insertHTML', false, `
            <div style="margin:20px 0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:12px;">
                <input type="checkbox" style="width:18px;height:18px;cursor:pointer;accent-color:#a78bfa;">
                <span style="color:#e2e8f0;">Задача для выполнения</span>
            </div>
        `);
    }

    function cleanHTML(html) {
        if (!html) return '';
        let div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
        // Удаляем только пустые span без содержимого
        div.querySelectorAll('span').forEach(el => {
            if (!el.textContent.trim() && !el.querySelector('*')) {
                el.remove();
            }
        });
        // Удаляем пустые блоки без содержимого
        div.querySelectorAll('p, div').forEach(el => {
            if (!el.textContent.trim() && !el.querySelector('img, iframe, table, pre, hr, br')) {
                el.remove();
            }
        });
        return div.innerHTML;
    }

    // ============================================
    // ПОПУЛЯРНЫЕ СТАТЬИ
    // ============================================

    function getPopularArticles(limit = 5) {
        return state.articles
            .filter(a => (a.views || 0) > 0)
            .sort((a, b) => (b.views || 0) - (a.views || 0))
            .slice(0, limit);
    }

    function renderPopularArticles() {
        let popular = getPopularArticles(3);
        if (popular.length === 0) return '';
        return `
        <div class="kb-popular-header">
            <i class="fas fa-fire" style="color:#f59e0b;"></i>
            <span>Популярные статьи</span>
        </div>
        <div class="kb-popular-list">
            ${popular.map((article, idx) => {
                let author = article.created_by || 'Неизвестный';
                let category = state.categories.find(c => c.id === article.category_id);
                return `
                <div class="kb-popular-item" onclick="window.kbOpenArticle(${article.id})">
                    <div class="kb-popular-rank">#${idx + 1}</div>
                    <div class="kb-popular-info">
                        <div class="kb-popular-title">${escapeHtml(article.title)}</div>
                        <div class="kb-popular-meta">
                            <span><i class="fas fa-user"></i> ${escapeHtml(author)}</span>
                            <span><i class="fas fa-eye"></i> ${article.views || 0}</span>
                            ${category ? `<span style="color:${category.color || '#a78bfa'};">${category.icon} ${category.name}</span>` : ''}
                        </div>
                    </div>
                    <div class="kb-popular-views">${article.views || 0} 👁️</div>
                </div>
                `;
            }).join('')}
        </div>
        `;
    }

    // ============================================
    // ПРОСМОТР СТАТЬИ
    // ============================================

    async function openArticle(articleId) {
        let article = state.articles.find(a => a.id === articleId);
        if (!article) {
            showNotification('❌ Статья не найдена', 'error');
            return;
        }
        await trackArticleView(articleId);
        let category = state.categories.find(c => c.id === article.category_id);
        let likes = state.likes[articleId] || article.likes || 0;
        let liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        let canEdit = canManageArticles();

        let categoryEl = getElement('kbArticleCategory');
        let titleEl = getElement('kbArticleTitle');
        let authorEl = getElement('kbArticleAuthor');
        let dateEl = getElement('kbArticleDate');
        let timeEl = getElement('kbArticleTime');
        let viewsEl = getElement('kbArticleViews');
        let contentEl = getElement('kbArticleContent');
        let likeBtn = getElement('kbArticleLikeBtn');
        let editBtn = getElement('kbArticleEditBtn');

        if (categoryEl) categoryEl.textContent = (category?.icon || '📁') + ' ' + (category?.name || 'Без категории');
        if (titleEl) titleEl.textContent = article.title;
        if (authorEl) authorEl.innerHTML = '<i class="fas fa-user"></i> ' + escapeHtml(article.created_by || 'Неизвестный');
        if (dateEl) dateEl.innerHTML = '<i class="fas fa-calendar"></i> ' + formatDate(article.created_at);
        if (timeEl) timeEl.innerHTML = '<i class="fas fa-clock"></i> ' + formatTimeAgo(article.updated_at || article.created_at);
        if (viewsEl) viewsEl.innerHTML = '<i class="fas fa-eye"></i> ' + ((article.views || 0) + 1) + ' просмотров';
        if (contentEl) contentEl.innerHTML = article.content || '<p style="color:#64748b;text-align:center;padding:40px;">У этой статьи пока нет содержания</p>';

        if (likeBtn) {
            likeBtn.className = 'kb-like-btn ' + (liked ? 'liked' : '');
            likeBtn.innerHTML = (liked ? '❤️' : '🤍') + ' <span>' + (likes || 0) + '</span>';
            likeBtn.onclick = () => toggleLike(articleId);
        }
        if (editBtn) {
            editBtn.style.display = canEdit ? 'inline-flex' : 'none';
            editBtn.onclick = () => { closeArticle(); kbEditArticle(articleId); };
        }

        let modal = getElement('kbArticleModal');
        if (modal) modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Обработчик Escape
        let escHandler = function(e) {
            if (e.key === 'Escape') {
                closeArticle();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        // Сохраняем обработчик для удаления при закрытии
        modal._escHandler = escHandler;
    }

    function closeArticle() {
        let modal = getElement('kbArticleModal');
        if (modal) {
            if (modal._escHandler) {
                document.removeEventListener('keydown', modal._escHandler);
                delete modal._escHandler;
            }
            modal.classList.remove('active');
        }
        document.body.style.overflow = '';
    }

    // ============================================
    // РЕДАКТОР СТАТЬИ
    // ============================================

    function kbCreateArticle(categoryId) {
        state.editingArticleId = null;
        openEditor(categoryId, null);
    }

    function kbEditArticle(articleId) {
        state.editingArticleId = articleId;
        let article = state.articles.find(a => a.id === articleId);
        if (article) {
            openEditor(article.category_id, {
                id: article.id,
                title: article.title,
                content: cleanHTML(article.content || '')
            });
        }
    }

    function openEditor(categoryId, article) {
        let titleEl = getElement('kbEditorTitle');
        let titleInput = getElement('kbEditorArticleTitle');
        let contentEl = getElement('kbEditorContent');
        let deleteBtn = getElement('kbEditorDeleteBtn');
        let saveBtn = getElement('kbEditorSaveBtn');

        if (titleEl) titleEl.textContent = article ? '✏️ Редактировать статью' : '➕ Новая статья';
        if (titleInput) titleInput.value = article ? article.title : '';
        if (contentEl) contentEl.innerHTML = article?.content || '';
        if (deleteBtn) deleteBtn.style.display = article ? 'inline-flex' : 'none';
        if (saveBtn) {
            saveBtn.onclick = () => kbSaveArticle(categoryId);
        }

        let modal = getElement('kbEditorModal');
        if (modal) modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        setTimeout(() => kbInitEditor(contentEl), 200);

        let escHandler = function(e) {
            if (e.key === 'Escape') {
                closeEditor();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        if (modal) modal._escHandler = escHandler;
    }

    function closeEditor() {
        let modal = getElement('kbEditorModal');
        if (modal) {
            if (modal._escHandler) {
                document.removeEventListener('keydown', modal._escHandler);
                delete modal._escHandler;
            }
            modal.classList.remove('active');
        }
        document.body.style.overflow = '';
        state.editingArticleId = null;
    }

    async function kbSaveArticle(categoryId) {
        if (state.isSaving) return;
        let titleInput = getElement('kbEditorArticleTitle');
        let contentEl = getElement('kbEditorContent');
        let title = titleInput?.value.trim();
        let content = contentEl?.innerHTML || '';

        if (!title) {
            showNotification('❌ Введите заголовок', 'error');
            return;
        }
        content = cleanHTML(content);

        state.isSaving = true;
        let saveBtn = getElement('kbEditorSaveBtn');
        if (saveBtn) {
            saveBtn.textContent = '⏳ Сохранение...';
            saveBtn.disabled = true;
        }

        try {
            let response;
            if (state.editingArticleId) {
                response = await apiCall('/knowledge/articles/' + state.editingArticleId, 'PUT', { title, content });
            } else {
                if (!categoryId) {
                    showNotification('❌ Выберите категорию', 'error');
                    return;
                }
                response = await apiCall('/knowledge/articles', 'POST', { category_id: categoryId, title, content });
            }
            if (response?.success) {
                showNotification(state.editingArticleId ? '✅ Статья обновлена' : '✅ Статья создана', 'success');
                closeEditor();
                await loadKnowledgeData();
            } else {
                showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
            }
        } catch (e) {
            showNotification('❌ ' + (e.message || 'Ошибка'), 'error');
        } finally {
            state.isSaving = false;
            if (saveBtn) {
                saveBtn.textContent = state.editingArticleId ? '💾 Сохранить' : '➕ Создать';
                saveBtn.disabled = false;
            }
        }
    }

    async function kbDeleteArticle(articleId) {
        if (!canManageArticles()) {
            showNotification('❌ Нет прав', 'error');
            return;
        }
        if (!confirm('Удалить эту статью?')) return;
        let response = await apiCall('/knowledge/articles/' + articleId, 'DELETE');
        if (response?.success) {
            showNotification('🗑️ Статья удалена', 'warning');
            closeEditor();
            closeArticle();
            await loadKnowledgeData();
        } else {
            showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }

    function kbDeleteArticleConfirm(articleId) {
        if (confirm('Удалить эту статью?')) kbDeleteArticle(articleId);
    }

    // ============================================
    // КАТЕГОРИИ
    // ============================================

    function kbOpenCreateCategory() {
        state.editingCategoryId = null;
        openCategoryModal(null, null);
    }

    function kbOpenEditCategory(id, name, icon) {
        state.editingCategoryId = id;
        openCategoryModal(name, icon);
    }

    function openCategoryModal(name, icon) {
        let titleEl = getElement('kbCategoryModalTitle');
        let nameInput = getElement('kbCategoryName');
        let iconInput = getElement('kbCategoryIcon');
        let picker = getElement('kbIconPicker');

        if (titleEl) titleEl.textContent = state.editingCategoryId ? '✏️ Редактировать категорию' : '➕ Новая категория';
        if (nameInput) nameInput.value = name || '';
        if (iconInput) iconInput.value = icon || '📁';

        let iconList = ['📁','📖','📜','❓','💡','🔧','⚙️','🎮','🏆','⭐','🔥','✅','❌','⚠️','ℹ️','📅','🎧','📡','🧹','👋','💬','🎫','🆕','💰','📊','🌍','📢','🤝','🎯','🎂'];
        if (picker) {
            picker.innerHTML = iconList.map(ic => `
                <div class="kb-icon-option ${ic === (icon || '📁') ? 'selected' : ''}" data-icon="${ic}" onclick="window.kbSelectIcon('${ic}')">${ic}</div>
            `).join('');
        }

        let modal = getElement('kbCategoryModal');
        if (modal) modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        let escHandler = function(e) {
            if (e.key === 'Escape') {
                closeCategoryModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        if (modal) modal._escHandler = escHandler;
    }

    function closeCategoryModal() {
        let modal = getElement('kbCategoryModal');
        if (modal) {
            if (modal._escHandler) {
                document.removeEventListener('keydown', modal._escHandler);
                delete modal._escHandler;
            }
            modal.classList.remove('active');
        }
        document.body.style.overflow = '';
        state.editingCategoryId = null;
    }

    function kbSelectIcon(icon) {
        let iconInput = getElement('kbCategoryIcon');
        if (iconInput) iconInput.value = icon;
        document.querySelectorAll('.kb-icon-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.icon === icon);
        });
    }

    async function kbSaveCategory() {
        let nameInput = getElement('kbCategoryName');
        let iconInput = getElement('kbCategoryIcon');
        let name = nameInput?.value.trim();
        let icon = iconInput?.value || '📁';

        if (!name) {
            showNotification('❌ Введите название', 'error');
            return;
        }

        let response;
        if (state.editingCategoryId) {
            response = await apiCall('/knowledge/categories/' + state.editingCategoryId, 'PUT', { name, icon });
        } else {
            response = await apiCall('/knowledge/categories', 'POST', { name, icon });
        }

        if (response?.success) {
            showNotification(state.editingCategoryId ? '✅ Категория обновлена' : '✅ Категория создана', 'success');
            closeCategoryModal();
            await loadKnowledgeData();
        } else {
            showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }

    async function kbDeleteCategory(categoryId) {
        if (!canManageCategories()) {
            showNotification('❌ Нет прав', 'error');
            return;
        }
        if (!confirm('Удалить категорию и все статьи в ней?')) return;
        let response = await apiCall('/knowledge/categories/' + categoryId, 'DELETE');
        if (response?.success) {
            showNotification('🗑️ Категория удалена', 'warning');
            await loadKnowledgeData();
        } else {
            showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }

    // ============================================
    // ПРЕСЕТЫ КАТЕГОРИЙ
    // ============================================

    function kbShowPresets() {
        let presetCategories = [
            { icon: '⚔️', name: 'Мясорубка' }, { icon: '👥', name: 'Командный бой' },
            { icon: '🔫', name: 'Свободная игра' }, { icon: '🧟', name: 'Кооператив' },
            { icon: '👤', name: 'VR-станция' }, { icon: '🎢', name: 'VR-экстрим' },
            { icon: '🏆', name: 'Турниры' }, { icon: '🎯', name: 'Тактика' },
            { icon: '🎂', name: 'День рождения' }, { icon: '🏢', name: 'Корпоратив' },
            { icon: '🎧', name: 'VR-шлемы' }, { icon: '🎮', name: 'Контроллеры' },
            { icon: '📡', name: 'Wi-Fi' }, { icon: '🧹', name: 'Дезинфекция' },
            { icon: '👋', name: 'Встреча' }, { icon: '💬', name: 'Скрипты' },
            { icon: '🎫', name: 'Бронирования' }, { icon: '🆕', name: 'Онбординг' },
            { icon: '📜', name: 'Правила' }, { icon: '💰', name: 'Финансы' }
        ];
        let grid = getElement('kbPresetGrid');
        if (grid) {
            grid.innerHTML = presetCategories.map(cat => `
                <div class="kb-preset-item" onclick="window.kbCreatePresetCategory('${escapeHtml(cat.name)}','${cat.icon}')">
                    <div class="kb-preset-item-icon">${cat.icon}</div>
                    <div class="kb-preset-item-name">${escapeHtml(cat.name)}</div>
                </div>
            `).join('');
        }

        let modal = getElement('kbPresetModal');
        if (modal) modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        let escHandler = function(e) {
            if (e.key === 'Escape') {
                closePresets();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        if (modal) modal._escHandler = escHandler;
    }

    function closePresets() {
        let modal = getElement('kbPresetModal');
        if (modal) {
            if (modal._escHandler) {
                document.removeEventListener('keydown', modal._escHandler);
                delete modal._escHandler;
            }
            modal.classList.remove('active');
        }
        document.body.style.overflow = '';
    }

    async function kbCreatePresetCategory(name, icon) {
        let exists = state.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            showNotification('❌ Категория "' + name + '" уже существует!', 'error');
            return;
        }
        let response = await apiCall('/knowledge/categories', 'POST', { name, icon });
        if (response?.success) {
            showNotification('✅ Категория "' + name + '" создана', 'success');
            await loadKnowledgeData();
        } else {
            showNotification('❌ Ошибка при создании', 'error');
        }
    }

    async function kbCreateAllPresets() {
        let presetCategories = [
            { icon: '⚔️', name: 'Мясорубка' }, { icon: '👥', name: 'Командный бой' },
            { icon: '🔫', name: 'Свободная игра' }, { icon: '🧟', name: 'Кооператив' },
            { icon: '👤', name: 'VR-станция' }, { icon: '🎢', name: 'VR-экстрим' },
            { icon: '🏆', name: 'Турниры' }, { icon: '🎯', name: 'Тактика' },
            { icon: '🎂', name: 'День рождения' }, { icon: '🏢', name: 'Корпоратив' },
            { icon: '🎧', name: 'VR-шлемы' }, { icon: '🎮', name: 'Контроллеры' },
            { icon: '📡', name: 'Wi-Fi' }, { icon: '🧹', name: 'Дезинфекция' },
            { icon: '👋', name: 'Встреча' }, { icon: '💬', name: 'Скрипты' },
            { icon: '🎫', name: 'Бронирования' }, { icon: '🆕', name: 'Онбординг' },
            { icon: '📜', name: 'Правила' }, { icon: '💰', name: 'Финансы' }
        ];
        let created = 0, skipped = 0;
        showNotification('⏳ Создание категорий...', 'info');
        for (let cat of presetCategories) {
            let exists = state.categories.some(c => c.name.toLowerCase() === cat.name.toLowerCase());
            if (exists) { skipped++; continue; }
            let response = await apiCall('/knowledge/categories', 'POST', { name: cat.name, icon: cat.icon });
            if (response?.success) created++;
            await new Promise(r => setTimeout(r, 20));
        }
        showNotification('✅ Создано: ' + created + ', Пропущено: ' + skipped, created > 0 ? 'success' : 'info');
        await loadKnowledgeData();
        closePresets();
    }

    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================

    async function loadKnowledgeData() {
        if (state.isLoading) return;
        state.isLoading = true;
        let container = getElement('knowledgeContainer');
        if (container) {
            container.innerHTML = '<div class="kb-loading"><div class="kb-spinner"></div><p>Загрузка базы знаний...</p></div>';
        }

        try {
            let categoriesRes = await apiCall('/knowledge/categories');
            let articlesRes = await apiCall('/knowledge/articles');

            if (!categoriesRes.success || !articlesRes.success) {
                throw new Error(categoriesRes.error || articlesRes.error || 'API вернул ошибку');
            }

            state.categories = categoriesRes.data || [];
            state.articles = articlesRes.data || [];
            renderKnowledge();
        } catch (err) {
            console.error('❌ load error:', err);
            if (container) {
                container.innerHTML = `
                    <div class="kb-empty-state">
                        <div class="kb-empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <h3>Ошибка загрузки</h3>
                        <p>${err.message}</p>
                        <button class="btn-primary" onclick="loadKnowledgeData()">🔄 Повторить</button>
                    </div>
                `;
            }
            showNotification('❌ Ошибка загрузки базы знаний', 'error');
        } finally {
            state.isLoading = false;
        }
    }

    // ============================================
    // РЕНДЕР
    // ============================================

    function renderKnowledge() {
        let container = getElement('knowledgeContainer');
        if (!container) return;

        let filteredArticles = state.articles.slice();
        if (state.searchQuery) {
            filteredArticles = filteredArticles.filter(a =>
                (a.title && a.title.toLowerCase().includes(state.searchQuery)) ||
                (a.content && a.content.toLowerCase().includes(state.searchQuery))
            );
        }

        let popularHtml = renderPopularArticles();
        let popularSection = getElement('kbPopularSection');
        if (popularSection) {
            popularSection.innerHTML = popularHtml;
            popularSection.style.display = popularHtml ? 'block' : 'none';
        }

        let categoriesWithArticles = state.categories.map(cat => ({
            ...cat,
            articles: filteredArticles.filter(a => a.category_id === cat.id)
        }));
        let canEditCategories = canManageCategories();
        let canEditArticles = canManageArticles();

        let actionBtns = getElement('actionButtons');
        if (actionBtns) {
            if (canEditCategories) {
                actionBtns.innerHTML = `
                    <button class="btn-secondary" onclick="window.kbOpenCreateCategory()"><i class="fas fa-folder-plus"></i> Новая категория</button>
                    <button class="btn-secondary" onclick="window.kbShowPresets()"><i class="fas fa-magic"></i> Готовые категории</button>
                `;
            } else if (canEditArticles) {
                actionBtns.innerHTML = '<span style="font-size:12px;color:#64748b;"><i class="fas fa-info-circle"></i> Вы можете добавлять статьи</span>';
            } else {
                actionBtns.innerHTML = '';
            }
        }

        if (state.categories.length === 0) {
            if (canEditCategories) {
                container.innerHTML = `
                    <div class="kb-empty-state">
                        <div class="kb-empty-state-icon">📂</div>
                        <h3>База знаний пуста</h3>
                        <p>Создайте первую категорию, чтобы начать</p>
                        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                            <button class="btn-secondary" onclick="window.kbOpenCreateCategory()"><i class="fas fa-folder-plus"></i> Новая категория</button>
                            <button class="btn-secondary" onclick="window.kbShowPresets()"><i class="fas fa-magic"></i> Готовые категории</button>
                        </div>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="kb-empty-state">
                        <div class="kb-empty-state-icon"><i class="fas fa-folder-open"></i></div>
                        <h3>База знаний пуста</h3>
                        <p>Категории ещё не созданы. Обратитесь к руководителю.</p>
                    </div>
                `;
            }
            return;
        }

        let html = '';
        for (let cat of categoriesWithArticles) {
            let hasArticles = cat.articles.length > 0;
            html += `
            <div class="kb-category-card" data-category-id="${cat.id}">
                <div class="kb-category-header" onclick="window.kbToggleCategory(${cat.id})">
                    <div class="kb-category-title-group">
                        <div class="kb-category-icon-box">${cat.icon || '📁'}</div>
                        <span class="kb-category-name">${escapeHtml(cat.name)}</span>
                        <span class="kb-category-count">${cat.articles.length}</span>
                    </div>
                    <div class="kb-category-actions-group">
                        ${canEditCategories ? `<button class="kb-category-edit-btn" onclick="event.stopPropagation();window.kbOpenEditCategory(${cat.id},'${escapeHtml(cat.name)}','${escapeHtml(cat.icon || '📁')}')" title="Редактировать"><i class="fas fa-edit"></i></button>` : ''}
                        ${canEditCategories ? `<button class="kb-category-delete-btn" onclick="event.stopPropagation();window.kbDeleteCategory(${cat.id})" title="Удалить"><i class="fas fa-trash-alt"></i></button>` : ''}
                        <span class="kb-category-arrow"><i class="fas fa-chevron-down"></i></span>
                    </div>
                </div>
                <div class="kb-category-body">`;
            if (hasArticles) {
                for (let article of cat.articles) {
                    html += `
                    <div class="kb-article-item" data-article-id="${article.id}">
                        <div class="kb-article-item-info">
                            <div class="kb-article-item-title"><i class="fas fa-file-alt"></i> ${escapeHtml(article.title)}</div>
                            <div class="kb-article-item-meta">
                                <span><i class="fas fa-eye"></i> ${article.views || 0}</span>
                                <span><i class="fas fa-calendar-alt"></i> ${formatDate(article.created_at)}</span>
                            </div>
                        </div>
                        <div class="kb-article-item-actions">
                            ${canEditArticles ? `<button class="kb-article-edit-btn" onclick="event.stopPropagation();window.kbEditArticle(${article.id})"><i class="fas fa-edit"></i></button>` : ''}
                            ${canEditArticles ? `<button class="kb-article-delete-btn" onclick="event.stopPropagation();window.kbDeleteArticle(${article.id})"><i class="fas fa-trash-alt"></i></button>` : ''}
                        </div>
                    </div>
                    `;
                }
            } else {
                html += '<div style="padding:16px;text-align:center;color:#64748b;font-size:14px;"><i class="fas fa-info-circle"></i> В этой категории пока нет статей</div>';
            }
            if (canEditArticles) {
                html += `<div style="margin-top:8px;"><button class="btn-secondary" onclick="event.stopPropagation();window.kbCreateArticle(${cat.id})" style="padding:10px 18px;font-size:13px;width:100%;"><i class="fas fa-plus"></i> Добавить статью</button></div>`;
            }
            html += '</div></div>';
        }
        container.innerHTML = html;

        try {
            let openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');
            openCategories.forEach(catId => {
                let card = document.querySelector(`.kb-category-card[data-category-id="${catId}"]`);
                let body = card?.querySelector('.kb-category-body');
                let arrow = card?.querySelector('.kb-category-arrow i');
                if (body) body.style.display = 'flex';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            });
        } catch(e) {}
    }

    function kbToggleCategory(categoryId) {
        let card = document.querySelector(`.kb-category-card[data-category-id="${categoryId}"]`);
        let body = card?.querySelector('.kb-category-body');
        let arrow = card?.querySelector('.kb-category-arrow i');
        if (!body) return;

        let openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');

        if (body.style.display === 'none' || body.style.display === '') {
            body.style.display = 'flex';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
            if (!openCategories.includes(categoryId)) openCategories.push(categoryId);
        } else {
            body.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
            openCategories = openCategories.filter(id => id !== categoryId);
        }
        localStorage.setItem('knowledgeOpenCategories', JSON.stringify(openCategories));
    }

    // ============================================
    // УТИЛИТЫ
    // ============================================

    async function loadTools() {
        if (state.toolsLoaded) {
            renderTools();
            return;
        }
        let grid = getElement('toolsGrid');
        if (grid) {
            grid.innerHTML = '<div class="kb-loading"><div class="kb-spinner"></div><p>Загрузка утилит...</p></div>';
        }

        try {
            let response = await apiCall('/tools');
            if (response?.success) {
                state.tools = response.tools || [];
                state.toolsLoaded = true;
                renderTools();
            } else {
                throw new Error(response.error || 'Ошибка загрузки утилит');
            }
        } catch (err) {
            if (grid) {
                grid.innerHTML = `
                    <div class="kb-empty-state">
                        <div class="kb-empty-state-icon"><i class="fas fa-wrench"></i></div>
                        <h3>Утилиты не загружены</h3>
                        <p>${err.message}</p>
                        <button class="btn-primary" onclick="loadTools()">🔄 Повторить</button>
                    </div>
                `;
            }
            showNotification('❌ ' + err.message, 'error');
        }
    }

    function renderTools() {
        let grid = getElement('toolsGrid');
        if (!grid) return;

        let filtered = state.tools;
        if (state.toolsFilter !== 'all') {
            filtered = filtered.filter(t => {
                let ext = t.name.split('.').pop().toLowerCase();
                if (state.toolsFilter === 'exe') return ext === 'exe';
                if (state.toolsFilter === 'msi') return ext === 'msi';
                if (state.toolsFilter === 'bat') return ext === 'bat' || ext === 'cmd';
                if (state.toolsFilter === 'url') return t.path?.startsWith('http');
                return true;
            });
        }
        if (state.toolsSearch) {
            filtered = filtered.filter(t => t.name.toLowerCase().includes(state.toolsSearch.toLowerCase()));
        }

        let countEl = getElement('toolsCount');
        let sizeEl = getElement('toolsTotalSize');
        if (countEl) countEl.textContent = filtered.length;
        let totalSize = filtered.reduce((sum, t) => sum + (t.size || 0), 0);
        if (sizeEl) sizeEl.textContent = totalSize > 0 ? (totalSize / 1024).toFixed(1) + ' KB' : '0 KB';

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="kb-empty-state">
                    <div class="kb-empty-state-icon"><i class="fas fa-search"></i></div>
                    <h3>Утилиты не найдены</h3>
                    <p>Попробуйте изменить фильтры или добавьте новую утилиту</p>
                </div>
            `;
            return;
        }

        let html = filtered.map(tool => {
            let icon = '📁';
            let ext = tool.name.split('.').pop().toLowerCase();
            let isLink = tool.path?.startsWith('http');
            let badge = isLink ? 'badge-link' : 'badge-server';
            let badgeText = isLink ? '🌐 Ссылка' : '💾 Файл';
            let btnClass = isLink ? 'btn-launch-link' : 'btn-launch';
            let btnText = isLink ? '🌐 Перейти' : '⬇️ Скачать';
            let href = isLink ? tool.path : tool.path;
            let download = isLink ? '' : 'download';

            if (ext === 'exe') icon = '💻';
            else if (ext === 'msi') icon = '📦';
            else if (ext === 'bat' || ext === 'cmd') icon = '📜';
            else if (isLink) icon = '🌐';
            else if (ext === 'pdf') icon = '📄';
            else if (ext === 'zip' || ext === 'rar' || ext === '7z') icon = '🗜️';
            else if (['png','jpg','jpeg','gif','webp'].includes(ext)) icon = '🖼️';

            return `
            <div class="tool-card">
                <div class="tool-card-icon">${icon}</div>
                <div class="tool-badge ${badge}">${badgeText}</div>
                <div class="tool-card-name">${escapeHtml(tool.name)}</div>
                <div class="tool-card-meta">
                    <span>📅 ${formatDate(tool.uploadedAt)}</span>
                    ${tool.size ? `<span>📦 ${(tool.size / 1024).toFixed(1)} KB</span>` : ''}
                </div>
                <div class="tool-card-actions">
                    <a href="${href}" ${download} target="_blank" class="btn-launch ${btnClass}">${btnText}</a>
                    ${canManageTools() ? `<button class="btn-delete-tool" onclick="window.kbDeleteTool('${tool.name}')"><i class="fas fa-trash-alt"></i></button>` : ''}
                </div>
            </div>
            `;
        }).join('');

        grid.innerHTML = html;
    }

    async function kbDeleteTool(filename) {
        if (!canManageTools()) {
            showNotification('❌ Нет прав', 'error');
            return;
        }
        if (!confirm(`Удалить утилиту "${filename}"?`)) return;
        let response = await apiCall('/tools/' + filename, 'DELETE');
        if (response?.success) {
            showNotification('🗑️ Утилита удалена', 'warning');
            state.tools = state.tools.filter(t => t.name !== filename);
            renderTools();
        } else {
            showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }

    async function kbUploadTool() {
    let nameInput = getElement('toolName');
    let descInput = getElement('toolDesc');
    let typeSelect = getElement('toolType');
    let fileInput = getElement('toolFileInput');
    let urlInput = getElement('toolPath');

    let name = nameInput?.value.trim();
    let desc = descInput?.value.trim();
    let type = typeSelect?.value;

    if (!name) {
        showNotification('❌ Введите название утилиты', 'error');
        return;
    }

    let formData = new FormData();
    formData.append('name', name);
    if (desc) formData.append('description', desc);
    formData.append('type', type);

    if (type === 'url') {
        let url = urlInput?.value.trim();
        if (!url || !url.startsWith('http')) {
            showNotification('❌ Введите корректную ссылку', 'error');
            return;
        }
        formData.append('url', url);
    } else {
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showNotification('❌ Выберите файл', 'error');
            return;
        }
        // ✨ Ограничиваем размер файла до 5 МБ
        if (fileInput.files[0].size > 5 * 1024 * 1024) {
            showNotification('❌ Файл слишком большой (макс. 5 МБ)', 'error');
            return;
        }
        formData.append('file', fileInput.files[0]);
    }

    let token = getToken();
    try {
        // ✨ Добавляем таймаут и явный Content-Type
        let response = await fetch('/api/tools/upload', {
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + token
                // НЕ указываем Content-Type — браузер сам добавит с boundary
            },
            body: formData,
            signal: AbortSignal.timeout(30000) // 30 секунд таймаут
        });
        
        if (!response.ok) {
            let text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
        }
        
        let result = await response.json();
        if (result.success) {
            showNotification('✅ Утилита загружена', 'success');
            closeUploadModal();
            state.toolsLoaded = false;
            await loadTools();
        } else {
            showNotification('❌ ' + (result.error || 'Ошибка'), 'error');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            showNotification('❌ Таймаут загрузки. Попробуйте файл меньше 5 МБ.', 'error');
        } else {
            showNotification('❌ Ошибка загрузки: ' + e.message, 'error');
        }
        console.error('Upload error:', e);
    }
}

    function setupToolsUpload() {
        let typeSelect = getElement('toolType');
        let toolFileGroup = getElement('toolFileGroup');
        let toolUrlGroup = getElement('toolUrlGroup');
        let dropZone = getElement('toolDropZone');
        let fileInput = getElement('toolFileInput');
        let uploadBtn = getElement('uploadToolBtn');
        let closeBtn = getElement('uploadToolCloseBtn');
        let cancelBtn = getElement('uploadToolCancelBtn');
        let saveBtn = getElement('uploadToolSaveBtn');

        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                let isUrl = this.value === 'url';
                if (toolFileGroup) toolFileGroup.style.display = isUrl ? 'none' : 'block';
                if (toolUrlGroup) toolUrlGroup.style.display = isUrl ? 'block' : 'none';
            });
        }

        if (dropZone && fileInput) {
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = '#10b981';
                dropZone.style.background = 'rgba(16,185,129,0.08)';
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.style.borderColor = 'rgba(99,102,241,0.25)';
                dropZone.style.background = '';
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = 'rgba(99,102,241,0.25)';
                dropZone.style.background = '';
                if (e.dataTransfer.files.length) {
                    fileInput.files = e.dataTransfer.files;
                    updateFileInfo();
                }
            });
            fileInput.addEventListener('change', updateFileInfo);
        }

        function updateFileInfo() {
            let file = fileInput?.files[0];
            let info = getElement('toolFileInfo');
            if (info) {
                if (file) {
                    info.style.display = 'block';
                    info.textContent = `✅ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
                } else {
                    info.style.display = 'none';
                }
            }
        }

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                let modal = getElement('uploadToolModal');
                if (modal) modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeUploadModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeUploadModal);
        if (saveBtn) saveBtn.addEventListener('click', kbUploadTool);
    }

    function closeUploadModal() {
        let modal = getElement('uploadToolModal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        let nameInput = getElement('toolName');
        let descInput = getElement('toolDesc');
        let fileInput = getElement('toolFileInput');
        let urlInput = getElement('toolPath');
        let info = getElement('toolFileInfo');
        if (nameInput) nameInput.value = '';
        if (descInput) descInput.value = '';
        if (fileInput) fileInput.value = '';
        if (urlInput) urlInput.value = '';
        if (info) info.style.display = 'none';
    }

    function setupToolsSearch() {
        let searchInput = getElement('toolsSearch');
        let filterSelect = getElement('toolsFilterType');

        if (searchInput) {
            searchInput.addEventListener('input', debounce(function() {
                state.toolsSearch = this.value;
                renderTools();
            }, 300));
        }
        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                state.toolsFilter = this.value;
                renderTools();
            });
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // ============================================
    // ПОИСК СТАТЕЙ
    // ============================================

    function setupSearch() {
        let searchInput = getElement('knowledgeSearch');
        let clearBtn = getElement('clearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', debounce(function() {
                state.searchQuery = this.value.toLowerCase();
                renderKnowledge();
                if (clearBtn) {
                    clearBtn.style.display = this.value ? 'block' : 'none';
                }
            }, 300));
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                if (searchInput) {
                    searchInput.value = '';
                    state.searchQuery = '';
                    renderKnowledge();
                    clearBtn.style.display = 'none';
                }
            });
        }
    }

    // ============================================
    // ВКЛАДКИ
    // ============================================

    function setupTabs() {
        let tabBtns = document.querySelectorAll('.kb-tab-btn');
        let panels = {
            articles: getElement('kbPanelArticles'),
            tools: getElement('kbPanelTools')
        };

        tabBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                let tab = this.dataset.tab;
                tabBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                Object.keys(panels).forEach(key => {
                    if (panels[key]) {
                        panels[key].style.display = key === tab ? 'block' : 'none';
                    }
                });
                if (tab === 'tools') loadTools();
            });
        });
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================

    function initKnowledge() {
        if (state.isInitialized) return;
        console.log('📚 Инициализация базы знаний');

        setupSearch();
        setupTabs();
        setupToolsSearch();
        setupToolsUpload();
        loadKnowledgeData();
        loadTools();

        let closeHandlers = [
            { id: 'kbArticleCloseBtn', handler: closeArticle },
            { id: 'kbArticleCloseFooterBtn', handler: closeArticle },
            { id: 'kbEditorCloseBtn', handler: closeEditor },
            { id: 'kbEditorCancelBtn', handler: closeEditor },
            { id: 'kbEditorDeleteBtn', handler: () => {
                if (state.editingArticleId) kbDeleteArticleConfirm(state.editingArticleId);
            }},
            { id: 'kbCategoryCloseBtn', handler: closeCategoryModal },
            { id: 'kbCategoryCancelBtn', handler: closeCategoryModal },
            { id: 'kbCategorySaveBtn', handler: kbSaveCategory },
            { id: 'kbPresetCloseBtn', handler: closePresets },
            { id: 'kbPresetCancelBtn', handler: closePresets },
            { id: 'kbPresetAddAllBtn', handler: kbCreateAllPresets }
        ];

        closeHandlers.forEach(({ id, handler }) => {
            let el = getElement(id);
            if (el) el.addEventListener('click', handler);
        });

        document.querySelectorAll('.kb-modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('active');
                    document.body.style.overflow = '';
                    // Удаляем обработчики Escape
                    if (this._escHandler) {
                        document.removeEventListener('keydown', this._escHandler);
                        delete this._escHandler;
                    }
                }
            });
        });

        state.isInitialized = true;
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    window.initKnowledge = initKnowledge;
    window.kbExec = kbExec;
    window.kbInitEditor = kbInitEditor;
    window.kbToggleEmoji = kbToggleEmoji;
    window.kbInsertEmoji = kbInsertEmoji;
    window.kbInsertLink = kbInsertLink;
    window.kbInsertImage = kbInsertImage;
    window.kbInsertVideo = kbInsertVideo;
    window.kbInsertTable = kbInsertTable;
    window.kbInsertDivider = kbInsertDivider;
    window.kbInsertCallout = kbInsertCallout;
    window.kbInsertCodeBlock = kbInsertCodeBlock;
    window.kbInsertChecklist = kbInsertChecklist;
    window.kbOpenArticle = openArticle;
    window.kbCloseArticle = closeArticle;
    window.kbToggleLike = toggleLike;
    window.kbToggleCategory = kbToggleCategory;
    window.kbCreateArticle = kbCreateArticle;
    window.kbEditArticle = kbEditArticle;
    window.kbCloseArticleEdit = closeEditor;
    window.kbSaveArticle = kbSaveArticle;
    window.kbDeleteArticle = kbDeleteArticle;
    window.kbDeleteArticleConfirm = kbDeleteArticleConfirm;
    window.kbOpenCreateCategory = kbOpenCreateCategory;
    window.kbOpenEditCategory = kbOpenEditCategory;
    window.kbSelectIcon = kbSelectIcon;
    window.kbCloseCategory = closeCategoryModal;
    window.kbSaveCategory = kbSaveCategory;
    window.kbDeleteCategory = kbDeleteCategory;
    window.kbShowPresets = kbShowPresets;
    window.kbClosePresets = closePresets;
    window.kbCreatePresetCategory = kbCreatePresetCategory;
    window.kbCreateAllPresets = kbCreateAllPresets;
    window.loadKnowledgeData = loadKnowledgeData;
    window.renderKnowledge = renderKnowledge;
    window.loadTools = loadTools;
    window.renderTools = renderTools;
    window.kbDeleteTool = kbDeleteTool;
    window.kbUploadTool = kbUploadTool;
    window.closeUploadModal = closeUploadModal;

    console.log('✅ knowledge.js v9.0 загружен — все исправления учтены');
})();