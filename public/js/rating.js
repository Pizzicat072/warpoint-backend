// public/js/rating.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ v1.1
// Добавлены все уведомления

let ratingData = [];
let currentRatingSort = 'rating';
let currentRatingOrder = 'desc';
let isLoadingRating = false;
let ratingInitialized = false;

// ============================================
// СБРОС СОСТОЯНИЯ
// ============================================

function resetRatingState() {
    console.log('🧹 Сброс состояния рейтинга');
    ratingInitialized = false;
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function showSystemNotification(message, type) {
    if (typeof window.showSystemNotification === 'function' && window.showSystemNotification !== showSystemNotification) {
        window.showSystemNotification(message, type);
        return;
    }
    if (typeof window.showNotif === 'function' && window.showNotif !== showSystemNotification) {
        window.showNotif(message, type);
        return;
    }
    console.log(`[${type}] ${message}`);
}

async function apiCall(endpoint, method = 'GET', body = null) {
    if (typeof window.originalApiCall === 'function') {
        return window.originalApiCall(endpoint, method, body);
    }
    if (typeof window.apiCall === 'function' && window.apiCall !== apiCall) {
        return window.apiCall(endpoint, method, body);
    }
    const token = localStorage.getItem('token');
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) options.body = JSON.stringify(body);
    try {
        const response = await fetch(`/api${endpoint}`, options);
        return await response.json();
    } catch (e) {
        console.error('Fetch error:', e);
        return { success: false, error: 'Ошибка соединения' };
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initRating() {
    if (ratingInitialized) {
        console.log('🏆 Рейтинг уже инициализирован');
        return;
    }
    
    console.log('🏆 Инициализация рейтинга');
    
    const tbody = document.getElementById('ratingTableBody');
    if (!tbody) {
        console.warn('⚠️ ratingTableBody не найден, ждём...');
        setTimeout(initRating, 100);
        return;
    }
    
    const searchInput = document.getElementById('ratingSearch');
    const sortSelect = document.getElementById('ratingSort');
    
    if (searchInput) searchInput.addEventListener('input', () => renderRatingTable());
    if (sortSelect) sortSelect.addEventListener('change', () => {
        currentRatingSort = sortSelect.value;
        renderRatingTable();
    });
    
    loadRatingData();
    
    setTimeout(() => {
        if (typeof renderAchievements === 'function') {
            renderAchievements();
        } else if (typeof initAchievements === 'function') {
            initAchievements();
        }
    }, 300);
    
    updateRatingStats();
    
    ratingInitialized = true;
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================

async function loadRatingData() {
    if (isLoadingRating) return;
    isLoadingRating = true;
    
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
    
    isLoadingRating = false;
    showSystemNotification(`📊 Загружено ${ratingData.length} сотрудников`, 'info');
    renderRatingTable();
}

// ============================================
// РЕНДЕР ТАБЛИЦЫ
// ============================================

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
            ? `<img src="${escapeHtml(item.avatar_url)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerHTML='👤'">`
            : `<span style="font-size: 22px;">${escapeHtml(item.avatar || '👤')}</span>`;
        
        const roleNames = {
            director: 'Директор',
            manager: 'Управляющий',
            admin: 'Админ',
            operator: 'Оператор'
        };
        
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

// ============================================
// СОРТИРОВКА
// ============================================

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

// ============================================
// СТАТИСТИКА
// ============================================

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

// ============================================
// ЭКСПОРТ
// ============================================

window.initRating = initRating;
window.resetRatingState = resetRatingState;
window.loadRatingData = loadRatingData;
window.renderRatingTable = renderRatingTable;
window.changeRatingOrder = changeRatingOrder;
window.updateRatingStats = updateRatingStats;

console.log('✅ rating.js загружен (v1.1 — с уведомлениями)');