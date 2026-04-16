// parsing-weather.js — АДАПТИРОВАН ПОД ПРОЕКТ

const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

let lastWeatherData = null;
let sharedBrowser = null;
let browserInitPromise = null;

// ============================================
// ПОЛУЧЕНИЕ БРАУЗЕРА (С ЗАЩИТОЙ ОТ ГОНОК)
// ============================================

async function getBrowser() {
    if (browserInitPromise) {
        return await browserInitPromise;
    }
    
    if (sharedBrowser && sharedBrowser.isConnected()) {
        try {
            await sharedBrowser.version();
            return sharedBrowser;
        } catch (e) {
            console.log('⚠️ Браузер погоды отвалился, пересоздаём...');
            sharedBrowser = null;
        }
    }
    
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch(e) {}
        sharedBrowser = null;
    }
    
    browserInitPromise = (async () => {
        try {
            console.log('🌤️ Запуск браузера для погоды...');
            
            const executablePath = process.env.CHROME_PATH || await chromium.executablePath();
            
            sharedBrowser = await puppeteer.launch({
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer'
                ],
                defaultViewport: { width: 1280, height: 800 },
                executablePath: executablePath,
                headless: true,
                timeout: 30000
            });
            console.log('✅ Браузер погоды запущен');
            return sharedBrowser;
        } catch (e) {
            console.error('❌ Ошибка запуска браузера погоды:', e.message);
            
            // Fallback на обычный puppeteer
            sharedBrowser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                headless: true
            });
            return sharedBrowser;
        } finally {
            browserInitPromise = null;
        }
    })();
    
    return await browserInitPromise;
}

async function closeBrowser() {
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
            console.log('🔒 Браузер погоды закрыт');
        } catch(e) {}
        sharedBrowser = null;
    }
}

// ============================================
// СПИСОК ИСТОЧНИКОВ ПОГОДЫ
// ============================================

const weatherSources = [
    {
        name: 'Yandex',
        url: 'https://yandex.ru/pogoda/ru/tobolsk',
        parser: async (page) => {
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
            
            return await page.evaluate(() => {
                let temperature = null;
                let feelsLike = null;
                
                const tempSpan = document.querySelector('.temp__value');
                if (tempSpan) {
                    const tempText = tempSpan.innerText;
                    const match = tempText.match(/[−\-]?\d+/);
                    if (match) temperature = parseInt(match[0].replace('−', '-'));
                }
                
                const feelsSpan = document.querySelector('.term__value');
                if (feelsSpan) {
                    const feelsText = feelsSpan.innerText;
                    const match = feelsText.match(/[−\-]?\d+/);
                    if (match) feelsLike = parseInt(match[0].replace('−', '-'));
                }
                
                let icon = '🌡️';
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    
                    if (temperature <= -20) icon = isNight ? '🌙❄️' : '❄️🥶';
                    else if (temperature <= -10) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= 0) icon = isNight ? '🌙🧥' : '🧥';
                    else if (temperature <= 10) icon = isNight ? '🌙☁️' : '☁️';
                    else if (temperature <= 20) icon = isNight ? '🌙☀️' : '☀️';
                    else icon = isNight ? '🌙😎' : '😎🔥';
                }
                
                return { temperature, feelsLike, description: 'Яндекс.Погода', icon };
            });
        }
    },
    {
        name: 'Gismeteo',
        url: 'https://www.gismeteo.ru/weather-tobolsk-4590/now/',
        parser: async (page) => {
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (resourceType === 'image' || resourceType === 'font' || resourceType === 'stylesheet') {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            
            return await page.evaluate(() => {
                let temperature = null;
                let feelsLike = null;
                
                const tempElement = document.querySelector('temperature-value');
                if (tempElement) {
                    const value = tempElement.getAttribute('value');
                    if (value) temperature = parseInt(value);
                    else {
                        const match = tempElement.innerText.match(/[−-]?\d+/);
                        if (match) temperature = parseInt(match[0].replace('−', '-'));
                    }
                }
                
                if (temperature === null) {
                    const weatherValue = document.querySelector('.weather-value');
                    if (weatherValue) {
                        const match = weatherValue.innerText.match(/[−-]?\d+/);
                        if (match) temperature = parseInt(match[0].replace('−', '-'));
                    }
                }
                
                const feelElement = document.querySelector('.weather-feel');
                if (feelElement) {
                    const match = feelElement.innerText.match(/[−-]?\d+/);
                    if (match) feelsLike = parseInt(match[0].replace('−', '-'));
                }
                
                let icon = '🌡️';
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    
                    if (temperature <= -15) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= 0) icon = isNight ? '🌙🧥' : '🧥';
                    else icon = isNight ? '🌙' : '☀️';
                }
                
                return { temperature, feelsLike, description: 'Gismeteo', icon };
            });
        }
    }
];

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getTobolskTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ПАРСИНГА
// ============================================

async function fetchWeather() {
    console.log('🌤️ Запуск парсинга погоды...', getTobolskTime().toLocaleString());
    
    const cachePath = path.join(__dirname, 'data', 'weather-cache.json');
    const cacheDir = path.join(__dirname, 'data');
    
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    // Пробуем загрузить из кэша
    if (fs.existsSync(cachePath)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime();
            if (cacheAge < 30 * 60 * 1000) {
                console.log(`📦 Кэш погоды (${Math.round(cacheAge / 60000)} мин, ${cached.source})`);
                lastWeatherData = cached;
                return cached;
            }
        } catch(e) {}
    }
    
    let page = null;
    
    try {
        const browser = await getBrowser();
        
        for (const source of weatherSources) {
            try {
                console.log(`🔄 Пробуем: ${source.name}`);
                page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setDefaultNavigationTimeout(20000);
                
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await new Promise(r => setTimeout(r, 2000));
                
                const weatherData = await source.parser(page);
                await page.close();
                page = null;
                
                if (weatherData.temperature !== null && !isNaN(weatherData.temperature)) {
                    weatherData.temperatureDisplay = weatherData.temperature > 0 ? '+' + weatherData.temperature : '' + weatherData.temperature;
                    weatherData.feelsLikeDisplay = weatherData.feelsLike !== null && !isNaN(weatherData.feelsLike)
                        ? (weatherData.feelsLike > 0 ? '+' + weatherData.feelsLike : '' + weatherData.feelsLike)
                        : null;
                    weatherData.fetchedAt = new Date().toISOString();
                    weatherData.source = source.name;
                    
                    lastWeatherData = weatherData;
                    fs.writeFileSync(cachePath, JSON.stringify(weatherData, null, 2));
                    
                    console.log(`✅ Погода от ${source.name}: ${weatherData.temperatureDisplay}°C`);
                    return weatherData;
                }
            } catch (e) {
                console.log(`⚠️ ${source.name}: ${e.message}`);
                if (page) {
                    await page.close().catch(() => {});
                    page = null;
                }
            }
        }
        
        // Возвращаем кэш или заглушку
        if (fs.existsSync(cachePath)) {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            console.log('📦 Все источники недоступны, используем старый кэш');
            return cached;
        }
        
        throw new Error('Все источники погоды недоступны');
        
    } catch (err) {
        console.error('❌ Ошибка парсинга погоды:', err.message);
        
        const fallbackData = {
            temperature: 0,
            temperatureDisplay: '0',
            feelsLike: null,
            feelsLikeDisplay: null,
            description: 'Данные недоступны',
            icon: '🌡️',
            isError: true,
            fetchedAt: new Date().toISOString(),
            source: 'fallback'
        };
        
        try {
            fs.writeFileSync(cachePath, JSON.stringify(fallbackData, null, 2));
        } catch(e) {}
        
        return fallbackData;
    }
}

function getLastWeather() {
    return lastWeatherData;
}

// ============================================
// ОЧИСТКА ПРИ ЗАВЕРШЕНИИ
// ============================================

process.on('exit', () => {
    if (sharedBrowser) {
        sharedBrowser.close().catch(() => {});
    }
});

process.on('SIGINT', async () => {
    console.log('🛑 Получен SIGINT, закрываем браузер погоды...');
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Получен SIGTERM, закрываем браузер погоды...');
    await closeBrowser();
    process.exit(0);
});

module.exports = { fetchWeather, getLastWeather };