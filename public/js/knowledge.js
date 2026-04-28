// public/js/knowledge.js — ПРЕМИУМ РЕДАКТОР v3.0
// WYSIWYG редактор + лайки + просмотры + популярные статьи
// Вдохновлён: TipTap, Editor.js, Medium, Notion

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
    let articleLikes = {};

    function resetKnowledgeState() {
        knowledgeInitialized = false;
        editingArticleId = null;
        editingCategoryId = null;
        activeEditor = null;
    }

    function canManageCategories() {
        var role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager';
    }

    function canManageArticles() {
        var role = window.app?.currentUserRole;
        return role === 'director' || role === 'manager' || role === 'admin' || role === 'operator';
    }

    function escapeHtml(str) {
        if (!str) return '';
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
        return String(str).replace(/[&<>"'/]/g, function(m) { return map[m]; });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        var now = new Date();
        var date = new Date(dateStr);
        var diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'только что';
        if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
        if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
        if (diff < 2592000) return Math.floor(diff / 86400) + ' дн назад';
        return formatDate(dateStr);
    }

    function showNotification(message, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(message, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(message, type);
        } else {
            console.log('[' + type + '] ' + message);
        }
    }

    async function apiCall(endpoint, method, body) {
        if (method === undefined) method = 'GET';
        if (body === undefined) body = null;
        if (typeof window.originalApiCall === 'function') return window.originalApiCall(endpoint, method, body);
        if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) return window.apiCall(endpoint, method, body);
        var token = localStorage.getItem('token');
        var options = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        if (body) options.body = JSON.stringify(body);
        try {
            var response = await fetch('/api' + endpoint, options);
            return await response.json();
        } catch (e) {
            console.error('Fetch error:', e);
            return { success: false, error: 'Ошибка соединения' };
        }
    }

    function canCountView(articleId) {
        var key = 'kb_view_' + articleId;
        var lastView = parseInt(localStorage.getItem(key) || '0');
        var now = Date.now();
        var oneHour = 60 * 60 * 1000;
        if (now - lastView > oneHour) {
            localStorage.setItem(key, now.toString());
            return true;
        }
        return false;
    }

    async function trackArticleView(articleId) {
        if (!canCountView(articleId)) return;
        try {
            await apiCall('/knowledge/articles/' + articleId + '/view', 'POST');
            var article = knowledgeArticles.find(function(a) { return a.id === articleId; });
            if (article) article.views = (article.views || 0) + 1;
        } catch (e) {}
    }

    async function toggleLike(articleId) {
        var key = 'kb_like_' + articleId;
        var liked = localStorage.getItem(key) === 'true';
        try {
            var response = await apiCall('/knowledge/articles/' + articleId + '/like', 'POST', { like: !liked });
            if (response && response.success) {
                localStorage.setItem(key, (!liked).toString());
                articleLikes[articleId] = response.likes || 0;
                renderKnowledge();
                showNotification(liked ? '💔 Лайк убран' : '❤️ Статья понравилась!', 'success');
            }
        } catch (e) {
            showNotification('❌ Ошибка', 'error');
        }
    }

    function getEmojiList() {
        var emojis = [
            '😀','😂','🤣','😍','🥰','😘','😎','🤩','😤','😢','😡','😱','🤔','😴',
            '👍','👎','👏','🙌','💪','🤝','🎉','🔥','💯','✅','❌','⭐','🌟','🎮',
            '🛒','💰','📅','📋','🏆','👑','🎁','🔄','📚','💡','🔧','⚙️','📸','📝',
            '🎯','🚀','🎂','☕','🧹','📱','💻','🖥️','🎧','🎬','📊','📈','🔒','🔑',
            '❤️','💔','🫶','🤌','🫡','🥇','🥈','🥉','🏅','🎖️','🔔','💬','🗨️','📢'
        ];
        return emojis.map(function(e) {
            return '<span class="kb-emoji-item" onclick="window.kbInsertEmoji(\'' + e + '\')" title="' + e + '">' + e + '</span>';
        }).join('');
    }

    function renderEditorToolbar() {
        return '' +
        '<div class="kb-editor-toolbar" id="kbEditorToolbar">' +
            '<div class="kb-toolbar-row">' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbExec(\'bold\')" title="Жирный (Ctrl+B)" class="kb-toolbar-btn"><b>B</b></button>' +
                    '<button onclick="window.kbExec(\'italic\')" title="Курсив (Ctrl+I)" class="kb-toolbar-btn"><i>I</i></button>' +
                    '<button onclick="window.kbExec(\'underline\')" title="Подчёркнутый (Ctrl+U)" class="kb-toolbar-btn"><u>U</u></button>' +
                    '<button onclick="window.kbExec(\'strikeThrough\')" title="Зачёркнутый" class="kb-toolbar-btn"><s>S</s></button>' +
                    '<button onclick="window.kbExec(\'removeFormat\')" title="Очистить формат" class="kb-toolbar-btn"><i class="fas fa-eraser"></i></button>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<select onchange="window.kbExec(\'formatBlock\', this.value)" class="kb-toolbar-select">' +
                        '<option value="p">📝 Параграф</option>' +
                        '<option value="h1">H1 Заголовок</option>' +
                        '<option value="h2">H2 Заголовок</option>' +
                        '<option value="h3">H3 Подзаголовок</option>' +
                        '<option value="h4">H4 Заголовок</option>' +
                        '<option value="pre">💻 Код</option>' +
                        '<option value="blockquote">💬 Цитата</option>' +
                    '</select>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<select onchange="window.kbExec(\'fontSize\', this.value)" class="kb-toolbar-select kb-select-sm">' +
                        '<option value="1">8px</option>' +
                        '<option value="2">10px</option>' +
                        '<option value="3">12px</option>' +
                        '<option value="4" selected>14px</option>' +
                        '<option value="5">18px</option>' +
                        '<option value="6">24px</option>' +
                        '<option value="7">36px</option>' +
                    '</select>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<input type="color" onchange="window.kbExec(\'foreColor\', this.value)" value="#e2e8f0" title="Цвет текста" class="kb-color-picker">' +
                    '<input type="color" onchange="window.kbExec(\'hiliteColor\', this.value)" value="#000000" title="Цвет фона" class="kb-color-picker">' +
                '</div>' +
            '</div>' +
            '<div class="kb-toolbar-row">' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbExec(\'justifyLeft\')" title="По левому краю" class="kb-toolbar-btn"><i class="fas fa-align-left"></i></button>' +
                    '<button onclick="window.kbExec(\'justifyCenter\')" title="По центру" class="kb-toolbar-btn"><i class="fas fa-align-center"></i></button>' +
                    '<button onclick="window.kbExec(\'justifyRight\')" title="По правому краю" class="kb-toolbar-btn"><i class="fas fa-align-right"></i></button>' +
                    '<button onclick="window.kbExec(\'justifyFull\')" title="По ширине" class="kb-toolbar-btn"><i class="fas fa-align-justify"></i></button>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbExec(\'insertUnorderedList\')" title="Маркированный список" class="kb-toolbar-btn"><i class="fas fa-list-ul"></i></button>' +
                    '<button onclick="window.kbExec(\'insertOrderedList\')" title="Нумерованный список" class="kb-toolbar-btn"><i class="fas fa-list-ol"></i></button>' +
                    '<button onclick="window.kbInsertChecklist()" title="Чек-лист" class="kb-toolbar-btn"><i class="fas fa-check-square"></i></button>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbInsertLink()" title="Ссылка" class="kb-toolbar-btn"><i class="fas fa-link"></i></button>' +
                    '<button onclick="window.kbInsertImage()" title="Изображение" class="kb-toolbar-btn"><i class="fas fa-image"></i></button>' +
                    '<button onclick="window.kbInsertVideo()" title="Видео (YouTube)" class="kb-toolbar-btn"><i class="fas fa-video"></i></button>' +
                    '<button onclick="window.kbInsertTable()" title="Таблица" class="kb-toolbar-btn"><i class="fas fa-table"></i></button>' +
                    '<button onclick="window.kbInsertDivider()" title="Разделитель" class="kb-toolbar-btn"><i class="fas fa-grip-lines"></i></button>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbInsertCallout(\'info\')" title="Инфо" class="kb-toolbar-btn" style="color:#3b82f6;"><i class="fas fa-info-circle"></i></button>' +
                    '<button onclick="window.kbInsertCallout(\'success\')" title="Успех" class="kb-toolbar-btn" style="color:#10b981;"><i class="fas fa-check-circle"></i></button>' +
                    '<button onclick="window.kbInsertCallout(\'warning\')" title="Предупреждение" class="kb-toolbar-btn" style="color:#f59e0b;"><i class="fas fa-exclamation-triangle"></i></button>' +
                    '<button onclick="window.kbInsertCallout(\'error\')" title="Ошибка" class="kb-toolbar-btn" style="color:#ef4444;"><i class="fas fa-times-circle"></i></button>' +
                    '<button onclick="window.kbInsertCodeBlock()" title="Блок кода" class="kb-toolbar-btn"><i class="fas fa-code"></i></button>' +
                '</div>' +
                '<div class="kb-toolbar-section">' +
                    '<button onclick="window.kbToggleEmoji()" title="Эмодзи" class="kb-toolbar-btn">😊</button>' +
                '</div>' +
                '<div class="kb-toolbar-section" style="margin-left:auto;">' +
                    '<button onclick="document.execCommand(\'undo\')" title="Отменить (Ctrl+Z)" class="kb-toolbar-btn"><i class="fas fa-undo"></i></button>' +
                    '<button onclick="document.execCommand(\'redo\')" title="Повторить (Ctrl+Y)" class="kb-toolbar-btn"><i class="fas fa-redo"></i></button>' +
                '</div>' +
            '</div>' +
            '<div id="kbEmojiPanel" class="kb-emoji-panel" style="display:none;">' + getEmojiList() + '</div>' +
        '</div>';
    }

    function kbExec(command, value) {
        if (value === undefined) value = null;
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        try {
            document.execCommand(command, false, value);
        } catch(e) {
            console.error('execCommand error:', e);
        }
    }

    function kbInitEditor(editorElement) {
        activeEditor = editorElement;
        if (!editorElement.innerHTML || editorElement.innerHTML === '<br>') {
            editorElement.innerHTML = '';
        }
        editorElement.setAttribute('data-placeholder', 'Начните писать здесь...');
        if (!editorElement.innerHTML.trim()) {
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
        setTimeout(function() { editorElement.focus(); }, 150);
    }

    function kbToggleEmoji() {
        var panel = document.getElementById('kbEmojiPanel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        }
    }

    function kbInsertEmoji(emoji) {
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            range.deleteContents();
            var textNode = document.createTextNode(emoji);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            activeEditor.innerHTML += emoji;
        }
        var panel = document.getElementById('kbEmojiPanel');
        if (panel) panel.style.display = 'none';
    }

    function kbInsertLink() {
        var url = prompt('🔗 Введите URL ссылки:', 'https://');
        if (!url || !url.trim()) return;
        var text = prompt('📝 Текст ссылки (необязательно):', '');
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        if (text && text.trim()) {
            document.execCommand('insertHTML', false,
                '<a href="' + escapeHtml(url.trim()) + '" target="_blank" rel="noopener noreferrer" style="color:#a78bfa;text-decoration:underline;">' + escapeHtml(text.trim()) + '</a>'
            );
        } else {
            document.execCommand('createLink', false, url.trim());
        }
        showNotification('🔗 Ссылка добавлена', 'info');
    }

    function kbInsertImage() {
        var url = prompt('🖼️ Введите URL изображения:', 'https://');
        if (!url || !url.trim()) return;
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        var imgId = 'img_' + Date.now();
        document.execCommand('insertHTML', false,
            '<div style="margin:24px 0;text-align:center;position:relative;">' +
                '<img id="' + imgId + '" src="' + escapeHtml(url.trim()) + '" alt="Изображение" ' +
                     'style="max-width:100%;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,0.4);cursor:pointer;transition:transform 0.3s;" ' +
                     'onerror="this.onerror=null;this.parentElement.innerHTML=\'<div style=&quot;padding:40px;background:rgba(239,68,68,0.1);border-radius:16px;border:1px solid rgba(239,68,68,0.3);text-align:center;color:#f87171;&quot;>❌ Не удалось загрузить изображение</div>\'" ' +
                     'onclick="this.style.transform=this.style.transform===\'scale(1.05)\'?\'scale(1)\':\'scale(1.05)\'">' +
                '<div style="margin-top:8px;font-size:11px;color:#64748b;">🖼️ Нажмите на изображение чтобы увеличить</div>' +
            '</div>'
        );
        showNotification('🖼️ Изображение добавлено', 'info');
    }

    function kbInsertVideo() {
        var url = prompt('🎬 Введите ссылку на YouTube видео:', 'https://www.youtube.com/watch?v=');
        if (!url || !url.trim()) return;
        var videoId = '';
        try {
            var u = new URL(url.trim());
            videoId = u.searchParams.get('v') || u.pathname.split('/').pop();
        } catch(e) {
            videoId = url.trim().split('v=')[1]?.split('&')[0] || '';
        }
        if (!videoId) {
            showNotification('❌ Неверная ссылка на YouTube', 'error');
            return;
        }
        var embedUrl = 'https://www.youtube.com/embed/' + escapeHtml(videoId);
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        document.execCommand('insertHTML', false,
            '<div style="margin:24px 0;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:16px;box-shadow:0 8px 25px rgba(0,0,0,0.4);">' +
                '<iframe src="' + embedUrl + '" ' +
                        'style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:16px;" ' +
                        'frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ' +
                        'allowfullscreen>' +
                '</iframe>' +
            '</div>'
        );
        showNotification('🎬 Видео добавлено', 'info');
    }

    function kbInsertTable() {
        var rows = parseInt(prompt('Количество строк:', '3')) || 3;
        var cols = parseInt(prompt('Количество столбцов:', '3')) || 3;
        if (rows < 1 || cols < 1 || rows > 10 || cols > 8) {
            showNotification('❌ Строк: 1-10, Столбцов: 1-8', 'error');
            return;
        }
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        var table = '<div style="overflow-x:auto;margin:24px 0;border-radius:16px;border:1px solid rgba(99,102,241,0.2);"><table style="width:100%;border-collapse:collapse;background:rgba(0,0,0,0.2);">';
        for (var i = 0; i < rows; i++) {
            table += '<tr>';
            for (var j = 0; j < cols; j++) {
                var isHeader = i === 0;
                var tag = isHeader ? 'th' : 'td';
                var style = isHeader ? 'background:rgba(99,102,241,0.2);font-weight:600;color:#a78bfa;' : 'background:rgba(0,0,0,0.1);';
                table += '<' + tag + ' style="border:1px solid rgba(99,102,241,0.1);padding:12px 16px;text-align:left;' + style + '">' + (isHeader ? 'Колонка ' + (j+1) : '—') + '</' + tag + '>';
            }
            table += '</tr>';
        }
        table += '</table></div>';
        document.execCommand('insertHTML', false, table);
        showNotification('📊 Таблица добавлена', 'info');
    }

    function kbInsertDivider() {
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        document.execCommand('insertHTML', false,
            '<hr style="margin:32px 0;border:none;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,0.5),transparent);">'
        );
    }

    function kbInsertCallout(type) {
        var config = {
            info: { icon: 'ℹ️', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', title: 'Информация' },
            success: { icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.08)', title: 'Успешно' },
            warning: { icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', title: 'Внимание' },
            error: { icon: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', title: 'Ошибка' }
        };
        var c = config[type] || config.info;
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        document.execCommand('insertHTML', false,
            '<div style="background:' + c.bg + ';border-left:4px solid ' + c.color + ';border-radius:16px;padding:16px 20px;margin:24px 0;display:flex;align-items:flex-start;gap:14px;">' +
                '<span style="font-size:24px;flex-shrink:0;">' + c.icon + '</span>' +
                '<div style="flex:1;color:#e2e8f0;">' +
                    '<div style="font-weight:600;color:' + c.color + ';margin-bottom:6px;font-size:15px;">' + c.title + '</div>' +
                    '<div style="line-height:1.6;">Введите текст сообщения здесь...</div>' +
                '</div>' +
            '</div>'
        );
        showNotification(c.icon + ' Блок добавлен', 'info');
    }

    function kbInsertCodeBlock() {
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        document.execCommand('insertHTML', false,
            '<div style="margin:24px 0;position:relative;">' +
                '<div style="background:#0d1016;border-radius:16px;border:1px solid rgba(99,102,241,0.2);overflow:hidden;">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:rgba(99,102,241,0.1);border-bottom:1px solid rgba(99,102,241,0.2);">' +
                        '<div style="display:flex;gap:8px;">' +
                            '<span style="width:10px;height:10px;border-radius:50%;background:#ef4444;"></span>' +
                            '<span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;"></span>' +
                            '<span style="width:10px;height:10px;border-radius:50%;background:#10b981;"></span>' +
                        '</div>' +
                        '<span style="font-size:11px;color:#64748b;">JavaScript</span>' +
                        '<button onclick="navigator.clipboard.writeText(this.closest(\'.kb-code-wrapper\')?.querySelector(\'code\')?.textContent || \'\');" ' +
                                'style="background:transparent;border:1px solid rgba(99,102,241,0.3);color:#a78bfa;padding:4px 12px;border-radius:20px;font-size:11px;cursor:pointer;">' +
                            '📋 Копировать' +
                        '</button>' +
                    '</div>' +
                    '<div class="kb-code-wrapper" style="padding:20px;">' +
                        '<pre style="margin:0;overflow-x:auto;"><code style="color:#e2e8f0;font-family:\'JetBrains Mono\',\'Fira Code\',\'Courier New\',monospace;font-size:13px;line-height:1.6;">// Введите ваш код здесь\nfunction hello() {\n    console.log("Привет, WARPOINT!");\n}</code></pre>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
        showNotification('💻 Блок кода добавлен', 'info');
    }

    function kbInsertChecklist() {
        if (!activeEditor) activeEditor = document.getElementById('kbEditorContent');
        if (!activeEditor) return;
        activeEditor.focus();
        document.execCommand('insertHTML', false,
            '<div style="margin:20px 0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:12px;">' +
                '<input type="checkbox" style="width:18px;height:18px;cursor:pointer;accent-color:#a78bfa;">' +
                '<span style="color:#e2e8f0;">Задача для выполнения</span>' +
            '</div>'
        );
    }

    async function openArticle(articleId) {
        var article = knowledgeArticles.find(function(a) { return a.id === articleId; });
        if (!article) {
            showNotification('❌ Статья не найдена', 'error');
            return;
        }
        await trackArticleView(articleId);
        var category = knowledgeCategories.find(function(c) { return c.id === article.category_id; });
        var likes = articleLikes[articleId] || article.likes || 0;
        var liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        var canEdit = canManageArticles();

        var modalHtml = '' +
        '<div id="kbArticleModal" class="kb-modal" onclick="window.kbCloseArticle()">' +
            '<div class="kb-modal-window kb-article-window" onclick="event.stopPropagation()">' +
                '<div class="kb-article-header">' +
                    '<div class="kb-article-header-top">' +
                        '<div class="kb-article-category" style="background:' + (category?.color || '#6366f1') + '20;color:' + (category?.color || '#a78bfa') + ';">' +
                            (category?.icon || '📁') + ' ' + (category?.name || 'Без категории') +
                        '</div>' +
                        '<button class="kb-modal-close" onclick="window.kbCloseArticle()">×</button>' +
                    '</div>' +
                    '<h1 class="kb-article-title">' + escapeHtml(article.title) + '</h1>' +
                    '<div class="kb-article-meta">' +
                        '<span><i class="fas fa-user"></i> ' + escapeHtml(article.created_by || 'Неизвестный') + '</span>' +
                        '<span><i class="fas fa-calendar"></i> ' + formatDate(article.created_at) + '</span>' +
                        '<span><i class="fas fa-clock"></i> ' + formatTimeAgo(article.updated_at || article.created_at) + '</span>' +
                        '<span><i class="fas fa-eye"></i> ' + ((article.views || 0) + 1) + ' просмотров</span>' +
                    '</div>' +
                '</div>' +
                '<div class="kb-article-body">' +
                    '<div class="kb-article-content">' + (article.content || '<p style="color:#64748b;text-align:center;padding:40px;">У этой статьи пока нет содержания</p>') + '</div>' +
                '</div>' +
                '<div class="kb-article-footer">' +
                    '<div class="kb-article-likes">' +
                        '<button class="kb-like-btn ' + (liked ? 'liked' : '') + '" onclick="window.kbToggleLike(' + articleId + ')">' +
                            (liked ? '❤️' : '🤍') + ' <span>' + (likes || 0) + '</span>' +
                        '</button>' +
                    '</div>' +
                    '<div class="kb-article-actions">' +
                        (canEdit ? '<button class="kb-btn-secondary" onclick="window.kbCloseArticle();window.kbEditArticle(' + articleId + ')"><i class="fas fa-edit"></i> Редактировать</button>' : '') +
                        '<button class="kb-btn-primary" onclick="window.kbCloseArticle()"><i class="fas fa-times"></i> Закрыть</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';

        var escHandler = function(e) {
            if (e.key === 'Escape') {
                kbCloseArticle();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    function kbCloseArticle() {
        var modal = document.getElementById('kbArticleModal');
        if (modal) modal.remove();
        document.body.style.overflow = '';
    }

    async function kbToggleLike(articleId) {
        await toggleLike(articleId);
        var article = knowledgeArticles.find(function(a) { return a.id === articleId; });
        if (!article) return;
        var likes = articleLikes[articleId] || article.likes || 0;
        var liked = localStorage.getItem('kb_like_' + articleId) === 'true';
        var likeBtn = document.querySelector('.kb-like-btn');
        if (likeBtn) {
            likeBtn.className = 'kb-like-btn ' + (liked ? 'liked' : '');
            likeBtn.innerHTML = (liked ? '❤️' : '🤍') + ' <span>' + (likes || 0) + '</span>';
        }
    }

    function getPopularArticles(limit) {
        if (limit === undefined) limit = 5;
        return knowledgeArticles.filter(function(a) { return (a.views || 0) > 0; })
            .sort(function(a, b) { return (b.views || 0) - (a.views || 0); })
            .slice(0, limit);
    }

    function renderPopularArticles() {
        var popular = getPopularArticles(3);
        if (popular.length === 0) return '';

        var html = '' +
        '<div class="kb-popular-section">' +
            '<div class="kb-section-header">' +
                '<i class="fas fa-fire" style="color:#f59e0b;"></i>' +
                '<span>Популярные статьи</span>' +
            '</div>' +
            '<div class="kb-popular-list">';

        popular.forEach(function(article, idx) {
            var author = article.created_by || 'Неизвестный';
            var category = knowledgeCategories.find(function(c) { return c.id === article.category_id; });
            html += '' +
            '<div class="kb-popular-item" onclick="window.kbOpenArticle(' + article.id + ')">' +
                '<div class="kb-popular-rank">#' + (idx + 1) + '</div>' +
                '<div class="kb-popular-info">' +
                    '<div class="kb-popular-title">' + escapeHtml(article.title) + '</div>' +
                    '<div class="kb-popular-meta">' +
                        '<span><i class="fas fa-user"></i> ' + escapeHtml(author) + '</span>' +
                        '<span><i class="fas fa-eye"></i> ' + (article.views || 0) + '</span>' +
                        (category ? '<span style="color:' + (category.color || '#a78bfa') + ';">' + category.icon + ' ' + category.name + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="kb-popular-views">' + (article.views || 0) + ' 👁️</div>' +
            '</div>';
        });

        html += '</div></div>';
        return html;
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    function initKnowledge() {
        if (knowledgeInitialized) {
            console.log('📚 База знаний уже инициализирована');
            return;
        }
        console.log('📚 Инициализация базы знаний');
        var container = document.getElementById('knowledgeContainer');
        if (!container) {
            setTimeout(initKnowledge, 100);
            return;
        }
        loadKnowledgeData();
        var searchInput = document.getElementById('knowledgeSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function(e) {
                knowledgeSearchQuery = e.target.value.toLowerCase();
                renderKnowledge();
            });
        }
        setupActionButtons();
        knowledgeInitialized = true;
    }

    function setupActionButtons() {
        var actionButtons = document.getElementById('actionButtons');
        if (!actionButtons) return;
        if (canManageCategories()) {
            actionButtons.innerHTML = '' +
            '<button class="btn-secondary" onclick="window.kbOpenCreateCategory()"><i class="fas fa-folder-plus"></i> Новая категория</button>' +
            '<button class="btn-secondary" onclick="window.kbShowPresets()"><i class="fas fa-magic"></i> Готовые категории</button>';
        } else if (canManageArticles()) {
            actionButtons.innerHTML = '<span style="font-size:12px;color:#64748b;"><i class="fas fa-info-circle"></i> Вы можете добавлять статьи</span>';
        } else {
            actionButtons.innerHTML = '';
        }
    }

    async function loadKnowledgeData() {
        if (isLoadingKnowledge) return;
        isLoadingKnowledge = true;
        var container = document.getElementById('knowledgeContainer');
        if (container) container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
        try {
            var categoriesRes = await apiCall('/knowledge/categories');
            var articlesRes = await apiCall('/knowledge/articles');
            knowledgeCategories = (categoriesRes && categoriesRes.success) ? categoriesRes.data : (Array.isArray(categoriesRes) ? categoriesRes : []);
            knowledgeArticles = (articlesRes && articlesRes.success) ? articlesRes.data : (Array.isArray(articlesRes) ? articlesRes : []);
            showNotification('📚 Загружено ' + knowledgeCategories.length + ' категорий, ' + knowledgeArticles.length + ' статей', 'info');
            renderKnowledge();
        } catch (err) {
            if (container) container.innerHTML = '<div class="empty-knowledge"><i class="fas fa-exclamation-triangle"></i><h3>Ошибка загрузки</h3><button class="btn-primary" onclick="loadKnowledgeData()">🔄 Повторить</button></div>';
            showNotification('❌ Ошибка загрузки базы знаний', 'error');
        } finally {
            isLoadingKnowledge = false;
        }
    }

    function renderKnowledge() {
        var container = document.getElementById('knowledgeContainer');
        if (!container) return;

        var filteredArticles = knowledgeArticles.slice();
        if (knowledgeSearchQuery) {
            filteredArticles = filteredArticles.filter(function(a) {
                return (a.title && a.title.toLowerCase().indexOf(knowledgeSearchQuery) !== -1) ||
                       (a.content && a.content.toLowerCase().indexOf(knowledgeSearchQuery) !== -1);
            });
        }

        var categoriesWithArticles = knowledgeCategories.map(function(cat) {
            return {
                id: cat.id,
                name: cat.name,
                icon: cat.icon,
                color: cat.color,
                articles: filteredArticles.filter(function(a) { return a.category_id === cat.id; })
            };
        });

        var canEditCategories = canManageCategories();
        var canEditArticles = canManageArticles();

        if (knowledgeCategories.length === 0) {
            if (canEditCategories) {
                renderPresetSelector(container);
            } else {
                container.innerHTML = '<div class="empty-knowledge"><i class="fas fa-folder-open"></i><h3>База знаний пуста</h3><p>Категории ещё не созданы. Обратитесь к руководителю.</p></div>';
            }
            return;
        }

        var popularHtml = renderPopularArticles();

        var html = popularHtml;

        for (var c = 0; c < categoriesWithArticles.length; c++) {
            var cat = categoriesWithArticles[c];
            var hasArticles = cat.articles.length > 0;

            html += '' +
            '<div class="knowledge-category" data-category-id="' + cat.id + '">' +
                '<div class="category-header" onclick="window.kbToggleCategory(' + cat.id + ')">' +
                    '<div class="category-title">' +
                        '<div class="category-icon">' + (cat.icon || '📁') + '</div>' +
                        '<div class="category-name">' + escapeHtml(cat.name) + '</div>' +
                        '<div class="category-count">' + cat.articles.length + '</div>' +
                    '</div>' +
                    '<div class="category-actions">' +
                        (canEditCategories ? '<button class="category-edit" onclick="event.stopPropagation();window.kbOpenEditCategory(' + cat.id + ',\'' + escapeHtml(cat.name) + '\',\'' + escapeHtml(cat.icon || '📁') + '\')" title="Редактировать"><i class="fas fa-edit"></i></button>' : '') +
                        (canEditCategories ? '<button class="category-delete" onclick="event.stopPropagation();window.kbDeleteCategory(' + cat.id + ')" title="Удалить"><i class="fas fa-trash-alt"></i></button>' : '') +
                        '<div class="category-arrow"><i class="fas fa-chevron-down"></i></div>' +
                    '</div>' +
                '</div>' +
                '<div class="category-content" style="display:none;">';

            if (hasArticles) {
                for (var a = 0; a < cat.articles.length; a++) {
                    var article = cat.articles[a];
                    html += '' +
                    '<div class="knowledge-article" data-article-id="' + article.id + '">' +
                        '<div class="article-info" onclick="window.kbOpenArticle(' + article.id + ')">' +
                            '<div class="article-title"><i class="fas fa-file-alt"></i> ' + escapeHtml(article.title) + '</div>' +
                            '<div class="article-meta">' +
                                '<span><i class="fas fa-eye"></i> ' + (article.views || 0) + '</span>' +
                                '<span><i class="fas fa-calendar-alt"></i> ' + formatDate(article.created_at) + '</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="article-actions">' +
                            (canEditArticles ? '<button class="article-edit" onclick="event.stopPropagation();window.kbEditArticle(' + article.id + ')"><i class="fas fa-edit"></i></button>' : '') +
                            (canEditArticles ? '<button class="article-delete" onclick="event.stopPropagation();window.kbDeleteArticle(' + article.id + ')"><i class="fas fa-trash-alt"></i></button>' : '') +
                        '</div>' +
                    '</div>';
                }
            } else {
                html += '<div class="empty-category-message"><i class="fas fa-info-circle"></i> В этой категории пока нет статей</div>';
            }

            if (canEditArticles) {
                html += '<button class="add-article-btn" onclick="event.stopPropagation();window.kbCreateArticle(' + cat.id + ')"><i class="fas fa-plus"></i> Добавить статью</button>';
            }

            html += '</div></div>';
        }

        if (canEditCategories) {
            html += '' +
            '<div class="action-buttons-bottom">' +
                '<button class="btn-secondary" onclick="window.kbOpenCreateCategory()"><i class="fas fa-folder-plus"></i> Новая категория</button>' +
                '<button class="btn-secondary" onclick="window.kbShowPresets()"><i class="fas fa-magic"></i> Готовые категории</button>' +
            '</div>';
        }

        container.innerHTML = html;

        try {
            var openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]');
            openCategories.forEach(function(catId) {
                var content = document.querySelector('.knowledge-category[data-category-id="' + catId + '"] .category-content');
                var arrow = document.querySelector('.knowledge-category[data-category-id="' + catId + '"] .category-arrow i');
                if (content) { content.style.display = 'flex'; if (arrow) arrow.style.transform = 'rotate(180deg)'; }
            });
        } catch(e) {}
    }

    function kbToggleCategory(categoryId) {
        var category = document.querySelector('.knowledge-category[data-category-id="' + categoryId + '"]');
        var content = category?.querySelector('.category-content');
        var arrow = category?.querySelector('.category-arrow i');
        if (!content) return;
        var openCategories = [];
        try { openCategories = JSON.parse(localStorage.getItem('knowledgeOpenCategories') || '[]'); } catch(e) {}
        if (content.style.display === 'none' || content.style.display === '') {
            content.style.display = 'flex';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
            if (openCategories.indexOf(categoryId) === -1) openCategories.push(categoryId);
        } else {
            content.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
            openCategories = openCategories.filter(function(id) { return id !== categoryId; });
        }
        localStorage.setItem('knowledgeOpenCategories', JSON.stringify(openCategories));
    }

    // ============================================
    // МОДАЛКИ СТАТЕЙ
    // ============================================

    function kbCreateArticle(categoryId) {
        editingArticleId = null;
        openArticleModalInternal(categoryId, null);
    }

    function kbEditArticle(articleId) {
        editingArticleId = articleId;
        var article = knowledgeArticles.find(function(a) { return a.id === articleId; });
        if (article) openArticleModalInternal(article.category_id, article);
    }

    function openArticleModalInternal(categoryId, article) {
        var modalHtml = '' +
        '<div id="articleEditModal" class="kb-modal active">' +
            '<div class="kb-modal-window" style="max-width:900px;width:95%;">' +
                '<div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);">' +
                    '<h3 style="margin:0;">' + (article ? '✏️ Редактировать статью' : '➕ Новая статья') + '</h3>' +
                '</div>' +
                '<div style="padding:20px;">' +
                    '<div class="form-group" style="margin-bottom:15px;">' +
                        '<label style="display:block;margin-bottom:5px;font-size:13px;color:#94a3b8;"><i class="fas fa-heading"></i> Заголовок</label>' +
                        '<input type="text" id="articleTitle" class="form-input" value="' + (article ? escapeHtml(article.title) : '') + '" placeholder="Введите заголовок" style="width:100%;padding:10px;background:#0d1016;border:1px solid #1e2430;border-radius:8px;color:#e2e8f0;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="display:block;margin-bottom:5px;font-size:13px;color:#94a3b8;"><i class="fas fa-edit"></i> Содержание</label>' +
                        renderEditorToolbar() +
                        '<div id="kbEditorContent" class="kb-editor-content" contenteditable="true" onfocus="window.kbInitEditor(this)">' + (article?.content || '') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;gap:12px;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);">' +
                    '<button class="btn-primary" onclick="window.kbSaveArticle(' + categoryId + ')">' + (article ? 'Сохранить' : 'Создать') + '</button>' +
                    '<button class="btn-secondary" onclick="window.kbCloseArticleEdit()">Отмена</button>' +
                    (article ? '<button class="btn-danger" onclick="window.kbDeleteArticleConfirm(' + article.id + ')">🗑️ Удалить</button>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.body.style.overflow = 'hidden';
        setTimeout(function() {
            var editor = document.getElementById('kbEditorContent');
            if (editor) kbInitEditor(editor);
        }, 200);
    }

    function kbCloseArticleEdit() {
        var modal = document.getElementById('articleEditModal');
        if (modal) modal.remove();
        document.body.style.overflow = '';
        editingArticleId = null;
    }

    async function kbSaveArticle(categoryId) {
        var title = document.getElementById('articleTitle')?.value.trim();
        var content = document.getElementById('kbEditorContent')?.innerHTML || '';
        if (!title) {
            showNotification('❌ Введите заголовок', 'error');
            return;
        }
        var response;
        if (editingArticleId) {
            response = await apiCall('/knowledge/articles/' + editingArticleId, 'PUT', { title: title, content: content });
        } else {
            response = await apiCall('/knowledge/articles', 'POST', { category_id: categoryId, title: title, content: content });
        }
        if (response?.success) {
            showNotification(editingArticleId ? '✅ Статья обновлена' : '✅ Статья создана', 'success');
            kbCloseArticleEdit();
            await loadKnowledgeData();
        } else {
            showNotification('❌ ' + (response?.error || 'Ошибка'), 'error');
        }
    }

    async function kbDeleteArticle(articleId) {
        if (!canManageArticles()) {
            showNotification('❌ Нет прав', 'error');
            return;
        }
        if (!confirm('Удалить эту статью?')) return;
        var response = await apiCall('/knowledge/articles/' + articleId, 'DELETE');
        if (response?.success) {
            showNotification('🗑️ Статья удалена', 'warning');
            kbCloseArticleEdit();
            kbCloseArticle();
            await loadKnowledgeData();
        } else {
            showNotification('❌ Ошибка', 'error');
        }
    }

    function kbDeleteArticleConfirm(articleId) {
        if (confirm('Удалить эту статью?')) kbDeleteArticle(articleId);
    }

    // ============================================
    // МОДАЛКИ КАТЕГОРИЙ
    // ============================================

    function kbOpenCreateCategory() {
        editingCategoryId = null;
        openCategoryModalInternal(null, null, null);
    }

    function kbOpenEditCategory(id, name, icon) {
        editingCategoryId = id;
        openCategoryModalInternal(id, name, icon);
    }

    function openCategoryModalInternal(id, name, icon) {
        var iconList = [
            '📁','📖','📜','❓','💡','🔧','⚙️','🎮','🏆','⭐','🔥','✅','❌','⚠️','ℹ️',
            '📅','🎧','📡','🧹','👋','💬','🎫','🆕','💰','📊','🌍','📢','🤝','🎯','🎂'
        ];
        var iconsHtml = iconList.map(function(ic) {
            return '<div class="icon-option" onclick="window.kbSelectIcon(\'' + ic + '\')" style="font-size:24px;cursor:pointer;padding:8px;text-align:center;border-radius:8px;' + (ic === (icon || '📁') ? 'background:rgba(99,102,241,0.3);' : '') + '">' + ic + '</div>';
        }).join('');

        var modalHtml = '' +
        '<div id="categoryModal" class="kb-modal active">' +
            '<div class="kb-modal-window" style="max-width:450px;">' +
                '<div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);">' +
                    '<h3>' + (id ? '✏️ Редактировать категорию' : '➕ Новая категория') + '</h3>' +
                '</div>' +
                '<div style="padding:20px;">' +
                    '<div class="form-group" style="margin-bottom:15px;">' +
                        '<label style="display:block;margin-bottom:5px;font-size:13px;color:#94a3b8;"><i class="fas fa-tag"></i> Название</label>' +
                        '<input type="text" id="categoryName" class="form-input" value="' + (name ? escapeHtml(name) : '') + '" placeholder="Введите название" style="width:100%;padding:10px;background:#0d1016;border:1px solid #1e2430;border-radius:8px;color:#e2e8f0;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="display:block;margin-bottom:10px;font-size:13px;color:#94a3b8;"><i class="fas fa-icons"></i> Иконка</label>' +
                        '<div class="icon-selector" style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;max-height:200px;overflow-y:auto;padding:8px;background:#0d1016;border-radius:12px;">' + iconsHtml + '</div>' +
                        '<input type="hidden" id="categoryIcon" value="' + (icon || '📁') + '">' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;gap:12px;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);">' +
                    '<button class="btn-primary" onclick="window.kbSaveCategory()">' + (id ? 'Сохранить' : 'Создать') + '</button>' +
                    '<button class="btn-secondary" onclick="window.kbCloseCategory()">Отмена</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function kbSelectIcon(icon) {
        document.getElementById('categoryIcon').value = icon;
        document.querySelectorAll('.icon-option').forEach(function(el) {
            el.style.background = '';
        });
        if (event && event.target) event.target.style.background = 'rgba(99,102,241,0.3)';
    }

    function kbCloseCategory() {
        var modal = document.getElementById('categoryModal');
        if (modal) modal.remove();
        editingCategoryId = null;
    }

    async function kbSaveCategory() {
        var name = document.getElementById('categoryName')?.value.trim();
        var icon = document.getElementById('categoryIcon')?.value || '📁';
        if (!name) {
            showNotification('❌ Введите название', 'error');
            return;
        }
        var response;
        if (editingCategoryId) {
            response = await apiCall('/knowledge/categories/' + editingCategoryId, 'PUT', { name: name, icon: icon });
        } else {
            response = await apiCall('/knowledge/categories', 'POST', { name: name, icon: icon });
        }
        if (response?.success) {
            showNotification(editingCategoryId ? '✅ Категория обновлена' : '✅ Категория создана', 'success');
            kbCloseCategory();
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
        var response = await apiCall('/knowledge/categories/' + categoryId, 'DELETE');
        if (response?.success) {
            showNotification('🗑️ Категория удалена', 'warning');
            await loadKnowledgeData();
        } else {
            showNotification('❌ Ошибка', 'error');
        }
    }

    function kbShowPresets() {
        var presetCategories = [
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

        var rowsHtml = '';
        for (var i = 0; i < presetCategories.length; i += 6) {
            var rowCats = presetCategories.slice(i, i + 6);
            rowsHtml += '<div class="preset-row">';
            rowCats.forEach(function(cat) {
                rowsHtml += '<div class="preset-item" onclick="window.kbCreatePresetCategory(\'' + escapeHtml(cat.name) + '\',\'' + cat.icon + '\')"><div class="preset-item-icon">' + cat.icon + '</div><div class="preset-item-name">' + escapeHtml(cat.name) + '</div></div>';
            });
            rowsHtml += '</div>';
        }

        var modalHtml = '' +
        '<div id="presetModal" class="kb-modal active" onclick="window.kbClosePresets()">' +
            '<div class="kb-modal-window" style="max-width:700px;max-height:80vh;overflow-y:auto;" onclick="event.stopPropagation()">' +
                '<div style="padding:20px;border-bottom:1px solid rgba(99,102,241,0.15);"><h3>🎨 Добавить готовые категории</h3></div>' +
                '<div style="padding:20px;"><div class="preset-grid">' + rowsHtml + '</div>' +
                '<div style="display:flex;gap:12px;justify-content:center;margin-top:16px;">' +
                    '<button class="btn-create-all" onclick="window.kbCreateAllPresets();window.kbClosePresets();"><i class="fas fa-plus-circle"></i> Создать все категории</button>' +
                '</div></div>' +
                '<div style="display:flex;justify-content:flex-end;padding:16px 20px;border-top:1px solid rgba(99,102,241,0.1);">' +
                    '<button class="btn-secondary" onclick="window.kbClosePresets()">Закрыть</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    function kbClosePresets() {
        var modal = document.getElementById('presetModal');
        if (modal) modal.remove();
    }

    async function kbCreatePresetCategory(name, icon) {
        var exists = knowledgeCategories.some(function(cat) {
            return cat.name.toLowerCase() === name.toLowerCase();
        });
        if (exists) {
            showNotification('❌ Категория "' + name + '" уже существует!', 'error');
            return;
        }
        var response = await apiCall('/knowledge/categories', 'POST', { name: name, icon: icon });
        if (response?.success) {
            showNotification('✅ Категория "' + name + '" создана', 'success');
            await loadKnowledgeData();
        } else {
            showNotification('❌ Ошибка при создании', 'error');
        }
    }

    async function kbCreateAllPresets() {
        var presetCategories = [
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
        var created = 0;
        var skipped = 0;
        showNotification('⏳ Создание категорий...', 'info');
        for (var i = 0; i < presetCategories.length; i++) {
            var cat = presetCategories[i];
            var exists = knowledgeCategories.some(function(c) {
                return c.name.toLowerCase() === cat.name.toLowerCase();
            });
            if (exists) {
                skipped++;
                continue;
            }
            var response = await apiCall('/knowledge/categories', 'POST', { name: cat.name, icon: cat.icon });
            if (response?.success) created++;
            await new Promise(function(r) { setTimeout(r, 20); });
        }
        showNotification('✅ Создано: ' + created + ', Пропущено: ' + skipped, created > 0 ? 'success' : 'info');
        await loadKnowledgeData();
    }

    function renderPresetSelector(container) {
        var presetCategories = [
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
        var rowsHtml = '';
        for (var i = 0; i < presetCategories.length; i += 6) {
            var rowCats = presetCategories.slice(i, i + 6);
            rowsHtml += '<div class="preset-row">';
            rowCats.forEach(function(cat) {
                rowsHtml += '<div class="preset-item" onclick="window.kbCreatePresetCategory(\'' + escapeHtml(cat.name) + '\',\'' + cat.icon + '\')"><div class="preset-item-icon">' + cat.icon + '</div><div class="preset-item-name">' + escapeHtml(cat.name) + '</div></div>';
            });
            rowsHtml += '</div>';
        }
        container.innerHTML = '' +
        '<div class="preset-selector">' +
            '<div class="preset-header"><i class="fas fa-magic"></i><h2>Создайте базу знаний WARPOINT</h2><p>Нажмите на категорию, чтобы добавить её</p></div>' +
            '<div class="preset-grid">' + rowsHtml + '</div>' +
            '<div class="action-buttons-bottom">' +
                '<button class="btn-create-all" onclick="window.kbCreateAllPresets()"><i class="fas fa-plus-circle"></i> Создать все категории (' + presetCategories.length + ')</button>' +
                '<button class="btn-secondary" onclick="window.kbOpenCreateCategory()"><i class="fas fa-plus"></i> Создать свою категорию</button>' +
            '</div>' +
        '</div>';
    }

    // ============================================
    // ЭКСПОРТ ВСЕХ ФУНКЦИЙ
    // ============================================

    window.initKnowledge = initKnowledge;
    window.resetKnowledgeState = resetKnowledgeState;
    window.renderEditorToolbar = renderEditorToolbar;
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
    window.kbCloseArticle = kbCloseArticle;
    window.kbToggleLike = kbToggleLike;
    window.kbToggleCategory = kbToggleCategory;
    window.kbCreateArticle = kbCreateArticle;
    window.kbEditArticle = kbEditArticle;
    window.kbCloseArticleEdit = kbCloseArticleEdit;
    window.kbSaveArticle = kbSaveArticle;
    window.kbDeleteArticle = kbDeleteArticle;
    window.kbDeleteArticleConfirm = kbDeleteArticleConfirm;
    window.kbOpenCreateCategory = kbOpenCreateCategory;
    window.kbOpenEditCategory = kbOpenEditCategory;
    window.kbSelectIcon = kbSelectIcon;
    window.kbCloseCategory = kbCloseCategory;
    window.kbSaveCategory = kbSaveCategory;
    window.kbDeleteCategory = kbDeleteCategory;
    window.kbShowPresets = kbShowPresets;
    window.kbClosePresets = kbClosePresets;
    window.kbCreatePresetCategory = kbCreatePresetCategory;
    window.kbCreateAllPresets = kbCreateAllPresets;
    window.loadKnowledgeData = loadKnowledgeData;
    window.renderKnowledge = renderKnowledge;
    window.initEditor = kbInitEditor;

    console.log('✅ knowledge.js v3.0 загружен (премиум WYSIWYG + лайки + просмотры + топ статей)');
})();