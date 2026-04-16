// public/js/reports.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

let progressInterval = null;
let pieChart = null;
let isFirstLoad = true;
let isReportsActive = false;
let isLoadingReports = false;

// ============================================
// ИНИЦИАЛИЗАЦИЯ (С ПРОВЕРКОЙ DOM)
// ============================================
function initReports() {
    console.log('📊 Инициализация отчётов');
    
    const container = document.getElementById('datesGrid');
    if (!container) {
        console.warn('⚠️ datesGrid не найден, ждём...');
        setTimeout(initReports, 100);
        return;
    }
    
    isReportsActive = true;
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupReports);
    } else {
        setupReports();
    }
}

function setupReports() {
    console.log('🔧 setupReports вызван');
    
    const runBtn = document.getElementById('runParserBtn');
    if (runBtn) {
        const newBtn = runBtn.cloneNode(true);
        runBtn.parentNode.replaceChild(newBtn, runBtn);
        newBtn.addEventListener('click', runParser);
        console.log('✅ Кнопка обновления привязана');
    }
    
    const fixBtn = document.getElementById('fixParserBtn');
    if (fixBtn) {
        const newFixBtn = fixBtn.cloneNode(true);
        fixBtn.parentNode.replaceChild(newFixBtn, fixBtn);
        newFixBtn.addEventListener('click', fixParser);
        console.log('✅ Кнопка сброса привязана');
    }
    
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    
    if (isReportsActive) {
        progressInterval = setInterval(() => {
            const token = localStorage.getItem('token');
            if (!token || !isReportsActive) {
                return;
            }
            checkProgress();
        }, 3000);
    }
    
    loadReportsData();
}

// ============================================
// ОЧИСТКА ПРИ УХОДЕ
// ============================================
function cleanupReports() {
    console.log('🧹 Очистка отчётов');
    isReportsActive = false;
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    if (pieChart) {
        pieChart.destroy();
        pieChart = null;
    }
}

// ============================================
// ПРОВЕРКА ПРОГРЕССА
// ============================================
async function checkProgress() {
    const token = localStorage.getItem('token');
    if (!token || !isReportsActive) return;
    
    try {
        const res = await apiCall('/parsing/progress');
        if (!res) return;
        
        console.log('📊 Прогресс:', res.percent + '%', 'isParsing:', res.isParsing);
        
        const isParsing = res.isParsing === true || (res.percent > 0 && res.percent < 100);
        
        if (isParsing) {
            showProgressCard(res);
        } else {
            hideProgressCard();
            if (res.percent >= 100) {
                console.log('🎉 Парсинг завершён, загружаем данные...');
                await loadReportsData();
            }
        }
    } catch(e) { 
        console.error('Ошибка checkProgress:', e);
    }
}

function showProgressCard(progress) {
    const card = document.getElementById('progressCard');
    const indicator = document.getElementById('parsingIndicator');
    if (!card) return;
    
    card.style.display = 'block';
    if (indicator) indicator.style.display = 'flex';
    
    const percent = progress.percent || 0;
    const fillEl = document.getElementById('progressFill');
    const percentEl = document.getElementById('progressPercent');
    
    if (percentEl) percentEl.innerText = percent + '%';
    if (fillEl) {
        fillEl.style.width = percent + '%';
        fillEl.innerText = percent + '%';
    }
    
    const step = progress.step || 0;
    for (let i = 1; i <= 8; i++) {
        const el = document.querySelector(`.step[data-step="${i}"]`);
        if (el) {
            if (i < step) {
                el.classList.add('completed');
                el.classList.remove('active');
            } else if (i === step) {
                el.classList.add('active');
                el.classList.remove('completed');
            } else {
                el.classList.remove('active', 'completed');
            }
        }
    }
}

function hideProgressCard() {
    const card = document.getElementById('progressCard');
    const indicator = document.getElementById('parsingIndicator');
    if (card) card.style.display = 'none';
    if (indicator) indicator.style.display = 'none';
}

// ============================================
// ЗАПУСК ПАРСИНГА
// ============================================
async function runParser() {
    const btn = document.getElementById('runParserBtn');
    if (!btn) return;
    
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Запуск...';
    btn.disabled = true;
    showProgressCard({ percent: 0, message: 'Запуск...' });
    
    try {
        const response = await apiCall('/parsing/run', 'POST');
        console.log('Ответ на запуск:', response);
    } catch(e) { 
        console.error('Ошибка запуска:', e);
        showNotif('Ошибка запуска парсинга', 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

async function fixParser() {
    const btn = document.getElementById('fixParserBtn');
    if (!btn) return;
    
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сброс...';
    btn.disabled = true;
    
    try {
        const res = await apiCall('/parsing/reset', 'POST');
        if (res && res.success) {
            showNotif('✅ Состояние парсинга сброшено', 'success');
            setTimeout(() => location.reload(), 1500);
        } else {
            showNotif('❌ Ошибка сброса', 'error');
        }
    } catch(e) {
        console.error(e);
        showNotif('❌ Ошибка соединения', 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ============================================
// ЗАГРУЗКА ДАННЫХ
// ============================================
async function loadReportsData() {
    if (isLoadingReports) return;
    isLoadingReports = true;
    
    console.log('🔄 loadReportsData вызвана');
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'block';
    
    try {
        const data = await apiCall('/parsing/latest');
        console.log('📊 Получены данные:', data);
        
        if (!data || !data.dates || Object.keys(data.dates).length === 0) {
            console.log('⚠️ НЕТ ДАННЫХ');
            if (loader) {
                loader.innerHTML = '⚠️ Нет данных. Нажмите "Обновить данные"';
                loader.style.display = 'block';
            }
            isLoadingReports = false;
            return;
        }
        
        if (loader) loader.style.display = 'none';
        
        renderStats(data);
        renderPieChart(data);
        renderTopDays(data);
        renderDates(data);
        
        const updateTime = document.getElementById('updateTime');
        if (updateTime && data.parsedAt) {
            updateTime.innerHTML = `<i class="fas fa-clock"></i> Данные: ${new Date(data.parsedAt).toLocaleString()}`;
        }
        
    } catch (err) {
        console.error('❌ Ошибка загрузки:', err);
        if (loader) {
            loader.innerHTML = '❌ Ошибка загрузки данных';
            loader.style.display = 'block';
        }
    } finally {
        isLoadingReports = false;
    }
}

// ============================================
// РЕНДЕР СТАТИСТИКИ
// ============================================
function renderStats(data) {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;
    
    const dates = Object.keys(data.dates);
    let totalAvailable = 0, totalPartially = 0, totalBooked = 0;
    
    for (const date of dates) {
        const dayData = data.dates[date];
        totalAvailable += dayData.available?.length || 0;
        totalPartially += dayData.partially?.length || 0;
        totalBooked += dayData.fullyBooked?.length || 0;
    }
    
    statsGrid.innerHTML = `
        <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${dates.length}</div><div class="stat-label">Дней</div></div>
        <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-value" style="color:#10b981;">${totalAvailable}</div><div class="stat-label">Свободных</div></div>
        <div class="stat-card"><div class="stat-icon">🟡</div><div class="stat-value" style="color:#f59e0b;">${totalPartially}</div><div class="stat-label">Частично</div></div>
        <div class="stat-card"><div class="stat-icon">❌</div><div class="stat-value" style="color:#ef4444;">${totalBooked}</div><div class="stat-label">Занятых</div></div>
    `;
    console.log('📊 Статистика отрендерена');
}

// ============================================
// РЕНДЕР КРУГОВОЙ ДИАГРАММЫ
// ============================================
function renderPieChart(data) {
    const canvas = document.getElementById('pieChart');
    if (!canvas) return;
    
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js не загружен!');
        return;
    }
    
    const dates = Object.keys(data.dates);
    let totalAvailable = 0, totalPartially = 0, totalBooked = 0;
    
    for (const date of dates) {
        const dayData = data.dates[date];
        totalAvailable += dayData.available?.length || 0;
        totalPartially += dayData.partially?.length || 0;
        totalBooked += dayData.fullyBooked?.length || 0;
    }
    
    const total = totalAvailable + totalPartially + totalBooked;
    if (total === 0) {
        console.log('⚠️ Нет данных для диаграммы');
        return;
    }
    
    if (pieChart && typeof pieChart.destroy === 'function') {
        pieChart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    pieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Свободные', 'Частично', 'Занятые'],
            datasets: [{
                data: [totalAvailable, totalPartially, totalBooked],
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, color: '#94a3b8' } }
            }
        }
    });
    console.log('📊 Круговая диаграмма отрендерена');
}

// ============================================
// ФОРМАТИРОВАНИЕ ДАТ
// ============================================
function formatDateRu(dateStr) {
    if (!dateStr) return '—';
    
    if (/^\d+$/.test(dateStr)) {
        const day = parseInt(dateStr);
        return `${day} апреля`;
    }
    
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[2]);
        const month = parseInt(parts[1]);
        const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                            'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        return `${day} ${monthNames[month - 1]}`;
    }
    
    return dateStr;
}

function getDayOfWeek(dateStr) {
    if (/^\d+$/.test(dateStr)) {
        const now = new Date();
        const day = parseInt(dateStr);
        const date = new Date(now.getFullYear(), now.getMonth(), day);
        return date.getDay();
    }
    
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return date.getDay();
    }
    
    return 0;
}

// ============================================
// РЕНДЕР ТОП ДНЕЙ
// ============================================
function renderTopDays(data) {
    const container = document.getElementById('topDaysContainer');
    if (!container) return;
    
    const dates = Object.keys(data.dates);
    const allTimes = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', 
                      '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
    
    const loadPercent = [];
    
    for (const date of dates) {
        const dayData = data.dates[date];
        let totalSlots = 0;
        let bookedSlots = 0;
        
        for (const time of allTimes) {
            totalSlots++;
            if (dayData.fullyBooked?.includes(time)) {
                bookedSlots++;
            } else if (dayData.partially?.find(p => p.time === time)) {
                bookedSlots++;
            }
        }
        
        const percent = totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0;
        loadPercent.push({ 
            date: date,
            formattedDate: formatDateRu(date),
            percent, 
            booked: bookedSlots, 
            total: totalSlots 
        });
    }
    
    loadPercent.sort((a, b) => b.percent - a.percent);
    const top5 = loadPercent.slice(0, 5);
    
    if (top5.length === 0) {
        container.innerHTML = '<div class="reports-loader">Нет данных для анализа</div>';
        return;
    }
    
    let html = '<h3><i class="fas fa-fire"></i> Самые загруженные дни</h3>';
    
    for (let i = 0; i < top5.length; i++) {
        const item = top5[i];
        let color = '#10b981';
        if (item.percent > 70) color = '#ef4444';
        else if (item.percent > 40) color = '#f59e0b';
        
        html += `
            <div class="top-day">
                <div>
                    <strong style="min-width: 35px; display: inline-block;">№${i + 1}</strong>
                    <strong>${item.formattedDate}</strong>
                    <span style="font-size: 11px; color: #64748b; margin-left: 8px;">${item.booked}/${item.total} слотов</span>
                </div>
                <div style="color: ${color}; font-weight: 600;">${item.percent}%</div>
            </div>
            <div class="top-day-bar" style="width: ${item.percent}%; background: linear-gradient(90deg, ${color}, ${color}88);"></div>
        `;
    }
    
    container.innerHTML = html;
}

// ============================================
// РЕНДЕР ДАТ
// ============================================
function renderDates(data) {
    const datesGrid = document.getElementById('datesGrid');
    if (!datesGrid) return;
    
    const dates = Object.keys(data.dates).sort((a, b) => parseInt(a) - parseInt(b));
    const times = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
    const today = new Date().getDate();
    const currentHour = new Date().getHours();
    
    const isPassed = (day, time) => {
        if (day < today) return true;
        if (day > today) return false;
        return parseInt(time.split(':')[0]) < currentHour;
    };
    
    let html = '';
    
    for (const date of dates) {
        const dayNum = parseInt(date);
        const dayOfWeek = getDayOfWeek(date);
        const isWeekendOrFriday = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0);
        
        const dayData = data.dates[date];
        let slotsHtml = '';
        let available = 0, partially = 0, booked = 0;
        
        const formattedDate = formatDateRu(date);
        const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        
        for (const time of times) {
            let slotClass = 'slot';
            let statusText = '';
            
            if (isPassed(dayNum, time)) {
                slotClass += ' slot-passed';
                statusText = 'Прошёл';
            } else if (dayData.fullyBooked?.includes(time)) {
                slotClass += ' slot-booked';
                statusText = 'Занят';
                booked++;
            } else if (dayData.partially?.find(p => p.time === time)) {
                slotClass += ' slot-partially';
                const partial = dayData.partially.find(p => p.time === time);
                statusText = `${partial.free}/${partial.total}`;
                partially++;
            } else if (dayData.available?.includes(time)) {
                slotClass += ' slot-available';
                statusText = 'Свободен';
                available++;
            } else {
                slotClass += ' slot-booked';
                statusText = 'Занят';
                booked++;
            }
            
            slotsHtml += `
                <div class="${slotClass}">
                    <div>${time}</div>
                    <div style="font-size: 9px; opacity: 0.8;">${statusText}</div>
                </div>
            `;
        }
        
        const weekendClass = isWeekendOrFriday ? 'date-weekend' : '';
        
        html += `
            <div class="date-card ${weekendClass}">
                <div class="date-header">
                    <span class="date-number">${formattedDate} <span style="font-size: 11px; color: #64748b;">${weekdays[dayOfWeek]}</span></span>
                    <div class="date-badge">
                        <span class="badge badge-green">🟢 ${available}</span>
                        <span class="badge badge-yellow">🟡 ${partially}</span>
                        <span class="badge badge-red">🔴 ${booked}</span>
                    </div>
                </div>
                <div class="slots-grid">${slotsHtml}</div>
            </div>
        `;
    }
    
    datesGrid.innerHTML = html;
    console.log('📊 Даты отрендерены, количество:', dates.length);
}

// ============================================
// ЭКСПОРТ
// ============================================
window.initReports = initReports;
window.cleanupReports = cleanupReports;
window.loadReportsData = loadReportsData;
window.runParser = runParser;
window.fixParser = fixParser;

console.log('✅ reports.js загружен (исправленная версия)');