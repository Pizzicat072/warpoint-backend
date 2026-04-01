const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

process.env.TZ = 'Asia/Yekaterinburg';

let currentProgress = { step: 0, percent: 0, message: 'Ожидание запуска' };

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
    
    async saveProgress(step, percent, message, currentDate = null, totalDates = null) {
        currentProgress = {
            step: step,
            percent: percent,
            message: message,
            currentDate: currentDate,
            totalDates: totalDates,
            timestamp: Date.now()
        };
        
        const progressFile = path.join(this.dataDir, 'parsing-progress.json');
        try {
            fs.writeFileSync(progressFile, JSON.stringify(currentProgress, null, 2));
        } catch (err) {}
        
        console.log(`📊 [${percent}%] ${message}`);
        return currentProgress;
    }
    
    async clickOnText(page, text) {
        try {
            const result = await page.evaluate((searchText) => {
                const elements = Array.from(document.querySelectorAll('button, div, span, a'));
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
            const buttons = Array.from(document.querySelectorAll('button, .q-btn, [role="button"]'));
            
            for (const btn of buttons) {
                const text = btn.innerText?.trim();
                if (text && /^\d{1,2}$/.test(text)) {
                    const day = parseInt(text);
                    if (day >= 1 && day <= 31 && day >= today) {
                        const rect = btn.getBoundingClientRect();
                        const isDisabled = btn.disabled || btn.classList?.contains('disabled');
                        const isVisible = rect.width > 0 && rect.height > 0 && rect.y > 0;
                        
                        if (!isDisabled && isVisible) {
                            dates.push({
                                day: day,
                                x: rect.x + rect.width / 2,
                                y: rect.y + rect.height / 2
                            });
                        }
                    }
                }
            }
            return dates.sort((a, b) => a.day - b.day);
        }, today);
    }
    
    async parseAvailability() {
        const time = this.getTobolskTime();
        const today = time.day;
        const currentHour = time.hour;
        const monthName = time.monthName;
        const year = time.year;
        
        console.log(`🕷️ Парсинг ${this.city}, ${this.arena}`);
        console.log(`🕐 Тобольск: ${time.dateStr}`);
        console.log(`📅 Месяц: ${monthName} ${year}`);
        console.log(`📌 Сегодня: ${today}, текущий час: ${currentHour}`);
        
        await this.saveProgress(1, 5, 'Запуск браузера...');
        
        const startTime = Date.now();
        let browser = null;
        
        const allTimes = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', 
                          '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
        
        const getTimesForDate = (day) => {
            if (day === today) {
                return allTimes.filter(t => parseInt(t.split(':')[0]) >= currentHour);
            }
            return [...allTimes];
        };
        
        try {
            let executablePath;
            try {
                executablePath = await chromium.executablePath();
                console.log(`   Chromium path: ${executablePath}`);
            } catch (e) {
                executablePath = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
                console.log(`   Fallback path: ${executablePath}`);
            }
            
            browser = await puppeteer.launch({
                args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                executablePath: executablePath,
                headless: true,
                defaultViewport: { width: 1280, height: 800 }
            });
            
            await this.saveProgress(2, 10, 'Браузер запущен');
            
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            const url = `${this.baseUrl}/?country=Россия&city=${encodeURIComponent(this.city)}&arena=${encodeURIComponent(this.arena)}`;
            
            console.log(`🌐 Загрузка: ${url}`);
            await this.saveProgress(3, 20, 'Загрузка страницы...');
            
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            await this.sleep(10000);
            
            await this.saveProgress(4, 30, 'Выбор АРЕНЫ...');
            await this.clickOnText(page, 'АРЕНА');
            await this.sleep(2000);
            
            await this.saveProgress(5, 40, 'Выбор ОТКРЫТОЙ ИГРЫ...');
            await this.clickOnText(page, 'ОТКРЫТАЯ ИГРА');
            await this.sleep(10000);
            
            await this.saveProgress(6, 50, 'Открытие календаря...');
            await this.clickOnText(page, 'ДАТА И ВРЕМЯ');
            await this.sleep(3000);
            
            const dates = await this.getAvailableDates(page);
            console.log(`📊 Найдено дат: ${dates.length}`);
            await this.saveProgress(6, 55, `Найдено ${dates.length} дат`);
            
            if (dates.length === 0) {
                return { success: false, error: 'Даты не найдены' };
            }
            
            const result = { 
                success: true, 
                dates: {}, 
                month: `${monthName} ${year}`, 
                parsedAt: new Date().toISOString(), 
                city: this.city, 
                arena: this.arena 
            };
            
            for (let i = 0; i < dates.length; i++) {
                const date = dates[i];
                const percent = 55 + Math.floor((i + 1) / dates.length * 35);
                await this.saveProgress(7, percent, `Обработка ${date.day} (${i+1}/${dates.length})`);
                
                console.log(`\n📅 Дата ${date.day}`);
                
                const dateData = { available: [], partially: [], fullyBooked: [], passed: [] };
                const times = getTimesForDate(date.day);
                
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
                await this.sleep(8000);
                await this.clickOnText(page, 'АРЕНА');
                await this.sleep(2000);
                await this.clickOnText(page, 'ОТКРЫТАЯ ИГРА');
                await this.sleep(8000);
                await this.clickOnText(page, 'ДАТА И ВРЕМЯ');
                await this.sleep(3000);
                
                const currentDates = await this.getAvailableDates(page);
                const targetDate = currentDates.find(d => d.day === date.day);
                
                if (targetDate) {
                    await page.mouse.click(targetDate.x, targetDate.y);
                    await this.sleep(2000);
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
                    
                    await this.sleep(300);
                }
                
                result.dates[date.day] = {
                    available: dateData.available,
                    partially: dateData.partially,
                    fullyBooked: dateData.fullyBooked,
                    passed: dateData.passed,
                    total: times.length
                };
                
                console.log(`   ✅ ${dateData.available.length} 🟡 ${dateData.partially.length} ❌ ${dateData.fullyBooked.length}`);
            }
            
            await this.saveProgress(8, 100, 'Сохранение...');
            
            const filePath = path.join(this.dataDir, 'booking-availability.json');
            fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
            
            console.log(`✅ Парсинг завершён за ${((Date.now() - startTime)/1000).toFixed(1)}с`);
            
            return result;
            
        } catch (err) {
            console.error('❌ Ошибка:', err.message);
            await this.saveProgress(0, 0, `Ошибка: ${err.message}`);
            return { success: false, error: err.message };
        } finally {
            if (browser) await browser.close();
        }
    }
}

module.exports = { BookingParser };