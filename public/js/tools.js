// public/js/tools.js — УТИЛИТЫ v3.0
// Полная переработка: загрузка файлов, ссылки, метаданные

(function() {
    'use strict';
    
    var tools = [];
    
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    
    function initTools() {
        console.log('🔧 Инициализация утилит');
        
        // Кнопка "Добавить утилиту"
        var uploadBtn = document.getElementById('uploadToolBtn');
        if (uploadBtn) {
            uploadBtn.onclick = function() {
                openUploadToolModal();
            };
        }
        
        // Переключатель типа файл/ссылка
        var typeSelect = document.getElementById('toolType');
        if (typeSelect) {
            typeSelect.onchange = function() {
                toggleFileUrlInput();
            };
        }
        
        // Загружаем данные
        loadTools();
    }
    
    // ============================================
    // ЗАГРУЗКА ДАННЫХ
    // ============================================
    
    async function loadTools() {
    var grid = document.getElementById('toolsGrid');
    if (!grid) {
        console.warn('⚠️ toolsGrid не найден');
        return;
    }
    
    tools = [];
    
    // 1. СНАЧАЛА загружаем данные, ПОТОМ показываем
    try {
        // Грузим ссылки из localStorage
        var savedLinks = localStorage.getItem('warpoint_tools');
        if (savedLinks) {
            try {
                var parsed = JSON.parse(savedLinks);
                if (Array.isArray(parsed)) {
                    tools = parsed;
                }
            } catch(e) {}
        }
        
        // Грузим файлы с сервера
        var response = await fetch('/api/tools', {
            headers: {
                'Authorization': 'Bearer ' + getToken()
            }
        });
        
        if (response.ok) {
            var data = await response.json();
            if (data && data.success && Array.isArray(data.tools)) {
                data.tools.forEach(function(serverFile) {
                    var alreadyExists = tools.some(function(t) {
                        return t.path === serverFile.path;
                    });
                    
                    if (!alreadyExists) {
                        var ext = getFileExtension(serverFile.name);
                        var icon = getFileIcon(ext);
                        
                        tools.push({
                            id: 'srv_' + serverFile.name,
                            name: cleanFileName(serverFile.name),
                            desc: formatFileSize(serverFile.size) + ' — ' + formatDate(serverFile.uploadedAt),
                            type: ext,
                            icon: icon,
                            path: serverFile.path,
                            size: serverFile.size,
                            uploadedAt: serverFile.uploadedAt,
                            isServer: true,
                            isLink: false
                        });
                    }
                });
            }
        }
    } catch(e) {
        console.warn('Ошибка загрузки утилит:', e.message);
    }
    
    // 2. Только теперь рендерим
    renderTools();
}
    
    // ============================================
    // РЕНДЕР
    // ============================================
    
    function renderTools() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;
        
        if (tools.length === 0) {
            grid.innerHTML = '' +
            '<div style="text-align:center;padding:60px 20px;grid-column:1/-1;">' +
                '<div style="font-size:64px;margin-bottom:16px;">📭</div>' +
                '<div style="font-size:18px;font-weight:600;color:#e2e8f0;margin-bottom:8px;">Нет утилит</div>' +
                '<div style="font-size:14px;color:#94a3b8;">Загрузите файл или добавьте ссылку на программу</div>' +
            '</div>';
            return;
        }
        
        var html = '';
        
        for (var i = 0; i < tools.length; i++) {
            var t = tools[i];
            var badgeText = t.isServer ? '📁 Файл на сервере' : '🔗 Внешняя ссылка';
            var badgeClass = t.isServer ? 'tool-badge-server' : 'tool-badge-link';
            
            html += '' +
            '<div class="tool-card">' +
                '<div class="tool-card-badge ' + badgeClass + '">' + badgeText + '</div>' +
                '<div class="tool-icon">' + (t.icon || '📁') + '</div>' +
                '<div class="tool-name">' + escapeHTML(t.name) + '</div>' +
                '<div class="tool-desc">' + escapeHTML(t.desc || '') + '</div>' +
                '<div class="tool-meta">' +
                    '<span>' + (t.type || 'file').toUpperCase() + '</span>' +
                    (t.size ? '<span> • ' + formatFileSize(t.size) + '</span>' : '') +
                    (t.uploadedAt ? '<span> • ' + formatDate(t.uploadedAt) + '</span>' : '') +
                '</div>' +
                '<div class="tool-actions">';
            
            if (t.isLink) {
                html += '<a href="' + escapeAttr(t.path) + '" target="_blank" rel="noopener" class="btn-launch btn-launch-link">🔗 Открыть</a>';
            } else {
                html += '<a href="' + t.path + '" download class="btn-launch">📥 Скачать</a>';
            }
            
            html += '<button class="btn-delete-tool" onclick="window.toolsRemove(\'' + escapeAttr(t.id) + '\')">🗑️</button>' +
                '</div>' +
            '</div>';
        }
        
        grid.innerHTML = html;
    }
    
    // ============================================
    // ДОБАВЛЕНИЕ
    // ============================================
    
    function openUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (!modal) return;
        
        modal.style.display = 'flex';
        modal.classList.add('active');
        
        // Очищаем поля
        var nameEl = document.getElementById('toolName');
        var descEl = document.getElementById('toolDesc');
        var pathEl = document.getElementById('toolPath');
        var typeEl = document.getElementById('toolType');
        var fileEl = document.getElementById('toolFile');
        
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        if (pathEl) { pathEl.value = ''; pathEl.style.display = 'none'; }
        if (typeEl) typeEl.value = 'exe';
        if (fileEl) { fileEl.value = ''; fileEl.style.display = 'block'; }
    }
    
    function closeUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    }
    
    function toggleFileUrlInput() {
        var type = document.getElementById('toolType').value;
        var fileInput = document.getElementById('toolFile');
        var urlInput = document.getElementById('toolPath');
        
        if (type === 'url') {
            if (fileInput) fileInput.style.display = 'none';
            if (urlInput) { urlInput.style.display = 'block'; urlInput.placeholder = 'https://...'; }
        } else {
            if (fileInput) fileInput.style.display = 'block';
            if (urlInput) { urlInput.style.display = 'none'; urlInput.value = ''; }
        }
    }
    
    async function addTool() {
        var name = document.getElementById('toolName')?.value?.trim();
        var desc = document.getElementById('toolDesc')?.value?.trim();
        var type = document.getElementById('toolType')?.value || 'exe';
        
        if (!name) {
            showNotif('❌ Введите название', 'error');
            return;
        }
        
        // Если ссылка
        if (type === 'url') {
            var url = document.getElementById('toolPath')?.value?.trim();
            if (!url) {
                showNotif('❌ Введите ссылку', 'error');
                return;
            }
            
            tools.push({
                id: 'link_' + Date.now(),
                name: name,
                desc: desc || url,
                type: 'url',
                icon: '🌐',
                path: url,
                isServer: false,
                isLink: true
            });
            
            saveLocalLinks();
            renderTools();
            closeUploadToolModal();
            showNotif('✅ Ссылка добавлена', 'success');
            return;
        }
        
        // Если файл
        var fileInput = document.getElementById('toolFile');
        var file = fileInput?.files?.[0];
        
        if (!file) {
            showNotif('❌ Выберите файл для загрузки', 'error');
            return;
        }
        
        if (file.size > 100 * 1024 * 1024) {
            showNotif('❌ Максимальный размер файла: 100 МБ', 'error');
            return;
        }
        
        showNotif('⏳ Загрузка...', 'info');
        
        try {
            var formData = new FormData();
            formData.append('file', file);
            
            var response = await fetch('/api/tools/upload', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + getToken()
                },
                body: formData
            });
            
            var data = await response.json();
            
            if (data && data.success) {
                var ext = data.file.type || '';
                var icon = getFileIcon(ext);
                
                tools.push({
                    id: 'srv_' + data.file.path,
                    name: name,
                    desc: desc || formatFileSize(data.file.size),
                    type: ext.replace('.', ''),
                    icon: icon,
                    path: data.file.path,
                    size: data.file.size,
                    uploadedAt: new Date().toISOString(),
                    isServer: true,
                    isLink: false
                });
                
                renderTools();
                closeUploadToolModal();
                showNotif('✅ Файл загружен: ' + file.name, 'success');
            } else {
                showNotif('❌ ' + ((data && data.error) || 'Ошибка загрузки'), 'error');
            }
        } catch(e) {
            console.error('Upload error:', e);
            showNotif('❌ Ошибка соединения с сервером', 'error');
        }
    }
    
    // ============================================
    // УДАЛЕНИЕ
    // ============================================
    
    async function removeTool(id) {
        if (!confirm('Удалить эту утилиту?')) return;
        
        var tool = tools.find(function(t) { return t.id === id; });
        if (!tool) return;
        
        // Если файл на сервере — удаляем через API
        if (tool.isServer) {
            try {
                var filename = tool.path.split('/').pop();
                await fetch('/api/tools/' + encodeURIComponent(filename), {
                    method: 'DELETE',
                    headers: {
                        'Authorization': 'Bearer ' + getToken()
                    }
                });
            } catch(e) {
                console.warn('Ошибка удаления с сервера:', e);
            }
        }
        
        // Удаляем из локального массива
        tools = tools.filter(function(t) { return t.id !== id; });
        
        // Сохраняем ссылки
        saveLocalLinks();
        
        renderTools();
        showNotif('🗑️ Утилита удалена', 'info');
    }
    
    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ
    // ============================================
    
    function getToken() {
        return localStorage.getItem('token') || 
               localStorage.getItem('warpoint_token') || 
               '';
    }
    
    function saveLocalLinks() {
        var linksOnly = tools.filter(function(t) { return !t.isServer; });
        localStorage.setItem('warpoint_tools', JSON.stringify(linksOnly));
    }
    
    function getFileExtension(filename) {
        if (!filename) return '';
        var parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }
    
    function getFileIcon(ext) {
        var icons = {
            exe: '💻', msi: '📦', bat: '📜', ps1: '⚡', cmd: '⬛',
            zip: '📚', rar: '📚', '7z': '📚', tar: '📚', gz: '📚',
            pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
            ppt: '📽️', pptx: '📽️', txt: '📃', csv: '📊',
            png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
            mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
            mp3: '🎵', wav: '🎵', flac: '🎵',
            iso: '💿', dmg: '💿',
            apk: '📱', ipa: '📱'
        };
        return icons[ext] || '📁';
    }
    
    function cleanFileName(filename) {
        if (!filename) return 'Файл';
        // Убираем таймштамп из имени
        return filename.replace(/_\d{13}\./, '.');
    }
    
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }
    
    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            var d = new Date(dateStr);
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch(e) {
            return '';
        }
    }
    
    function escapeHTML(str) {
        if (!str) return '';
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, function(m) { return map[m]; });
    }
    
    function escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }
    
    function showNotif(msg, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(msg, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(msg, type);
        }
    }
    
    // ============================================
    // ЭКСПОРТ
    // ============================================
    
    window.initTools = initTools;
    window.toolsRemove = removeTool;
    window.openUploadToolModal = openUploadToolModal;
    window.closeUploadToolModal = closeUploadToolModal;
    window.addTool = addTool;
    
    console.log('✅ tools.js v3.0 загружен');
})();