// public/js/shop.js — ИСПРАВЛЕННАЯ ВЕРСИЯ v1.1
// Добавлены все уведомления

const giftList = [
    { id: 'flower', name: '🌸 Букет цветов', icon: '🌸', price: 25, rating: 8, desc: 'Красивый букет для настроения' },
    { id: 'star', name: '⭐ Золотая звезда', icon: '⭐', price: 75, rating: 25, desc: 'Звезда за особые достижения' },
    { id: 'pizza', name: '🍕 Пицца «4 сыра»', icon: '🍕', price: 150, rating: 50, desc: 'Большая, горячая, с доставкой' },
    { id: 'trophy', name: '🏆 Трофей', icon: '🏆', price: 300, rating: 100, desc: 'Победный кубок' },
    { id: 'crown', name: '👑 Корона', icon: '👑', price: 500, rating: 175, desc: 'Почувствуй себя монархом' },
    { id: 'trash', name: '🗑️ Мешок мусора', icon: '🗑️', price: 25, rating: -8, desc: 'Пахнет соответственно' },
    { id: 'socks', name: '🧦 Носки с дыркой', icon: '🧦', price: 75, rating: -25, desc: 'Одна пара. Вторая где-то потерялась' },
    { id: 'brick', name: '🧱 Кирпич ручной работы', icon: '🧱', price: 150, rating: -50, desc: 'Тяжелый. Просто тяжелый кирпич' },
    { id: 'abibas', name: '👟 Кеды «Abibas»', icon: '👟', price: 300, rating: -100, desc: 'Почти оригинал. Размер подойдет не всем' },
    { id: 'poop', name: '💩 Шоколадный сюрприз', icon: '💩', price: 500, rating: -175, desc: 'Выглядит аппетитно, но лучше не пробовать' }
];

const avatarList = [
    { icon: '😎', name: 'Крутой', price: 0 },
    { icon: '🔥', name: 'Огонь', price: 0 },
    { icon: '⚡', name: 'Молния', price: 0 },
    { icon: '🎯', name: 'Цель', price: 0 },
    { icon: '🏆', name: 'Трофей', price: 0 },
    { icon: '🦸', name: 'Супергерой', price: 0 },
    { icon: '👑', name: 'Корона', price: 0 }
];

const paidStatuses = [
    { id: 'lazy', name: '🦥 Проф. ленивец', price: 80, rating: 8, desc: 'Мастер откладывания' },
    { id: 'coffee', name: '☕ Кофеман', price: 60, rating: 6, desc: 'Без кофе - не человек' },
    { id: 'zombie', name: '🧟 Зомби', price: 60, rating: 6, desc: 'Просыпаюсь к обеду' },
    { id: 'excuse', name: '🎯 Мастер отмазок', price: 110, rating: 11, desc: 'Придумаю отмазку' },
    { id: 'cringe', name: '🎭 Кринж', price: 90, rating: 9, desc: 'Маскировщик кринжа' },
    { id: 'drama', name: '🎬 Драма', price: 85, rating: 8, desc: 'Раздуваю проблемы' },
    { id: 'puzzle', name: '🧩 Пазл', price: 65, rating: 6, desc: 'Без коллег бесполезен' },
    { id: 'double', name: '🎭 Двойной агент', price: 100, rating: 10, desc: 'Своим - одно, чужим - другое' }
];

const freeStatuses = [
    { id: 'working', name: '💼 Работаю', icon: '💼' },
    { id: 'break', name: '☕ Перерыв', icon: '☕' },
    { id: 'focus', name: '🎯 В фокусе', icon: '🎯' },
    { id: 'mvp', name: '⭐ MVP', icon: '⭐' },
    { id: 'takeoff', name: '🚀 Взлёт', icon: '🚀' }
];

let selectedGift = null;
let selectedQuantity = 1;
let isAnonymous = false;
let myStatuses = [];
let isLoadingShop = false;
let shopInitialized = false;

// ============================================
// СБРОС СОСТОЯНИЯ
// ============================================

function resetShopState() {
    console.log('🧹 Сброс состояния магазина');
    shopInitialized = false;
    selectedGift = null;
    selectedQuantity = 1;
    isAnonymous = false;
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
    if (typeof window.showSystemNotification === 'function') {
        window.showSystemNotification(message, type);
    } else if (typeof window.showNotif === 'function') {
        window.showNotif(message, type);
    } else {
        console.log(`[${type}] ${message}`);
    }
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

function handleNewAchievements(achievements) {
    if (achievements && achievements.length > 0) {
        for (const ach of achievements) {
            showSystemNotification(`🏆 Новое достижение: ${ach.name} (+${ach.coins} WP)`, 'success');
        }
        if (typeof loadAchievements === 'function') {
            setTimeout(() => loadAchievements(), 500);
        }
        if (typeof renderRatingTable === 'function') {
            setTimeout(() => renderRatingTable(), 500);
        }
    }
}

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================

function initShop() {
    if (shopInitialized) {
        console.log('🛒 Магазин уже инициализирован');
        return;
    }
    
    console.log('🛒 Инициализация магазина');
    
    const container = document.getElementById('giftsContainer');
    if (!container) {
        console.warn('⚠️ giftsContainer не найден, ждём...');
        setTimeout(initShop, 100);
        return;
    }
    
    renderGifts();
    renderAvatars();
    renderPaidStatuses();
    loadMyStatuses();
    updateBalance();
    initTabs();
    
    shopInitialized = true;
}

function initTabs() {
    const tabs = document.querySelectorAll('.shop-tab');
    if (tabs.length === 0) return;
    
    tabs.forEach(tab => {
        tab.onclick = () => {
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.shop-tab-content').forEach(c => c.style.display = 'none');
            document.getElementById(tabId + 'Tab').style.display = 'block';
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            if (tabId === 'statuses') {
                renderPaidStatuses();
                renderInventory();
            }
        };
    });
}

// ============================================
// РЕНДЕР СТАТУСОВ
// ============================================

function renderPaidStatuses() {
    const container = document.getElementById('statusesContainer');
    if (!container) return;
    
    const userCoins = window.app?.profiles?.[window.app?.currentUser]?.coins || 0;
    
    container.innerHTML = paidStatuses.map(s => {
        const owned = myStatuses.some(m => m.status_id === s.id);
        return `
            <div class="shop-card" ${!owned ? `onclick="buyStatus('${s.id}', '${escapeHtml(s.name)}', ${s.price}, ${s.rating})"` : ''}>
                <div class="card-icon">${s.name.split(' ')[0]}</div>
                <div class="card-name">${escapeHtml(s.name)}</div>
                <div class="card-desc">${escapeHtml(s.desc)}</div>
                <div class="card-price">${s.price} WP</div>
                <div class="card-rating">⭐ +${s.rating}</div>
                ${owned ? '<div class="card-badge badge-owned">✅ В коллекции</div>' : ''}
                <button class="card-btn" ${owned ? 'disabled' : ''}>${owned ? 'Куплен' : '💰 Купить'}</button>
            </div>
        `;
    }).join('');
}

function renderInventory() {
    const container = document.getElementById('inventoryContainer');
    if (!container) return;
    
    const ownedPaid = myStatuses.filter(m => m.status_id);
    const allOwned = [
        ...freeStatuses.map(s => ({ status_id: s.id, status_name: s.name, isFree: true, icon: s.icon })),
        ...ownedPaid.map(s => ({ status_id: s.status_id, status_name: s.status_name, isFree: false, icon: s.status_name.split(' ')[0] }))
    ];
    
    if (allOwned.length === 0) {
        container.innerHTML = '<div class="empty-state">📦 Инвентарь пуст</div>';
        return;
    }
    
    const active = window.app?.profiles?.[window.app?.currentUser]?.active_status;
    
    container.innerHTML = allOwned.map(s => `
        <div class="shop-card" onclick="activateStatus('${s.status_id}', '${escapeHtml(s.status_name)}')">
            <div class="card-icon">${escapeHtml(s.icon)}</div>
            <div class="card-name">${escapeHtml(s.status_name)}</div>
            <div class="card-desc">${s.isFree ? 'Базовый статус' : 'Премиум статус'}</div>
            <div class="card-price">${s.isFree ? '🆓 Бесплатный' : '💰 Куплен'}</div>
            ${active === s.status_name ? '<div class="card-badge badge-active">✅ Активен</div>' : '<div class="card-badge">🔘 Активировать</div>'}
            <button class="card-btn">🎨 Применить</button>
        </div>
    `).join('');
}

// ============================================
// РЕНДЕР ПОДАРКОВ
// ============================================

function renderGifts() {
    const container = document.getElementById('giftsContainer');
    if (!container) return;
    
    container.innerHTML = giftList.map(g => `
        <div class="shop-card" onclick="openGiftModal('${g.id}')">
            <div class="card-icon">${g.icon}</div>
            <div class="card-name">${escapeHtml(g.name)}</div>
            <div class="card-desc">${escapeHtml(g.desc)}</div>
            <div class="card-price">${g.price} WP</div>
            <div class="card-rating">⭐ ${g.rating > 0 ? '+' : ''}${g.rating}</div>
            <button class="card-btn">🎁 Купить</button>
        </div>
    `).join('');
    
    console.log('✅ Подарки отрендерены:', giftList.length);
}

function renderAvatars() {
    const container = document.getElementById('avatarsContainer');
    if (!container) return;
    
    const currentAvatar = window.app?.profiles?.[window.app?.currentUser]?.avatar || '👤';
    container.innerHTML = avatarList.map(a => `
        <div class="shop-card" onclick="buyAvatar('${a.icon}')">
            <div class="card-icon">${a.icon}</div>
            <div class="card-name">${escapeHtml(a.name)}</div>
            <div class="card-price">${a.price} WP</div>
            ${currentAvatar === a.icon ? '<div class="card-badge badge-active">✅ Активен</div>' : ''}
            <button class="card-btn">🔄 Выбрать</button>
        </div>
    `).join('');
}

// ============================================
// ПОКУПКА СТАТУСА
// ============================================

async function buyStatus(id, name, price, rating) {
    const userCoins = window.app?.profiles?.[window.app?.currentUser]?.coins || 0;
    if (userCoins < price) {
        showSystemNotification(`❌ Не хватает! Нужно ${price} WP`, 'error');
        return;
    }
    if (!confirm(`Купить "${name}" за ${price} WP?`)) return;
    
    const res = await apiCall('/statuses/buy', 'POST', {
        statusId: id, statusName: name, statusIcon: name.split(' ')[0], price, rating, description: ''
    });
    
    if (res?.success) {
        showSystemNotification(`✅ Статус "${name}" куплен`, 'success');
        if (res.newAchievements) handleNewAchievements(res.newAchievements);
        await loadMyStatuses();
        await loadEmployees();
        renderPaidStatuses();
        renderInventory();
        updateBalance();
    } else {
        showSystemNotification('❌ ' + (res?.error || 'Ошибка при покупке'), 'error');
    }
}

async function activateStatus(id, name) {
    const res = await apiCall('/statuses/activate', 'POST', { statusId: id });
    if (res?.success) {
        showSystemNotification(`✅ Статус "${name}" активирован`, 'success');
        await loadEmployees();
        renderInventory();
        if (typeof renderEmployees === 'function') renderEmployees();
    } else {
        showSystemNotification('❌ ' + (res?.error || 'Ошибка активации'), 'error');
    }
}

async function loadMyStatuses() {
    const res = await apiCall('/user/statuses');
    myStatuses = res?.data || [];
    renderInventory();
}

async function buyAvatar(icon) {
    const currentAvatar = window.app?.profiles?.[window.app?.currentUser]?.avatar;
    if (currentAvatar === icon) {
        showSystemNotification('ℹ️ Уже используется', 'info');
        return;
    }
    const success = await updateEmployeeAvatar(window.app?.currentUser, icon);
    if (success) {
        showSystemNotification('✅ Аватар изменён', 'success');
        await loadEmployees();
        renderAvatars();
        if (typeof renderEmployees === 'function') renderEmployees();
        if (typeof window.updateHeaderAvatar === 'function') window.updateHeaderAvatar(null, icon);
    } else {
        showSystemNotification('❌ Ошибка при смене аватара', 'error');
    }
}

function updateBalance() {
    if (typeof refreshAllBalanceDisplays === 'function') {
        refreshAllBalanceDisplays();
    } else {
        const el = document.getElementById('userCoinsAmount');
        if (el) el.innerText = window.app?.profiles?.[window.app?.currentUser]?.coins || 0;
    }
}

// ============================================
// МОДАЛКА ПОДАРКА
// ============================================

function openGiftModal(giftId) {
    selectedGift = giftList.find(g => g.id === giftId);
    if (!selectedGift) return;
    selectedQuantity = 1;
    isAnonymous = false;
    const employees = window.app?.employees?.filter(e => e !== window.app?.currentUser) || [];
    const select = document.getElementById('giftRecipient');
    if (select) select.innerHTML = '<option value="">Выберите сотрудника</option>' + employees.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
    document.getElementById('giftQuantity').innerText = selectedQuantity;
    document.getElementById('giftAnonymous').checked = false;
    updateTotalPrice();
    document.getElementById('giftModal').style.display = 'flex';
}

function closeGiftModal() { 
    document.getElementById('giftModal').style.display = 'none'; 
}

function changeQuantity(delta) {
    let newQ = selectedQuantity + delta;
    if (newQ >= 1 && newQ <= 99) {
        selectedQuantity = newQ;
        document.getElementById('giftQuantity').innerText = selectedQuantity;
        updateTotalPrice();
    }
}

function toggleAnonymous(checked) { 
    isAnonymous = checked; 
}

function updateTotalPrice() {
    const totalEl = document.getElementById('totalPrice');
    if (totalEl) totalEl.innerText = (selectedGift.price * selectedQuantity) + ' WP';
}

async function sendGift() {
    const recipient = document.getElementById('giftRecipient')?.value;
    if (!recipient) {
        showSystemNotification('❌ Выберите получателя', 'error');
        return;
    }
    
    const total = selectedGift.price * selectedQuantity;
    const userCoins = window.app?.profiles?.[window.app?.currentUser]?.coins || 0;
    if (userCoins < total) {
        showSystemNotification('❌ Недостаточно монет', 'error');
        return;
    }
    
    const sender = isAnonymous ? '🕵️ Аноним' : window.app?.currentUser;
    
    const sendBtn = document.querySelector('#giftModal .btn-primary');
    const originalText = sendBtn?.innerHTML;
    if (sendBtn) {
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
        sendBtn.disabled = true;
    }
    
    const res = await apiCall('/gifts', 'POST', {
        recipient, 
        giftId: selectedGift.id, 
        price: selectedGift.price, 
        ratingChange: selectedGift.rating,
        sender, 
        quantity: selectedQuantity
    });
    
    if (sendBtn) {
        sendBtn.innerHTML = originalText;
        sendBtn.disabled = false;
    }
    
    if (res?.success) {
        closeGiftModal();
        showSystemNotification(`🎁 Вы подарили ${selectedGift.name} сотруднику ${recipient}!`, 'success');
        if (res.newAchievements) handleNewAchievements(res.newAchievements);
        await loadEmployees();
        updateBalance();
        if (typeof renderEmployees === 'function') renderEmployees();
        
        // Отправить событие получателю
        if (typeof window.sendEvent === 'function') {
            window.sendEvent('gift_received', {
                sender: sender,
                giftName: selectedGift.name,
                giftId: selectedGift.id,
                anonymous: isAnonymous
            }, recipient);
        }
    } else {
        showSystemNotification('❌ ' + (res?.error || 'Ошибка при отправке'), 'error');
    }
}

// ============================================
// ЭКСПОРТ
// ============================================

window.initShop = initShop;
window.resetShopState = resetShopState;
window.openGiftModal = openGiftModal;
window.closeGiftModal = closeGiftModal;
window.sendGift = sendGift;
window.buyAvatar = buyAvatar;
window.changeQuantity = changeQuantity;
window.toggleAnonymous = toggleAnonymous;
window.buyStatus = buyStatus;
window.activateStatus = activateStatus;
window.renderGifts = renderGifts;
window.renderAvatars = renderAvatars;
window.updateBalance = updateBalance;
window.handleNewAchievements = handleNewAchievements;

console.log('✅ shop.js загружен (v1.1 — с уведомлениями)');