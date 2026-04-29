// public/js/tools.js — УТИЛИТЫ С ЗАГРУЗКОЙ ФАЙЛОВ v2.0
// Без заготовок, только загруженные файлы и ссылки

(function() {
    'use strict';
    
    var tools = [];
    var serverTools = [];
    
    function initTools() {
        var uploadBtn = document.getElementById('uploadToolBtn');
        if (uploadBtn) {
            uploadBtn.onclick = function() { openUploadToolModal(); };
        }
        
        var toolType = document.getElementById('toolType');
        if (toolType) {
            toolType.onchange = function() {
                var fileInput = document.getElementById('toolFile');
                var urlInput = document.getElementById('toolPath');
                if (this.value === 'url') {
                    if (fileInput) fileInput.style.display = 'none';
                    if (urlInput) urlInput.style.display = 'block';
                } else {
                    if (fileInput) fileInput.style.display = 'block';
                    if (urlInput) urlInput.style.display = 'none';
                }
            };
        }
        
        loadTools();
    }
    
    async function loadTools() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;
        
        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Загрузка утилит...</div>';
        
        tools = [];
        
        // Грузим сохранённые ссылки из localStorage
        var saved = localStorage.getItem('warpoint_tools');
        if (saved) {
            try { tools = JSON.parse(saved); } catch(e) { tools = []; }
        }
        
        // Грузим файлы с сервера
        try {
            var response = await apiCall('/tools');
            if (response && response.success) {
                serverTools = response.tools || [];
                serverTools.forEach(function(st) {
                    var exists = tools.find(function(t) { return t.path === st.path; });
                    if (!exists) {
                        var ext = st.name.split('.').pop().toLowerCase();
                        var icons = { 
                            exe: '💻', msi: '📦', bat: '📜', ps1: '⚡', 
                            zip: '📚', rar: '📚', pdf: '📄', doc: '📝',
                            png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️',
                            mp4: '🎬', mp3: '🎵', txt: '📃', csv: '📊'
                        };
                        tools.push({
                            id: st.name,
                            name: st.name.replace(/_\d+\./, '.'),
                            desc: formatSize(st.size) + ' • ' + new Date(st.uploadedAt).toLocaleDateString('ru-RU'),
                            type: ext,
                            icon: icons[ext] || '📁',
                            path: st.path,
                            size: st.size,
                            isServer: true
                        });
                    }
                });
            }
        } catch(e) {
            console.error('Ошибка загрузки утилит:', e);
        }
        
        renderTools();
    }
    
    function renderTools() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;
        
        if (tools.length === 0) {
            grid.innerHTML = '<div class="loading-spinner" style="grid-column:1/-1;">' +
                '<div style="font-size:64px;margin-bottom:16px;">📭</div>' +
                '<div style="font-size:16px;color:#e2e8f0;margin-bottom:8px;">Нет утилит</div>' +
                '<div style="font-size:13px;color:#64748b;">Загрузите первую утилиту или добавьте ссылку</div>' +
            '</div>';
            return;
        }
        
        grid.innerHTML = tools.map(function(t) {
            var isServer = t.isServer;
            var typeLabel = t.type ? t.type.toUpperCase() : 'ФАЙЛ';
            var badgeText = isServer ? '☁️ На сервере' : '🔗 Ссылка';
            var badgeClass = isServer ? 'tool-badge-server' : 'tool-badge-link';
            
            return '<div class="tool-card' + (isServer ? ' tool-server' : ' tool-link') + '">' +
                '<div class="tool-card-badge ' + badgeClass + '">' + badgeText + '</div>' +
                '<div class="tool-icon">' + (t.icon || '🔧') + '</div>' +
                '<div class="tool-name">' + escapeHTML(t.name) + '</div>' +
                '<div class="tool-desc">' + escapeHTML(t.desc || '') + '</div>' +
                '<div class="tool-meta">' + typeLabel + (t.size ? ' • ' + formatSize(t.size) : '') + '</div>' +
                '<div class="tool-actions">' +
                    (isServer ?
                        '<a href="' + t.path + '" download class="btn-launch" style="text-decoration:none;text-align:center;">📥 Скачать</a>' :
                        '<a href="' + escapeAttr(t.path) + '" target="_blank" rel="noopener" class="btn-launch btn-launch-link" style="text-decoration:none;text-align:center;">🔗 Открыть</a>'
                    ) +
                    '<button class="btn-delete-tool" onclick="window.removeTool(\'' + escapeAttr(String(t.id)) + '\')" title="Удалить">🗑️</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }
    
    function removeTool(id) {
        if (!confirm('Удалить эту утилиту?')) return;
        
        var tool = tools.find(function(t) { return String(t.id) === String(id); });
        
        if (tool && tool.isServer) {
            var filename = tool.path.split('/').pop();
            apiCall('/tools/' + encodeURIComponent(filename), 'DELETE').then(function(res) {
                if (res && res.success) {
                    tools = tools.filter(function(t) { return String(t.id) !== String(id); });
                    saveLocalTools();
                    renderTools();
                    showNotif('🗑️ Утилита удалена', 'info');
                }
            }).catch(function() {
                tools = tools.filter(function(t) { return String(t.id) !== String(id); });
                saveLocalTools();
                renderTools();
                showNotif('🗑️ Утилита удалена', 'info');
            });
        } else {
            tools = tools.filter(function(t) { return String(t.id) !== String(id); });
            saveLocalTools();
            renderTools();
            showNotif('🗑️ Утилита удалена', 'info');
        }
    }
    
    function saveLocalTools() {
        var localOnly = tools.filter(function(t) { return !t.isServer; });
        localStorage.setItem('warpoint_tools', JSON.stringify(localOnly));
    }
    
    function openUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active');
            
            var nameEl = document.getElementById('toolName');
            var descEl = document.getElementById('toolDesc');
            var urlEl = document.getElementById('toolPath');
            var typeEl = document.getElementById('toolType');
            var fileEl = document.getElementById('toolFile');
            
            if (nameEl) nameEl.value = '';
            if (descEl) descEl.value = '';
            if (urlEl) urlEl.value = '';
            if (typeEl) typeEl.value = 'exe';
            if (fileEl) {
                fileEl.style.display = 'block';
                fileEl.value = '';
            }
            if (urlEl) urlEl.style.display = 'none';
        }
    }
    
    function closeUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
        }
    }
    
    async function addTool() {
        var nameEl = document.getElementById('toolName');
        var descEl = document.getElementById('toolDesc');
        var typeEl = document.getElementById('toolType');
        var fileEl = document.getElementById('toolFile');
        var urlEl = document.getElementById('toolPath');
        
        var name = nameEl ? nameEl.value.trim() : '';
        var desc = descEl ? descEl.value.trim() : '';
        var type = typeEl ? typeEl.value : 'exe';
        
        if (!name) { showNotif('❌ Введите название', 'error'); return; }
        
        // Если тип URL — просто добавляем ссылку
        if (type === 'url') {
            var url = urlEl ? urlEl.value.trim() : '';
            if (!url) { showNotif('❌ Введите ссылку', 'error'); return; }
            
            tools.push({ 
                id: Date.now().toString(), 
                name: name, 
                desc: desc || url, 
                type: 'url', 
                icon: '🌐', 
                path: url 
            });
            saveLocalTools();
            renderTools();
            closeUploadToolModal();
            showNotif('✅ Ссылка добавлена', 'success');
            return;
        }
        
        // Загрузка файла
        var file = fileEl ? fileEl.files[0] : null;
        if (!file) { showNotif('❌ Выберите файл', 'error'); return; }
        
        if (file.size > 100 * 1024 * 1024) {
            showNotif('❌ Файл слишком большой (макс. 100 МБ)', 'error');
            return;
        }
        
        showNotif('⏳ Загрузка файла...', 'info');
        
        var formData = new FormData();
        formData.append('file', file);
        
        try {
            var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
            var response = await fetch('/api/tools/upload', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            
            var data = await response.json();
            
            if (data.success) {
                var ext = data.file.type;
                var icons = { '.exe': '💻', '.msi': '📦', '.bat': '📜', '.ps1': '⚡', '.zip': '📚', '.pdf': '📄' };
                
                tools.push({
                    id: data.file.path,
                    name: name,
                    desc: desc || formatSize(data.file.size),
                    type: ext.replace('.', ''),
                    icon: icons[ext] || '📁',
                    path: data.file.path,
                    size: data.file.size,
                    isServer: true
                });
                
                saveLocalTools();
                renderTools();
                closeUploadToolModal();
                showNotif('✅ Файл загружен: ' + file.name, 'success');
            } else {
                showNotif('❌ ' + (data.error || 'Ошибка загрузки'), 'error');
            }
        } catch(e) {
            console.error('Upload error:', e);
            showNotif('❌ Ошибка соединения', 'error');
        }
    }
    
    function formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(1) + ' GB';
    }
    
    function escapeHTML(str) {
        if (!str) return '';
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(str).replace(/[&<>"']/g, function(m) { return map[m]; });
    }
    
    function escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/</g, '\\x3C').replace(/>/g, '\\x3E');
    }
    
    function showNotif(msg, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(msg, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(msg, type);
        } else {
            console.log('[' + type + '] ' + msg);
        }
    }
    
    async function apiCall(endpoint, method, body) {
        if (method === undefined) method = 'GET';
        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token');
        var options = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        if (body) options.body = JSON.stringify(body);
        try {
            var response = await fetch('/api' + endpoint, options);
            return await response.json();
        } catch(e) {
            console.error('API error:', e);
            return { success: false, error: 'Ошибка соединения' };
        }
    }
    
    // Экспорт
    window.initTools = initTools;
    window.removeTool = removeTool;
    window.openUploadToolModal = openUploadToolModal;
    window.closeUploadToolModal = closeUploadToolModal;
    window.addTool = addTool;
    
    console.log('✅ tools.js v2.0 загружен');
})();