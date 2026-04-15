// parsing-weather.js - ЗАГЛУШКА БЕЗ PUPPETEER 
 
async function fetchWeather() { 
    console.log('??? Погода: заглушка (экономия памяти)'); 
    return { temperature: 0, temperatureDisplay: '0', feelsLike: null, feelsLikeDisplay: null, description: 'Тобольск', icon: '???', source: 'stub' }; 
} 
 
function getLastWeather() { return { temperature: 0, temperatureDisplay: '0', description: 'Тобольск', icon: '???' }; } 
 
module.exports = { fetchWeather, getLastWeather }; 
