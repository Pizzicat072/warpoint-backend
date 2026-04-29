// public/js/tools.js — УТИЛИТЫ v4.0
(function() {
    'use strict';
    
    var tools = [];
    var loaded = false;
    
    window.initTools = function() {
        if (loaded) {
            renderTools();
            return;
        }
        loaded = true;
        loadServerFiles();
    };
    
    function loadServerFiles() {
        var token = localStorage.getItem('token') || localStorage.getItem('warpoint_token') || '';
        
        fetch('/api/tools', {
            headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            tools = [];
            
            // Добавляем файлы с сервера
            if (data && data.tools) {
                data.tools.forEach(function(f) {
                    var ext = f.name.split('.').pop().toLowerCase();
                    var icons = { exe:'💻', msi:'📦', bat:'📜', zip:'📚', pdf:'📄' };
                    tools.push({
                        id: f.name,
                        name: f.name.replace(/_\d{13}\./, '.'),
                        desc: formatSize(f.size),
                        type: ext,
                        icon: icons[ext] || '📁',
                        path: f.path,
                        size: f.size,
                        isServer: true
                    });
                });
            }
            
            // Добавляем ссылки из localStorage
            try {
                var saved = JSON.parse(localStorage.getItem('warpoint_tools') || '[]');
                saved.forEach(function(s) { tools.push(s); });
            } catch(e) {}
            
            renderTools();
        })
        .catch(function(err) {
            console.error('Ошибка:', err);
            renderTools();
        });
    }
    
    function renderTools() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;
        
        if (tools.length === 0) {
            grid.innerHTML = 
            '<div style="text-align:center;padding:40px;grid-column:1/-1;">' +
                '<div style="font-size:48px;margin-bottom:12px;">📭</div>' +
                '<div style="color:#e2e8f0;font-size:16px;">Нет утилит</div>' +
            '</div>';
            return;
        }
        
        var html = '';
        tools.forEach(function(t) {
            html += 
            '<div class="tool-card">' +
                '<div class="tool-icon">' + (t.icon || '📁') + '</div>' +
                '<div class="tool-name">' + esc(t.name) + '</div>' +
                '<div class="tool-desc">' + esc(t.desc || '') + '</div>' +
                '<div class="tool-actions">' +
                    (t.isServer ? 
                        '<a href="' + t.path + '" download class="btn-launch">📥 Скачать</a>' :
                        '<a href="' + esc(t.path) + '" target="_blank" class="btn-launch">🔗 Открыть</a>'
                    ) +
                    '<button class="btn-delete-tool" onclick="window.toolsDelete(\'' + t.id + '\')">🗑️</button>' +
                '</div>' +
            '</div>';
        });
        
        grid.innerHTML = html;
    }
    
    window.toolsDelete = function(id) {
        if (!confirm('Удалить?')) return;
        
        var tool = tools.find(function(t) { return t.id === id; });
        if (!tool) return;
        
        if (tool.isServer) {
            fetch('/api/tools/' + encodeURIComponent(tool.path.split('/').pop()), {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
            });
        }
        
        tools = tools.filter(function(t) { return t.id !== id; });
        
        // Сохраняем ссылки
        var links = tools.filter(function(t) { return !t.isServer; });
        localStorage.setItem('warpoint_tools', JSON.stringify(links));
        
        renderTools();
    };
    
    window.openUploadToolModal = function() {
        var m = document.getElementById('uploadToolModal');
        if (m) m.style.display = 'flex';
        var f = document.getElementById('toolFile');
        if (f) { f.style.display = 'block'; f.value = ''; }
        var u = document.getElementById('toolPath');
        if (u) { u.style.display = 'none'; u.value = ''; }
        var n = document.getElementById('toolName');
        if (n) n.value = '';
    };
    
    window.closeUploadToolModal = function() {
        var m = document.getElementById('uploadToolModal');
        if (m) m.style.display = 'none';
    };
    
    window.addTool = function() {
        var name = document.getElementById('toolName')?.value?.trim();
        var type = document.getElementById('toolType')?.value || 'exe';
        
        if (!name) { alert('Введите название'); return; }
        
        if (type === 'url') {
            var url = document.getElementById('toolPath')?.value?.trim();
            if (!url) { alert('Введите ссылку'); return; }
            
            tools.push({
                id: 'link_' + Date.now(),
                name: name,
                desc: url,
                type: 'url',
                icon: '🌐',
                path: url,
                isServer: false
            });
            
            var links = tools.filter(function(t) { return !t.isServer; });
            localStorage.setItem('warpoint_tools', JSON.stringify(links));
            renderTools();
            window.closeUploadToolModal();
            return;
        }
        
        var file = document.getElementById('toolFile')?.files?.[0];
        if (!file) { alert('Выберите файл'); return; }
        
        var fd = new FormData();
        fd.append('file', file);
        
        fetch('/api/tools/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') },
            body: fd
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var ext = data.file.type.replace('.', '');
                tools.push({
                    id: data.file.path,
                    name: name,
                    desc: formatSize(data.file.size),
                    type: ext,
                    icon: '📁',
                    path: data.file.path,
                    size: data.file.size,
                    isServer: true
                });
                renderTools();
                window.closeUploadToolModal();
            }
        })
        .catch(function(err) {
            console.error(err);
            alert('Ошибка загрузки');
        });
    };
    
    function formatSize(b) {
        if (!b) return '0 B';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }
    
    function esc(s) {
        if (!s) return '';
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
})();