// public/js/dashboard.js — ОБЁРНУТ В IIFE
(function() {
    'use strict';
    
    // ============================================
    // ЗАЩИТА ОТ РЕКУРСИИ И ЧАСТЫХ ЗАПРОСОВ
    // ============================================
    let dashboardInterval = null;
    let bonusCheckInterval = null;
    let shiftTimerInterval = null;
    let hiddenBlocks = new Set();
    let isUpdatingDashboard = false;
    let lastDashboardUpdate = 0;
    const MIN_UPDATE_INTERVAL = 5000;
    let isFetchingWeather = false;
    let lastWeatherFetch = 0;
    const WEATHER_FETCH_INTERVAL = 300000;
    let isClaimingBonus = false;
    let cachedFundAmount = 0;

    // ============================================
    // МАГАЗИН СТИЛЕЙ
    // ============================================
    const availableStyles = [
        { id: 'standart', name: 'Стандарт', price: 0, icon: '🔮', desc: 'Классический прозрачный стиль' },
        { id: 'phantom', name: 'Фантом', price: 500, icon: '🟣', desc: 'Фиолетовое неоновое свечение' },
        { id: 'impulse', name: 'Импульс', price: 1000, icon: '💛', desc: 'Золотистый энергичный стиль' },
        { id: 'glow', name: 'Сияние', price: 1500, icon: '✨', desc: 'Северное сияние' },
        { id: 'cyber', name: 'Кибер', price: 2000, icon: '🤖', desc: 'Киберпанк розово-фиолетовый' },
        { id: 'legend', name: 'Легенда', price: 3000, icon: '💎', desc: 'Королевский пурпурный' },
        { id: 'cosmic', name: 'Космос', price: 5000, icon: '🌠', desc: 'Звёздная бездна' },
        { id: 'hologram', name: 'Голограмма', price: 7500, icon: '📡', desc: 'Голографический стиль' },
        { id: 'inferno', name: 'Инферно', price: 4000, icon: '🔥', desc: 'Огненно-красный' },
        { id: 'frozen', name: 'Мороз', price: 4000, icon: '❄️', desc: 'Ледяной голубой' },
        { id: 'shadow', name: 'Тень', price: 3500, icon: '🌑', desc: 'Чёрный матовый' },
        { id: 'toxic', name: 'Токсин', price: 4500, icon: '☣️', desc: 'Ядовито-зелёный' },
        { id: 'plasma', name: 'Плазма', price: 5500, icon: '⚡', desc: 'Электрический синий' },
        { id: 'void', name: 'Пустота', price: 6000, icon: '🕳️', desc: 'Глубокий фиолетовый' },
        { id: 'carbon', name: 'Карбон', price: 6500, icon: '🖤', desc: 'Чёрный с текстурой' }
    ];
    window.availableStyles = availableStyles;

    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    function getTobolskNow() {
        if (typeof window.getTobolskNow === 'function' && window.getTobolskNow !== getTobolskNow) {
            return window.getTobolskNow();
        }
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
    }

    function formatDateSimple(dateStr) {
        if (!dateStr) return '—';
        const parts = dateStr.split('-');
        const day = parseInt(parts[2]);
        const month = parseInt(parts[1]);
        const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${day} ${monthNames[month - 1]}`;
    }

    // ============================================
    // СТИЛИ
    // ============================================
    function renderStylesShop() {
        const container = document.getElementById('stylesShopGrid');
        if (!container) return;
        
        if (!window.app) window.app = {};
        
        const isDirector = window.app.currentUserRole === 'director';
        const currentStyle = window.app.userStyle || 'standart';
        let boughtStyles = window.app.userBoughtStyles || ['standart'];
        
        if (isDirector) boughtStyles = availableStyles.map(s => s.id);
        
        const currentUser = window.app.currentUser;
        const userCoins = window.app.profiles?.[currentUser]?.coins || 0;
        
        let html = '';
        for (const style of availableStyles) {
            const isBought = boughtStyles.includes(style.id);
            const isCurrent = currentStyle === style.id;
            
            let buttonHtml = '';
            if (isCurrent) buttonHtml = `<button class="style-btn style-btn-current" disabled>✅ Активен</button>`;
            else if (isBought) buttonHtml = `<button class="style-btn style-btn-apply" onclick="window.applyBoughtStyle('${style.id}')">🎨 Применить</button>`;
            else {
                const canBuy = userCoins >= style.price || isDirector;
                buttonHtml = `<button class="style-btn style-btn-buy" onclick="window.buyStyle('${style.id}', ${style.price})" ${!canBuy ? 'disabled style="opacity:0.5"' : ''}>Купить за ${style.price} 🪙</button>`;
            }
            
            let priceDisplay = isDirector && style.price > 0 ? '👑 Бесплатно' : (style.price === 0 ? '🔮 Бесплатно' : style.price + ' 🪙');
            
            html += `
                <div class="style-card ${isBought ? 'bought' : ''} ${isCurrent ? 'current' : ''}" data-style-id="${style.id}"
                     onmouseenter="window.previewStyle('${style.id}')" onmouseleave="window.cancelPreview()">
                    <div class="style-preview"><span style="font-size:48px;">${style.icon}</span></div>
                    <div class="style-info">
                        <div class="style-name">${style.name}</div>
                        <div class="style-price">${priceDisplay}</div>
                        <div class="style-desc">${style.desc}</div>
                        <div class="style-actions">${buttonHtml}</div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    function initStylesShop() { renderStylesShop(); }

    async function buyStyle(styleId, price) {
        if (!window.app) { showNotif('Ошибка: данные пользователя не загружены', 'error'); return false; }
        if (window.app.currentUserRole === 'director') { showNotif('Директору все стили доступны бесплатно!', 'warning'); return false; }
        
        const currentUser = window.app.currentUser;
        const userCoins = window.app.profiles?.[currentUser]?.coins || 0;
        
        if (userCoins < price) { showNotif(`❌ Недостаточно монет! Нужно ${price} 🪙`, 'error'); return false; }
        
        const boughtStyles = window.app.userBoughtStyles || ['standart'];
        if (boughtStyles.includes(styleId)) { showNotif('Стиль уже куплен!', 'warning'); return false; }
        
        try {
            const response = await apiCall('/user/buy-style', 'POST', { style: styleId, price: price });
            if (response && response.success) {
                window.app.userBoughtStyles = response.boughtStyles;
                if (window.app.profiles[currentUser]) window.app.profiles[currentUser].coins = response.remainingCoins;
                renderStylesShop();
                refreshAllBalanceDisplays();
                showNotif(`✨ Стиль "${getStyleName(styleId)}" куплен!`, 'success');
                return true;
            } else {
                showNotif(response?.error || 'Ошибка при покупке', 'error');
                return false;
            }
        } catch (err) {
            console.error('Ошибка покупки:', err);
            showNotif('Ошибка соединения с сервером', 'error');
            return false;
        }
    }

    async function applyBoughtStyle(styleId) {
        if (!window.app) { showNotif('Ошибка: данные пользователя не загружены', 'error'); return false; }
        
        const isDirector = window.app.currentUserRole === 'director';
        let boughtStyles = window.app.userBoughtStyles || ['standart'];
        if (isDirector) boughtStyles = availableStyles.map(s => s.id);
        
        if (!boughtStyles.includes(styleId)) { showNotif('Стиль не куплен!', 'error'); return false; }
        if (window.app.userStyle === styleId) { showNotif('Этот стиль уже активен!', 'info'); return false; }
        
        try {
            const response = await apiCall('/user/apply-style', 'POST', { style: styleId });
            if (response && response.success) {
                window.app.userStyle = styleId;
                
                const dashboardClasses = [
                    'dashboard-style-standart', 'dashboard-style-phantom', 'dashboard-style-impulse',
                    'dashboard-style-glow', 'dashboard-style-cyber', 'dashboard-style-legend',
                    'dashboard-style-cosmic', 'dashboard-style-hologram', 'dashboard-style-inferno',
                    'dashboard-style-frozen', 'dashboard-style-shadow', 'dashboard-style-toxic',
                    'dashboard-style-plasma', 'dashboard-style-void', 'dashboard-style-carbon'
                ];
                dashboardClasses.forEach(cls => document.body.classList.remove(cls));
                
                if (styleId !== 'standart') document.body.classList.add(`dashboard-style-${styleId}`);
                else document.body.classList.add('dashboard-style-standart');
                
                stopBlockParticles();
                setTimeout(() => initBlockParticles(), 100);
                
                renderStylesShop();
                showNotif(`🎨 Стиль "${getStyleName(styleId)}" применён!`, 'success');
                return true;
            }
        } catch (err) {
            console.error('Ошибка применения:', err);
            showNotif('Ошибка при применении стиля', 'error');
            return false;
        }
    }

    function getStyleName(styleId) {
        const style = availableStyles.find(s => s.id === styleId);
        return style ? style.name : styleId;
    }

    let previewTimeout = null;
    let lastPreviewStyle = null;

    function previewStyle(styleId) {
        if (previewTimeout) clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => {
            if (lastPreviewStyle !== styleId) {
                document.body.classList.remove('style-neon', 'style-premium', 'style-aurora', 'style-cyber', 'style-royal', 'style-cosmic', 'style-hologram');
                if (styleId !== 'standart') document.body.classList.add(`style-${styleId}`);
                lastPreviewStyle = styleId;
            }
        }, 50);
    }

    function cancelPreview() {
        if (previewTimeout) clearTimeout(previewTimeout);
        previewTimeout = setTimeout(() => {
            if (window.app?.userStyle && window.app.userStyle !== 'standart') {
                document.body.classList.remove('style-neon', 'style-premium', 'style-aurora', 'style-cyber', 'style-royal', 'style-cosmic', 'style-hologram');
                document.body.classList.add(`style-${window.app.userStyle}`);
            } else {
                document.body.classList.remove('style-neon', 'style-premium', 'style-aurora', 'style-cyber', 'style-royal', 'style-cosmic', 'style-hologram');
            }
            lastPreviewStyle = null;
        }, 100);
    }

    // ============================================
    // НАСТРОЙКИ БЛОКОВ
    // ============================================
    function loadHiddenBlocks() {
        const saved = localStorage.getItem('dashboardHiddenBlocks');
        if (saved) { try { hiddenBlocks = new Set(JSON.parse(saved)); } catch(e) {} }
    }

    function saveHiddenBlocks() {
        localStorage.setItem('dashboardHiddenBlocks', JSON.stringify([...hiddenBlocks]));
    }

    function applyHiddenBlocks() {
        document.querySelectorAll('.dashboard-content > [data-block-id]').forEach(block => {
            const blockId = block.dataset.blockId;
            if (blockId && hiddenBlocks.has(blockId)) block.style.display = 'none';
            else block.style.display = '';
        });
        updateTogglesState();
    }

    function updateTogglesState() {
        const blockIds = ['welcome-panel', 'info-grid', 'quick-start', 'key-stats', 'events-section', 'activity-grid', 'quote-card'];
        blockIds.forEach(blockId => {
            const checkbox = document.getElementById(`toggle-${blockId}`);
            if (checkbox) checkbox.checked = !hiddenBlocks.has(blockId);
        });
    }

    function toggleBlockVisibility(blockId, isVisible) {
        if (isVisible) hiddenBlocks.delete(blockId);
        else hiddenBlocks.add(blockId);
        saveHiddenBlocks();
        applyHiddenBlocks();
    }

    function showAllHiddenBlocks() {
        hiddenBlocks.clear();
        saveHiddenBlocks();
        applyHiddenBlocks();
        showNotif('Все скрытые блоки восстановлены', 'success');
    }

    function resetAllDashboardSettings() {
        hiddenBlocks.clear();
        saveHiddenBlocks();
        applyHiddenBlocks();
        localStorage.removeItem('dashboardPreset');
        showNotif('Все настройки дашборда сброшены', 'success');
    }

    function applyDashboardPreset(presetName) {
        const presets = {
            default: ['welcome-panel', 'info-grid', 'quick-start', 'key-stats', 'events-section', 'activity-grid', 'quote-card'],
            compact: ['welcome-panel', 'key-stats', 'activity-grid'],
            focus: ['welcome-panel', 'quick-start', 'key-stats', 'events-section'],
            minimal: ['welcome-panel', 'key-stats']
        };
        
        const visibleBlocks = presets[presetName] || presets.default;
        const allBlocks = ['welcome-panel', 'info-grid', 'quick-start', 'key-stats', 'events-section', 'activity-grid', 'quote-card'];
        
        hiddenBlocks.clear();
        allBlocks.forEach(blockId => { if (!visibleBlocks.includes(blockId)) hiddenBlocks.add(blockId); });
        
        saveHiddenBlocks();
        applyHiddenBlocks();
        localStorage.setItem('dashboardPreset', presetName);
        
        const presetNames = { default: 'Стандартный', compact: 'Компактный', focus: 'Фокус', minimal: 'Минимальный' };
        showNotif(`Пресет "${presetNames[presetName]}" применён`, 'success');
    }

    function initDashboardSettings() {
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', () => {
                const preset = card.dataset.preset;
                if (preset) applyDashboardPreset(preset);
            });
        });
        
        const blockIds = ['welcome-panel', 'info-grid', 'quick-start', 'key-stats', 'events-section', 'activity-grid', 'quote-card'];
        blockIds.forEach(blockId => {
            const checkbox = document.getElementById(`toggle-${blockId}`);
            if (checkbox) checkbox.addEventListener('change', (e) => toggleBlockVisibility(blockId, e.target.checked));
        });
    }

    // ============================================
    // ПОГОДА И ВРЕМЯ
    // ============================================
    async function fetchWeather() {
        const now = Date.now();
        if (now - lastWeatherFetch < WEATHER_FETCH_INTERVAL) return;
        if (isFetchingWeather) return;
        
        const iconEl = document.getElementById('weatherIcon');
        if (!iconEl) return;
        
        lastWeatherFetch = now;
        isFetchingWeather = true;
        
        try {
            const response = await fetch('/api/weather?force=' + Date.now());
            if (!response.ok) throw new Error('HTTP error: ' + response.status);
            
            const data = await response.json();
            
            if (data && data.success) {
                const temp = data.temp;
                const nowTime = getTobolskNow();
                const hour = nowTime.getHours();
                
                let mainIcon = data.icon || '🌡️';
                const isNight = hour < 6 || hour >= 20;
                
                if (isNight) {
                    if (mainIcon === '☀️') mainIcon = '🌙';
                    else if (mainIcon === '🌧️') mainIcon = '🌙🌧️';
                    else if (mainIcon === '⛈️') mainIcon = '🌙⛈️';
                    else if (mainIcon === '☁️') mainIcon = '☁️🌙';
                    else mainIcon = '🌙';
                }
                
                if (iconEl) iconEl.textContent = mainIcon;
                
                const tempEl = document.getElementById('weatherTemp');
                if (tempEl) tempEl.textContent = data.tempDisplay ? data.tempDisplay + '°C' : (temp > 0 ? '+' : '') + temp + '°C';
                
                const feelsLikeEl = document.getElementById('weatherFeelsLike');
                if (feelsLikeEl) feelsLikeEl.innerHTML = data.feelsLikeDisplay ? 'ощущается как ' + data.feelsLikeDisplay + '°C' : '';
                
                const cityEl = document.getElementById('weatherCity');
                if (cityEl) cityEl.innerHTML = 'Тобольск';
                
                const descEl = document.getElementById('weatherDesc');
                if (descEl) descEl.textContent = data.desc || '';
                
                const weatherTipEl = document.getElementById('weatherTip');
                if (weatherTipEl) {
                    let tip = '';
                    if (temp <= -20) tip = '🥶 Экстрим! Оставайся в тепле!';
                    else if (temp <= -10) tip = '❄️ Очень холодно! Одевайся теплее!';
                    else if (temp <= 0) tip = '🧤 Нулевая температура! Не замёрзни!';
                    else if (temp <= 10) tip = '🧥 Прохладно, лучше надеть куртку';
                    else if (temp <= 20) tip = '😎 Отличная погода для работы!';
                    else if (temp <= 30) tip = '🕶️ Жарко! Не забывай пить воду';
                    else tip = '🥵 Адская жара! Береги себя!';
                    
                    if (isNight && temp < 0) tip = '🌙❄️ Холодная ночь! Укутайся потеплее';
                    else if (isNight) tip = '🌙 Спокойной ночи! Завтра будет продуктивный день';
                    else if (hour >= 6 && hour < 9) tip = '🌅 Доброе утро! Хорошего дня!';
                    else if (hour >= 17 && hour < 20) tip = '🌇 Вечер близко! Ты отлично поработал!';
                    
                    weatherTipEl.innerHTML = tip || '😊 Хорошего дня!';
                }
            }
        } catch (err) {
            console.error('Ошибка погоды:', err);
            if (iconEl) iconEl.textContent = '🌡️';
            const tempEl = document.getElementById('weatherTemp');
            if (tempEl) tempEl.textContent = '--°C';
        } finally {
            isFetchingWeather = false;
        }
    }

    function updateDateTime() {
        const timeElement = document.getElementById('currentTime');
        const dateElement = document.getElementById('currentDate');
        if (!timeElement) return;
        try {
            const now = getTobolskNow();
            timeElement.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            dateElement.textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        } catch (err) {}
    }

    function startDateTimeUpdater() {
        updateDateTime();
        setInterval(updateDateTime, 1000);
    }

    function updateGreetingByTime() {
        const now = getTobolskNow();
        const hour = now.getHours();
        const userName = window.app?.currentUser || 'Гость';
        const greetingText = document.getElementById('greetingText');
        if (!greetingText) return;
        
        let icon = '🌄', greeting = '';
        if (hour >= 5 && hour < 12) { icon = '🌄'; greeting = `Доброе утро, ${userName}!`; }
        else if (hour >= 12 && hour < 17) { icon = '🔆'; greeting = `Добрый день, ${userName}!`; }
        else if (hour >= 17 && hour < 22) { icon = '🌇'; greeting = `Добрый вечер, ${userName}!`; }
        else { icon = '🌙✨'; greeting = `Доброй ночи, ${userName}!`; }
        greetingText.innerHTML = `${icon} ${greeting}`;
    }

    function updateUserAvatarAndStatus() {
        const userProfile = window.app?.profiles?.[window.app?.currentUser];
        const welcomeAvatar = document.getElementById('welcomeAvatar');
        if (welcomeAvatar && userProfile) {
            if (userProfile.avatar_url) {
                welcomeAvatar.innerHTML = `<img src="${userProfile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            } else {
                welcomeAvatar.innerHTML = userProfile.avatar || '👤';
            }
        }
        
        const ratingSpan = document.getElementById('userRating');
        if (ratingSpan && userProfile) ratingSpan.textContent = userProfile.rating || 0;
        
        const statusSelect = document.getElementById('quickStatusSelect');
        if (statusSelect && userProfile) statusSelect.value = userProfile.status || '💼 Работаю';
        
        const userCoinsHeader = document.getElementById('userCoinsAmountHeader');
        if (userCoinsHeader && userProfile) userCoinsHeader.textContent = userProfile.coins || 0;
    }

    // ============================================
    // СТАТИСТИКА ДАШБОРДА
    // ============================================
    async function loadFundAmount() {
        try {
            const response = await apiCall('/fund');
            if (response && response.amount !== undefined) {
                cachedFundAmount = response.amount;
                window.fundAmount = response.amount;
                return response.amount;
            }
        } catch (err) { console.error('Ошибка загрузки фонда:', err); }
        return cachedFundAmount;
    }

    async function updateDashboardStats() {
        const now = Date.now();
        if (now - lastDashboardUpdate < MIN_UPDATE_INTERVAL) return;
        if (isUpdatingDashboard) return;
        
        lastDashboardUpdate = now;
        isUpdatingDashboard = true;
        
        try {
            const totalEmployees = window.app?.employees?.length || 0;
            const totalHint = document.getElementById('statTotalEmployeesHint');
            if (totalHint) totalHint.innerHTML = `из ${totalEmployees} сотрудников`;
            
            const today = getTobolskNow().toISOString().split('T')[0];
            const todaySchedule = window.app?.schedule?.[today] || {};
            
            const onShiftCount = Object.keys(todaySchedule).filter(emp => {
                const shift = todaySchedule[emp];
                return shift?.time && (!shift?.shift_status || shift.shift_status === 'working');
            }).length;
            
            const onShiftSpan = document.getElementById('statOnShift');
            if (onShiftSpan) onShiftSpan.textContent = onShiftCount;
            
            const activeTasks = window.app?.tasks?.filter(t => !t.is_archived) || [];
            const tasksDone = activeTasks.filter(t => t.status === 'completed').length;
            const tasksTotal = activeTasks.length;
            const tasksInProgress = activeTasks.filter(t => t.status === 'in_progress').length;
            
            const tasksText = document.getElementById('tasksProgressText');
            const tasksBar = document.getElementById('tasksProgressBar');
            if (tasksText) tasksText.innerHTML = `${tasksDone} из ${tasksTotal}`;
            if (tasksBar) tasksBar.style.width = tasksTotal > 0 ? (tasksDone / tasksTotal * 100) + '%' : '0%';
            
            const tasksInProgressSpan = document.getElementById('tasksInProgress');
            if (tasksInProgressSpan) tasksInProgressSpan.textContent = tasksInProgress;
            
            const fines = window.app?.fines || [];
            const finesCount = fines.filter(f => {
                const fineDate = new Date(f.date);
                const now = getTobolskNow();
                return fineDate.getMonth() === now.getMonth() && fineDate.getFullYear() === now.getFullYear();
            }).length;
            
            const statFinesCount = document.getElementById('statFinesCount');
            if (statFinesCount) statFinesCount.textContent = finesCount;
            
            const fundAmount = await loadFundAmount();
            const fundAmountSpan = document.getElementById('statFundAmount');
            if (fundAmountSpan) fundAmountSpan.textContent = (fundAmount || 0).toLocaleString() + ' ₽';
            
            const salaryFundEl = document.getElementById('salaryFundAmount');
            if (salaryFundEl) salaryFundEl.textContent = (fundAmount || 0).toLocaleString() + ' ₽';
            
        } finally {
            isUpdatingDashboard = false;
        }
    }

    // ============================================
    // ОБМЕН СМЕНАМИ
    // ============================================
    let pendingExchanges = [];

    async function loadPendingExchanges() {
        try {
            const response = await apiCall('/exchange/pending');
            if (response && response.success) {
                pendingExchanges = response.requests || [];
                renderExchangeNotifications();
            }
        } catch (err) { console.error('Ошибка загрузки запросов на обмен:', err); }
    }

    function renderExchangeNotifications() {
        const container = document.getElementById('exchangeNotificationsContainer');
        if (!container) return;
        
        if (pendingExchanges.length === 0) {
            container.innerHTML = '<div class="exchange-empty">Нет новых предложений</div>';
            return;
        }
        
        let html = '';
        for (const req of pendingExchanges) {
            const fromDate = formatDateSimple(req.from_date);
            const toDate = formatDateSimple(req.to_date);
            
            html += `
                <div class="exchange-notification">
                    <div class="exchange-header">
                        <span class="exchange-icon">🔄</span>
                        <span class="exchange-title">Предложение обмена</span>
                    </div>
                    <div class="exchange-body">
                        <div class="exchange-employee">👤 ${escapeHtml(req.from_employee)} хочет обменяться</div>
                        <div class="exchange-details">
                            <div>📌 Его смена: ${fromDate} — ${req.from_shift_time}</div>
                            <div>📌 Ваша смена: ${toDate} — ${req.to_shift_time}</div>
                            ${req.comment ? `<div class="exchange-comment">💬 ${escapeHtml(req.comment)}</div>` : ''}
                        </div>
                        <div class="exchange-actions">
                            <button class="exchange-accept" onclick="acceptExchange(${req.id})">✅ Принять</button>
                            <button class="exchange-reject" onclick="rejectExchange(${req.id})">❌ Отклонить</button>
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    async function acceptExchange(requestId) {
        try {
            const response = await apiCall(`/exchange/accept/${requestId}`, 'POST');
            if (response && response.success) {
                showNotif('✅ Обмен смен подтверждён!', 'success');
                await loadScheduleData();
                if (typeof renderMonthSchedule === 'function') renderMonthSchedule();
                updateDashboardStats();
                updateNextShiftInfo();
                await loadPendingExchanges();
                await loadMyActiveExchanges();
            } else {
                showNotif(response?.error || 'Ошибка при подтверждении', 'error');
            }
        } catch (err) { console.error('Ошибка:', err); showNotif('Ошибка соединения', 'error'); }
    }

    async function rejectExchange(requestId) {
        try {
            const response = await apiCall(`/exchange/reject/${requestId}`, 'POST');
            if (response && response.success) {
                showNotif('❌ Запрос отклонён', 'success');
                await loadPendingExchanges();
            } else {
                showNotif(response?.error || 'Ошибка при отклонении', 'error');
            }
        } catch (err) { console.error('Ошибка:', err); showNotif('Ошибка соединения', 'error'); }
    }

    async function loadMyActiveExchanges() {
        try {
            const response = await apiCall('/exchange/my?status=pending');
            if (response && response.success) {
                const myRequests = response.requests || [];
                renderMyExchangesWidget(myRequests);
            }
        } catch (err) { console.error('Ошибка загрузки своих запросов:', err); }
    }

    function renderMyExchangesWidget(requests) {
        const container = document.getElementById('myExchangesContainer');
        if (!container) return;
        
        if (requests.length === 0) {
            container.innerHTML = '<div class="exchange-empty">Нет активных запросов</div>';
            return;
        }
        
        let html = '';
        for (const req of requests) {
            const toDate = formatDateSimple(req.to_date);
            const fromDate = formatDateSimple(req.from_date);
            
            html += `
                <div class="my-exchange-request">
                    <div class="my-exchange-header">
                        <span>📤 Запрос отправлен</span>
                        <span class="my-exchange-status">⏳ ожидает</span>
                    </div>
                    <div class="my-exchange-body">
                        <div>Кому: ${escapeHtml(req.to_employee)}</div>
                        <div>Моя смена: ${fromDate} — ${req.from_shift_time}</div>
                        <div>Его смена: ${toDate} — ${req.to_shift_time}</div>
                        ${req.comment ? `<div class="my-exchange-comment">💬 ${escapeHtml(req.comment)}</div>` : ''}
                    </div>
                    <div class="my-exchange-actions">
                        <button class="my-exchange-cancel" onclick="cancelExchangeRequest(${req.id})">❌ Отменить</button>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    async function cancelExchangeRequest(requestId) {
        if (!confirm('Отменить запрос на обмен?')) return;
        try {
            const response = await apiCall(`/exchange/cancel/${requestId}`, 'POST');
            if (response && response.success) {
                showNotif('✅ Запрос отменён', 'success');
                await loadMyActiveExchanges();
                if (typeof loadScheduleData === 'function') loadScheduleData();
            } else {
                showNotif(response?.error || 'Ошибка при отмене', 'error');
            }
        } catch (err) { console.error('Ошибка:', err); showNotif('Ошибка соединения', 'error'); }
    }

    // ============================================
    // ТРАНЗАКЦИИ
    // ============================================
    async function openTransactionsModal() {
        try {
            const response = await apiCall('/transactions?limit=50&offset=0&type=all');
            if (!response || !response.success) { showNotif('Ошибка загрузки истории', 'error'); return; }
            
            const transactions = response.transactions || [];
            const grouped = {};
            transactions.forEach(tx => {
                const date = tx.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];
                if (!grouped[date]) grouped[date] = [];
                grouped[date].push(tx);
            });
            
            const sortedDates = Object.keys(grouped).sort().reverse();
            let transactionsHtml = '';
            
            for (const date of sortedDates) {
                const txList = grouped[date];
                const formattedDate = formatTransactionDateSimple(date);
                
                transactionsHtml += `<div class="modal-transaction-group"><div class="modal-transaction-date">${formattedDate}</div>`;
                
                for (const tx of txList) {
                    const isPositive = tx.amount > 0;
                    const amountAbs = Math.abs(tx.amount);
                    const typeNames = {
                        'login_streak': '🎁 Бонус', 'task_reward': '✅ Задача', 'shift_earn': '⏱️ Смена',
                        'gift_send': '🎁 Подарок', 'gift_receive': '🎁 Подарок', 'shop_purchase': '🛒 Покупка',
                        'fine': '⚠️ Штраф', 'admin_bonus': '👑 Бонус', 'achievement': '🏆 Достижение'
                    };
                    const typeName = typeNames[tx.type] || tx.type;
                    
                    transactionsHtml += `
                        <div class="modal-transaction-item">
                            <div class="modal-transaction-icon ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : '-'}</div>
                            <div class="modal-transaction-info">
                                <div class="modal-transaction-title">${typeName}</div>
                                ${tx.comment ? `<div class="modal-transaction-comment">${escapeHtml(tx.comment.substring(0, 50))}${tx.comment.length > 50 ? '...' : ''}</div>` : ''}
                            </div>
                            <div class="modal-transaction-amount ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : '-'}${amountAbs} WP</div>
                        </div>
                    `;
                }
                transactionsHtml += `</div>`;
            }
            
            if (transactions.length === 0) {
                transactionsHtml = `<div class="modal-empty-state"><div class="modal-empty-icon">💰</div><div>Нет операций</div></div>`;
            }
            
            const modalHtml = `
                <div id="transactionsModal" class="modal active">
                    <div class="modal-window" style="max-width: 500px; max-height: 70vh; overflow-y: auto; padding: 0;">
                        <div class="modal-header" style="padding: 14px 18px; border-bottom: 1px solid rgba(99,102,241,0.15); display: flex; justify-content: space-between; align-items: center; background: #1a1f2e;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="width: 28px; height: 28px; background: linear-gradient(135deg, #fbbf24, #f59e0b); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                                    <i class="fas fa-history" style="font-size: 12px;"></i>
                                </div>
                                <h3 style="margin: 0; font-size: 16px;">История операций</h3>
                            </div>
                            <button onclick="closeTransactionsModal()" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">&times;</button>
                        </div>
                        <div style="padding: 14px;">
                            <div class="modal-balance-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(251,191,36,0.08); border-radius: 10px; margin-bottom: 14px;">
                                <span style="font-size: 12px; font-weight: 500;">💰 Текущий баланс</span>
                                <span style="font-size: 18px; font-weight: 700; color: #fbbf24;">${getCurrentBalance()} WP</span>
                            </div>
                            <div class="modal-transactions-list" style="max-height: 400px; overflow-y: auto;">${transactionsHtml}</div>
                        </div>
                        <div class="modal-footer" style="padding: 10px 14px; border-top: 1px solid rgba(99,102,241,0.1); display: flex; justify-content: flex-end;">
                            <button class="btn-secondary" onclick="closeTransactionsModal()" style="padding: 5px 14px; font-size: 11px;">Закрыть</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        } catch (err) { console.error('Ошибка загрузки транзакций:', err); showNotif('Ошибка загрузки истории', 'error'); }
    }

    function closeTransactionsModal() {
        const modal = document.getElementById('transactionsModal');
        if (modal) modal.remove();
    }

    function formatTransactionDateSimple(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === today.toDateString()) return 'Сегодня';
        else if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
        
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${date.getDate()} ${months[date.getMonth()]}`;
    }

    function getCurrentBalance() {
        const currentUser = window.app?.currentUser;
        if (currentUser && window.app?.profiles?.[currentUser]) return window.app.profiles[currentUser].coins || 0;
        return 0;
    }

    // ============================================
    // ЕЖЕДНЕВНЫЙ БОНУС
    // ============================================
    async function loadDailyBonusInfo() {
        try {
            const response = await apiCall('/user/login-streak');
            if (response && response.success) {
                const streakDays = document.getElementById('streakDays');
                const bonusAmount = document.getElementById('bonusAmount');
                const claimBtn = document.getElementById('claimBonusBtn');
                
                if (streakDays) streakDays.textContent = response.streak || 1;
                if (bonusAmount) bonusAmount.textContent = `+${response.nextBonusAmount || 1} WP`;
                if (claimBtn) {
                    if (response.hasClaimedToday) {
                        claimBtn.disabled = true;
                        claimBtn.innerHTML = '✅ Получено';
                    } else {
                        claimBtn.disabled = false;
                        claimBtn.innerHTML = '🎁 Забрать';
                    }
                }
            }
        } catch (err) { console.error('Ошибка загрузки бонуса:', err); }
    }

    async function claimDailyBonus() {
        if (isClaimingBonus) return;
        
        const claimBtn = document.getElementById('claimBonusBtn');
        if (!claimBtn) return;
        
        isClaimingBonus = true;
        const originalText = claimBtn.innerHTML;
        claimBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
        claimBtn.disabled = true;
        
        try {
            const response = await apiCall('/user/claim-daily-bonus', 'POST');
            if (response && response.success) {
                if (response.claimed) {
                    showBonusAnimation(response.bonus);
                    showNotif(`🎉 Получен ежедневный бонус +${response.bonus} WP!`, 'success');
                    
                    if (response.newAchievements && response.newAchievements.length > 0) {
                        for (const ach of response.newAchievements) showNotif(`🏆 ${ach.name} (+${ach.coins} WP)`, 'success');
                    }
                    
                    await loadEmployees();
                    updateUserBalance();
                    loadDailyBonusInfo();
                    refreshAllBalanceDisplays();
                } else {
                    showNotif('Бонус уже получен сегодня', 'info');
                }
            } else {
                showNotif(response?.error || 'Ошибка', 'error');
            }
        } catch (err) { console.error('Ошибка:', err); showNotif('Ошибка соединения', 'error'); }
        finally {
            isClaimingBonus = false;
            claimBtn.innerHTML = originalText;
            loadDailyBonusInfo();
        }
    }

    function showBonusAnimation(amount) {
        const container = document.querySelector('.daily-bonus-card');
        if (!container) return;
        
        for (let i = 0; i < 10; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.className = 'bonus-floating-text';
                particle.textContent = `+${amount}`;
                particle.style.cssText = `
                    position: absolute;
                    left: ${50 + (Math.random() - 0.5) * 80}%;
                    top: ${50 + (Math.random() - 0.5) * 60}%;
                    color: #fbbf24;
                    font-weight: 700;
                    font-size: 20px;
                    pointer-events: none;
                    z-index: 100;
                    animation: floatUp 1.5s ease-out forwards;
                `;
                container.style.position = 'relative';
                container.appendChild(particle);
                setTimeout(() => particle.remove(), 1500);
            }, i * 80);
        }
    }

    function updateUserBalance() {
        const currentUser = window.app?.currentUser;
        if (currentUser && window.app?.profiles?.[currentUser]) {
            const balance = window.app.profiles[currentUser].coins || 0;
            const userCoinsHeader = document.getElementById('userCoinsAmountHeader');
            if (userCoinsHeader) userCoinsHeader.textContent = balance;
        }
    }

    // ============================================
    // НАСТРОЙКИ ДАШБОРДА
    // ============================================
    function toggleDashboardSettings() {
        const content = document.getElementById('settingsContent');
        const icon = document.getElementById('settingsToggleIcon');
        if (!content) return;
        if (content.style.display === 'none' || content.style.display === '') {
            content.style.display = 'block';
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            content.style.display = 'none';
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }

    function initSettingsTabs() {
        const btnStyles = document.getElementById('btnStyles');
        const btnPresets = document.getElementById('btnPresets');
        const btnBlocks = document.getElementById('btnBlocks');
        const panelStyles = document.getElementById('panelStyles');
        const panelPresets = document.getElementById('panelPresets');
        const panelBlocks = document.getElementById('panelBlocks');
        
        if (!btnStyles || !panelStyles) return;
        
        function switchPanel(activePanel, activeBtn) {
            if (panelStyles) panelStyles.style.display = 'none';
            if (panelPresets) panelPresets.style.display = 'none';
            if (panelBlocks) panelBlocks.style.display = 'none';
            if (activePanel) activePanel.style.display = 'block';
            
            [btnStyles, btnPresets, btnBlocks].forEach(btn => {
                if (btn) { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; }
            });
            if (activeBtn) { activeBtn.style.background = 'rgba(99,102,241,0.2)'; activeBtn.style.color = '#a78bfa'; }
        }
        
        btnStyles.onclick = () => switchPanel(panelStyles, btnStyles);
        btnPresets.onclick = () => switchPanel(panelPresets, btnPresets);
        btnBlocks.onclick = () => switchPanel(panelBlocks, btnBlocks);
        
        panelStyles.style.display = 'block';
        panelPresets.style.display = 'none';
        panelBlocks.style.display = 'none';
        btnStyles.style.background = 'rgba(99,102,241,0.2)';
        btnStyles.style.color = '#a78bfa';
    }

    // ============================================
    // ЧАСТИЦЫ В БЛОКАХ
    // ============================================
    let particlesInterval = null;

    function initBlockParticles() {
        if (particlesInterval) clearInterval(particlesInterval);
        
        const blocks = document.querySelectorAll('.info-card, .stat-card, .daily-bonus-card');
        
        particlesInterval = setInterval(() => {
            blocks.forEach(block => {
                if (Math.random() > 0.7) {
                    const particle = document.createElement('div');
                    particle.className = 'block-particle';
                    
                    const colors = ['#6366f1', '#8b5cf6', '#a78bfa', '#c084fc', '#fbbf24'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    
                    particle.style.cssText = `
                        position: absolute;
                        left: ${Math.random() * 100}%;
                        top: ${Math.random() * 100}%;
                        width: ${4 + Math.random() * 4}px;
                        height: ${4 + Math.random() * 4}px;
                        background: ${color};
                        border-radius: 50%;
                        pointer-events: none;
                        opacity: 0;
                        animation: particleFloatBlock ${2 + Math.random() * 2}s ease-out forwards;
                        z-index: 10;
                    `;
                    
                    block.style.position = 'relative';
                    block.appendChild(particle);
                    
                    setTimeout(() => { if (particle && particle.remove) particle.remove(); }, 4000);
                }
            });
        }, 800);
    }

    function stopBlockParticles() {
        if (particlesInterval) { clearInterval(particlesInterval); particlesInterval = null; }
    }

    // ============================================
    // СЛЕДУЮЩАЯ СМЕНА
    // ============================================
    function updateNextShiftInfo() {
        const currentUser = window.app?.currentUser;
        if (!currentUser) return;
        
        const nextShiftEl = document.getElementById('nextShiftInfo');
        const shiftTimerEl = document.getElementById('shiftTimer');
        if (!nextShiftEl || !shiftTimerEl) return;
        
        const schedule = window.app?.schedule || {};
        const now = getTobolskNow();
        const today = now.toISOString().split('T')[0];
        
        let nextShiftDate = null;
        let nextShiftTime = null;
        
        const dates = Object.keys(schedule).sort();
        for (const date of dates) {
            if (date < today) continue;
            
            const daySchedule = schedule[date];
            const myShift = daySchedule[currentUser];
            
            if (myShift && myShift.time && myShift.status !== 'dayoff' && myShift.status !== 'sick') {
                nextShiftDate = date;
                nextShiftTime = myShift.time;
                break;
            }
        }
        
        if (nextShiftDate && nextShiftTime) {
            const shiftDate = new Date(nextShiftDate);
            const formattedDate = shiftDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            nextShiftEl.textContent = `${formattedDate} в ${nextShiftTime}`;
            
            const [hours, minutes] = nextShiftTime.split(':').map(Number);
            const shiftDateTime = new Date(nextShiftDate);
            shiftDateTime.setHours(hours, minutes, 0, 0);
            
            const updateTimer = () => {
                const now = getTobolskNow();
                const diff = shiftDateTime - now;
                
                if (diff <= 0) { shiftTimerEl.textContent = 'Уже началась!'; return; }
                
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hrs = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                
                if (days > 0) shiftTimerEl.textContent = `${days} дн ${hrs} ч`;
                else shiftTimerEl.textContent = `${hrs} ч ${mins} мин`;
            };
            
            updateTimer();
            
            if (shiftTimerInterval) clearInterval(shiftTimerInterval);
            shiftTimerInterval = setInterval(updateTimer, 60000);
        } else {
            nextShiftEl.textContent = 'Нет запланированных смен';
            shiftTimerEl.textContent = '—';
        }
    }

    // ============================================
    // БЫСТРЫЕ ДЕЙСТВИЯ
    // ============================================
    function quickAction(action) {
        if (typeof window.loadPage === 'function') window.loadPage(action);
    }

    async function quickChangeStatus(status) {
        const currentUser = window.app?.currentUser;
        if (!currentUser) { showNotif('Ошибка: пользователь не определён', 'error'); return; }
        
        const success = await updateEmployeeStatus(currentUser, status);
        if (success) {
            showNotif(`Статус изменён на ${status}`, 'success');
            
            if (window.app?.profiles?.[currentUser]) window.app.profiles[currentUser].status = status;
            
            const statusSelect = document.getElementById('quickStatusSelect');
            if (statusSelect) statusSelect.value = status;
            
            if (typeof renderEmployees === 'function') renderEmployees();
        } else {
            showNotif('Ошибка при смене статуса', 'error');
        }
    }

    function switchToTab(tabId) {
        if (typeof window.loadPage === 'function') window.loadPage(tabId);
    }

    // ============================================
    // ЦИТАТА ДНЯ
    // ============================================
    function refreshPhilosophyQuote() {
        const quotes = [
            { text: "Работа избавляет нас от трёх великих зол: скуки, порока и нужды.", author: "Вольтер" },
            { text: "Успех — это способность двигаться от неудачи к неудаче, не теряя энтузиазма.", author: "Черчилль" },
            { text: "Единственный способ сделать великую работу — любить то, что вы делаете.", author: "Стив Джобс" },
            { text: "Секрет успеха — начать.", author: "Марк Твен" },
            { text: "Лучший способ предсказать будущее — изобрести его.", author: "Алан Кей" },
            { text: "Не бойтесь совершенства, вам его не достичь.", author: "Сальвадор Дали" }
        ];
        const quote = quotes[Math.floor(Math.random() * quotes.length)];
        const quoteText = document.getElementById('philosophyQuoteText');
        const quoteAuthor = document.getElementById('philosophyQuoteAuthor');
        if (quoteText) quoteText.textContent = quote.text;
        if (quoteAuthor) quoteAuthor.textContent = `— ${quote.author}`;
    }

    // ============================================
    // ПРАЗДНИКИ И СОБЫТИЯ
    // ============================================
    function loadHolidaysAndBirthdays() {
        const container = document.getElementById('holidaysAndBirthdaysList');
        if (!container) return;
        
        const today = getTobolskNow();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDate = today.getDate();
        
        const holidays = [
            { date: '01-01', name: 'Новый год' }, { date: '01-07', name: 'Рождество' },
            { date: '02-23', name: 'День защитника' }, { date: '03-08', name: '8 Марта' },
            { date: '05-01', name: 'Праздник Весны' }, { date: '05-09', name: 'День Победы' },
            { date: '06-12', name: 'День России' }, { date: '11-04', name: 'День единства' },
            { date: '12-31', name: 'Новый год' }
        ];
        
        const employees = window.app?.employees || [];
        const birthdays = [];
        
        for (const emp of employees) {
            const profile = window.app?.profiles?.[emp];
            if (profile && profile.birthday) {
                let birthDate = new Date(profile.birthday);
                if (birthDate && !isNaN(birthDate.getTime())) {
                    let nextBirthday = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
                    if (nextBirthday < today) nextBirthday = new Date(currentYear + 1, birthDate.getMonth(), birthDate.getDate());
                    const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
                    birthdays.push({
                        name: emp,
                        daysUntil: daysUntil,
                        isToday: nextBirthday.getDate() === currentDate && nextBirthday.getMonth() === currentMonth
                    });
                }
            }
        }
        
        birthdays.sort((a, b) => a.daysUntil - b.daysUntil);
        const upcomingBirthdays = birthdays.filter(b => b.daysUntil <= 30).slice(0, 10);
        
        const events = [];
        
        for (const holiday of holidays) {
            const [month, day] = holiday.date.split('-');
            const holidayDate = new Date(currentYear, parseInt(month) - 1, parseInt(day));
            let daysUntil, eventDate;
            if (holidayDate < today) {
                eventDate = new Date(currentYear + 1, parseInt(month) - 1, parseInt(day));
                daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
            } else {
                eventDate = holidayDate;
                daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
            }
            if (daysUntil <= 30) {
                events.push({
                    type: 'holiday', name: holiday.name, date: eventDate, daysUntil: daysUntil,
                    isToday: eventDate.getDate() === currentDate && eventDate.getMonth() === currentMonth
                });
            }
        }
        
        for (const birthday of upcomingBirthdays) {
            events.push({
                type: 'birthday', name: `🎂 ${birthday.name}`,
                daysUntil: birthday.daysUntil, isToday: birthday.isToday
            });
        }
        
        events.sort((a, b) => a.daysUntil - b.daysUntil);
        const upcomingEvents = events.slice(0, 10);
        
        if (upcomingEvents.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 16px; color: #64748b;">Нет ближайших событий</div>`;
            return;
        }
        
        let html = '';
        for (const event of upcomingEvents) {
            let dateStr = '';
            if (event.daysUntil === 0) dateStr = '<span style="color: #fbbf24;">СЕГОДНЯ!</span>';
            else if (event.daysUntil === 1) dateStr = 'ЗАВТРА';
            else if (event.date) dateStr = event.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            else dateStr = `через ${event.daysUntil} дн.`;
            const eventColor = event.type === 'birthday' ? '#ec4899' : '#6366f1';
            html += `
                <div style="display: flex; align-items: center; gap: 14px; padding: 10px 14px; background: rgba(0, 0, 0, 0.2); border-radius: 12px; border-left: 2px solid ${event.isToday ? '#fbbf24' : eventColor}; margin-bottom: 8px;">
                    <div style="flex: 1;">
                        <div style="font-weight: 500;">${event.name}</div>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">${dateStr}</div>
                    </div>
                    ${event.isToday ? '<div style="font-size: 18px;">🎉</div>' : ''}
                </div>
            `;
        }
        container.innerHTML = html;
    }

    // ============================================
    // АКТИВНОСТЬ
    // ============================================
    let lastActivityUpdate = 0;
    const ACTIVITY_UPDATE_INTERVAL = 15000;

    function loadActivity() {
        const now = Date.now();
        if (now - lastActivityUpdate < ACTIVITY_UPDATE_INTERVAL) return;
        lastActivityUpdate = now;
        
        const onlineList = document.getElementById('onlineList');
        const lastList = document.getElementById('lastActivityList');
        if (!onlineList) return;
        
        const onlineEmployees = [];
        for (const emp of window.app?.employees || []) {
            const lastActive = window.app?.lastActivity?.[emp];
            if (lastActive && Date.now() - lastActive < 60000) onlineEmployees.push(emp);
        }
        
        onlineList.innerHTML = onlineEmployees.length ? 
            onlineEmployees.map(e => `<div><span style="color:#10b981;">🟢</span> ${escapeHtml(e)}</div>`).join('') :
            '<div style="opacity:0.5;">— никого в сети —</div>';
        
        if (lastList) {
            const lastActivityList = [];
            for (const emp of window.app?.employees || []) {
                const lastActive = window.app?.lastActivity?.[emp];
                if (lastActive) {
                    const date = new Date(lastActive);
                    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                    lastActivityList.push({ name: emp, time: timeStr, timestamp: lastActive });
                }
            }
            lastActivityList.sort((a, b) => b.timestamp - a.timestamp);
            
            if (lastActivityList.length > 0) {
                lastList.innerHTML = lastActivityList.slice(0, 5).map(item => 
                    `<div>${escapeHtml(item.name)} — ${item.time}</div>`
                ).join('');
            } else {
                lastList.innerHTML = '<div style="opacity:0.5;">— нет активности —</div>';
            }
        }
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ ДАШБОРДА
    // ============================================
    function initDashboard() {
        console.log('📊 Инициализация дашборда');
        
        const currentUser = window.app?.currentUser;
        if (currentUser && window.app?.profiles?.[currentUser]) {
            const savedStyle = window.app.profiles[currentUser].dashboard_style || 'standart';
            window.app.userStyle = savedStyle;
        }
        
        loadHiddenBlocks();
        applyHiddenBlocks();
        loadMyActiveExchanges();
        
        setTimeout(() => initDashboardSettings(), 100);
        
        const savedPreset = localStorage.getItem('dashboardPreset');
        if (savedPreset && ['default', 'compact', 'focus', 'minimal'].includes(savedPreset)) {
            applyDashboardPreset(savedPreset);
        }
        
        updateGreetingByTime();
        
        const userName = window.app?.currentUser || 'Гость';
        const welcomeSpan = document.getElementById('welcomeUserName');
        if (welcomeSpan) welcomeSpan.textContent = userName;
        
        updateUserAvatarAndStatus();
        
        const userRole = window.app?.currentUserRole || 'operator';
        const roleBadge = document.getElementById('userRoleBadge');
        if (roleBadge) {
            if (userRole === 'director') roleBadge.innerHTML = '👑 Директор';
            else if (userRole === 'manager') roleBadge.innerHTML = '📋 Управляющий';
            else if (userRole === 'admin') roleBadge.innerHTML = '⚙️ Админ';
            else roleBadge.innerHTML = '👤 Оператор';
        }
        
        loadFundAmount().then(() => updateDashboardStats());
        
        loadActivity();
        loadHolidaysAndBirthdays();
        refreshPhilosophyQuote();
        startDateTimeUpdater();
        fetchWeather();
        updateNextShiftInfo();
        
        loadDailyBonusInfo();
        loadPendingExchanges();
        
        setTimeout(() => initStylesShop(), 100);
        setTimeout(() => initSettingsTabs(), 200);
        
        if (dashboardInterval) clearInterval(dashboardInterval);
        dashboardInterval = setInterval(() => {
            updateDashboardStats();
            loadActivity();
            fetchWeather();
            updateNextShiftInfo();
            loadPendingExchanges();
        }, 60000);
        
        if (bonusCheckInterval) clearInterval(bonusCheckInterval);
        bonusCheckInterval = setInterval(() => {
            loadDailyBonusInfo();
            loadPendingExchanges();
        }, 300000);
        
        if (window.channel) {
            window.channel.bind('schedule-updated', (data) => {
                console.log('🔄 График обновлён');
                if (typeof loadScheduleData === 'function') loadScheduleData();
                updateNextShiftInfo();
                updateDashboardStats();
            });
        }
        
        const savedStyle = window.app?.userStyle || 'standart';
        const allDashboardStyles = ['standart', 'phantom', 'impulse', 'glow', 'cyber', 'legend', 'cosmic', 'hologram', 'inferno', 'frozen', 'shadow', 'toxic', 'plasma', 'void', 'carbon'];
        allDashboardStyles.forEach(style => document.body.classList.remove(`dashboard-style-${style}`));
        if (savedStyle !== 'standart') document.body.classList.add(`dashboard-style-${savedStyle}`);
        else document.body.classList.add('dashboard-style-standart');
        
        setTimeout(() => initBlockParticles(), 500);
    }

    function cleanupDashboard() {
        if (dashboardInterval) { clearInterval(dashboardInterval); dashboardInterval = null; }
        if (bonusCheckInterval) { clearInterval(bonusCheckInterval); bonusCheckInterval = null; }
        if (shiftTimerInterval) { clearInterval(shiftTimerInterval); shiftTimerInterval = null; }
        if (particlesInterval) { clearInterval(particlesInterval); particlesInterval = null; }
    }

    window.addEventListener('beforeunload', cleanupDashboard);

    // ============================================
    // ЭКСПОРТ
    // ============================================
    window.initDashboard = initDashboard;
    window.cleanupDashboard = cleanupDashboard;
    window.refreshPhilosophyQuote = refreshPhilosophyQuote;
    window.quickAction = quickAction;
    window.quickChangeStatus = quickChangeStatus;
    window.switchToTab = switchToTab;
    window.updateUserAvatarAndStatus = updateUserAvatarAndStatus;
    window.applyDashboardPreset = applyDashboardPreset;
    window.showAllHiddenBlocks = showAllHiddenBlocks;
    window.resetAllDashboardSettings = resetAllDashboardSettings;
    window.toggleBlockVisibility = toggleBlockVisibility;
    window.updateNextShiftInfo = updateNextShiftInfo;
    window.updateDashboardStats = updateDashboardStats;
    window.getTobolskNow = getTobolskNow;
    window.initStylesShop = initStylesShop;
    window.renderStylesShop = renderStylesShop;
    window.applyBoughtStyle = applyBoughtStyle;
    window.buyStyle = buyStyle;
    window.previewStyle = previewStyle;
    window.cancelPreview = cancelPreview;
    window.fetchWeather = fetchWeather;
    window.formatDateSimple = formatDateSimple;
    window.loadDailyBonusInfo = loadDailyBonusInfo;
    window.claimDailyBonus = claimDailyBonus;
    window.showBonusAnimation = showBonusAnimation;
    window.updateUserBalance = updateUserBalance;
    window.openTransactionsModal = openTransactionsModal;
    window.closeTransactionsModal = closeTransactionsModal;
    window.getCurrentBalance = getCurrentBalance;
    window.loadPendingExchanges = loadPendingExchanges;
    window.acceptExchange = acceptExchange;
    window.rejectExchange = rejectExchange;
    window.loadMyActiveExchanges = loadMyActiveExchanges;
    window.cancelExchangeRequest = cancelExchangeRequest;
    window.initBlockParticles = initBlockParticles;
    window.stopBlockParticles = stopBlockParticles;
    window.toggleDashboardSettings = toggleDashboardSettings;
    window.initSettingsTabs = initSettingsTabs;
    window.loadActivity = loadActivity;
    window.loadFundAmount = loadFundAmount;

    const particleBlockStyle = document.createElement('style');
    particleBlockStyle.textContent = `
        @keyframes particleFloatBlock {
            0% { transform: translateY(0) scale(0.5); opacity: 0; }
            20% { opacity: 0.7; }
            80% { opacity: 0.4; }
            100% { transform: translateY(-30px) scale(1); opacity: 0; }
        }
        @keyframes floatUp {
            0% { transform: translateY(0) scale(0.8); opacity: 1; }
            100% { transform: translateY(-60px) scale(1.2); opacity: 0; }
        }
    `;
    if (!document.querySelector('#particleBlockStyles')) {
        particleBlockStyle.id = 'particleBlockStyles';
        document.head.appendChild(particleBlockStyle);
    }

    console.log('✅ dashboard.js загружен');
})();