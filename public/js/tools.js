// public/js/tools.js
(function() {
    'use strict';
    
    var tools = [];
    
    function initTools() {
        var uploadBtn = document.getElementById('uploadToolBtn');
        if (uploadBtn) {
            uploadBtn.onclick = function() { openUploadToolModal(); };
        }
        loadTools();
    }
    
    function loadTools() {
        // Загружаем из localStorage
        var saved = localStorage.getItem('warpoint_tools');
        tools = saved ? JSON.parse(saved) : getDefaultTools();
        renderTools();
    }
    
    function getDefaultTools() {
        return [
            { id: 1, name: 'Калькулятор', desc: 'Встроенный калькулятор Windows', type: 'exe', icon: '🧮', path: 'calc.exe' },
            { id: 2, name: 'Блокнот', desc: 'Текстовый редактор', type: 'exe', icon: '📝', path: 'notepad.exe' },
            { id: 3, name: 'Проводник', desc: 'Файловый менеджер', type: 'exe', icon: '📁', path: 'explorer.exe' },
            { id: 4, name: 'Командная строка', desc: 'cmd.exe', type: 'exe', icon: '⬛', path: 'cmd.exe' },
            { id: 5, name: 'Диск C', desc: 'Открыть диск C', type: 'exe', icon: '💾', path: 'C:' }
        ];
    }
    
    function saveTools() {
        localStorage.setItem('warpoint_tools', JSON.stringify(tools));
    }
    
    function renderTools() {
        var grid = document.getElementById('toolsGrid');
        if (!grid) return;
        
        if (tools.length === 0) {
            grid.innerHTML = '<div class="loading-spinner">Нет инструментов. Загрузите первый!</div>';
            return;
        }
        
        grid.innerHTML = tools.map(function(t) {
            return '<div class="tool-card">' +
                '<div class="tool-icon">' + (t.icon || '🔧') + '</div>' +
                '<div class="tool-name">' + escapeHTML(t.name) + '</div>' +
                '<div class="tool-desc">' + escapeHTML(t.desc || '') + '</div>' +
                '<div class="tool-meta">' + (t.type || 'url').toUpperCase() + '</div>' +
                '<div class="tool-actions">' +
                    '<button class="btn-launch" onclick="window.launchTool(\'' + escapeAttr(t.path) + '\', \'' + (t.type || 'exe') + '\')">🚀 Запустить</button>' +
                    '<button class="btn-download" onclick="window.deleteTool(' + t.id + ')">🗑️</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }
    
    function launchTool(path, type) {
        if (!path) return;
        
        // Ссылки открываем в новой вкладке
        if (type === 'url' || path.startsWith('http://') || path.startsWith('https://')) {
            window.open(path, '_blank');
            showNotif('🔗 Открываем ссылку...', 'info');
            return;
        }
        
        // Локальные файлы — через URL scheme
        if (path.match(/^[a-zA-Z]:\\/) || path.match(/^[a-zA-Z]:$/)) {
            // Локальный путь
            window.open('file:///' + path.replace(/\\/g, '/'), '_blank');
            showNotif('📂 Открываем: ' + path, 'info');
            return;
        }
        
        // Обычные программы
        var a = document.createElement('a');
        a.href = path;
        a.click();
        showNotif('🚀 Запуск: ' + path, 'info');
    }
    
    function deleteTool(id) {
        if (!confirm('Удалить этот инструмент?')) return;
        tools = tools.filter(function(t) { return t.id !== id; });
        saveTools();
        renderTools();
        showNotif('🗑️ Инструмент удалён', 'info');
    }
    
    function openUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (modal) modal.style.display = 'flex';
    }
    
    function closeUploadToolModal() {
        var modal = document.getElementById('uploadToolModal');
        if (modal) modal.style.display = 'none';
    }
    
    function addTool() {
        var name = document.getElementById('toolName')?.value.trim();
        var desc = document.getElementById('toolDesc')?.value.trim();
        var type = document.getElementById('toolType')?.value || 'url';
        var path = document.getElementById('toolPath')?.value.trim();
        
        if (!name || !path) {
            showNotif('❌ Заполните название и путь', 'error');
            return;
        }
        
        var icons = { url: '🌐', exe: '💻', bat: '📜', msi: '📦' };
        
        tools.push({
            id: Date.now(),
            name: name,
            desc: desc || '',
            type: type,
            icon: icons[type] || '🔧',
            path: path
        });
        
        saveTools();
        renderTools();
        closeUploadToolModal();
        
        // Очищаем поля
        document.getElementById('toolName').value = '';
        document.getElementById('toolDesc').value = '';
        document.getElementById('toolPath').value = '';
        
        showNotif('✅ Инструмент добавлен', 'success');
    }
    
    function showNotif(msg, type) {
        if (typeof window.showSystemNotification === 'function') {
            window.showSystemNotification(msg, type);
        } else if (typeof window.showNotif === 'function') {
            window.showNotif(msg, type);
        }
    }
    
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    
    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/'/g,"\\'").replace(/"/g,'\\"');
    }
    
    window.initTools = initTools;
    window.launchTool = launchTool;
    window.deleteTool = deleteTool;
    window.openUploadToolModal = openUploadToolModal;
    window.closeUploadToolModal = closeUploadToolModal;
    window.addTool = addTool;
})();