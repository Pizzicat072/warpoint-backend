// public/js/rating.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

let ratingData = [];
let currentRatingSort = 'rating';
let currentRatingOrder = 'desc';

function initRating() {
    console.log('🏆 Инициализация рейтинга');
    
    const searchInput = document.getElementById('ratingSearch');
    const sortSelect = document.getElementById('ratingSort');
    
    if (searchInput) searchInput.addEventListener('input', () => renderRatingTable());
    if (sortSelect) sortSelect.addEventListener('change', () => {
        currentRatingSort = sortSelect.value;
        renderRatingTable();
    });
    
    loadRatingData();
    
    // Вызываем загрузку достижений
    if (typeof loadAchievements === 'function') {
        loadAchievements();
    }
    
    // Вызываем рендер достижений
    setTimeout(() => {
        if (typeof renderAchievements === 'function') {
            renderAchievements();
        } else if (typeof initAchievements === 'function') {
            initAchievements();
        }
    }, 300);
    
    updateRatingStats();
}

async function loadRatingData() {
    const employees = window.app?.employees || [];
    const profiles = window.app?.profiles || {};
    
    let achievementsCounts = {};
    try {
        const response = await apiCall('/employees/achievements-count');
        if (response && response.success) {
            achievementsCounts = response.counts || {};
        }
    } catch (err) {
        console.error('Ошибка загрузки количества достижений:', err);
    }
    
    ratingData = employees.map(emp => {
        const profile = profiles[emp];
        if (!profile) return null;
        
        let rank = '', rankIcon = '';
        const rating = profile.rating || 0;
        
        if (rating >= 5000) { rank = 'Легенда'; rankIcon = '👑'; }
        else if (rating >= 3000) { rank = 'Профессионал'; rankIcon = '💎'; }
        else if (rating >= 1500) { rank = 'Эксперт'; rankIcon = '🏆'; }
        else if (rating >= 500) { rank = 'Мастер'; rankIcon = '🔥'; }
        else { rank = 'Ученик'; rankIcon = '⭐'; }
        
        return {
            name: emp,
            role: profile.role,
            avatar: profile.avatar,
            avatar_url: profile.avatar_url,
            rating: rating,
            coins: profile.coins || 0,
            hours: profile.hours || 0,
            rank: rank,
            rankIcon: rankIcon,
            achievementsCount: achievementsCounts[emp] || 0
        };
    }).filter(r => r !== null);
    
    renderRatingTable();
}

function renderRatingTable() {
    const tbody = document.getElementById('ratingTableBody');
    if (!tbody) return;
    
    const search = document.getElementById('ratingSearch')?.value.toLowerCase() || '';
    
    let filtered = [...ratingData];
    if (search) filtered = filtered.filter(r => r.name.toLowerCase().includes(search));
    
    filtered.sort((a, b) => {
        let aVal = a[currentRatingSort];
        let bVal = b[currentRatingSort];
        if (currentRatingSort === 'name') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        if (currentRatingOrder === 'desc') return bVal - aVal;
        return aVal - bVal;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">🏆 Нет данных</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map((item, index) => {
        const rankColor = {
            'Легенда': '#fbbf24', 'Профессионал': '#06b6d4', 'Эксперт': '#10b981',
            'Мастер': '#f97316', 'Ученик': '#64748b'
        }[item.rank] || '#64748b';
        
        const avatarHtml = item.avatar_url 
            ? `<img src="${item.avatar_url}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`
            : `<span style="font-size: 22px;">${item.avatar || '👤'}</span>`;
        
        return `
            <tr onclick="openProfile('${escapeHtml(item.name)}')">
                <td style="text-align: center; font-weight: 700; color: #fbbf24;">${index + 1}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1, #ec4899); border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            ${avatarHtml}
                        </div>
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <div style="font-size: 11px; color: #64748b;">${roleNames[item.role] || 'Оператор'}</div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">${item.hours} ч</td>
                <td style="text-align: center; font-weight: 700; color: ${item.rating >= 0 ? '#10b981' : '#ef4444'};">${item.rating >= 0 ? '+' : ''}${item.rating}</td>
                <td style="text-align: center; color: #fbbf24;">💰 ${item.coins}</td>
                <td style="text-align: center;">
                    <span style="background: ${rankColor}20; color: ${rankColor}; padding: 4px 12px; border-radius: 20px; font-size: 11px;">
                        ${item.rankIcon} ${item.rank}
                    </span>
                </td>
                <td style="text-align: center;">
                    <span style="background: rgba(139,92,246,0.15); color: #a78bfa; padding: 4px 12px; border-radius: 20px; font-size: 11px;">
                        🏆 ${item.achievementsCount}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function changeRatingOrder(order) {
    currentRatingOrder = order;
    renderRatingTable();
    
    document.querySelectorAll('.order-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((order === 'desc' && btn.dataset.order === 'desc') ||
            (order === 'asc' && btn.dataset.order === 'asc')) {
            btn.classList.add('active');
        }
    });
}

function updateRatingStats() {
    const employees = window.app?.employees || [];
    const total = employees.filter(e => e !== 'Денис').length;
    const totalAchievements = window.app?.achievements?.length || 0;
    const currentUser = window.app?.currentUser;
    const profile = window.app?.profiles?.[currentUser];
    
    let rank = '⭐';
    const rating = profile?.rating || 0;
    if (rating >= 5000) rank = '👑 Легенда';
    else if (rating >= 3000) rank = '💎 Профессионал';
    else if (rating >= 1500) rank = '🏆 Эксперт';
    else if (rating >= 500) rank = '🔥 Мастер';
    else rank = '⭐ Ученик';
    
    const totalEl = document.getElementById('totalEmployees');
    const totalAchievementsEl = document.getElementById('totalAchievements');
    const userRankEl = document.getElementById('userRank');
    
    if (totalEl) totalEl.textContent = total;
    if (totalAchievementsEl) totalAchievementsEl.textContent = totalAchievements;
    if (userRankEl) userRankEl.textContent = rank;
}

window.initRating = initRating;
window.loadRatingData = loadRatingData;
window.renderRatingTable = renderRatingTable;
window.changeRatingOrder = changeRatingOrder;
window.updateRatingStats = updateRatingStats;