// parsing-booking.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

process.env.TZ = 'Asia/Yekaterinburg';

let currentProgress = { step: 0, percent: 0, message: 'Ожидание запуска' };
let isParsing = false;
let lastParseTime = null;

// Один браузер на все запросы
let sharedBrowser = null;
let browserInitPromise = null;

// ============================================
// ПОЛУЧЕНИЕ БРАУЗЕРА (С ЗАЩИТОЙ ОТ ГОНОК)
// ============================================

async function getBrowser() {
    // Если браузер уже инициализируется, ждём
    if (browserInitPromise) {
        return await browserInitPromise;
    }
    
    // Если браузер жив, возвращаем его
    if (sharedBrowser && sharedBrowser.isConnected()) {
        try {
            // Проверяем, что браузер действительно работает
            await sharedBrowser.version();
            return sharedBrowser;
        } catch (e) {
            console.log('?? Браузер отвалился, пересоздаём...');
            sharedBrowser = null;
        }
    }
    
    // Закрываем старый браузер если есть
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch(e) {}
        sharedBrowser = null;
    }
    
    // Создаём новый браузер
    browserInitPromise = (async () => {
        try {
            console.log('?? Запуск браузера...');
            sharedBrowser = await puppeteer.launch({
                args: [
                    ...chromium.args,
                    '--single-process',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ],
                defaultViewport: { width: 800, height: 600 },
                executablePath: await chromium.executablePath(),
                headless: true,
                timeout: 30000
            });
            console.log('? Браузер запущен');
            return sharedBrowser;
        } catch (e) {
            console.error('? Ошибка запуска браузера:', e.message);
            throw e;
        } finally {
            browserInitPromise = null;
        }
    })();
    
    return await browserInitPromise;
}

// ============================================
// ЗАКРЫТИЕ БРАУЗЕРА
// ============================================

async function closeBrowser() {
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
            console.log('?? Браузер закрыт');
        } catch(e) {
            console.error('Ошибка закрытия браузера:', e);
        }
        sharedBrowser = null;
    }
}

// ============================================
// КЛАСС ПАРСЕРА
// ============================================

class BookingParser {
    constructor() {
        this.baseUrl = 'https://booking.warpoint.ru';
        this.city = 'Тобольск';
        this.arena = 'ТГК Евразия';
        this.dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    getTobolskTime() {
        const now = new Date();
        const tobolskTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
        return {
            date: tobolskTime,
            hour: tobolskTime.getHours(),
            minute: tobolskTime.getMinutes(),
            day: tobolskTime.getDate(),
            month: tobolskTime.getMonth() + 1,
            year: tobolskTime.getFullYear(),
            monthName: tobolskTime.toLocaleString('ru', { month: 'long' }).toUpperCase(),
            dateStr: tobolskTime.toLocaleString('ru-RU')
        };
    }
    
    async saveProgress(step, percent, message) {
        currentProgress = { step, percent, message, timestamp: Date.now(), isParsing };
        const progressFile = path.join(this.dataDir, 'parsing-progress.json');
        try {
            fs.writeFileSync(progressFile, JSON.stringify(currentProgress, null, 2));
        } catch (err) {
            console.error('Ошибка сохранения прогресса:', err);
        }
        console.log(`?? [${percent}%] ${message}`);
        return currentProgress;
    }
    
    async clickOnText(page, text) {
        try {
            const result = await page.evaluate((searchText) => {
                const elements = Array.from(document.querySelectorAll('button, div, span, a, .q-btn, [role="button"]'));
                for (const el of elements) {
                    if (el.innerText?.trim() === searchText && el.offsetParent !== null) {
                        const rect = el.getBoundingClientRect();
                        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, found: true };
                    }
                }
                return { found: false };
            }, text);
            
            if (result.found) {
                await page.mouse.click(result.x, result.y);
                await this.sleep(1000);
                return true;
            }
            return false;
        } catch (err) {
            return false;
        }
    }
    
    async getAvailableDates(page) {
        const time = this.getTobolskTime();
        const today = time.day;
        
        return await page.evaluate((today) => {
            const dates = [];
            const buttons = Array.from(document.querySelectorAll('button, .q-btn, [role="button"], .q-date__calendar-item'));
            
            for (const btn of buttons) {
                let text = btn.innerText?.trim();
                if (!text && btn.getAttribute('data-date')) {
                    text = btn.getAttribute('data-date');
                }
                if (text && /^\d{1,2}$/.test(text)) {
                    const day = parseInt(text);
                    if (day >= 1 && day <= 31 && day >= today - 1) {
                        const rect = btn.getBoundingClientRect();
                        const isDisabled = btn.disabled || btn.classList?.contains('disabled') || btn.classList?.contains('inactive');
                        const isVisible = rect.width > 0 && rect.height > 0 && rect.y > 0;
                        
                        if (!isDisabled && isVisible) {
                            dates.push({ day, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
                        }
                    }
                }
            }
            return dates.sort((a, b) => a.day - b.day);
        }, today);
    }
    
    async parseAvailability() {
        if (isParsing) {
            console.log('?? Парсинг уже выполняется');
            return { success: false, error: 'Парсинг уже выполняется' };
        }
        
        isParsing = true;
        lastParseTime = Date.now();
        
        const time = this.getTobolskTime();
        const today = time.day;
        const currentHour = time.hour;
        const monthName = time.monthName;
        const year = time.year;
        
        console.log(`?? Парсинг ${this.city}, ${this.arena}`);
        console.log(`?? Тобольск: ${time.dateStr}`);
        console.log(`?? Месяц: ${monthName} ${year}`);
        
        await this.saveProgress(1, 5, 'Запуск браузера...');
        
        const startTime = Date.now();
        let page = null;
        
        const allTimes = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
        
        const getTimesForDate = (day) => {
            if (day === today) {
                return allTimes.filter(t => parseInt(t.split(':')[0]) >= currentHour);
            }
            return [...allTimes];
        };
        
        try {
            const browser = await getBrowser();
            page = await browser.newPage();
            
            // Блокируем лишние ресурсы
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (resourceType === 'image' || resourceType === 'font' || resourceType === 'stylesheet') {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            
            await page.setViewport({ width: 800, height: 600 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            const url = `${this.baseUrl}/?country=Россия&city=${encodeURIComponent(this.city)}&arena=${encodeURIComponent(this.arena)}`;
            
            console.log(`?? Загрузка: ${url}`);
            await this.saveProgress(3, 20, 'Загрузка страницы...');
            
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.sleep(3000);
            
            await this.saveProgress(4, 30, 'Выбор АРЕНЫ...');
            await this.clickOnText(page, 'АРЕНА');
            await this.sleep(1500);
            
            await this.saveProgress(5, 40, 'Выбор ОТКРЫТОЙ ИГРЫ...');
            await this.clickOnText(page, 'ОТКРЫТАЯ ИГРА');
            await this.sleep(3000);
            
            await this.saveProgress(6, 50, 'Открытие календаря...');
            await this.clickOnText(page, 'ДАТА И ВРЕМЯ');
            await this.sleep(2000);
            
            const dates = await this.getAvailableDates(page);
            console.log(`?? Найдено дат: ${dates.length}`);
            
            if (dates.length === 0) {
                await page.close();
                isParsing = false;
                return { success: false, error: 'Даты не найдены' };
            }
            
            const result = { 
                success: true, 
                dates: {}, 
                month: `${monthName} ${year}`, 
                parsedAt: new Date().toISOString(), 
                city: this.city, 
                arena: this.arena,
                lastUpdate: Date.now()
            };
            
            for (let i = 0; i < dates.length; i++) {
                const date = dates[i];
                const percent = 55 + Math.floor((i + 1) / dates.length * 35);
                await this.saveProgress(7, percent, `Обработка ${date.day} (${i+1}/${dates.length})`);
                
                const dateData = { available: [], partially: [], fullyBooked: [], passed: [] };
                const times = getTimesForDate(date.day);
                
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await this.sleep(2000);
                await this.clickOnText(page, 'АРЕНА');
                await this.sleep(1000);
                await this.clickOnText(page, 'ОТКРЫТАЯ ИГРА');
                await this.sleep(2000);
                await this.clickOnText(page, 'ДАТА И ВРЕМЯ');
                await this.sleep(1500);
                
                const currentDates = await this.getAvailableDates(page);
                const targetDate = currentDates.find(d => d.day === date.day);
                
                if (targetDate) {
                    await page.mouse.click(targetDate.x, targetDate.y);
                    await this.sleep(1500);
                }
                
                for (const timeSlot of times) {
                    const hour = parseInt(timeSlot.split(':')[0]);
                    if (date.day === today && hour < currentHour) {
                        dateData.passed.push(timeSlot);
                        continue;
                    }
                    
                    const info = await page.evaluate((t) => {
                        const elements = Array.from(document.querySelectorAll('*'));
                        for (const el of elements) {
                            if (el.innerText?.trim() === t) {
                                const parent = el.parentElement;
                                const text = (el.innerText || '') + ' ' + (parent?.innerText || '');
                                const match = text.match(/(\d+)\/(\d+)/);
                                if (match) return { free: parseInt(match[1]), total: parseInt(match[2]) };
                            }
                        }
                        return null;
                    }, timeSlot);
                    
                    if (!info) {
                        dateData.fullyBooked.push(timeSlot);
                    } else if (info.free === 10) {
                        dateData.available.push(timeSlot);
                    } else if (info.free > 0) {
                        dateData.partially.push({ time: timeSlot, free: info.free, total: info.total });
                    } else {
                        dateData.fullyBooked.push(timeSlot);
                    }
                    
                    await this.sleep(200);
                }
                
                result.dates[date.day] = dateData;
                console.log(`   ? ${dateData.available.length} ?? ${dateData.partially.length} ?? ${dateData.fullyBooked.length}`);
            }
            
            await page.close();
            
            await this.saveProgress(8, 100, 'Сохранение...');
            
            const filePath = path.join(this.dataDir, 'booking-availability.json');
            fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
            
            console.log(`? Парсинг завершён за ${((Date.now() - startTime)/1000).toFixed(1)}с`);
            
            isParsing = false;
            return result;
            
        } catch (err) {
            console.error('? Ошибка:', err.message);
            await this.saveProgress(0, 0, `Ошибка: ${err.message}`);
            isParsing = false;
            if (page) await page.close().catch(() => {});
            return { success: false, error: err.message };
        }
    }
    
    getProgress() { return currentProgress; }
    getLastParseTime() { return lastParseTime; }
    isParsingNow() { return isParsing; }
}

// ============================================
// ЭКСПОРТ И ОЧИСТКА
// ============================================

// Закрываем браузер при завершении процесса
process.on('exit', () => {
    if (sharedBrowser) {
        sharedBrowser.close().catch(() => {});
    }
});

process.on('SIGINT', async () => {
    console.log('?? Получен SIGINT, закрываем браузер...');
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('?? Получен SIGTERM, закрываем браузер...');
    await closeBrowser();
    process.exit(0);
});

module.exports = { BookingParser };