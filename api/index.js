const app = require('../server-pg.js'); 
 
// Vercel serverless handler 
module.exports = (req, res) =
    app(req, res); 
}; 
