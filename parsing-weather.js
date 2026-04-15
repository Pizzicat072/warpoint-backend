const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let lastWeatherData = null;
let lastSource = null;

// ============================================
// СПИСОК ИСТОЧНИКОВ ПОГОДЫ (с актуальными селекторами)
// ============================================

const weatherSources = [
    {
        name: 'Yandex',
        url: 'https://yandex.ru/pogoda/ru/tobolsk',
        parser: async (page) => {
            return await page.evaluate(() => {
                let temperature = null;
                let feelsLike = null;
                
                // Парсим температуру: <span class="AppFactTemperature_value__2qhsG">3</span>
                const tempSpan = document.querySelector('.AppFactTemperature_value__2qhsG');
                if (tempSpan) {
                    const tempValue = parseInt(tempSpan.innerText.trim());
                    if (!isNaN(tempValue)) {
                        // Проверяем знак минус
                        const signSpan = document.querySelector('.AppFactTemperature_sign__1MeN4');
                        temperature = signSpan && signSpan.innerText.trim() === '−' ? -tempValue : tempValue;
                    }
                }
                
                // Парсим "ощущается как": <span class="AppFact_feels__base__bw86b">Ощущается как −6°</span>
                const feelsSpan = document.querySelector('.AppFact_feels__base__bw86b');
                if (feelsSpan) {
                    const feelsText = feelsSpan.innerText;
                    const match = feelsText.match(/[−-]?\d+/);
                    if (match) {
                        let feelsValue = parseInt(match[0].replace('−', '-'));
                        if (!isNaN(feelsValue)) feelsLike = feelsValue;
                    }
                }
                
                // Определяем иконку по температуре
let icon = '🌡️';
if (temperature !== null) {
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 20;
    
    if (temperature <= -20) icon = isNight ? '🌙❄️' : '❄️🥶';
    else if (temperature <= -10) icon = isNight ? '🌙❄️' : '❄️';
    else if (temperature <= -5) icon = isNight ? '🌙☁️❄️' : '☁️❄️';
    else if (temperature <= 0) icon = isNight ? '🌙🧥' : '🧥';
    else if (temperature <= 5) icon = isNight ? '🌙☁️' : '☁️';
    else if (temperature <= 15) icon = isNight ? '🌙☀️' : '☀️';
    else if (temperature <= 25) icon = isNight ? '🌙😎' : '😎🔥';
    else icon = isNight ? '🌙🥵' : '🥵';
}
                
                return { temperature, feelsLike, description: 'Яндекс.Погода', icon };
            });
        }
    },
    {
        name: 'Gismeteo',
        url: 'https://www.gismeteo.ru/weather-tobolsk-4590/now/',
        parser: async (page) => {
            return await page.evaluate(() => {
                let temperature = null;
                let feelsLike = null;
                
                // Парсим температуру: <temperature-value value="-5">-5</temperature-value>
                const tempElement = document.querySelector('temperature-value');
                if (tempElement) {
                    const value = tempElement.getAttribute('value');
                    if (value) {
                        temperature = parseInt(value);
                    } else {
                        const match = tempElement.innerText.match(/[−-]?\d+/);
                        if (match) temperature = parseInt(match[0].replace('−', '-'));
                    }
                }
                
                // Альтернативный селектор на случай изменения
                if (temperature === null) {
                    const weatherValue = document.querySelector('.weather-value');
                    if (weatherValue) {
                        const match = weatherValue.innerText.match(/[−-]?\d+/);
                        if (match) temperature = parseInt(match[0].replace('−', '-'));
                    }
                }
                
                // Парсим "ощущается как"
                const feelElement = document.querySelector('.weather-feel');
                if (feelElement) {
                    const match = feelElement.innerText.match(/[−-]?\d+/);
                    if (match) feelsLike = parseInt(match[0].replace('−', '-'));
                }
                
                // Определяем описание и иконку
                let description = 'Gismeteo';
                let icon = '🌡️';
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    
                    if (temperature <= -15) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= -5) icon = isNight ? '🌙☁️' : '☁️❄️';
                    else if (temperature <= 0) icon = isNight ? '🌙🧥' : '🧥';
                    else if (temperature <= 10) icon = isNight ? '🌙' : '☀️';
                    else icon = isNight ? '🌙' : '☀️🔥';
                }
                
                return { temperature, feelsLike, description, icon };
            });
        }
    },
    {
        name: 'Mail.ru',
        url: 'https://pogoda.mail.ru/prognoz/tobolsk/14dney/',
        parser: async (page) => {
            return await page.evaluate(() => {
                let temperature = null;
                let feelsLike = null;
                
                // Парсим температуру: <span class="text text_block text_bold_medium margin_bottom_10">-2°</span>
                const tempElements = document.querySelectorAll('.text.text_block.text_bold_medium.margin_bottom_10');
                for (const el of tempElements) {
                    const match = el.innerText.match(/[−-]?\d+/);
                    if (match) {
                        temperature = parseInt(match[0].replace('−', '-'));
                        break;
                    }
                }
                
                // Парсим "ощущается как": <span class="text text_block text_light_normal text_fixed color_gray">ощущается как -4°</span>
                const feelElements = document.querySelectorAll('.text.text_block.text_light_normal.text_fixed.color_gray');
                for (const el of feelElements) {
                    const text = el.innerText;
                    if (text.includes('ощущается') || text.includes('ощущается как')) {
                        const match = text.match(/[−-]?\d+/);
                        if (match) {
                            feelsLike = parseInt(match[0].replace('−', '-'));
                            break;
                        }
                    }
                }
                
                // Определяем иконку
                let icon = '🌡️';
                if (temperature !== null) {
                    const hour = new Date().getHours();
                    const isNight = hour < 6 || hour >= 20;
                    
                    if (temperature <= -15) icon = isNight ? '🌙❄️' : '❄️';
                    else if (temperature <= -5) icon = isNight ? '🌙☁️' : '☁️❄️';
                    else if (temperature <= 0) icon = isNight ? '🌙🧥' : '🧥';
                    else if (temperature <= 10) icon = isNight ? '🌙' : '☀️';
                    else icon = isNight ? '🌙' : '☀️🔥';
                }
                
                return { temperature, feelsLike, description: 'Mail.ru Погода', icon };
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
// ОСНОВНАЯ ФУНКЦИЯ ПАРСИНГА С РЕЗЕРВОМ
// ============================================

async function fetchWeather() {
    console.log('🌤️ Запуск парсинга погоды...', getTobolskTime().toLocaleString());
    
    // Пробуем загрузить из кэша (если свежий)
    const cachePath = path.join(__dirname, 'data', 'weather-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime();
            if (cacheAge < 30 * 60 * 1000) { // 30 минут
                console.log(`📦 Используем кэшированную погоду (возраст: ${Math.round(cacheAge / 60000)} мин, источник: ${cached.source || 'cache'})`);
                lastWeatherData = cached;
                lastSource = cached.source || 'cache';
                return cached;
            }
        } catch(e) {}
    }
    
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--disable-software-rasterizer'
            ],
            headless: true,
            timeout: 30000
        });
        
        // Пробуем каждый источник по очереди
        for (let i = 0; i < weatherSources.length; i++) {
            const source = weatherSources[i];
            console.log(`🔄 Пробуем источник: ${source.name} (${i + 1}/${weatherSources.length})`);
            
            let page = null;
            try {
                page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setDefaultNavigationTimeout(20000);
                
                await page.goto(source.url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                });
                
                await new Promise(r => setTimeout(r, 3000));
                
                const weatherData = await source.parser(page);
                await page.close();
                
                // Проверяем, удалось ли получить температуру
                if (weatherData.temperature !== null && !isNaN(weatherData.temperature)) {
                    weatherData.temperatureDisplay = weatherData.temperature > 0 ? '+' + weatherData.temperature : '' + weatherData.temperature;
                    weatherData.feelsLikeDisplay = weatherData.feelsLike !== null && !isNaN(weatherData.feelsLike)
                        ? (weatherData.feelsLike > 0 ? '+' + weatherData.feelsLike : '' + weatherData.feelsLike)
                        : null;
                    weatherData.fetchedAt = new Date().toISOString();
                    weatherData.source = source.name;
                    
                    lastWeatherData = weatherData;
                    lastSource = source.name;
                    
                    // Сохраняем в кэш
                    const cacheDir = path.join(__dirname, 'data');
                    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
                    fs.writeFileSync(cachePath, JSON.stringify(weatherData, null, 2));
                    
                    console.log(`✅ Погода получена из ${source.name}: ${weatherData.temperatureDisplay}°C, ощущается как ${weatherData.feelsLikeDisplay || '?'}°C`);
                    return weatherData;
                } else {
                    console.log(`⚠️ ${source.name} вернул некорректную температуру (${weatherData.temperature}), пробуем следующий...`);
                }
                
            } catch (sourceErr) {
                console.log(`❌ ${source.name} не удался: ${sourceErr.message}`);
                if (page) await page.close();
                continue;
            }
        }
        
        // Если все источники не удались, используем кэш (даже старый)
        if (fs.existsSync(cachePath)) {
            try {
                const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                console.log('📦 Все источники недоступны, используем старый кэш');
                return cached;
            } catch(e) {}
        }
        
        throw new Error('Все источники погоды недоступны');
        
    } catch (err) {
        console.error('❌ Ошибка парсинга погоды:', err.message);
        
        // Последняя попытка — вернуть заглушку
        const fallbackData = { 
            temperature: 0, 
            temperatureDisplay: '0', 
            feelsLike: null, 
            feelsLikeDisplay: null, 
            description: 'Данные временно недоступны', 
            icon: '🌡️', 
            isError: true,
            fetchedAt: new Date().toISOString(),
            source: 'fallback'
        };
        
        // Сохраняем заглушку в кэш
        try {
            fs.writeFileSync(cachePath, JSON.stringify(fallbackData, null, 2));
        } catch(e) {}
        
        return fallbackData;
        
    } finally {
        if (browser) await browser.close();
    }
}

function getLastWeather() {
    return lastWeatherData;
}

module.exports = { fetchWeather, getLastWeather };