// public/js/achievements.js — ОБЁРНУТ В IIFE
(function() {
    'use strict';
    
    let achievementsData = [];
    let userUnlocked = new Set();
    let userPending = new Set();
    let isLoading = false;
    let isRendering = false;
    let achievementsCache = null;
    let cacheTimestamp = 0;
    const CACHE_TTL = 60000;

    // ============================================
    // ОБЛЕГЧЁННЫЕ ФАНФАРЫ (БЕЗ ЛАГОВ)
    // ============================================

    function showFanfare(achievementName, coins) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at 50% 50%, rgba(251,191,36,0.3) 0%, transparent 60%);
            z-index: 99999;
            pointer-events: none;
            animation: epicFlash 1.5s ease-out forwards;
        `;
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 1500);
        
        const banner = document.createElement('div');
        banner.style.cssText = `
            position: fixed;
            top: 45%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1a1f2e 0%, #0f1222 100%);
            border: 2px solid #fbbf24;
            border-radius: 24px;
            padding: 24px 40px;
            z-index: 100000;
            text-align: center;
            box-shadow: 0 0 40px rgba(251, 191, 36, 0.4);
            animation: epicBanner 2s ease-out forwards;
            pointer-events: none;
        `;
        
        banner.innerHTML = `
            <div style="font-size: 44px; margin-bottom: 12px;">🏆</div>
            <div style="font-size: 22px; font-weight: 800; background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 8px;">
                ДОСТИЖЕНИЕ!
            </div>
            <div style="font-size: 16px; color: #e2e8f0; margin-bottom: 14px;">
                ${escapeHtml(achievementName)}
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span style="font-size: 13px; color: #64748b;">НАГРАДА</span>
                <span style="font-size: 32px; font-weight: 800; color: #fbbf24;">+${coins}</span>
                <span style="font-size: 13px; color: #fbbf24;">WP</span>
            </div>
        `;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 2000);
        
        if (!document.getElementById('fanfare-styles')) {
            const style = document.createElement('style');
            style.id = 'fanfare-styles';
            style.textContent = `
                @keyframes epicFlash { 0% { opacity: 1; } 100% { opacity: 0; } }
                @keyframes epicBanner { 0% { opacity: 0; transform: translate(-50%, -40%) scale(0.9); } 20% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -60%) scale(0.9); } }
            `;
            document.head.appendChild(style);
        }
    }

    // ============================================
    // ЗАГРУЗКА ДОСТИЖЕНИЙ (С КЭШЕМ)
    // ============================================

    async function loadAchievements() {
        if (isLoading) {
            console.log('⏳ Достижения уже загружаются');
            return false;
        }
        
        const token = localStorage.getItem('token');
        if (!token) return false;
        
        if (achievementsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
            console.log('📦 Достижения из кэша');
            achievementsData = achievementsCache.achievements;
            userUnlocked = new Set(achievementsCache.unlocked);
            userPending = new Set(achievementsCache.pending);
            return true;
        }
        
        isLoading = true;
        
        try {
            const response = await fetch('/api/achievements', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await response.json();
            
            if (data && data.success) {
                achievementsData = data.achievements || [];
                userUnlocked.clear();
                userPending.clear();
                
                for (const ach of achievementsData) {
                    if (ach.unlocked) userUnlocked.add(ach.id);
                    if (ach.pending) userPending.add(ach.id);
                }
                
                achievementsCache = {
                    achievements: achievementsData,
                    unlocked: [...userUnlocked],
                    pending: [...userPending]
                };
                cacheTimestamp = Date.now();
                
                console.log(`✅ Достижений: ${achievementsData.length}`);
                isLoading = false;
                return true;
            }
        } catch (err) {
            console.error('❌ Ошибка загрузки достижений:', err);
        }
        
        isLoading = false;
        return false;
    }

    function invalidateAchievementsCache() {
        achievementsCache = null;
        cacheTimestamp = 0;
        console.log('🧹 Кэш достижений очищен');
    }

    // ============================================
    // РЕНДЕР ДОСТИЖЕНИЙ (С ПРОВЕРКОЙ DOM)
    // ============================================

    function renderAchievements() {
        if (isRendering) {
            console.log('⚠️ Рендер достижений уже выполняется');
            return;
        }
        
        const container = document.getElementById('achievementsContainer');
        if (!container) {
            console.warn('⚠️ achievementsContainer не найден');
            return;
        }
        
        if (achievementsData.length === 0) {
            container.innerHTML = `
                <div class="achievements-empty">
                    <div class="loading-spinner"></div>
                    <p style="color: #64748b; margin-top: 16px;">Загрузка достижений...</p>
                </div>
            `;
            loadAchievements().then(() => renderAchievements());
            return;
        }
        
        isRendering = true;
        
        setTimeout(() => {
            try {
                const categories = {
                    'work': { name: 'Смены', icon: '📅', color: '#3b82f6' },
                    'tasks': { name: 'Задачи', icon: '✅', color: '#10b981' },
                    'gifts': { name: 'Подарки', icon: '🎁', color: '#ec4899' },
                    'rating': { name: 'Рейтинг', icon: '⭐', color: '#fbbf24' },
                    'streak': { name: 'Ежедневный вход', icon: '🔥', color: '#f97316' },
                    'exchange': { name: 'Обмен', icon: '🔄', color: '#8b5cf6' },
                    'chat': { name: 'Чат', icon: '💬', color: '#06b6d4' },
                    'shop': { name: 'Магазин', icon: '🛒', color: '#a78bfa' },
                    'knowledge': { name: 'База знаний', icon: '📚', color: '#14b8a6' },
                    'special': { name: 'Особые', icon: '✨', color: '#fbbf24' }
                };
                
                const grouped = {};
                for (const cat of Object.keys(categories)) grouped[cat] = [];
                for (const ach of achievementsData) {
                    if (grouped[ach.category]) grouped[ach.category].push(ach);
                }
                
                const total = achievementsData.length;
                const unlocked = userUnlocked.size;
                const pending = userPending.size;
                const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
                
                let html = `
                    <div class="achievements-header-premium">
                        <div class="achievements-stats-premium">
                            <div class="stat-item">
                                <span class="stat-value" style="color: #10b981;">${unlocked}</span>
                                <span class="stat-label">ПОЛУЧЕНО</span>
                            </div>
                            ${pending > 0 ? `
                                <div class="stat-item">
                                    <span class="stat-value" style="color: #fbbf24;">${pending}</span>
                                    <span class="stat-label">ОЖИДАЕТ</span>
                                </div>
                            ` : ''}
                            <div class="stat-item">
                                <span class="stat-value" style="color: #64748b;">${total - unlocked - pending}</span>
                                <span class="stat-label">ЗАБЛОКИРОВАНО</span>
                            </div>
                        </div>
                        <div class="progress-ring">
                            <svg viewBox="0 0 36 36">
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2a3240" stroke-width="3" />
                                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#fbbf24" stroke-width="3" stroke-dasharray="${percent}, 100" stroke-linecap="round" />
                            </svg>
                            <span class="progress-text">${percent}%</span>
                        </div>
                    </div>
                `;
                
                const categoryKeys = Object.keys(categories).filter(cat => grouped[cat].length > 0);
                
                for (const catId of categoryKeys) {
                    const cat = categories[catId];
                    const catAchievements = grouped[catId];
                    
                    const catUnlocked = catAchievements.filter(a => userUnlocked.has(a.id)).length;
                    const catPending = catAchievements.filter(a => userPending.has(a.id)).length;
                    
                    html += `
                        <div class="achievement-category-premium">
                            <div class="category-header-premium" style="border-bottom-color: ${cat.color}40;" onclick="toggleCategory('${catId}')">
                                <span class="category-icon">${cat.icon}</span>
                                <span class="category-name">${escapeHtml(cat.name)}</span>
                                <span class="category-stats">
                                    <span style="color: #10b981;">${catUnlocked}</span>/<span>${catAchievements.length}</span>
                                    ${catPending > 0 ? ` <span style="color: #fbbf24; margin-left: 8px;">🎁 ${catPending}</span>` : ''}
                                </span>
                            </div>
                            <div class="category-achievements-grid" id="category-${catId}">
                    `;
                    
                    for (const ach of catAchievements) {
                        const isUnlocked = userUnlocked.has(ach.id);
                        const isPending = userPending.has(ach.id);
                        
                        let borderColor = '#2a3240';
                        let statusColor = '#64748b';
                        let statusText = '🔒';
                        let button = '';
                        
                        if (isUnlocked) {
                            borderColor = '#10b981';
                            statusColor = '#10b981';
                            statusText = '✅';
                        } else if (isPending) {
                            borderColor = '#fbbf24';
                            statusColor = '#fbbf24';
                            statusText = '🎁';
                            button = `<button class="claim-achievement-btn" onclick="claimAchievement('${ach.id}')">Получить +${ach.coins_reward} WP</button>`;
                        }
                        
                        html += `
                            <div class="achievement-card-premium" style="border-color: ${borderColor};">
                                <div class="achievement-card-header">
                                    <span class="achievement-name">${escapeHtml(ach.name)}</span>
                                    <span class="achievement-status" style="color: ${statusColor};">${statusText}</span>
                                </div>
                                <div class="achievement-desc">${escapeHtml(ach.description)}</div>
                                <div class="achievement-reward">
                                    <span>💰 ${ach.coins_reward} WP</span>
                                </div>
                                ${button}
                            </div>
                        `;
                    }
                    
                    html += `</div></div>`;
                }
                
                container.innerHTML = html;
                isRendering = false;
                
            } catch (err) {
                console.error('❌ Ошибка рендера:', err);
                container.innerHTML = '<div class="achievements-empty"><div class="achievements-empty-icon">❌</div><h3>Ошибка загрузки</h3></div>';
                isRendering = false;
            }
        }, 10);
    }

    function toggleCategory(catId) {
        const grid = document.getElementById(`category-${catId}`);
        if (grid) {
            grid.style.display = grid.style.display === 'none' ? 'grid' : 'none';
        }
    }

    // ============================================
    // ПОЛУЧЕНИЕ НАГРАДЫ
    // ============================================

    async function claimAchievement(achievementId) {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const achievement = achievementsData.find(a => a.id === achievementId);
        if (!achievement) return;
        
        const claimBtn = document.querySelector(`.claim-achievement-btn[onclick*="${achievementId}"]`);
        const originalText = claimBtn?.innerHTML;
        if (claimBtn) {
            claimBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Получение...';
            claimBtn.disabled = true;
        }
        
        try {
            const response = await fetch('/api/achievements/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify({ achievementId })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showFanfare(achievement.name, data.coins);
                
                userPending.delete(achievementId);
                userUnlocked.add(achievementId);
                
                const ach = achievementsData.find(a => a.id === achievementId);
                if (ach) {
                    ach.unlocked = true;
                    ach.pending = false;
                }
                
                invalidateAchievementsCache();
                renderAchievements();
                
                if (typeof loadEmployees === 'function') await loadEmployees();
                if (typeof showNotif === 'function') showNotif(`+${data.coins} WP!`, 'success');
            } else {
                if (typeof showNotif === 'function') showNotif(data.error || 'Ошибка', 'error');
            }
        } catch (err) {
            console.error('❌ Ошибка:', err);
            if (typeof showNotif === 'function') showNotif('Ошибка соединения', 'error');
        } finally {
            if (claimBtn) {
                claimBtn.innerHTML = originalText;
                claimBtn.disabled = false;
            }
        }
    }

    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================

    function initAchievements() {
        const container = document.getElementById('achievementsContainer');
        if (container) {
            loadAchievements().then(() => renderAchievements());
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================

    window.loadAchievements = loadAchievements;
    window.renderAchievements = renderAchievements;
    window.claimAchievement = claimAchievement;
    window.initAchievements = initAchievements;
    window.toggleCategory = toggleCategory;
    window.invalidateAchievementsCache = invalidateAchievementsCache;

    console.log('✅ achievements.js загружен');
})();