const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');

let lastWeatherData = null;

// Один браузер на все запросы (экономия памяти)
let sharedBrowser = null;

async function getBrowser() {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }
    
    if (sharedBrowser) {
        try { await sharedBrowser.close(); } catch(e) {}
    }
    
    sharedBrowser = await puppeteer.launch({
        args: [
            ...chromium.args,
            '--single-process',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run'
        ],
        defaultViewport: { width: 800, height: 600 },
        executablePath: await chromium.executablePath(),
        headless: true,
        timeout: 30000
    });
    
    return sharedBrowser;
}

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
                const tempSpan = document.querySelector('.temp__value');
                if (tempSpan) {
                    const tempText = tempSpan.innerText;
                    const match = tempText.match(/[−-]?\d+/);
                    if (match) temperature = parseInt(match[0].replace('−', '-'));
                }
                let icon = '🌡️';
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    if (temperature <= -20) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= -10) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= 0) icon = isNight ? '🌙' : '☁️';
                    else if (temperature <= 10) icon = isNight ? '🌙' : '☀️';
                    else icon = isNight ? '🌙' : '☀️';
                }
                return { temperature, description: 'Яндекс.Погода', icon };
            });
        }
    }
];

function getTobolskTime() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

async function fetchWeather() {
    console.log('🌤️ Запуск парсинга погоды...', getTobolskTime().toLocaleString());
    
    let page = null;
    
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setDefaultNavigationTimeout(15000);
        
        for (const source of weatherSources) {
            console.log(`🔄 Пробуем: ${source.name}`);
            try {
                await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const weatherData = await source.parser(page);
                
                if (weatherData.temperature !== null && !isNaN(weatherData.temperature)) {
                    weatherData.temperatureDisplay = weatherData.temperature > 0 ? '+' + weatherData.temperature : '' + weatherData.temperature;
                    weatherData.fetchedAt = new Date().toISOString();
                    weatherData.source = source.name;
                    
                    console.log(`✅ Погода: ${weatherData.temperatureDisplay}°C (${source.name})`);
                    
                    lastWeatherData = weatherData;
                    
                    await page.close();
                    return weatherData;
                }
            } catch (e) {
                console.log(`❌ ${source.name}: ${e.message}`);
            }
        }
        
        await page.close();
        
        if (lastWeatherData) {
            console.log('📦 Используем последние успешные данные');
            return lastWeatherData;
        }
        
        return { 
            temperature: 0, 
            temperatureDisplay: '0', 
            feelsLike: null, 
            feelsLikeDisplay: null, 
            description: 'Нет данных', 
            icon: '🌡️', 
            isError: true 
        };
        
    } catch (err) {
        console.error('❌ Ошибка парсинга:', err.message);
        if (page) await page.close().catch(() => {});
        
        if (lastWeatherData) return lastWeatherData;
        
        return { 
            temperature: 0, 
            temperatureDisplay: '0', 
            feelsLike: null, 
            feelsLikeDisplay: null, 
            description: 'Ошибка', 
            icon: '🌡️', 
            isError: true 
        };
    }
}

function getLastWeather() {
    return lastWeatherData;
}

// Закрываем браузер при завершении процесса
process.on('exit', () => { 
    if (sharedBrowser) sharedBrowser.close(); 
});
process.on('SIGINT', () => { 
    if (sharedBrowser) sharedBrowser.close(); 
    process.exit(); 
});
process.on('SIGTERM', () => { 
    if (sharedBrowser) sharedBrowser.close(); 
    process.exit(); 
});

module.exports = { fetchWeather, getLastWeather };