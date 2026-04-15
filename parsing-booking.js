// parsing-booking.js - ЗАГЛУШКА БЕЗ PUPPETEER 
 
class BookingParser { 
    constructor() { this.dataDir = __dirname + '/data'; } 
    async parseAvailability() { console.log('??? Парсинг бронирований: заглушка'); return { success: false, error: 'Парсинг отключен на Render' }; } 
    getProgress() { return { step: 0, percent: 0, message: 'Парсинг отключен', isParsing: false }; } 
    getLastParseTime() { return null; } 
    isParsingNow() { return false; } 
} 
 
module.exports = { BookingParser }; 
