// public/js/achievements.js - СТАБИЛЬНЫЙ ПРЕМИУМ ДИЗАЙН

let achievementsData = [];
let userUnlocked = new Set();
let userPending = new Set();
let isLoading = false;

// ============================================
// ОБЛЕГЧЁННЫЕ ФАНФАРЫ (БЕЗ ЛАГОВ)
// ============================================
function showFanfare(achievementName, coins) {
    // 1. Лёгкая вспышка
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
    
    // 2. Умеренное конфетти (30 штук вместо 60)
    const colors = ['#fbbf24', '#f59e0b', '#10b981', '#6366f1', '#ec4899'];
    
    for (let i = 0; i < 30; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 8 + Math.random() * 10;
            
            confetti.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                width: ${size}px;
                height: ${size * 0.7}px;
                background: ${color};
                border-radius: 4px;
                z-index: 99998;
                pointer-events: none;
                box-shadow: 0 0 8px ${color};
                animation: epicConfetti 1.5s ease-out forwards;
                transform: translate(-50%, -50%);
            `;
            
            const angle = (i * 12) * (Math.PI / 180);
            const velocity = 150 + Math.random() * 200;
            const tx = Math.cos(angle) * velocity;
            const ty = Math.sin(angle) * velocity - 50;
            const rot = (Math.random() * 360 - 180);
            
            confetti.style.setProperty('--tx', tx + 'px');
            confetti.style.setProperty('--ty', ty + 'px');
            confetti.style.setProperty('--rot', rot + 'deg');
            
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 1500);
        }, i * 25);
    }
    
    // 3. Баннер (без звёздочек, меньше анимации)
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
        <div style="font-size: 44px; margin-bottom: 12px; animation: epicTrophy 0.5s ease-out;">🏆</div>
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
    
    // 4. Стили (только нужные)
    if (!document.getElementById('fanfare-styles')) {
        const style = document.createElement('style');
        style.id = 'fanfare-styles';
        style.textContent = `
            @keyframes epicFlash {
                0% { opacity: 1; }
                100% { opacity: 0; }
            }
            @keyframes epicConfetti {
                0% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); }
                100% { opacity: 0; transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)); }
            }
            @keyframes epicBanner {
                0% { opacity: 0; transform: translate(-50%, -40%) scale(0.9); }
                20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -60%) scale(0.9); }
            }
            @keyframes epicTrophy {
                0% { transform: scale(0); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
}

// ============================================
// ЗАГРУЗКА ДОСТИЖЕНИЙ
// ============================================
async function loadAchievements() {
    const token = localStorage.getItem('token');
    if (!token) return false;
    if (isLoading) return false;
    
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
            
            console.log(`✅ Достижений: ${achievementsData.length}`);
            isLoading = false;
            return true;
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
    }
    
    isLoading = false;
    return false;
}

// ============================================
// РЕНДЕР (КРАСИВЫЙ, НО БЕЗ СЛОЖНЫХ АНИМАЦИЙ)
// ============================================
function renderAchievements() {
    const container = document.getElementById('achievementsContainer');
    if (!container) return;
    
    if (achievementsData.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 60px;">
                <div style="width: 40px; height: 40px; margin: 0 auto 20px; border: 3px solid rgba(251,191,36,0.2); border-top-color: #fbbf24; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <p style="color: #64748b;">Загрузка...</p>
            </div>
        `;
        loadAchievements().then(() => renderAchievements());
        return;
    }
    
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
    const percent = Math.round((unlocked / total) * 100) || 0;
    
    let html = `
        <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            .ach-card { transition: transform 0.15s, box-shadow 0.15s; }
            .ach-card:hover { transform: translateY(-2px); box-shadow: 0 6px 15px rgba(0,0,0,0.3); }
            .claim-btn { transition: transform 0.15s, box-shadow 0.15s; }
            .claim-btn:hover { transform: scale(1.02); box-shadow: 0 4px 12px rgba(251,191,36,0.3); }
        </style>
        
        <!-- ШАПКА -->
        <div style="background: linear-gradient(135deg, #1a1f2e, #0f1222); border-radius: 20px; padding: 20px; margin-bottom: 24px; border: 1px solid #2a3240;">
            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                <div style="font-size: 48px;">🏆</div>
                <div style="flex: 1;">
                    <h2 style="margin: 0 0 10px 0; font-size: 22px; font-weight: 700; background: linear-gradient(135deg, #fff, #fbbf24); -webkit-background-clip: text; background-clip: text; color: transparent;">Мои достижения</h2>
                    <div style="display: flex; gap: 24px;">
                        <div><span style="font-size: 24px; font-weight: 800; color: #10b981;">${unlocked}</span> <span style="font-size: 11px; color: #64748b;">ПОЛУЧЕНО</span></div>
                        ${pending > 0 ? `<div><span style="font-size: 24px; font-weight: 800; color: #fbbf24;">${pending}</span> <span style="font-size: 11px; color: #64748b;">ОЖИДАЕТ</span></div>` : ''}
                        <div><span style="font-size: 24px; font-weight: 800; color: #64748b;">${total - unlocked - pending}</span> <span style="font-size: 11px; color: #64748b;">ЗАБЛОКИРОВАНО</span></div>
                    </div>
                </div>
                <div style="width: 60px; height: 60px;">
                    <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#2a3240" stroke-width="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#fbbf24" stroke-width="3" stroke-dasharray="${percent}, 100" stroke-linecap="round" />
                    </svg>
                    <div style="text-align: center; font-size: 11px; color: #fbbf24; margin-top: -42px;">${percent}%</div>
                </div>
            </div>
        </div>
    `;
    
    // КАТЕГОРИИ
    for (const [catId, cat] of Object.entries(categories)) {
        const catAchievements = grouped[catId];
        if (catAchievements.length === 0) continue;
        
        const catUnlocked = catAchievements.filter(a => userUnlocked.has(a.id)).length;
        const catPending = catAchievements.filter(a => userPending.has(a.id)).length;
        
        html += `
            <div style="margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid ${cat.color}40;">
                    <span style="font-size: 20px;">${cat.icon}</span>
                    <span style="font-size: 15px; font-weight: 600; color: #e2e8f0;">${cat.name}</span>
                    <span style="margin-left: auto; font-size: 12px; color: #64748b;">
                        <span style="color: #10b981;">${catUnlocked}</span>/<span>${catAchievements.length}</span>
                        ${catPending > 0 ? ` <span style="color: #fbbf24; margin-left: 8px;">🎁 ${catPending}</span>` : ''}
                    </span>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px;">
        `;
        
        for (const ach of catAchievements) {
            const isUnlocked = userUnlocked.has(ach.id);
            const isPending = userPending.has(ach.id);
            
            let borderColor = '#2a3240';
            let bgGradient = 'linear-gradient(135deg, #0f1222, #0a0c14)';
            let statusColor = '#64748b';
            let statusText = '🔒 Заблокировано';
            let button = '';
            
            if (isUnlocked) {
                borderColor = '#10b981';
                bgGradient = 'linear-gradient(135deg, #0a1a14, #061210)';
                statusColor = '#10b981';
                statusText = '✅ Получено';
            } else if (isPending) {
                borderColor = '#fbbf24';
                bgGradient = 'linear-gradient(135deg, #1a1a0a, #121206)';
                statusColor = '#fbbf24';
                statusText = '🎁 Получить';
                button = `<button class="claim-btn" onclick="claimAchievement('${ach.id}')" style="margin-top: 10px; width: 100%; padding: 8px; background: linear-gradient(135deg, #fbbf24, #f59e0b); border: none; border-radius: 20px; color: #1a1f2e; font-weight: 700; font-size: 12px; cursor: pointer;">Получить ${ach.coins} WP</button>`;
            }
            
            html += `
                <div class="ach-card" style="padding: 14px; background: ${bgGradient}; border-radius: 14px; border: 1px solid ${borderColor};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 700; font-size: 14px; color: #f1f5f9;">${escapeHtml(ach.name)}</span>
                        <span style="font-size: 9px; font-weight: 600; padding: 2px 6px; background: ${statusColor}20; color: ${statusColor}; border-radius: 12px;">${statusText}</span>
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 12px;">${escapeHtml(ach.description)}</div>
                    <div style="display: flex; align-items: center; gap: 5px; padding: 4px 8px; background: rgba(0,0,0,0.3); border-radius: 16px; width: fit-content;">
                        <span>💰</span>
                        <span style="font-weight: 700; color: #fbbf24;">${ach.coins} WP</span>
                    </div>
                    ${button}
                </div>
            `;
        }
        
        html += `</div></div>`;
    }
    
    container.innerHTML = html;
}

// ============================================
// ПОЛУЧЕНИЕ НАГРАДЫ
// ============================================
async function claimAchievement(achievementId) {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const achievement = achievementsData.find(a => a.id === achievementId);
    if (!achievement) return;
    
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
            
            renderAchievements();
            
            if (typeof loadEmployees === 'function') await loadEmployees();
            if (typeof showNotif === 'function') showNotif(`+${data.coins} WP!`, 'success');
        } else {
            if (typeof showNotif === 'function') showNotif(data.error || 'Ошибка', 'error');
        }
    } catch (err) {
        console.error('❌ Ошибка:', err);
        if (typeof showNotif === 'function') showNotif('Ошибка соединения', 'error');
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

setTimeout(() => {
    if (document.getElementById('achievementsContainer')) {
        initAchievements();
    }
}, 200);