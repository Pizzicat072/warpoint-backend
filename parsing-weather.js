// parsing-weather.js — ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ВЕРСИЯ

const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

let sharedBrowser = null;
let browserInitPromise = null;
let lastWeatherData = null;
let weatherCacheFile = path.join(__dirname, 'data', 'weather-cache.json');

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
            console.log('?? Браузер погоды отвалился, пересоздаём...');
            sharedBrowser = null;
        }
    }
    
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch(e) {}
        sharedBrowser = null;
    }
    
    browserInitPromise = (async () => {
        try {
            console.log('??? Запуск браузера для погоды...');
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
            console.log('? Браузер погоды запущен');
            return sharedBrowser;
        } catch (e) {
            console.error('? Ошибка запуска браузера погоды:', e.message);
            throw e;
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
            console.log('?? Браузер погоды закрыт');
        } catch(e) {
            console.error('Ошибка закрытия браузера погоды:', e);
        }
        sharedBrowser = null;
    }
}

// ============================================
// ИСТОЧНИКИ ПОГОДЫ
// ============================================

const weatherSources = [
    {
        name: 'Yandex',
        url: 'https://yandex.ru/pogoda/ru/tobolsk',
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
                let description = '';
                let icon = '???';
                
                // Температура
                const tempSpan = document.querySelector('.temp__value');
                if (tempSpan) {
                    const tempText = tempSpan.innerText;
                    const match = tempText.match(/[?\-]?\d+/);
                    if (match) temperature = parseInt(match[0].replace('?', '-'));
                }
                
                // Ощущается как
                const feelsLikeSpan = document.querySelector('.term__value');
                if (feelsLikeSpan) {
                    const feelsText = feelsLikeSpan.innerText;
                    const match = feelsText.match(/[?\-]?\d+/);
                    if (match) feelsLike = parseInt(match[0].replace('?', '-'));
                }
                
                // Описание
                const descSpan = document.querySelector('.link__condition');
                if (descSpan) {
                    description = descSpan.innerText.toLowerCase();
                }
                
                // Иконка
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    
                    if (description.includes('ясно')) {
                        icon = isNight ? '??' : '??';
                    } else if (description.includes('облачно')) {
                        icon = isNight ? '????' : '??';
                    } else if (description.includes('дожд') || description.includes('ливн')) {
                        icon = isNight ? '?????' : '???';
                    } else if (description.includes('снег')) {
                        icon = isNight ? '????' : '??';
                    } else if (description.includes('гроз')) {
                        icon = isNight ? '????' : '??';
                    } else {
                        if (temperature <= -20) icon = isNight ? '????' : '??';
                        else if (temperature <= -10) icon = isNight ? '???' : '???';
                        else if (temperature <= 0) icon = isNight ? '??' : '???';
                        else if (temperature <= 10) icon = isNight ? '??' : '???';
                        else icon = isNight ? '??' : '??';
                    }
                }
                
                return { temperature, feelsLike, description, icon };
            });
        }
    },
    {
        name: 'Gismeteo',
        url: 'https://www.gismeteo.ru/weather-tobolsk-11362/',
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
                let description = '';
                let icon = '???';
                
                const tempSpan = document.querySelector('.unit_temperature_c');
                if (tempSpan) {
                    const tempText = tempSpan.innerText;
                    const match = tempText.match(/[?\-]?\d+/);
                    if (match) temperature = parseInt(match[0].replace('?', '-'));
                }
                
                const feelsLikeSpan = document.querySelector('.feels-like');
                if (feelsLikeSpan) {
                    const feelsText = feelsLikeSpan.innerText;
                    const match = feelsText.match(/[?\-]?\d+/);
                    if (match) feelsLike = parseInt(match[0].replace('?', '-'));
                }
                
                const descSpan = document.querySelector('.weather-description');
                if (descSpan) {
                    description = descSpan.innerText.toLowerCase();
                }
                
                return { temperature, feelsLike, description, icon };
            });
        }
    }
];

// ============================================
// ВРЕМЯ ТОБОЛЬСКА
// ============================================

function getTobolskTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

// ============================================
// ЗАГРУЗКА КЭША
// ============================================

function loadWeatherCache() {
    try {
        if (fs.existsSync(weatherCacheFile)) {
            const data = JSON.parse(fs.readFileSync(weatherCacheFile, 'utf8'));
            const cacheAge = Date.now() - (data.timestamp || 0);
            if (cacheAge < 30 * 60 * 1000) { // 30 минут
                lastWeatherData = data;
                console.log('?? Погода загружена из кэша');
                return data;
            }
        }
    } catch (e) {
        console.error('Ошибка загрузки кэша погоды:', e);
    }
    return null;
}

// ============================================
// СОХРАНЕНИЕ КЭША
// ============================================

function saveWeatherCache(data) {
    try {
        const dir = path.dirname(weatherCacheFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(weatherCacheFile, JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch (e) {
        console.error('Ошибка сохранения кэша погоды:', e);
    }
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ПАРСИНГА
// ============================================

async function fetchWeather() {
    console.log('??? Запуск парсинга погоды...', getTobolskTime().toLocaleString());
    
    // Пробуем загрузить из кэша
    const cached = loadWeatherCache();
    if (cached && !cached.isError) {
        return cached;
    }
    
    let page = null;
    
    for (const source of weatherSources) {
        try {
            const browser = await getBrowser();
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            await page.setDefaultNavigationTimeout(20000);
            
            console.log(`?? Запрос к ${source.name}...`);
            await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Ждём загрузки контента
            await new Promise(r => setTimeout(r, 2000));
            
            const weatherData = await source.parser(page);
            
            if (weatherData.temperature !== null && !isNaN(weatherData.temperature)) {
                weatherData.temperatureDisplay = weatherData.temperature > 0 ? '+' + weatherData.temperature : '' + weatherData.temperature;
                if (weatherData.feelsLike !== null) {
                    weatherData.feelsLikeDisplay = weatherData.feelsLike > 0 ? '+' + weatherData.feelsLike : '' + weatherData.feelsLike;
                }
                weatherData.fetchedAt = new Date().toISOString();
                weatherData.source = source.name;
                
                console.log(`? Погода от ${source.name}: ${weatherData.temperatureDisplay}°C`);
                
                lastWeatherData = weatherData;
                saveWeatherCache(weatherData);
                
                await page.close();
                return weatherData;
            }
            
            await page.close();
        } catch (e) {
            console.log(`?? ${source.name}: ${e.message}`);
            if (page) await page.close().catch(() => {});
        }
    }
    
    // Если все источники не сработали, возвращаем кэш или заглушку
    console.log('?? Все источники погоды недоступны');
    
    if (lastWeatherData) {
        console.log('?? Возвращаем последние данные из памяти');
        return lastWeatherData;
    }
    
    const fallbackData = {
        temperature: 0,
        temperatureDisplay: '0',
        description: 'Нет данных',
        icon: '???',
        isError: true,
        fetchedAt: new Date().toISOString()
    };
    
    lastWeatherData = fallbackData;
    return fallbackData;
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
    console.log('?? Получен SIGINT, закрываем браузер погоды...');
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('?? Получен SIGTERM, закрываем браузер погоды...');
    await closeBrowser();
    process.exit(0);
});

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = { fetchWeather, getLastWeather };