require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const { Pool } = require('pg');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const NodeCache = require('node-cache');
const winston = require('winston');
const sanitizeHtml = require('sanitize-html');
const moment = require('moment-timezone');

const { fetchWeather, getLastWeather } = require('./parsing-weather.js');
const { BookingParser } = require('./parsing-booking.js');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'warpoint-secret-key-2024-ultra-secure';
const TIMEZONE = 'Asia/Yekaterinburg';
const BCRYPT_SALT_ROUNDS = 10;

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.File({ filename: 'error.log', level: 'error' }), new winston.transports.File({ filename: 'combined.log' }), new winston.transports.Console({ format: winston.format.simple() })]
});

const cache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
const bookingParser = new BookingParser();

let pool = null;
let pusher = null;
let server = null;
let dbInitialized = false;

const SERVER_STATE = { started: null, isReady: false, isShuttingDown: false, version: '5.1.1' };

const DB_CONFIG = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 8, min: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, allowExitOnIdle: true, application_name: 'warpoint_hub_v5' };

const PUSHER_CONFIG = { appId: process.env.PUSHER_APP_ID, key: process.env.PUSHER_KEY, secret: process.env.PUSHER_SECRET, cluster: process.env.PUSHER_CLUSTER, useTLS: true };

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { const allowedTypes = /jpeg|jpg|png|gif|webp/; const ext = path.extname(file.originalname).toLowerCase(); const mime = file.mimetype; if (allowedTypes.test(ext) && allowedTypes.test(mime)) cb(null, true); else cb(new Error('Только изображения (JPEG, PNG, GIF, WEBP)')); } });

const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip || req.socket.remoteAddress, skip: (req) => req.path === '/health' || req.path === '/api/health' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip || req.socket.remoteAddress });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip || req.socket.remoteAddress });

function getTobolskNow() { return moment().tz(TIMEZONE); }
function getTobolskDate() { return getTobolskNow().format('YYYY-MM-DD'); }
function getTobolskDateTime() { return getTobolskNow().format('YYYY-MM-DD HH:mm:ss'); }

function transliterate(name) { if (!name) return 'user'; const ru = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya' }; let result = ''; for (let char of name.toLowerCase()) result += ru[char] || char; return result.replace(/[^a-z0-9]/g, '') || 'user'; }

async function hashPassword(password) { return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS); }
async function comparePassword(password, hash) { if (!hash) return false; return await bcrypt.compare(password, hash); }
function generateToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(token) { try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; } }

function createDatabasePool() { if (pool) return pool; pool = new Pool(DB_CONFIG); pool.on('error', (err) => { logger.error('DB Pool Error:', err.message); if (err.message.includes('Connection terminated')) { pool = null; setTimeout(createDatabasePool, 5000); } }); logger.info('Пул БД создан'); return pool; }

async function query(text, params) { if (!pool) pool = createDatabasePool(); const start = Date.now(); try { const result = await pool.query(text, params); const duration = Date.now() - start; if (duration > 500) logger.warn('Slow query:', { duration, rows: result.rowCount, text: text.substring(0, 200) }); return result; } catch (err) { logger.error('SQL Error:', { message: err.message, query: text.substring(0, 200) }); throw err; } }

async function transaction(callback) { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); } }

function initPusher() { if (!PUSHER_CONFIG.appId || !PUSHER_CONFIG.key || !PUSHER_CONFIG.secret) { logger.warn('Pusher не настроен'); return null; } try { pusher = new Pusher(PUSHER_CONFIG); logger.info('Pusher инициализирован'); return pusher; } catch (err) { logger.error('Pusher error:', err.message); return null; } }

async function triggerPusher(channel, event, data) { if (!pusher) return false; try { await pusher.trigger(channel, event, data); return true; } catch (err) { logger.error('Pusher trigger error:', err.message); return false; } }

async function addNotification(recipient, type, data) { try { await query("INSERT INTO notifications (recipient, type, data, read, created_at) VALUES ($1, $2, $3, FALSE, NOW())", [recipient, type, JSON.stringify(data)]); if (pusher) { const channel = `private-user-${transliterate(recipient)}`; await pusher.trigger(channel, 'personal-notification', { type, data }); } } catch (err) { logger.error('Add notification error:', err.message); } }

function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }

app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            styleSrcAttr: ["'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.pusher.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
            connectSrc: [
                "'self'",
                "https://*.pusher.com",
                "wss://*.pusher.com",
                "https://api.pusherapp.com",
                "https://js.pusher.com",
                "https://cdn.jsdelivr.net",
                "https://sockjs-ap1.pusher.com",
                "wss://ws-ap1.pusher.com"
            ],
            frameSrc: ["'self'"],
            workerSrc: ["'self'", "blob:"],
            childSrc: ["'self'", "blob:"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(globalLimiter);
app.use(express.static('public', { maxAge: '1d', etag: true, lastModified: true }));

const authMiddleware = (req, res, next) => { const token = req.headers['authorization']?.split(' ')[1]; if (!token) return res.status(401).json({ success: false, error: 'No token' }); const decoded = verifyToken(token); if (!decoded) return res.status(401).json({ success: false, error: 'Invalid token' }); req.user = decoded; next(); };

const roleMiddleware = (...roles) => (req, res, next) => { if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' }); if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: 'Forbidden' }); next(); };

const directorOnly = roleMiddleware('director');
const managerOrDirector = roleMiddleware('manager', 'director');
const adminOrAbove = roleMiddleware('admin', 'manager', 'director');

const TABLE_DEFINITIONS = {
    system_settings: `CREATE TABLE IF NOT EXISTS system_settings (key VARCHAR(100) PRIMARY KEY, val TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    employees: `CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, avatar VARCHAR(10) DEFAULT '👤', avatar_url TEXT, status VARCHAR(100) DEFAULT '💼 Работаю', active_status VARCHAR(100), coins INTEGER DEFAULT 100, rating INTEGER DEFAULT 0, role VARCHAR(50) DEFAULT 'operator', hours NUMERIC(10,2) DEFAULT 0, birthday DATE, phone VARCHAR(20), last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP, dashboard_style VARCHAR(50) DEFAULT 'standart', bought_styles TEXT DEFAULT '["standart"]', can_edit_vp BOOLEAN DEFAULT FALSE, bonus_streak INTEGER DEFAULT 1, last_bonus_claimed_at TIMESTAMP, total_shifts INTEGER DEFAULT 0, total_tasks_completed INTEGER DEFAULT 0, total_gifts_sent INTEGER DEFAULT 0, total_gifts_received INTEGER DEFAULT 0, total_messages INTEGER DEFAULT 0, total_exchanges INTEGER DEFAULT 0, deleted_at TIMESTAMP, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    passwords: `CREATE TABLE IF NOT EXISTS passwords (username VARCHAR(100) PRIMARY KEY, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    achievements: `CREATE TABLE IF NOT EXISTS achievements (id VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT, category VARCHAR(50), required_value INTEGER NOT NULL, coins_reward INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, icon VARCHAR(10) DEFAULT '🏆', color VARCHAR(7) DEFAULT '#fbbf24', is_hidden BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    user_achievements: `CREATE TABLE IF NOT EXISTS user_achievements (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE, claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, achievement_id))`,
    pending_achievements: `CREATE TABLE IF NOT EXISTS pending_achievements (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, achievement_id))`,
    tasks: `CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, author VARCHAR(100) NOT NULL, executor VARCHAR(100), priority VARCHAR(20) DEFAULT 'medium', deadline DATE, progress INTEGER DEFAULT 0, comment TEXT, status VARCHAR(20) DEFAULT 'in_progress', is_group_task VARCHAR(20), group_members JSONB, group_progress JSONB, is_archived BOOLEAN DEFAULT FALSE, penalty_applied BOOLEAN DEFAULT FALSE, wp_reward INTEGER DEFAULT 0, completed_at TIMESTAMP, archived_at TIMESTAMP, recurring VARCHAR(20) DEFAULT 'none', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    subtasks: `CREATE TABLE IF NOT EXISTS subtasks (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    task_attachments: `CREATE TABLE IF NOT EXISTS task_attachments (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, file_name VARCHAR(255) NOT NULL, file_size INTEGER, file_type VARCHAR(100), file_data TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    fines: `CREATE TABLE IF NOT EXISTS fines (id SERIAL PRIMARY KEY, date DATE NOT NULL, employee VARCHAR(100) NOT NULL, type VARCHAR(50) DEFAULT 'other', amount INTEGER DEFAULT 0, coins INTEGER DEFAULT 0, rating INTEGER DEFAULT 0, description TEXT, status VARCHAR(30) DEFAULT 'pending', created_by VARCHAR(100), director_comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    schedule: `CREATE TABLE IF NOT EXISTS schedule (id SERIAL PRIMARY KEY, date DATE NOT NULL, employee VARCHAR(100) NOT NULL, shift_time VARCHAR(10), shift_status VARCHAR(30) DEFAULT 'working', is_special BOOLEAN DEFAULT FALSE, special_end_time VARCHAR(100), shift_paid BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(date, employee))`,
    schedule_special_cases: `CREATE TABLE IF NOT EXISTS schedule_special_cases (id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, cases JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    exchange_requests: `CREATE TABLE IF NOT EXISTS exchange_requests (id SERIAL PRIMARY KEY, from_employee VARCHAR(100) NOT NULL, to_employee VARCHAR(100) NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL, from_shift_time VARCHAR(10), to_shift_time VARCHAR(10), status VARCHAR(20) DEFAULT 'pending', comment TEXT, expires_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    vp_bookings: `CREATE TABLE IF NOT EXISTS vp_bookings (id SERIAL PRIMARY KEY, admin VARCHAR(50) NOT NULL, event_date DATE NOT NULL, event_time TIME NOT NULL, customer_name VARCHAR(255) NOT NULL, amount INTEGER DEFAULT 2000, payment_type VARCHAR(30) DEFAULT 'evotor_card', booking_date DATE NOT NULL, photo_status VARCHAR(20) DEFAULT 'pending', script_status VARCHAR(20) DEFAULT 'not_sent', duration INTEGER DEFAULT 1, is_archived BOOLEAN DEFAULT FALSE, comment TEXT, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    salary_daily: `CREATE TABLE IF NOT EXISTS salary_daily (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, day_number INTEGER NOT NULL, month_year VARCHAR(7) NOT NULL, oklad INTEGER DEFAULT 0, event INTEGER DEFAULT 0, turnover INTEGER DEFAULT 0, bonus35 INTEGER DEFAULT 0, video INTEGER DEFAULT 0, extra_motivation INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(employee_id, day_number, month_year))`,
    corporate_fund: `CREATE TABLE IF NOT EXISTS corporate_fund (id SERIAL PRIMARY KEY, amount INTEGER DEFAULT 0, operation_type VARCHAR(20), comment TEXT, created_by INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    messages: `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, room VARCHAR(100) NOT NULL, sender VARCHAR(100) NOT NULL, text TEXT NOT NULL, time BIGINT NOT NULL, action_data JSONB, is_deleted BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    stickers: `CREATE TABLE IF NOT EXISTS stickers (id SERIAL PRIMARY KEY, sender VARCHAR(100), employee VARCHAR(100) NOT NULL, gift_id VARCHAR(50) NOT NULL, quantity INTEGER DEFAULT 1, is_anonymous BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    user_statuses: `CREATE TABLE IF NOT EXISTS user_statuses (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, status_id VARCHAR(50) NOT NULL, status_name VARCHAR(100) NOT NULL, status_icon VARCHAR(10) NOT NULL, price INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT FALSE, purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(employee_id, status_id))`,
    transactions: `CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, type VARCHAR(50) NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER DEFAULT 0, balance_after INTEGER DEFAULT 0, comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    knowledge_categories: `CREATE TABLE IF NOT EXISTS knowledge_categories (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, icon VARCHAR(10) DEFAULT '📁', description TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    knowledge_articles: `CREATE TABLE IF NOT EXISTS knowledge_articles (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES knowledge_categories(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, content TEXT, views INTEGER DEFAULT 0, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    notifications: `CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, recipient VARCHAR(100) NOT NULL, type VARCHAR(50) NOT NULL, data JSONB, read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    audit_log: `CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, user_id INTEGER, action VARCHAR(100) NOT NULL, entity_type VARCHAR(50), entity_id INTEGER, details JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    schema_migrations: `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name VARCHAR(255), applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
};

const INDEX_DEFINITIONS = [
    `CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active) WHERE is_active = TRUE`,
    `CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_executor_status ON tasks(executor, status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived) WHERE is_archived = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_author ON tasks(author)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)`,
    `CREATE INDEX IF NOT EXISTS idx_fines_employee_date ON fines(employee, date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_fines_status ON fines(status)`,
    `CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date)`,
    `CREATE INDEX IF NOT EXISTS idx_schedule_employee ON schedule(employee)`,
    `CREATE INDEX IF NOT EXISTS idx_vp_event_date ON vp_bookings(event_date)`,
    `CREATE INDEX IF NOT EXISTS idx_vp_is_archived ON vp_bookings(is_archived) WHERE is_archived = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_vp_admin ON vp_bookings(admin)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_is_deleted ON messages(is_deleted) WHERE is_deleted = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read) WHERE read = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_salary_daily_employee_month ON salary_daily(employee_id, month_year)`,
    `CREATE INDEX IF NOT EXISTS idx_exchange_requests_status ON exchange_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_exchange_requests_to_employee ON exchange_requests(to_employee)`,
    `CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON user_achievements(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pending_achievements_user_id ON pending_achievements(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(category_id)`
];

console.log('✅ ЧАСТЬ 1/10 загружена (конфигурация, БД, middleware) — ИСПРАВЛЕНО');
async function addColumnIfNotExists(table, column, type, defaultValue = null) {
    try {
        const check = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, column]);
        if (check.rows.length === 0) {
            let sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;
            if (defaultValue !== null) sql += ` DEFAULT ${defaultValue}`;
            await query(sql);
            logger.info(`Миграция: ${table}.${column} добавлен`);
        }
    } catch (err) { logger.warn(`Миграция ${table}.${column}: ${err.message}`); }
}

async function fixSystemSettingsTable() {
    try {
        const tableCheck = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'system_settings')`);
        if (!tableCheck.rows[0].exists) {
            logger.info('Таблица system_settings не существует, будет создана позже');
            return;
        }
        const valueCheck = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'value'`);
        const valCheck = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'val'`);
        if (valueCheck.rows.length > 0 && valCheck.rows.length === 0) {
            logger.info('🔄 Переименование system_settings.value -> system_settings.val');
            await query(`ALTER TABLE system_settings RENAME COLUMN value TO val`);
            logger.info('✅ Колонка переименована');
        } else if (valueCheck.rows.length === 0 && valCheck.rows.length === 0) {
            logger.info('Добавление колонки val в system_settings');
            await query(`ALTER TABLE system_settings ADD COLUMN val TEXT`);
        } else {
            logger.info('Таблица system_settings уже в правильном формате');
        }
    } catch (err) {
        logger.error('Ошибка миграции system_settings:', err.message);
        try {
            logger.warn('Попытка пересоздания system_settings...');
            await query(`DROP TABLE IF EXISTS system_settings CASCADE`);
            await query(`CREATE TABLE system_settings (key VARCHAR(100) PRIMARY KEY, val TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
            logger.info('✅ Таблица system_settings пересоздана');
        } catch (e) { logger.error('Не удалось пересоздать system_settings:', e.message); }
    }
}

async function runMigrations() {
    logger.info('Выполнение миграций...');
    
    // 🔥 ИСПРАВЛЯЕМ system_settings
    await fixSystemSettingsTable();
    
    // 🔥 ПОЛНОЕ ИСПРАВЛЕНИЕ ТАБЛИЦЫ PASSWORDS
try {
    // 1. Проверяем существование старой колонки password
    const oldColCheck = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'passwords' AND column_name = 'password'`);
    
    // 2. Проверяем существование колонки password_hash
    const hashColCheck = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'passwords' AND column_name = 'password_hash'`);
    
    // 3. Если есть старая колонка password
    if (oldColCheck.rows.length > 0) {
        logger.info('Найдена старая колонка password');
        
        // Если password_hash ещё нет - создаём и копируем данные
        if (hashColCheck.rows.length === 0) {
            logger.info('Создаём password_hash и копируем данные');
            await query(`ALTER TABLE passwords ADD COLUMN password_hash VARCHAR(255)`);
            await query(`UPDATE passwords SET password_hash = password WHERE password_hash IS NULL`);
        }
        
        // Удаляем ограничение NOT NULL со старой колонки
        logger.info('Снимаем NOT NULL с password');
        await query(`ALTER TABLE passwords ALTER COLUMN password DROP NOT NULL`);
        
        // Удаляем старую колонку
        logger.info('Удаляем старую колонку password');
        await query(`ALTER TABLE passwords DROP COLUMN IF EXISTS password`);
        
        logger.info('✅ Старая колонка password удалена');
    }
    
    // 4. Если нет ни password ни password_hash - создаём password_hash
    if (oldColCheck.rows.length === 0 && hashColCheck.rows.length === 0) {
        logger.info('Создаём колонку password_hash');
        await query(`ALTER TABLE passwords ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
    }
    
    // 5. Проверяем наличие колонки username (на всякий случай)
    const userCheck = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'passwords' AND column_name = 'username'`);
    if (userCheck.rows.length === 0) {
        logger.info('Добавляем колонку username');
        await query(`ALTER TABLE passwords ADD COLUMN username VARCHAR(100)`);
    }
    
    logger.info('✅ Таблица passwords полностью исправлена');
    
} catch (e) {
    logger.error('Ошибка миграции passwords:', e.message);
    
    // Если всё сломалось - пересоздаём таблицу
    try {
        logger.warn('Пересоздание таблицы passwords...');
        
        // Сохраняем существующие данные
        const existingData = await query(`SELECT username, password_hash FROM passwords`).catch(() => ({ rows: [] }));
        
        // Удаляем старую таблицу
        await query(`DROP TABLE IF EXISTS passwords CASCADE`);
        
        // Создаём новую с правильной структурой
        await query(`CREATE TABLE passwords (
            username VARCHAR(100) PRIMARY KEY, 
            password_hash VARCHAR(255) NOT NULL, 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Восстанавливаем данные
        for (const row of existingData.rows) {
            if (row.username && row.password_hash) {
                await query(`INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [row.username, row.password_hash]);
            }
        }
        
        logger.info('✅ Таблица passwords пересоздана');
    } catch (e2) {
        logger.error('Не удалось пересоздать passwords:', e2.message);
    }
}
    
    // Остальные миграции
    const employeeColumns = [
        { name: 'total_shifts', type: 'INTEGER', default: '0' },
        { name: 'total_tasks_completed', type: 'INTEGER', default: '0' },
        { name: 'total_gifts_sent', type: 'INTEGER', default: '0' },
        { name: 'total_gifts_received', type: 'INTEGER', default: '0' },
        { name: 'total_messages', type: 'INTEGER', default: '0' },
        { name: 'total_exchanges', type: 'INTEGER', default: '0' },
        { name: 'deleted_at', type: 'TIMESTAMP', default: null },
        { name: 'is_active', type: 'BOOLEAN', default: 'TRUE' },
        { name: 'active_status', type: 'VARCHAR(100)', default: null },
        { name: 'can_edit_vp', type: 'BOOLEAN', default: 'FALSE' },
        { name: 'dashboard_style', type: 'VARCHAR(50)', default: "'standart'" },
        { name: 'bought_styles', type: 'TEXT', default: "'[\"standart\"]'" },
        { name: 'bonus_streak', type: 'INTEGER', default: '1' },
        { name: 'last_bonus_claimed_at', type: 'TIMESTAMP', default: null },
        { name: 'phone', type: 'VARCHAR(20)', default: null },
        { name: 'birthday', type: 'DATE', default: null }
    ];
    for (const col of employeeColumns) await addColumnIfNotExists('employees', col.name, col.type, col.default);
    await addColumnIfNotExists('employees', 'updated_at', 'TIMESTAMP', 'CURRENT_TIMESTAMP');
    await addColumnIfNotExists('tasks', 'wp_reward', 'INTEGER', '0');
    await addColumnIfNotExists('tasks', 'penalty_applied', 'BOOLEAN', 'FALSE');
    await addColumnIfNotExists('tasks', 'group_progress', 'JSONB', null);
    await addColumnIfNotExists('tasks', 'archived_at', 'TIMESTAMP', null);
    await addColumnIfNotExists('tasks', 'recurring', 'VARCHAR(20)', "'none'");
    await addColumnIfNotExists('achievements', 'icon', 'VARCHAR(10)', "'🏆'");
    await addColumnIfNotExists('achievements', 'color', 'VARCHAR(7)', "'#fbbf24'");
    await addColumnIfNotExists('messages', 'is_deleted', 'BOOLEAN', 'FALSE');
    await addColumnIfNotExists('messages', 'deleted_at', 'TIMESTAMP', null);
    await addColumnIfNotExists('salary_daily', 'extra_motivation', 'INTEGER', '0');
    await addColumnIfNotExists('vp_bookings', 'duration', 'INTEGER', '1');
    await addColumnIfNotExists('fines', 'director_comment', 'TEXT', null);
    
    await query(`CREATE TABLE IF NOT EXISTS pending_achievements (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, achievement_id))`).catch(() => {});
    await query(`CREATE TABLE IF NOT EXISTS schedule_special_cases (id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, cases JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    await query(`CREATE TABLE IF NOT EXISTS task_attachments (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, file_name VARCHAR(255) NOT NULL, file_size INTEGER, file_type VARCHAR(100), file_data TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});
    
    logger.info('Миграции выполнены');
}

async function initSystemSettings() {
    await new Promise(r => setTimeout(r, 100));
    const settings = [
        { key: 'app_version', val: '5.1.1' },
        { key: 'global_theme', val: 'vr-portal' },
        { key: 'vp_script_available_days', val: '2' },
        { key: 'auto_archive_tasks_days', val: '3' },
        { key: 'exchange_expire_hours', val: '24' }
    ];
    for (const s of settings) {
        try {
            await query(`INSERT INTO system_settings (key, val) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val, updated_at = NOW()`, [s.key, s.val]);
        } catch (e) { logger.warn(`Не удалось вставить ${s.key}:`, e.message); }
    }
    logger.info('Системные настройки инициализированы');
}

async function initCorporateFund() {
    const check = await query("SELECT id FROM corporate_fund LIMIT 1");
    if (check.rows.length === 0) await query("INSERT INTO corporate_fund (amount, operation_type, comment) VALUES (0, 'initial', 'Начальное состояние')");
}

async function createDefaultDirector() {
    try {
        const check = await query("SELECT id FROM employees WHERE name = 'Денис'");
        if (check.rows.length > 0) {
            const passCheck = await query("SELECT username FROM passwords WHERE username = 'Денис'");
            if (passCheck.rows.length === 0) {
                const hashedPassword = await hashPassword('denis_1');
                await query("INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)", [hashedPassword]);
            }
            return;
        }
        const result = await query(`INSERT INTO employees (name, avatar, coins, rating, role, dashboard_style, bought_styles, bonus_streak, is_active) VALUES ('Денис', '👑', 1000, 0, 'director', 'standart', '["standart"]', 1, TRUE) RETURNING id`);
        const hashedPassword = await hashPassword('denis_1');
        await query("INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)", [hashedPassword]);
        logger.info(`Директор создан, id: ${result.rows[0].id}`);
    } catch (err) { logger.error('Ошибка создания директора:', err.message); }
}

const ACHIEVEMENT_CATEGORIES = { work: { name: 'Смены', icon: '📅', color: '#3b82f6' }, tasks: { name: 'Задачи', icon: '✅', color: '#10b981' }, gifts: { name: 'Подарки', icon: '🎁', color: '#ec4899' }, rating: { name: 'Рейтинг', icon: '⭐', color: '#fbbf24' }, streak: { name: 'Ежедневный вход', icon: '🔥', color: '#f97316' }, exchange: { name: 'Обмен', icon: '🔄', color: '#8b5cf6' }, chat: { name: 'Чат', icon: '💬', color: '#06b6d4' }, shop: { name: 'Магазин', icon: '🛒', color: '#a78bfa' }, knowledge: { name: 'База знаний', icon: '📚', color: '#14b8a6' }, special: { name: 'Особые', icon: '✨', color: '#fbbf24' }, legendary: { name: 'Легендарные', icon: '👑', color: '#fbbf24' } };

function generateAllAchievements() {
    const achievements = [];
    const shiftMilestones = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
    const shiftCoins = [50,30,30,30,50,30,50,30,30,100,60,60,60,60,100,80,100,80,100,80,150,120,150,120,180,200,150,200,250,300,400,500,600,700,800,900,1000,1200,1500,2000,2500,3000];
    shiftMilestones.forEach((m, i) => { achievements.push({ id: `shift_${m}`, name: m === 1 ? '🥇 Первая смена' : `📅 ${m} смен`, description: `Отработать ${m} ${m === 1 ? 'смену' : (m < 5 ? 'смены' : 'смен')}`, category: 'work', required_value: m, coins_reward: shiftCoins[i] || 100, sort_order: 100 + i, icon: m === 1 ? '🥇' : (m <= 10 ? '📅' : '📆') }); });
    const taskMilestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,60,70,80,90,100,150,200,250,300,400,500];
    const taskCoins = [30,20,20,20,30,20,30,20,20,50,40,60,50,80,60,80,60,100,100,120,120,150,200,250,300,350,400,500,600];
    taskMilestones.forEach((m, i) => { achievements.push({ id: `task_${m}`, name: m === 1 ? '✅ Первая задача' : `📋 ${m} задач`, description: `Выполнить ${m} ${m === 1 ? 'задачу' : (m < 5 ? 'задачи' : 'задач')}`, category: 'tasks', required_value: m, coins_reward: taskCoins[i] || 50, sort_order: 200 + i, icon: m === 1 ? '🎯' : '📋' }); });
    const giftMilestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50,60,70,80,90,100,120,150,200];
    const giftCoins = [20,15,15,15,20,15,20,15,15,30,25,40,30,50,60,80,80,100,100,120,150,180,200,250];
    giftMilestones.forEach((m, i) => { achievements.push({ id: `gift_${m}`, name: m === 1 ? '🎁 Первый подарок' : `🎁 ${m} подарков`, description: `Отправить ${m} ${m === 1 ? 'подарок' : (m < 5 ? 'подарка' : 'подарков')}`, category: 'gifts', required_value: m, coins_reward: giftCoins[i] || 30, sort_order: 300 + i, icon: '🎁' }); });
    const ratingMilestones = [10,20,30,40,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
    const ratingCoins = [30,20,20,20,30,20,30,20,20,50,40,40,40,40,60,50,80,70,100,90,120,150,180,200,250,300];
    ratingMilestones.forEach((m, i) => { let rank = '🌱 Новичок', icon = '🌱'; if (m >= 5000) { rank = '👑 Легенда'; icon = '👑'; } else if (m >= 3000) { rank = '💎 Профессионал'; icon = '💎'; } else if (m >= 1500) { rank = '🏆 Эксперт'; icon = '🏆'; } else if (m >= 500) { rank = '🔥 Мастер'; icon = '🔥'; } achievements.push({ id: `rating_${m}`, name: `${icon} ${rank}`, description: `Достичь ${m} рейтинга`, category: 'rating', required_value: m, coins_reward: ratingCoins[i] || 50, sort_order: 400 + i, icon }); });
    const streakMilestones = [3,5,7,10,14,21,30,40,50,60,70,80,90,100,150,200,250,300,365];
    const streakCoins = [30,50,80,100,150,200,300,350,400,450,500,550,600,700,900,1200,1500,2000,3000];
    streakMilestones.forEach((m, i) => { achievements.push({ id: `streak_${m}`, name: m === 365 ? '📅 Год в системе' : `🔥 ${m} дней подряд`, description: `Входить в систему ${m} ${m === 1 ? 'день' : (m < 5 ? 'дня' : 'дней')} подряд`, category: 'streak', required_value: m, coins_reward: streakCoins[i] || 100, sort_order: 500 + i, icon: '🔥' }); });
    const specialAchievements = [{ id: 'first_login', name: '🎉 Добро пожаловать', description: 'Первый вход в систему', coins: 50, icon: '🎉' }, { id: 'set_avatar', name: '🖼️ Свой стиль', description: 'Установить аватар', coins: 50, icon: '🖼️' }, { id: 'complete_profile', name: '📝 Полный профиль', description: 'Заполнить профиль', coins: 100, icon: '📝' }, { id: 'first_task_completed', name: '🎯 Первая задача', description: 'Выполнить первую задачу', coins: 30, icon: '🎯' }, { id: 'first_gift_sent', name: '🎁 Первый подарок', description: 'Отправить подарок', coins: 25, icon: '🎁' }, { id: 'first_exchange', name: '🔄 Первый обмен', description: 'Обменяться сменами', coins: 40, icon: '🔄' }, { id: 'first_shop_purchase', name: '🛍️ Первая покупка', description: 'Купить в магазине', coins: 20, icon: '🛍️' }, { id: 'first_knowledge', name: '📖 Первое знание', description: 'Прочитать статью', coins: 15, icon: '📖' }, { id: 'rich_1000', name: '💰 Капиталист', description: 'Накопить 1000 WP', coins: 200, icon: '💰' }, { id: 'rich_5000', name: '💰 Миллионер', description: 'Накопить 5000 WP', coins: 500, icon: '💰' }];
    specialAchievements.forEach((ach, i) => { achievements.push({ ...ach, category: 'special', required_value: 1, sort_order: 1000 + i }); });
    const legendaryAchievements = [{ id: 'warpoint_legend', name: '🏆 Легенда WARPOINT', description: 'Выполнить 100 достижений', coins: 5000, icon: '🏆' }, { id: 'thousand_shifts', name: '💪 Тысячник', description: 'Отработать 1000 смен', coins: 5000, icon: '💪' }, { id: 'thousand_tasks', name: '📋 Мастер задач', description: 'Выполнить 1000 задач', coins: 3000, icon: '📋' }, { id: 'millionaire', name: '💎 WP-миллионер', description: 'Накопить 100000 WP', coins: 10000, icon: '💎' }];
    legendaryAchievements.forEach((ach, i) => { achievements.push({ ...ach, category: 'legendary', required_value: 1, sort_order: 2000 + i }); });
    return achievements;
}

async function initAchievements() {
    logger.info('Инициализация достижений...');
    const achievements = generateAllAchievements();
    let inserted = 0, updated = 0;
    for (const ach of achievements) {
        try {
            const result = await query(`INSERT INTO achievements (id, name, description, category, required_value, coins_reward, sort_order, icon, color) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category, required_value = EXCLUDED.required_value, coins_reward = EXCLUDED.coins_reward, sort_order = EXCLUDED.sort_order, icon = EXCLUDED.icon, color = EXCLUDED.color RETURNING (SELECT CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END)`, [ach.id, ach.name, ach.description, ach.category, ach.required_value, ach.coins_reward, ach.sort_order, ach.icon, ACHIEVEMENT_CATEGORIES[ach.category]?.color || '#fbbf24']);
            if (result.rows[0]?.xmax === 0) inserted++; else updated++;
        } catch (err) { logger.error(`Ошибка достижения ${ach.id}: ${err.message}`); }
    }
    logger.info(`Достижения: новых ${inserted}, обновлено ${updated}`);
}

async function initDatabase() {
    if (!pool) pool = createDatabasePool();
    logger.info('Инициализация БД...');
    const startTime = Date.now();
    try {
        const versionResult = await query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").catch(() => ({ rows: [] }));
        const currentVersion = versionResult.rows[0]?.version || 0;
        for (const [tableName, definition] of Object.entries(TABLE_DEFINITIONS)) await query(definition);
        for (const indexDef of INDEX_DEFINITIONS) await query(indexDef).catch(() => {});
        await runMigrations();
        await initSystemSettings();
        await createDefaultDirector();
        await initCorporateFund();
        await query(`INSERT INTO schema_migrations (version, name) VALUES (5, 'WARPOINT HUB v5.1.1') ON CONFLICT (version) DO NOTHING`);
        logger.info(`БД инициализирована за ${Date.now() - startTime}ms`);
    } catch (err) { logger.error('Ошибка инициализации БД:', err.message); throw err; }
}

let CRON_FLAGS = { isProcessingShift: false, isProcessingTasks: false, isProcessingExchange: false, isProcessingAchievements: false };

async function processShiftEarnings() {
    if (CRON_FLAGS.isProcessingShift) return;
    CRON_FLAGS.isProcessingShift = true;
    try {
        const yesterday = getTobolskNow().subtract(1, 'day').format('YYYY-MM-DD');
        const result = await query(`UPDATE employees e SET coins = coins + (s.hours * 2), hours = hours + s.hours, total_shifts = total_shifts + 1 FROM (SELECT employee, SUM(EXTRACT(HOUR FROM (COALESCE(NULLIF(special_end_time, ''), '22:00')::time - shift_time::time))) as hours FROM schedule WHERE date = $1 AND shift_time IS NOT NULL AND shift_paid = FALSE AND (shift_status = 'working' OR shift_status IS NULL) GROUP BY employee) s WHERE e.name = s.employee RETURNING e.id, e.name, s.hours`, [yesterday]);
        await query("UPDATE schedule SET shift_paid = TRUE WHERE date = $1", [yesterday]);
        for (const row of result.rows) await checkAndAwardAchievements(row.id, 'work');
        logger.info(`Начислено WP за ${yesterday}: ${result.rowCount} сотрудников`);
    } catch (err) { logger.error('Ошибка начисления WP:', err.message); } finally { CRON_FLAGS.isProcessingShift = false; }
}

async function checkOverdueTasks() {
    if (CRON_FLAGS.isProcessingTasks) return;
    CRON_FLAGS.isProcessingTasks = true;
    try {
        const today = getTobolskDate();
        const overdue = await query(`SELECT id, name, executor, is_group_task, group_members FROM tasks WHERE deadline < $1 AND status NOT IN ('completed', 'failed', 'overdue') AND is_archived = FALSE`, [today]);
        for (const task of overdue.rows) {
            let executors = [];
            if (task.is_group_task === 'operators') { const ops = await query("SELECT name FROM employees WHERE role = 'operator' AND is_active = TRUE"); executors = ops.rows.map(r => r.name); }
            else if (task.is_group_task === 'admins') { const admins = await query("SELECT name FROM employees WHERE role = 'admin' AND is_active = TRUE"); executors = admins.rows.map(r => r.name); }
            else if (task.executor) executors = [task.executor];
            for (const emp of executors) await query(`INSERT INTO fines (date, employee, type, description, status, created_by) VALUES ($1, $2, 'task_overdue', $3, 'pending', '🤖 Система')`, [today, emp, `Просрочена задача: ${task.name}`]);
            await query("UPDATE tasks SET status = 'overdue', penalty_applied = TRUE WHERE id = $1", [task.id]);
        }
        if (overdue.rows.length > 0) logger.info(`Создано штрафов за просрочку: ${overdue.rows.length * (overdue.rows[0]?.is_group_task ? 2 : 1)}`);
    } catch (err) { logger.error('Ошибка проверки задач:', err.message); } finally { CRON_FLAGS.isProcessingTasks = false; }
}

async function autoExpireExchanges() {
    if (CRON_FLAGS.isProcessingExchange) return;
    CRON_FLAGS.isProcessingExchange = true;
    try {
        const result = await query("UPDATE exchange_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()");
        if (result.rowCount > 0) logger.info(`Отменено просроченных обменов: ${result.rowCount}`);
    } catch (err) { logger.error('Ошибка отмены обменов:', err.message); } finally { CRON_FLAGS.isProcessingExchange = false; }
}

async function autoArchiveCompletedTasks() {
    try {
        const daysToArchive = 3;
        const result = await query(`UPDATE tasks SET is_archived = TRUE, archived_at = NOW() WHERE status = 'completed' AND is_archived = FALSE AND completed_at < NOW() - INTERVAL '${daysToArchive} days'`);
        if (result.rowCount > 0) logger.info(`Автоархивировано задач: ${result.rowCount}`);
    } catch (err) { logger.error('Ошибка автоархивации задач:', err.message); }
}

async function updateWeatherJob() {
    try { await fetchWeather(); logger.info('Погода обновлена'); } catch (err) { logger.error('Ошибка погоды:', err.message); }
}

async function checkAndAwardAchievements(userId, category = null) {
    if (CRON_FLAGS.isProcessingAchievements) return;
    CRON_FLAGS.isProcessingAchievements = true;
    try {
        const user = await query("SELECT id, name, coins, rating, total_shifts, total_tasks_completed, total_gifts_sent, bonus_streak FROM employees WHERE id = $1", [userId]);
        if (user.rows.length === 0) return;
        const u = user.rows[0];
        let achievementsToCheck = await query("SELECT * FROM achievements WHERE 1=1" + (category ? " AND category = $1" : ""), category ? [category] : []);
        const unlocked = await query("SELECT achievement_id FROM user_achievements WHERE user_id = $1", [userId]);
        const unlockedIds = new Set(unlocked.rows.map(r => r.achievement_id));
        const pending = await query("SELECT achievement_id FROM pending_achievements WHERE user_id = $1", [userId]);
        const pendingIds = new Set(pending.rows.map(r => r.achievement_id));
        for (const ach of achievementsToCheck.rows) {
            if (unlockedIds.has(ach.id) || pendingIds.has(ach.id)) continue;
            let currentValue = 0;
            if (ach.category === 'work') currentValue = u.total_shifts || 0;
            else if (ach.category === 'tasks') currentValue = u.total_tasks_completed || 0;
            else if (ach.category === 'gifts') currentValue = u.total_gifts_sent || 0;
            else if (ach.category === 'rating') currentValue = u.rating || 0;
            else if (ach.category === 'streak') currentValue = u.bonus_streak || 1;
            else continue;
            if (currentValue >= ach.required_value) {
                await query("INSERT INTO pending_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, ach.id]);
                await addNotification(u.name, 'achievement_unlocked', { id: ach.id, name: ach.name, coins: ach.coins_reward, description: ach.description });
            }
        }
    } catch (err) { logger.error('Ошибка проверки достижений:', err.message); } finally { CRON_FLAGS.isProcessingAchievements = false; }
}

function initCronJobs() {
    logger.info('Инициализация cron-задач...');
    cron.schedule('5 0 * * *', processShiftEarnings);
    cron.schedule('*/15 * * * *', checkOverdueTasks);
    cron.schedule('0 * * * *', autoExpireExchanges);
    cron.schedule('0 2 * * *', autoArchiveCompletedTasks);
    cron.schedule('0 */2 * * *', updateWeatherJob);
    cron.schedule('0 0 * * *', async () => { const users = await query("SELECT id FROM employees WHERE is_active = TRUE"); for (const u of users.rows) await checkAndAwardAchievements(u.id); });
    logger.info('Cron-задачи запущены');
}

console.log('✅ ЧАСТЬ 2/10 загружена (миграции, достижения, cron) — ИСПРАВЛЕНО');
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        logger.info(`Попытка входа: ${username}`);
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Введите логин и пароль' });
        }
        
        // Проверяем существование пользователя
        const userCheck = await query(`SELECT id, name FROM employees WHERE name = $1`, [username]);
        if (userCheck.rows.length === 0) {
            logger.warn(`Пользователь не найден: ${username}`);
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        
        // Получаем пользователя с паролем
        const userResult = await query(
            `SELECT e.*, p.password_hash 
             FROM employees e 
             LEFT JOIN passwords p ON p.username = e.name 
             WHERE e.name = $1 AND e.is_active = TRUE AND e.deleted_at IS NULL`,
            [username]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        
        const user = userResult.rows[0];
        logger.info(`Пользователь найден: ${user.name}, роль: ${user.role}`);
        
        // Проверяем пароль
        if (!user.password_hash) {
            logger.warn(`Нет хеша пароля для: ${username}`);
            
            // Если это директор и пароль denis_1 - создаём хеш
            if (user.role === 'director' && password === 'denis_1') {
                logger.info('Создаём пароль для директора');
                const hashedPassword = await hashPassword('denis_1');
                await query("INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2", [username, hashedPassword]);
                user.password_hash = hashedPassword;
            } else {
                return res.status(401).json({ success: false, error: 'Пароль не установлен' });
            }
        }
        
        const validPassword = await comparePassword(password, user.password_hash);
        if (!validPassword) {
            logger.warn(`Неверный пароль для: ${username}`);
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        
        // Успешный вход
        await query("UPDATE employees SET last_active = NOW() WHERE id = $1", [user.id]).catch(e => logger.warn('Не удалось обновить last_active:', e.message));
        delete user.password_hash;
        
        const token = generateToken({ id: user.id, username: user.name, role: user.role });
        
        logger.info(`✅ Успешный вход: ${username}`);
        res.json({ success: true, user, token });
        
    } catch (err) {
        logger.error('Ошибка входа:', err.message, err.stack);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => { res.json({ success: true, message: 'Выход выполнен' }); });

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT id, name, avatar, avatar_url, coins, rating, role, status, active_status, dashboard_style, bought_styles, can_edit_vp, bonus_streak, phone, birthday, total_shifts, total_tasks_completed FROM employees WHERE id = $1 AND deleted_at IS NULL", [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ success: false, error: 'No refresh token' });
        const decoded = verifyToken(refreshToken);
        if (!decoded) return res.status(401).json({ success: false, error: 'Invalid refresh token' });
        const user = await query("SELECT id, name, role FROM employees WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL", [decoded.id]);
        if (user.rows.length === 0) return res.status(401).json({ success: false, error: 'User not found' });
        const token = generateToken({ id: user.rows[0].id, username: user.rows[0].name, role: user.rows[0].role });
        res.json({ success: true, token });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/employees', authMiddleware, async (req, res) => {
    try {
        const cached = cache.get('employees_list');
        if (cached) return res.json({ success: true, employees: cached });
        const result = await query(`SELECT id, name, avatar, avatar_url, status, active_status, coins, rating, role, hours, birthday, phone, last_active, dashboard_style, bought_styles, can_edit_vp, bonus_streak, total_shifts, total_tasks_completed, total_gifts_sent, total_gifts_received, is_active FROM employees WHERE deleted_at IS NULL ORDER BY rating DESC, name ASC`);
        cache.set('employees_list', result.rows, 60);
        res.json({ success: true, employees: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/employees/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query(`SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/employees/achievements-count', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT e.name, COUNT(ua.achievement_id) as count 
             FROM employees e 
             LEFT JOIN user_achievements ua ON ua.user_id = e.id 
             WHERE e.deleted_at IS NULL 
             GROUP BY e.id, e.name`
        ).catch(err => {
            logger.error('achievements-count query error:', err.message);
            return { rows: [] };
        });
        
        const counts = {};
        result.rows.forEach(r => counts[r.name] = parseInt(r.count) || 0);
        res.json({ success: true, counts });
    } catch (err) {
        logger.error('/employees/achievements-count error:', err.message);
        res.json({ success: true, counts: {} }); // Возвращаем пустой объект вместо 500
    }
});

app.post('/api/employees', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { name, password, role, birthday, phone } = req.body;
        if (!name || !password) return res.status(400).json({ success: false, error: 'Имя и пароль обязательны' });
        if (password.length < 3) return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 3 символов' });
        const existing = await query("SELECT id FROM employees WHERE name = $1", [name]);
        if (existing.rows.length > 0) return res.status(400).json({ success: false, error: 'Сотрудник уже существует' });
        const result = await query(`INSERT INTO employees (name, role, birthday, phone, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING *`, [name, role || 'operator', birthday || null, phone || null]);
        const hashedPassword = await hashPassword(password);
        await query("INSERT INTO passwords (username, password_hash) VALUES ($1, $2)", [name, hashedPassword]);
        cache.del('employees_list');
        await addNotification('Денис', 'new_employee', { name, role: role || 'operator' });
        logger.info(`Создан сотрудник: ${name}`);
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/employees/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    if (req.user.role !== 'director' && req.user.id != id) return res.status(403).json({ success: false, error: 'Нет прав на редактирование' });
    try {
        const allowedFields = ['avatar', 'avatar_url', 'status', 'active_status', 'phone', 'birthday', 'dashboard_style'];
        if (req.user.role === 'director') allowedFields.push('name', 'role', 'coins', 'rating', 'can_edit_vp', 'bought_styles');
        const fields = [], values = [];
        let idx = 1;
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                fields.push(`${field} = $${idx++}`);
                values.push(updates[field]);
            }
        }
        if (fields.length === 0) return res.json({ success: true, message: 'Нет полей для обновления' });
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const result = await query(`UPDATE employees SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`, values);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        cache.del('employees_list');
        if (updates.avatar || updates.avatar_url) await checkAndAwardAchievements(id, 'special');
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/employees/:id', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const emp = await query("SELECT role, name FROM employees WHERE id = $1", [id]);
        if (emp.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        if (emp.rows[0].role === 'director') return res.status(403).json({ success: false, error: 'Нельзя удалить директора' });
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE id = $1", [id]);
        cache.del('employees_list');
        logger.info(`Сотрудник уволен: ${emp.rows[0].name}`);
        res.json({ success: true, message: 'Сотрудник уволен' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/employees/:id/password', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        if (!password || password.length < 3) return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 3 символов' });
        const emp = await query("SELECT name FROM employees WHERE id = $1", [id]);
        if (emp.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        const hashedPassword = await hashPassword(password);
        await query("INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2, updated_at = NOW()", [emp.rows[0].name, hashedPassword]);
        res.json({ success: true, message: 'Пароль изменён' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/employees/:id/role', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!['operator', 'admin', 'manager'].includes(role)) return res.status(400).json({ success: false, error: 'Недопустимая роль' });
        const emp = await query("SELECT role FROM employees WHERE id = $1", [id]);
        if (emp.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        if (emp.rows[0].role === 'director') return res.status(403).json({ success: false, error: 'Нельзя изменить роль директора' });
        await query("UPDATE employees SET role = $1, updated_at = NOW() WHERE id = $2", [role, id]);
        cache.del('employees_list');
        res.json({ success: true, message: 'Роль изменена' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/profiles/:name', authMiddleware, async (req, res) => {
    try {
        const { name } = req.params;
        const result = await query("SELECT id, name, avatar, avatar_url, status, active_status, coins, rating, role, hours, birthday, phone, last_active, dashboard_style, bought_styles, can_edit_vp, bonus_streak, total_shifts, total_tasks_completed FROM employees WHERE name = $1 AND deleted_at IS NULL", [name]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        res.json({ success: true, profile: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/profiles/:name', authMiddleware, async (req, res) => {
    const { name } = req.params;
    const updates = req.body;
    if (req.user.role !== 'director' && req.user.username !== name) return res.status(403).json({ success: false, error: 'Нет прав на редактирование' });
    try {
        const allowedFields = ['avatar', 'avatar_url', 'status', 'active_status', 'phone', 'birthday'];
        if (req.user.role === 'director') allowedFields.push('coins', 'rating', 'role', 'can_edit_vp');
        const fields = [], values = [];
        let idx = 1;
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                fields.push(`${field} = $${idx++}`);
                values.push(updates[field]);
            }
        }
        if (fields.length === 0) return res.json({ success: true, message: 'Нет полей для обновления' });
        fields.push(`updated_at = NOW()`);
        values.push(name);
        const result = await query(`UPDATE employees SET ${fields.join(', ')} WHERE name = $${idx} AND deleted_at IS NULL RETURNING id, name, avatar, avatar_url, status, active_status`, values);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        cache.del('employees_list');
        if (updates.avatar || updates.avatar_url) {
            const emp = result.rows[0];
            const userResult = await query("SELECT id FROM employees WHERE name = $1", [name]);
            if (userResult.rows.length > 0) await checkAndAwardAchievements(userResult.rows[0].id, 'special');
        }
        res.json({ success: true, profile: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        const cacheKey = `data_${req.user.id}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);
        const employees = await query("SELECT id, name, avatar, avatar_url, status, active_status, coins, rating, role, hours, birthday, phone, last_active, dashboard_style, can_edit_vp, bonus_streak, total_shifts, total_tasks_completed FROM employees WHERE deleted_at IS NULL ORDER BY rating DESC, name ASC");
        const tasks = await query("SELECT * FROM tasks WHERE is_archived = FALSE ORDER BY created_at DESC LIMIT 500");
        const fines = await query("SELECT * FROM fines ORDER BY date DESC LIMIT 500");
        const schedule = await query("SELECT date, employee, shift_time, shift_status, is_special, special_end_time FROM schedule ORDER BY date DESC LIMIT 1000");
        const stickers = await query("SELECT sender, employee, gift_id, quantity, is_anonymous FROM stickers ORDER BY created_at DESC LIMIT 500");
        const userAchievements = await query("SELECT ua.user_id, e.name, ua.achievement_id, a.name as achievement_name, a.icon, a.color FROM user_achievements ua JOIN employees e ON e.id = ua.user_id JOIN achievements a ON a.id = ua.achievement_id");
        const scheduleObj = {};
        schedule.rows.forEach(s => { if (!scheduleObj[s.date]) scheduleObj[s.date] = {}; scheduleObj[s.date][s.employee] = { time: s.shift_time, status: s.shift_status, is_special: s.is_special, special_end_time: s.special_end_time }; });
        const stickersObj = {};
        stickers.rows.forEach(s => { if (!stickersObj[s.employee]) stickersObj[s.employee] = []; stickersObj[s.employee].push(s); });
        const achievementsObj = {};
        userAchievements.rows.forEach(a => { if (!achievementsObj[a.name]) achievementsObj[a.name] = []; achievementsObj[a.name].push({ id: a.achievement_id, name: a.achievement_name, icon: a.icon, color: a.color }); });
        const profiles = {};
        employees.rows.forEach(e => { profiles[e.name] = { avatar: e.avatar, avatar_url: e.avatar_url, status: e.status, active_status: e.active_status, coins: e.coins, rating: e.rating, role: e.role, hours: e.hours, birthday: e.birthday, phone: e.phone, dashboard_style: e.dashboard_style, can_edit_vp: e.can_edit_vp, bonus_streak: e.bonus_streak, total_shifts: e.total_shifts, total_tasks_completed: e.total_tasks_completed }; });
        const data = { success: true, employees: employees.rows.map(e => e.name), profiles, tasks: tasks.rows, fines: fines.rows, schedule: scheduleObj, stickers: stickersObj, userAchievements: achievementsObj };
        cache.set(cacheKey, data, 30);
        res.json(data);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/heartbeat', authMiddleware, async (req, res) => {
    try {
        await query("UPDATE employees SET last_active = NOW() WHERE id = $1", [req.user.id]);
        res.json({ success: true, timestamp: getTobolskDateTime() });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/user/login-streak', authMiddleware, async (req, res) => {
    try {
        const user = await query("SELECT bonus_streak, last_bonus_claimed_at FROM employees WHERE id = $1", [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ success: false });
        const streak = user.rows[0].bonus_streak || 1;
        const lastClaim = user.rows[0].last_bonus_claimed_at ? new Date(user.rows[0].last_bonus_claimed_at).toISOString().split('T')[0] : null;
        const today = getTobolskDate();
        const hasClaimedToday = lastClaim === today;
        const nextBonus = Math.min(streak * 5, 50);
        res.json({ success: true, streak, hasClaimedToday, nextBonusAmount: nextBonus });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/user/claim-daily-bonus', authMiddleware, async (req, res) => {
    try {
        const today = getTobolskDate();
        const user = await query("SELECT id, name, coins, bonus_streak, last_bonus_claimed_at FROM employees WHERE id = $1 FOR UPDATE", [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ success: false });
        const u = user.rows[0];
        const lastClaim = u.last_bonus_claimed_at ? new Date(u.last_bonus_claimed_at).toISOString().split('T')[0] : null;
        if (lastClaim === today) return res.json({ success: true, claimed: false, message: 'Уже получен сегодня' });
        const yesterday = getTobolskNow().subtract(1, 'day').format('YYYY-MM-DD');
        let newStreak = u.bonus_streak || 1;
        if (lastClaim === yesterday) newStreak = Math.min(newStreak + 1, 365);
        else newStreak = 1;
        const bonus = Math.min(newStreak * 5, 50);
        await query("UPDATE employees SET coins = coins + $1, bonus_streak = $2, last_bonus_claimed_at = NOW() WHERE id = $3", [bonus, newStreak, req.user.id]);
        await query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) VALUES ($1, 'login_streak', $2, (SELECT coins FROM employees WHERE id = $1), $3)", [req.user.id, bonus, `Ежедневный бонус (день ${newStreak})`]);
        await checkAndAwardAchievements(req.user.id, 'streak');
        const pending = await query("SELECT a.id, a.name, a.coins_reward FROM pending_achievements pa JOIN achievements a ON a.id = pa.achievement_id WHERE pa.user_id = $1", [req.user.id]);
        res.json({ success: true, claimed: true, bonus, streak: newStreak, newAchievements: pending.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/user/bought-styles', authMiddleware, async (req, res) => {
    try {
        const user = await query("SELECT bought_styles, role FROM employees WHERE id = $1", [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ success: false });
        let styles = ['standart'];
        try { styles = JSON.parse(user.rows[0].bought_styles || '["standart"]'); } catch (e) {}
        if (user.rows[0].role === 'director') styles = ['standart', 'phantom', 'impulse', 'glow', 'cyber', 'legend', 'cosmic', 'hologram', 'inferno', 'frozen', 'shadow', 'toxic', 'plasma', 'void', 'carbon'];
        res.json({ success: true, boughtStyles: styles });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/user/buy-style', authMiddleware, async (req, res) => {
    try {
        const { style, price } = req.body;
        if (!style) return res.status(400).json({ success: false, error: 'Стиль не указан' });
        await transaction(async (client) => {
            const user = await client.query("SELECT coins, bought_styles, role FROM employees WHERE id = $1 FOR UPDATE", [req.user.id]);
            if (user.rows.length === 0) throw new Error('Пользователь не найден');
            const u = user.rows[0];
            if (u.role === 'director') throw new Error('Директору не нужно покупать стили');
            let bought = ['standart'];
            try { bought = JSON.parse(u.bought_styles || '["standart"]'); } catch (e) {}
            if (bought.includes(style)) throw new Error('Стиль уже куплен');
            if (u.coins < price) throw new Error('Недостаточно монет');
            bought.push(style);
            await client.query("UPDATE employees SET coins = coins - $1, bought_styles = $2 WHERE id = $3", [price, JSON.stringify(bought), req.user.id]);
            await client.query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) VALUES ($1, 'shop_purchase', $2, (SELECT coins FROM employees WHERE id = $1), $3)", [req.user.id, -price, `Покупка стиля ${style}`]);
        });
        const user = await query("SELECT coins, bought_styles FROM employees WHERE id = $1", [req.user.id]);
        res.json({ success: true, remainingCoins: user.rows[0].coins, boughtStyles: JSON.parse(user.rows[0].bought_styles || '["standart"]') });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.post('/api/user/apply-style', authMiddleware, async (req, res) => {
    try {
        const { style } = req.body;
        if (!style) return res.status(400).json({ success: false, error: 'Стиль не указан' });
        const user = await query("SELECT bought_styles, role FROM employees WHERE id = $1", [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ success: false });
        let bought = ['standart'];
        try { bought = JSON.parse(user.rows[0].bought_styles || '["standart"]'); } catch (e) {}
        if (user.rows[0].role === 'director') bought = ['standart', 'phantom', 'impulse', 'glow', 'cyber', 'legend', 'cosmic', 'hologram', 'inferno', 'frozen', 'shadow', 'toxic', 'plasma', 'void', 'carbon'];
        if (!bought.includes(style)) return res.status(400).json({ success: false, error: 'Стиль не куплен' });
        await query("UPDATE employees SET dashboard_style = $1 WHERE id = $2", [style, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

console.log('✅ ЧАСТЬ 3/10 загружена (авторизация, сотрудники, профили, стили)');
app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { executor, status, limit = 500 } = req.query;
        let sql = `SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE 1=1`;
        const params = [];
        if (executor) { sql += ` AND t.executor = $${params.length + 1}`; params.push(executor); }
        if (status) { sql += ` AND t.status = $${params.length + 1}`; params.push(status); }
        sql += ` GROUP BY t.id ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query(`SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE t.id = $1 GROUP BY t.id`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        res.json({ success: true, task: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { task } = req.body;
        if (!task || !task.name) return res.status(400).json({ success: false, error: 'Название задачи обязательно' });
        const author = (req.user.role === 'director' || req.user.role === 'manager') ? (task.author || req.user.username) : req.user.username;
        const wpReward = { low: 3, medium: 8, high: 15 }[task.priority] || 8;
        let executor = task.executor;
        let isGroupTask = null;
        let groupMembers = null;
        if (task.executor === '__GROUP_OPERATORS__') { isGroupTask = 'operators'; executor = 'operators'; const ops = await query("SELECT name FROM employees WHERE role = 'operator' AND is_active = TRUE"); groupMembers = ops.rows.map(r => ({ name: r.name, completed: false })); }
        else if (task.executor === '__GROUP_ADMINS__') { isGroupTask = 'admins'; executor = 'admins'; const admins = await query("SELECT name FROM employees WHERE role = 'admin' AND is_active = TRUE"); groupMembers = admins.rows.map(r => ({ name: r.name, completed: false })); }
        else if (task.executor === '__MULTI_SELECT__' && task.selected_executors) { executor = task.selected_executors.join(', '); }
        const result = await query(`INSERT INTO tasks (name, author, executor, priority, deadline, comment, status, is_group_task, group_members, wp_reward, recurring) VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7, $8, $9, $10) RETURNING *`, [task.name, author, executor, task.priority || 'medium', task.deadline || null, task.comment || null, isGroupTask, groupMembers ? JSON.stringify(groupMembers) : null, wpReward, task.recurring || 'none']);
        const taskId = result.rows[0].id;
        if (task.subtasks && Array.isArray(task.subtasks)) for (const sub of task.subtasks) if (sub.name && sub.name.trim()) await query("INSERT INTO subtasks (task_id, name) VALUES ($1, $2)", [taskId, sub.name.trim()]);
        if (task.attachments && Array.isArray(task.attachments)) for (const att of task.attachments) if (att.name && att.data) await query("INSERT INTO task_attachments (task_id, file_name, file_size, file_type, file_data) VALUES ($1, $2, $3, $4, $5)", [taskId, att.name, att.size || 0, att.type || 'application/octet-stream', att.data]);
        if (isGroupTask) {
            const members = groupMembers.map(m => m.name);
            for (const emp of members) await addNotification(emp, 'task_created', { taskId, taskName: task.name, author, isGroup: true });
        } else if (executor && !executor.includes(',')) await addNotification(executor, 'task_created', { taskId, taskName: task.name, author });
        res.json({ success: true, task: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const current = await query("SELECT * FROM tasks WHERE id = $1", [id]);
        if (current.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        const task = current.rows[0];
        if (req.user.role !== 'director' && req.user.role !== 'manager' && task.author !== req.user.username && task.executor !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав на редактирование' });
        if (updates.status === 'completed' && task.status !== 'completed') {
            await transaction(async (client) => {
                if (task.is_group_task) {
                    let members = [];
                    try { members = JSON.parse(task.group_members || '[]'); } catch (e) {}
                    for (const m of members) if (m.completed) await client.query("UPDATE employees SET coins = coins + $1, total_tasks_completed = total_tasks_completed + 1 WHERE name = $2", [task.wp_reward || 8, m.name]);
                } else if (task.executor) {
                    const executors = task.executor.split(',').map(e => e.trim());
                    const rewardPerPerson = Math.floor((task.wp_reward || 8) / executors.length);
                    for (const emp of executors) await client.query("UPDATE employees SET coins = coins + $1, total_tasks_completed = total_tasks_completed + 1 WHERE name = $2", [rewardPerPerson, emp]);
                }
                await client.query("UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1", [id]);
            });
            await checkAndAwardAchievements(req.user.id, 'tasks');
            await addNotification(task.author, 'task_completed', { taskId: id, taskName: task.name, executor: task.executor, isGroup: !!task.is_group_task });
        }
        const fields = [], values = [];
        let idx = 1;
        const allowed = ['name', 'executor', 'priority', 'deadline', 'progress', 'comment', 'status', 'is_archived', 'group_progress'];
        for (const f of allowed) if (updates[f] !== undefined) { fields.push(`${f} = $${idx++}`); values.push(updates[f]); }
        if (fields.length === 0) return res.json({ success: true, message: 'Нет изменений' });
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const result = await query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/tasks/:id/group-progress', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { completed_members } = req.body;
        const task = await query("SELECT * FROM tasks WHERE id = $1", [id]);
        if (task.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        if (!task.rows[0].is_group_task) return res.status(400).json({ success: false, error: 'Это не групповая задача' });
        let members = [];
        try { members = JSON.parse(task.rows[0].group_members || '[]'); } catch (e) {}
        let allCompleted = true;
        members = members.map(m => { const completed = completed_members.includes(m.name); if (!completed) allCompleted = false; return { ...m, completed }; });
        await query("UPDATE tasks SET group_progress = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify({ members, allCompleted }), id]);
        if (allCompleted && task.rows[0].status !== 'completed') {
            await query("UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1", [id]);
            await transaction(async (client) => {
                for (const m of members) await client.query("UPDATE employees SET coins = coins + $1, total_tasks_completed = total_tasks_completed + 1 WHERE name = $2", [task.rows[0].wp_reward || 8, m.name]);
            });
            await addNotification(task.rows[0].author, 'task_completed', { taskId: id, taskName: task.rows[0].name, isGroup: true });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await query("SELECT author FROM tasks WHERE id = $1", [id]);
        if (task.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        if (req.user.role !== 'director' && req.user.role !== 'manager' && task.rows[0].author !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав на удаление' });
        await query("DELETE FROM tasks WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/tasks/:id/subtasks', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Название подзадачи обязательно' });
        const task = await query("SELECT id FROM tasks WHERE id = $1", [id]);
        if (task.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        const result = await query("INSERT INTO subtasks (task_id, name) VALUES ($1, $2) RETURNING *", [id, name]);
        res.json({ success: true, subtask: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/subtasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { completed } = req.body;
        const result = await query("UPDATE subtasks SET completed = $1 WHERE id = $2 RETURNING *", [completed, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Подзадача не найдена' });
        res.json({ success: true, subtask: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/subtasks/:id', authMiddleware, async (req, res) => {
    try {
        await query("DELETE FROM subtasks WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/fines', authMiddleware, async (req, res) => {
    try {
        const { employee, status, limit = 500 } = req.query;
        let sql = "SELECT * FROM fines WHERE 1=1";
        const params = [];
        if (employee) { sql += ` AND employee = $${params.length + 1}`; params.push(employee); }
        if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
        sql += " ORDER BY date DESC, created_at DESC LIMIT $" + (params.length + 1);
        params.push(parseInt(limit));
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/fines', authMiddleware, adminOrAbove, async (req, res) => {
    try {
        const { fine } = req.body;
        if (!fine || !fine.employee) return res.status(400).json({ success: false, error: 'Сотрудник обязателен' });
        const result = await query(`INSERT INTO fines (date, employee, type, amount, coins, rating, description, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING *`, [fine.date || getTobolskDate(), fine.employee, fine.type || 'other', fine.amount || 0, fine.coins || 0, fine.rating || 0, fine.description || null, req.user.username]);
        await addNotification(fine.employee, 'fine_created', { fineId: result.rows[0].id, reason: fine.description || 'Нарушение' });
        if (req.user.role === 'director' || req.user.role === 'manager') for (const emp of ['Денис']) await addNotification(emp, 'fine_created', { fineId: result.rows[0].id, employee: fine.employee, reason: fine.description || 'Нарушение' });
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/fines/:id', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, director_comment, amount, coins, rating } = req.body;
        const current = await query("SELECT * FROM fines WHERE id = $1", [id]);
        if (current.rows.length === 0) return res.status(404).json({ success: false, error: 'Штраф не найден' });
        const fine = current.rows[0];
        let updateAmount = fine.amount, updateCoins = fine.coins, updateRating = fine.rating;
        if (amount !== undefined) updateAmount = amount;
        if (coins !== undefined) updateCoins = coins;
        if (rating !== undefined) updateRating = rating;
        const result = await query(`UPDATE fines SET status = $1, director_comment = $2, amount = $3, coins = $4, rating = $5, updated_at = NOW() WHERE id = $6 RETURNING *`, [status, director_comment || null, updateAmount, updateCoins, updateRating, id]);
        if (status === 'approved') {
            await transaction(async (client) => {
                if (updateCoins > 0) await client.query("UPDATE employees SET coins = GREATEST(coins - $1, 0) WHERE name = $2", [updateCoins, fine.employee]);
                if (updateRating !== 0) await client.query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [updateRating, fine.employee]);
                if (updateCoins > 0 || updateRating !== 0) {
                    await client.query("INSERT INTO transactions (user_id, type, amount, comment) SELECT id, 'fine', $1, $2 FROM employees WHERE name = $3", [-updateCoins, `Штраф: ${fine.description || 'Нарушение'}`, fine.employee]);
                }
            });
            await addNotification(fine.employee, 'fine_approved', { fineId: id, amount: updateAmount, coins: updateCoins, rating: updateRating, reason: fine.description });
        } else if (status === 'rejected') await addNotification(fine.employee, 'fine_rejected', { fineId: id, reason: fine.description });
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/fines/:id', authMiddleware, directorOnly, async (req, res) => {
    try {
        await query("DELETE FROM fines WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sql = "SELECT * FROM schedule WHERE 1=1";
        const params = [];
        if (month && year) { sql += ` AND EXTRACT(MONTH FROM date) = $${params.length + 1} AND EXTRACT(YEAR FROM date) = $${params.length + 2}`; params.push(month, year); }
        sql += " ORDER BY date DESC, employee";
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status, is_special, special_end_time } = req.body;
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав' });
    try {
        const existing = await query("SELECT id FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        let result;
        if (existing.rows.length > 0) result = await query(`UPDATE schedule SET shift_time = $1, shift_status = $2, is_special = $3, special_end_time = $4, updated_at = NOW() WHERE date = $5 AND employee = $6 RETURNING *`, [shift_time, shift_status || 'working', is_special || false, special_end_time || null, date, employee]);
        else result = await query(`INSERT INTO schedule (date, employee, shift_time, shift_status, is_special, special_end_time) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [date, employee, shift_time, shift_status || 'working', is_special || false, special_end_time || null]);
        await triggerPusher('private-warpoint-sync', 'schedule-updated', { date, employee, shift_time });
        if (employee !== req.user.username) await addNotification(employee, 'schedule_updated', { date, shift_time });
        res.json({ success: true, shift: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee } = req.body;
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав' });
    try {
        await query("DELETE FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        await triggerPusher('private-warpoint-sync', 'schedule-deleted', { date, employee });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/schedule/special-cases', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT date, cases FROM schedule_special_cases");
        const cases = {};
        result.rows.forEach(r => cases[r.date] = r.cases);
        res.json({ success: true, data: cases });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/schedule/special-cases', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { date, cases } = req.body;
        if (!date) return res.status(400).json({ success: false, error: 'Дата обязательна' });
        await query(`INSERT INTO schedule_special_cases (date, cases) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET cases = $2, updated_at = NOW()`, [date, JSON.stringify(cases)]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

console.log('✅ ЧАСТЬ 4/10 загружена (задачи, штрафы, график)');
app.post('/api/exchange/create', authMiddleware, async (req, res) => {
    try {
        const { toEmployee, toDate, toShiftTime, fromDate, fromShiftTime, comment } = req.body;
        const fromEmployee = req.user.username;
        if (fromEmployee === toEmployee) return res.status(400).json({ success: false, error: 'Нельзя обменяться с собой' });
        const fromShift = await query("SELECT id FROM schedule WHERE date = $1 AND employee = $2", [fromDate, fromEmployee]);
        if (fromShift.rows.length === 0) return res.status(400).json({ success: false, error: 'У вас нет смены в выбранный день' });
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const result = await query(`INSERT INTO exchange_requests (from_employee, to_employee, from_date, to_date, from_shift_time, to_shift_time, comment, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [fromEmployee, toEmployee, fromDate, toDate, fromShiftTime, toShiftTime, comment || null, expiresAt]);
        await addNotification(toEmployee, 'exchange_request', { requestId: result.rows[0].id, from: fromEmployee, fromDate, toDate, fromTime: fromShiftTime, toTime: toShiftTime });
        res.json({ success: true, requestId: result.rows[0].id });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/exchange/pending', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT * FROM exchange_requests WHERE to_employee = $1 AND status = 'pending' ORDER BY created_at DESC", [req.user.username]);
        res.json({ success: true, requests: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/exchange/my', authMiddleware, async (req, res) => {
    try {
        const { status } = req.query;
        let sql = "SELECT * FROM exchange_requests WHERE from_employee = $1";
        const params = [req.user.username];
        if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
        sql += " ORDER BY created_at DESC";
        const result = await query(sql, params);
        res.json({ success: true, requests: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/exchange/accept/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await query("SELECT * FROM exchange_requests WHERE id = $1 AND status = 'pending'", [id]);
        if (request.rows.length === 0) return res.status(404).json({ success: false, error: 'Запрос не найден' });
        if (request.rows[0].to_employee !== req.user.username) return res.status(403).json({ success: false, error: 'Не ваш запрос' });
        const r = request.rows[0];
        await transaction(async (client) => {
            await client.query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.from_employee, r.to_date, r.to_employee]);
            await client.query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.to_employee, r.from_date, r.from_employee]);
            await client.query("UPDATE exchange_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1", [id]);
            await client.query("UPDATE employees SET total_exchanges = total_exchanges + 1 WHERE name = $1", [r.from_employee]);
            await client.query("UPDATE employees SET total_exchanges = total_exchanges + 1 WHERE name = $1", [r.to_employee]);
        });
        await addNotification(r.from_employee, 'exchange_accepted', { requestId: id, to: r.to_employee, fromDate: r.from_date, toDate: r.to_date });
        await checkAndAwardAchievements((await query("SELECT id FROM employees WHERE name = $1", [r.from_employee])).rows[0]?.id, 'exchange');
        await checkAndAwardAchievements((await query("SELECT id FROM employees WHERE name = $1", [r.to_employee])).rows[0]?.id, 'exchange');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/exchange/reject/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await query("SELECT * FROM exchange_requests WHERE id = $1 AND status = 'pending'", [id]);
        if (request.rows.length === 0) return res.status(404).json({ success: false, error: 'Запрос не найден' });
        if (request.rows[0].to_employee !== req.user.username) return res.status(403).json({ success: false, error: 'Не ваш запрос' });
        await query("UPDATE exchange_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1", [id]);
        await addNotification(request.rows[0].from_employee, 'exchange_rejected', { requestId: id, to: req.user.username });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/exchange/cancel/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await query("SELECT * FROM exchange_requests WHERE id = $1 AND from_employee = $2 AND status = 'pending'", [id, req.user.username]);
        if (request.rows.length === 0) return res.status(404).json({ success: false, error: 'Запрос не найден' });
        await query("UPDATE exchange_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vp', authMiddleware, async (req, res) => {
    try {
        const { month, year, archived } = req.query;
        let sql = "SELECT * FROM vp_bookings WHERE 1=1";
        const params = [];
        if (month && year) { sql += ` AND EXTRACT(MONTH FROM event_date) = $${params.length + 1} AND EXTRACT(YEAR FROM event_date) = $${params.length + 2}`; params.push(month, year); }
        if (archived === 'false' || !archived) sql += ` AND is_archived = FALSE`;
        sql += " ORDER BY event_date DESC, event_time DESC LIMIT 500";
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    const canCreate = req.user.role === 'director' || req.user.role === 'manager' || (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canCreate) return res.status(403).json({ success: false, error: 'Нет прав' });
    try {
        const { vp } = req.body;
        if (!vp || !vp.customerName || !vp.admin || !vp.eventDate) return res.status(400).json({ success: false, error: 'Заполните обязательные поля' });
        const result = await query(`INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, duration, comment, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [vp.admin, vp.eventDate, vp.eventTime || '10:00', vp.customerName, vp.amount || 2000, vp.paymentType || 'evotor_card', getTobolskDate(), vp.duration || 1, vp.comment || null, req.user.username]);
        await addNotification('Денис', 'vp_created', { id: result.rows[0].id, admin: vp.admin, customer: vp.customerName, date: vp.eventDate });
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    const canEdit = req.user.role === 'director' || req.user.role === 'manager' || (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canEdit) return res.status(403).json({ success: false, error: 'Нет прав' });
    try {
        const { id } = req.params;
        const updates = req.body;
        const fields = [], values = [];
        let idx = 1;
        const allowed = ['event_date', 'event_time', 'customer_name', 'admin', 'amount', 'payment_type', 'comment', 'duration', 'photo_status', 'script_status', 'is_archived'];
        for (const f of allowed) if (updates[f] !== undefined) { fields.push(`${f} = $${idx++}`); values.push(updates[f]); }
        if (fields.length === 0) return res.json({ success: true, message: 'Нет изменений' });
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const result = await query(`UPDATE vp_bookings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        if (updates.photo_status === 'sent' || updates.script_status === 'sent') await addNotification('Денис', 'vp_updated', { id, ...updates });
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/vp/:id', authMiddleware, directorOnly, async (req, res) => {
    try {
        await query("DELETE FROM vp_bookings WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/salary', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ success: false, error: 'Месяц и год обязательны' });
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        const employees = await query("SELECT id, name, role, avatar, avatar_url FROM employees WHERE role != 'director' AND is_active = TRUE AND deleted_at IS NULL ORDER BY name");
        const dailyData = await query("SELECT * FROM salary_daily WHERE month_year = $1", [monthYear]);
        res.json({ success: true, employees: employees.rows, dailyData: dailyData.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/salary/day', authMiddleware, async (req, res) => {
    try {
        const { employee_id, day, month, year } = req.query;
        if (!employee_id || !day || !month || !year) return res.status(400).json({ success: false, error: 'Не все параметры указаны' });
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        const result = await query(`SELECT oklad, event, turnover, bonus35, video, extra_motivation FROM salary_daily WHERE employee_id = $1 AND day_number = $2 AND month_year = $3`, [employee_id, day, monthYear]);
        res.json({ success: true, ...(result.rows[0] || { oklad: 0, event: 0, turnover: 0, bonus35: 0, video: 0, extra_motivation: 0 }) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/salary/day/save', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { employee_id, day_number, month, year, oklad, event, turnover, bonus35, video, extra_motivation } = req.body;
        if (!employee_id || !day_number || !month || !year) return res.status(400).json({ success: false, error: 'Не все параметры указаны' });
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        await query(`INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover, bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation, updated_at = NOW()`, [employee_id, day_number, monthYear, oklad || 0, event || 0, turnover || 0, bonus35 || 0, video || 0, extra_motivation || 0]);
        const emp = await query("SELECT name FROM employees WHERE id = $1", [employee_id]);
        if (emp.rows.length > 0) await addNotification(emp.rows[0].name, 'salary_updated', { date: `${day_number}.${month}.${year}` });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/salary/apply-all', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { day_number, month, year, ...fields } = req.body;
        if (!day_number || !month || !year) return res.status(400).json({ success: false, error: 'Не все параметры указаны' });
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        const operators = await query("SELECT id FROM employees WHERE role = 'operator' AND is_active = TRUE AND deleted_at IS NULL");
        for (const op of operators.rows) await query(`INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover, bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation, updated_at = NOW()`, [op.id, day_number, monthYear, fields.oklad || 0, fields.event || 0, fields.turnover || 0, fields.bonus35 || 0, fields.video || 0, fields.extra_motivation || 0]);
        res.json({ success: true, updated: operators.rows.length });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/fund', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        res.json({ success: true, amount: result.rows[0]?.amount || 0 });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/fund/update', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { amount, comment, reset } = req.body;
        if (amount === undefined || amount < 0) return res.status(400).json({ success: false, error: 'Некорректная сумма' });
        await query("INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, $2, $3, $4)", [amount, reset ? 'reset' : 'update', comment || null, req.user.id]);
        await addNotification('Денис', 'fund_updated', { amount });
        res.json({ success: true, amount });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/fund/add', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { sum, comment } = req.body;
        if (!sum || typeof sum !== 'number') return res.status(400).json({ success: false, error: 'Некорректная сумма' });
        const current = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        const newAmount = (current.rows[0]?.amount || 0) + sum;
        if (newAmount < 0) return res.status(400).json({ success: false, error: 'Недостаточно средств' });
        await query("INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, $2, $3, $4)", [newAmount, sum > 0 ? 'add' : 'subtract', comment || null, req.user.id]);
        await addNotification('Денис', 'fund_updated', { amount: newAmount });
        res.json({ success: true, amount: newAmount });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

console.log('✅ ЧАСТЬ 5/10 загружена (обмен, ВП, зарплата, фонд)');
app.post('/api/chat', authMiddleware, async (req, res) => {
    try {
        const { room, message } = req.body;
        if (!message || !message.text || message.text.length > 2000) return res.status(400).json({ success: false, error: 'Неверное сообщение' });
        const cleanText = sanitizeHtml(message.text, { allowedTags: [], allowedAttributes: {} });
        const result = await query("INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *", [room || 'general', message.sender, cleanText, Date.now()]);
        await query("UPDATE employees SET total_messages = total_messages + 1 WHERE name = $1", [message.sender]);
        await triggerPusher('private-warpoint-sync', 'new-message', { room: room || 'general', message: result.rows[0] });
        if (room && room !== 'general') {
            await addNotification(room, 'mention', { sender: message.sender, text: cleanText.substring(0, 100) });
            const privateChannel = `private-user-${transliterate(room)}`;
            await triggerPusher(privateChannel, 'private-message', { from: message.sender, message: result.rows[0] });
        }
        res.json({ success: true, message: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/chat/private', authMiddleware, async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || !message || !message.text) return res.status(400).json({ success: false, error: 'Неверные данные' });
        const cleanText = sanitizeHtml(message.text, { allowedTags: [], allowedAttributes: {} });
        const room = [req.user.username, to].sort().join('-');
        const result = await query("INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *", [room, message.sender, cleanText, Date.now()]);
        await query("UPDATE employees SET total_messages = total_messages + 1 WHERE name = $1", [message.sender]);
        await addNotification(to, 'mention', { sender: message.sender, text: cleanText.substring(0, 100), roomId: room });
        const privateChannel = `private-user-${transliterate(to)}`;
        await triggerPusher(privateChannel, 'private-message', { from: message.sender, message: result.rows[0] });
        res.json({ success: true, message: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/chat/announcement', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { announcement } = req.body;
        if (!announcement || !announcement.text) return res.status(400).json({ success: false, error: 'Текст объявления обязателен' });
        const cleanText = sanitizeHtml(announcement.text, { allowedTags: ['b', 'i', 'u', 'br'], allowedAttributes: {} });
        const announcementData = { ...announcement, text: cleanText, type: 'announcement' };
        await query("INSERT INTO messages (room, sender, text, time) VALUES ('general', $1, $2, $3)", [announcement.sender, JSON.stringify(announcementData), Date.now()]);
        await triggerPusher('private-warpoint-sync', 'announcement', { announcement: announcementData });
        const employees = await query("SELECT name FROM employees WHERE is_active = TRUE AND deleted_at IS NULL AND name != $1", [announcement.sender]);
        for (const emp of employees.rows) await addNotification(emp.name, 'mention', { sender: announcement.sender, text: cleanText.substring(0, 100), isAnnouncement: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/chat/history/:room', authMiddleware, async (req, res) => {
    try {
        const { room } = req.params;
        const { after } = req.query;
        let sql = "SELECT * FROM messages WHERE room = $1 AND is_deleted = FALSE";
        const params = [room];
        if (after) { sql += " AND time > $" + (params.length + 1); params.push(parseInt(after)); }
        sql += " ORDER BY time ASC LIMIT 500";
        const result = await query(sql, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/chat/delete', authMiddleware, async (req, res) => {
    try {
        const { room, messageTime, sender } = req.body;
        if (!room || !messageTime) return res.status(400).json({ success: false, error: 'Неверные данные' });
        const msg = await query("SELECT sender FROM messages WHERE room = $1 AND time = $2 AND is_deleted = FALSE", [room, messageTime]);
        if (msg.rows.length === 0) return res.status(404).json({ success: false, error: 'Сообщение не найдено' });
        if (req.user.role !== 'director' && msg.rows[0].sender !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав на удаление' });
        await query("UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room = $1 AND time = $2", [room, messageTime]);
        if (room === 'general') await triggerPusher('private-warpoint-sync', 'delete-message', { room, messageTime });
        else {
            const participants = room.split('-');
            for (const p of participants) await triggerPusher(`private-user-${transliterate(p)}`, 'delete-private', { room, messageTime });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/chat/delete-bulk', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { period, room, timeThreshold } = req.body;
        if (!room) return res.status(400).json({ success: false, error: 'Комната не указана' });
        let deletedCount = 0;
        if (period === 'all') {
            const result = await query("UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room = $1 AND is_deleted = FALSE RETURNING id", [room]);
            deletedCount = result.rowCount;
        } else if (timeThreshold) {
            const result = await query("UPDATE messages SET is_deleted = TRUE, deleted_at = NOW() WHERE room = $1 AND time >= $2 AND is_deleted = FALSE RETURNING id", [room, timeThreshold]);
            deletedCount = result.rowCount;
        } else return res.status(400).json({ success: false, error: 'Период не указан' });
        if (room === 'general') await triggerPusher('private-warpoint-sync', 'bulk-delete', { period, room, timeThreshold, timestamp: Date.now() });
        res.json({ success: true, deletedCount });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/gifts', authMiddleware, (req, res) => {
    const gifts = [{ id: 'flower', name: '🌸 Букет', icon: '🌸', price: 25, rating: 8 }, { id: 'star', name: '⭐ Звезда', icon: '⭐', price: 75, rating: 25 }, { id: 'pizza', name: '🍕 Пицца', icon: '🍕', price: 150, rating: 50 }, { id: 'trophy', name: '🏆 Трофей', icon: '🏆', price: 300, rating: 100 }, { id: 'crown', name: '👑 Корона', icon: '👑', price: 500, rating: 175 }, { id: 'trash', name: '🗑️ Мешок мусора', icon: '🗑️', price: 25, rating: -8 }, { id: 'socks', name: '🧦 Носки с дыркой', icon: '🧦', price: 75, rating: -25 }, { id: 'brick', name: '🧱 Кирпич', icon: '🧱', price: 150, rating: -50 }, { id: 'abibas', name: '👟 Кеды Abibas', icon: '👟', price: 300, rating: -100 }, { id: 'poop', name: '💩 Шоколадный сюрприз', icon: '💩', price: 500, rating: -175 }];
    res.json({ success: true, gifts });
});

app.post('/api/gifts', authMiddleware, async (req, res) => {
    try {
        const { recipient, giftId, price, ratingChange, quantity, isAnonymous } = req.body;
        if (!recipient || !giftId) return res.status(400).json({ success: false, error: 'Получатель и подарок обязательны' });
        const sender = isAnonymous ? '🕵️ Аноним' : req.user.username;
        const qty = quantity || 1;
        const total = price * qty;
        await transaction(async (client) => {
            if (!isAnonymous) {
                const user = await client.query("SELECT coins FROM employees WHERE name = $1 FOR UPDATE", [req.user.username]);
                if (user.rows[0].coins < total) throw new Error('Недостаточно WP');
                await client.query("UPDATE employees SET coins = coins - $1, total_gifts_sent = total_gifts_sent + $2 WHERE name = $3", [total, qty, req.user.username]);
                await client.query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) SELECT id, 'gift_send', $1, coins, $2 FROM employees WHERE name = $3", [-total, `Подарок для ${recipient}`, req.user.username]);
            }
            await client.query(`INSERT INTO stickers (sender, employee, gift_id, quantity, is_anonymous) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (employee, gift_id, sender, DATE(created_at)) DO UPDATE SET quantity = stickers.quantity + $4`, [sender, recipient, giftId, qty, isAnonymous || false]);
            if (ratingChange) {
                await client.query("UPDATE employees SET rating = rating + $1, total_gifts_received = total_gifts_received + $2 WHERE name = $3", [ratingChange * qty, qty, recipient]);
                if (ratingChange > 0) {
                    const rec = await client.query("SELECT id FROM employees WHERE name = $1", [recipient]);
                    if (rec.rows.length > 0) await checkAndAwardAchievements(rec.rows[0].id, 'gifts');
                }
            }
        });
        await addNotification(recipient, 'gift_received', { sender, giftId, giftName: giftId, anonymous: isAnonymous, quantity: qty });
        if (!isAnonymous) {
            await addNotification(req.user.username, 'gift_sent', { recipient, giftId, quantity: qty });
            await checkAndAwardAchievements(req.user.id, 'gifts');
        }
        res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.get('/api/user/statuses', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT status_id, status_name, status_icon, price, is_active FROM user_statuses WHERE employee_id = $1", [req.user.id]);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/statuses/buy', authMiddleware, async (req, res) => {
    try {
        const { statusId, statusName, statusIcon, price, rating } = req.body;
        if (!statusId || !statusName) return res.status(400).json({ success: false, error: 'Данные статуса обязательны' });
        const existing = await query("SELECT id FROM user_statuses WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        if (existing.rows.length > 0) return res.status(400).json({ success: false, error: 'Статус уже куплен' });
        await transaction(async (client) => {
            const user = await client.query("SELECT coins FROM employees WHERE id = $1 FOR UPDATE", [req.user.id]);
            if (user.rows[0].coins < price) throw new Error('Недостаточно WP');
            await client.query("UPDATE employees SET coins = coins - $1 WHERE id = $2", [price, req.user.id]);
            await client.query("INSERT INTO user_statuses (employee_id, status_id, status_name, status_icon, price) VALUES ($1, $2, $3, $4, $5)", [req.user.id, statusId, statusName, statusIcon, price]);
            if (rating) await client.query("UPDATE employees SET rating = rating + $1 WHERE id = $2", [rating, req.user.id]);
            await client.query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) VALUES ($1, 'shop_purchase', $2, (SELECT coins FROM employees WHERE id = $1), $3)", [req.user.id, -price, `Покупка статуса ${statusName}`]);
        });
        await checkAndAwardAchievements(req.user.id, 'shop');
        res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.post('/api/statuses/activate', authMiddleware, async (req, res) => {
    try {
        const { statusId } = req.body;
        if (!statusId) return res.status(400).json({ success: false, error: 'Статус не указан' });
        await query("UPDATE user_statuses SET is_active = FALSE WHERE employee_id = $1", [req.user.id]);
        await query("UPDATE user_statuses SET is_active = TRUE WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        const status = await query("SELECT status_name FROM user_statuses WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        if (status.rows.length > 0) await query("UPDATE employees SET active_status = $1 WHERE id = $2", [status.rows[0].status_name, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/knowledge/categories', authMiddleware, async (req, res) => {
    try {
        const result = await query(`SELECT c.*, COUNT(a.id) as articles_count FROM knowledge_categories c LEFT JOIN knowledge_articles a ON a.category_id = c.id GROUP BY c.id ORDER BY c.sort_order, c.name`);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/knowledge/categories', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { name, icon, description } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Название обязательно' });
        const result = await query("INSERT INTO knowledge_categories (name, icon, description) VALUES ($1, $2, $3) RETURNING *", [name, icon || '📁', description || null]);
        res.json({ success: true, category: result.rows[0] });
    } catch (err) { if (err.code === '23505') return res.status(400).json({ success: false, error: 'Категория уже существует' }); res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/knowledge/categories/:id', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, description, sort_order } = req.body;
        const result = await query(`UPDATE knowledge_categories SET name = COALESCE($1, name), icon = COALESCE($2, icon), description = COALESCE($3, description), sort_order = COALESCE($4, sort_order) WHERE id = $5 RETURNING *`, [name, icon, description, sort_order, id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Категория не найдена' });
        res.json({ success: true, category: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/knowledge/categories/:id', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        await query("DELETE FROM knowledge_categories WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, limit = 200 } = req.query;
        let sql = "SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE 1=1";
        const params = [];
        if (category_id) { sql += ` AND a.category_id = $${params.length + 1}`; params.push(category_id); }
        sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        const result = await query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE a.id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Статья не найдена' });
        res.json({ success: true, article: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, title, content } = req.body;
        if (!category_id || !title) return res.status(400).json({ success: false, error: 'Категория и заголовок обязательны' });
        const cleanContent = sanitizeHtml(content || '', { allowedTags: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'pre', 'code', 'blockquote', 'hr', 'div', 'span'], allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], '*': ['style', 'class'] }, allowedStyles: { '*': { 'color': [/.*/], 'background-color': [/.*/], 'text-align': [/.*/], 'font-size': [/.*/], 'font-family': [/.*/], 'margin': [/.*/], 'padding': [/.*/], 'border': [/.*/], 'border-radius': [/.*/] } } });
        const result = await query("INSERT INTO knowledge_articles (category_id, title, content, created_by) VALUES ($1, $2, $3, $4) RETURNING *", [category_id, title, cleanContent, req.user.username]);
        res.json({ success: true, article: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, category_id } = req.body;
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [id]);
        if (article.rows.length === 0) return res.status(404).json({ success: false, error: 'Статья не найдена' });
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0].created_by !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав на редактирование' });
        const cleanContent = content ? sanitizeHtml(content, { allowedTags: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'pre', 'code', 'blockquote', 'hr', 'div', 'span'], allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], '*': ['style', 'class'] } }) : undefined;
        const result = await query(`UPDATE knowledge_articles SET title = COALESCE($1, title), content = COALESCE($2, content), category_id = COALESCE($3, category_id), updated_at = NOW() WHERE id = $4 RETURNING *`, [title, cleanContent, category_id, id]);
        res.json({ success: true, article: result.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [req.params.id]);
        if (article.rows.length === 0) return res.status(404).json({ success: false, error: 'Статья не найдена' });
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0].created_by !== req.user.username) return res.status(403).json({ success: false, error: 'Нет прав на удаление' });
        await query("DELETE FROM knowledge_articles WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    try {
        await query("UPDATE knowledge_articles SET views = views + 1 WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

console.log('✅ ЧАСТЬ 6/10 загружена (чат, подарки, статусы, база знаний)');
app.get('/api/achievements', authMiddleware, async (req, res) => {
    try {
        const achievements = await query(`SELECT a.*, CASE WHEN ua.user_id IS NOT NULL THEN TRUE ELSE FALSE END as unlocked, CASE WHEN pa.user_id IS NOT NULL THEN TRUE ELSE FALSE END as pending FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1 LEFT JOIN pending_achievements pa ON pa.achievement_id = a.id AND pa.user_id = $1 ORDER BY a.sort_order, a.id`, [req.user.id]);
        const stats = await query(`SELECT COUNT(DISTINCT a.id) as total, COUNT(DISTINCT ua.achievement_id) as unlocked FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1`, [req.user.id]);
        res.json({ success: true, achievements: achievements.rows, stats: { total: parseInt(stats.rows[0].total), unlocked: parseInt(stats.rows[0].unlocked) } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/achievements/claim', authMiddleware, async (req, res) => {
    try {
        const { achievementId } = req.body;
        if (!achievementId) return res.status(400).json({ success: false, error: 'Достижение не указано' });
        const pending = await query("SELECT * FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2", [req.user.id, achievementId]);
        if (pending.rows.length === 0) return res.status(400).json({ success: false, error: 'Достижение недоступно' });
        const ach = await query("SELECT * FROM achievements WHERE id = $1", [achievementId]);
        if (ach.rows.length === 0) return res.status(404).json({ success: false, error: 'Достижение не найдено' });
        await transaction(async (client) => {
            await client.query("DELETE FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2", [req.user.id, achievementId]);
            await client.query("INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)", [req.user.id, achievementId]);
            await client.query("UPDATE employees SET coins = coins + $1 WHERE id = $2", [ach.rows[0].coins_reward, req.user.id]);
            await client.query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) VALUES ($1, 'achievement', $2, (SELECT coins FROM employees WHERE id = $1), $3)", [req.user.id, ach.rows[0].coins_reward, `Достижение: ${ach.rows[0].name}`]);
        });
        await checkAndAwardAchievements(req.user.id);
        res.json({ success: true, coins: ach.rows[0].coins_reward, achievement: ach.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/parsing/latest', authMiddleware, async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'data', 'booking-availability.json');
        if (!fs.existsSync(filePath)) return res.json({ success: true, dates: {}, month: getTobolskNow().format('MMMM YYYY').toUpperCase() });
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const cacheKey = 'parsing_latest';
        let cached = cache.get(cacheKey);
        if (!cached || Date.now() - cached.timestamp > 300000) {
            cached = { data, timestamp: Date.now() };
            cache.set(cacheKey, cached, 600);
        }
        res.json({ success: true, ...data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/parsing/run', authMiddleware, managerOrDirector, async (req, res) => {
    res.json({ success: true, message: 'Парсинг запущен' });
    setImmediate(async () => { try { await bookingParser.parseAvailability(); } catch (err) { logger.error('Ошибка парсинга:', err.message); } });
});

app.post('/api/parsing/reset', authMiddleware, directorOnly, async (req, res) => {
    try {
        const progressFile = path.join(__dirname, 'data', 'parsing-progress.json');
        if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
        res.json({ success: true, message: 'Состояние парсинга сброшено' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/parsing/progress', authMiddleware, (req, res) => {
    const progress = bookingParser.getProgress();
    const isParsing = bookingParser.isParsingNow();
    res.json({ success: true, isParsing, progress: { ...progress, isParsing } });
});

app.get('/api/weather', async (req, res) => {
    try {
        const force = req.query.force === 'true';
        const cacheKey = 'weather_data';
        let weather = cache.get(cacheKey);
        if (!weather || force) {
            weather = await fetchWeather();
            cache.set(cacheKey, weather, 900);
        }
        const temp = weather.temperature || 0;
        const tempDisplay = temp > 0 ? `+${temp}` : `${temp}`;
        const feelsLike = weather.feelsLike;
        const feelsLikeDisplay = feelsLike !== null && feelsLike !== undefined ? (feelsLike > 0 ? `+${feelsLike}` : `${feelsLike}`) : null;
        res.json({ success: true, temp, tempDisplay, feelsLike, feelsLikeDisplay, desc: weather.description || 'Ясно', icon: weather.icon || '🌡️', city: 'Тобольск', source: weather.source });
    } catch (err) { res.json({ success: true, temp: 0, tempDisplay: '0', desc: 'Нет данных', icon: '🌡️', city: 'Тобольск' }); }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { limit = 50, offset = 0, type } = req.query;
        let sql = "SELECT * FROM transactions WHERE user_id = $1";
        const params = [req.user.id];
        if (type && type !== 'all') { sql += ` AND type = $${params.length + 1}`; params.push(type); }
        sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), parseInt(offset));
        const result = await query(sql, params);
        const total = await query("SELECT COUNT(*) FROM transactions WHERE user_id = $1", [req.user.id]);
        res.json({ success: true, transactions: result.rows, total: parseInt(total.rows[0].count) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    try {
        const today = getTobolskDate();
        const onShift = await query("SELECT COUNT(DISTINCT employee) FROM schedule WHERE date = $1 AND shift_time IS NOT NULL AND (shift_status = 'working' OR shift_status IS NULL)", [today]);
        const tasks = await query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as done FROM tasks WHERE is_archived = FALSE");
        const fines = await query("SELECT COUNT(*) FROM fines WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)");
        const fund = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        const activeTasks = tasks.rows[0] ? { total: parseInt(tasks.rows[0].total), done: parseInt(tasks.rows[0].done) } : { total: 0, done: 0 };
        res.json({ success: true, onShift: parseInt(onShift.rows[0].count), tasks: activeTasks, finesThisMonth: parseInt(fines.rows[0].count), fundAmount: fund.rows[0]?.amount || 0 });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/admin/theme', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT value FROM system_settings WHERE key = 'global_theme'");
        res.json({ success: true, theme: result.rows[0]?.value || 'vr-portal' });
    } catch (err) { res.json({ success: true, theme: 'vr-portal' }); }
});

app.post('/api/admin/theme', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { theme } = req.body;
        if (!theme) return res.status(400).json({ success: false, error: 'Тема не указана' });
        await query("INSERT INTO system_settings (key, value) VALUES ('global_theme', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [theme]);
        res.json({ success: true, theme });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/bonus/employee', authMiddleware, directorOnly, async (req, res) => {
    try {
        const { name, coins, rating } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Сотрудник не указан' });
        if (coins) {
            await query("UPDATE employees SET coins = coins + $1 WHERE name = $2", [coins, name]);
            const emp = await query("SELECT id FROM employees WHERE name = $1", [name]);
            if (emp.rows.length > 0) await query("INSERT INTO transactions (user_id, type, amount, balance_after, comment) VALUES ($1, 'admin_bonus', $2, (SELECT coins FROM employees WHERE id = $1), $3)", [emp.rows[0].id, coins, 'Бонус от директора']);
        }
        if (rating) await query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [rating, name]);
        await addNotification(name, 'bonus_received', { coins, rating, reason: 'Бонус от директора' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/reset-all', authMiddleware, directorOnly, async (req, res) => {
    try {
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE role != 'director'");
        await query("TRUNCATE tasks, subtasks, task_attachments, fines, schedule, schedule_special_cases, exchange_requests, vp_bookings, salary_daily, messages, stickers, user_statuses, user_achievements, pending_achievements, transactions CASCADE");
        cache.flushAll();
        res.json({ success: true, message: 'Данные сброшены' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/equal-start', authMiddleware, directorOnly, async (req, res) => {
    try {
        await query("UPDATE employees SET coins = 100, rating = 0, hours = 0, total_shifts = 0, total_tasks_completed = 0, total_gifts_sent = 0, total_gifts_received = 0, bonus_streak = 1, last_bonus_claimed_at = NULL");
        await query("TRUNCATE tasks, subtasks, task_attachments, fines, schedule, schedule_special_cases, exchange_requests, vp_bookings, salary_daily, stickers, user_achievements, pending_achievements, transactions CASCADE");
        await query("INSERT INTO corporate_fund (amount, operation_type, comment) VALUES (0, 'reset', 'Равный старт')");
        cache.flushAll();
        res.json({ success: true, message: 'Равный старт выполнен' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/init-achievements', authMiddleware, directorOnly, async (req, res) => {
    try {
        await initAchievements();
        res.json({ success: true, message: 'Достижения переинициализированы' });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT * FROM notifications WHERE recipient = $1 ORDER BY created_at DESC LIMIT 50", [req.user.username]);
        const unread = await query("SELECT COUNT(*) FROM notifications WHERE recipient = $1 AND read = FALSE", [req.user.username]);
        res.json({ success: true, notifications: result.rows, unread: parseInt(unread.rows[0].count) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/notifications/read', authMiddleware, async (req, res) => {
    try {
        const { all, notification_id } = req.body;
        if (all) await query("UPDATE notifications SET read = TRUE WHERE recipient = $1", [req.user.username]);
        else if (notification_id) await query("UPDATE notifications SET read = TRUE WHERE id = $1 AND recipient = $2", [notification_id, req.user.username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const { all } = req.body;
        if (all) await query("DELETE FROM notifications WHERE recipient = $1", [req.user.username]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/notifications/send', authMiddleware, managerOrDirector, async (req, res) => {
    try {
        const { recipient, type, data } = req.body;
        if (!recipient || !type) return res.status(400).json({ success: false, error: 'Получатель и тип обязательны' });
        await addNotification(recipient, type, data);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/pusher/auth', authMiddleware, (req, res) => {
    if (!pusher) return res.status(500).json({ error: 'Pusher not configured' });
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    if (!socketId || !channel) return res.status(400).json({ error: 'Missing parameters' });
    if (channel.startsWith('private-user-')) {
        const username = channel.replace('private-user-', '');
        if (transliterate(req.user.username) !== username && req.user.role !== 'director') return res.status(403).json({ error: 'Access denied' });
    }
    const auth = pusher.authorizeChannel(socketId, channel);
    res.send(auth);
});

app.get('/health', async (req, res) => {
    const health = { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), version: SERVER_STATE.version, environment: process.env.NODE_ENV || 'development' };
    try { await query('SELECT 1'); health.database = 'ok'; } catch (err) { health.status = 'degraded'; health.database = 'error'; }
    health.pusher = pusher ? 'configured' : 'not_configured';
    const memory = process.memoryUsage();
    health.memory = { rss: Math.round(memory.rss / 1024 / 1024) + 'MB', heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB', heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB' };
    res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

console.log('✅ ЧАСТЬ 7/10 загружена (достижения, парсинг, админ, уведомления)');
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/about.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/pages/:page', (req, res) => { const pagePath = path.join(__dirname, 'public', 'pages', req.params.page); fs.existsSync(pagePath) ? res.sendFile(pagePath) : res.status(404).send('Page not found'); });
app.get('/css/:file', (req, res) => { const cssPath = path.join(__dirname, 'public', 'css', req.params.file); fs.existsSync(cssPath) ? res.sendFile(cssPath) : res.status(404).send('CSS not found'); });
app.get('/js/:file', (req, res) => { const jsPath = path.join(__dirname, 'public', 'js', req.params.file); fs.existsSync(jsPath) ? res.sendFile(jsPath) : res.status(404).send('JS not found'); });
app.get('*', (req, res) => { if (req.path.startsWith('/api/') || req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/pages/')) return res.status(404).json({ error: 'Not found' }); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.use((req, res) => { if (req.path.startsWith('/api/')) res.status(404).json({ success: false, error: 'Endpoint not found' }); else res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')); });

app.use((err, req, res, next) => { logger.error('Unhandled error:', err.message, err.stack); if (res.headersSent) return next(err); if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Invalid JSON' }); if (err.code === '23505') return res.status(409).json({ success: false, error: 'Duplicate entry' }); if (err.code === '23503') return res.status(400).json({ success: false, error: 'Foreign key violation' }); res.status(500).json({ success: false, error: 'Internal server error' }); });

function gracefulShutdown(signal) {
    if (SERVER_STATE.isShuttingDown) return;
    SERVER_STATE.isShuttingDown = true;
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    let shutdownTimeout = setTimeout(() => { logger.error('Forcing shutdown after timeout'); process.exit(1); }, 15000);
    const cleanup = async () => {
        clearTimeout(shutdownTimeout);
        if (server) { 
            server.close(() => logger.info('HTTP server closed')); 
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        }
        if (pool) { 
            await pool.end().then(() => logger.info('Database pool closed')).catch(e => logger.error('Error closing pool:', e.message)); 
        }
        if (pusher && typeof pusher.disconnect === 'function') pusher.disconnect();
        cache.flushAll();
        logger.info('WARPOINT Hub shut down');
        process.exit(0);
    };
    cleanup();
}

async function startServer() {
    // 🔥 ЗАЩИТА ОТ ДВОЙНОЙ ИНИЦИАЛИЗАЦИИ
    if (dbInitialized) {
        logger.info('БД уже инициализирована, запускаем только HTTP сервер...');
        server = app.listen(PORT, '0.0.0.0', () => {
            SERVER_STATE.started = new Date();
            SERVER_STATE.isReady = true;
            logger.info(`WARPOINT Hub запущен на порту ${PORT}`);
            logger.info(`Окружение: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Время: ${getTobolskDateTime()}`);
        });
        setupServerHandlers();
        return;
    }
    
    try {
        logger.info('\n╔══════════════════════════════════════════════════════════════╗\n║   ██╗    ██╗ █████╗ ██████╗ ██████╗  ██████╗ ██╗███╗   ██╗████████╗  ║\n║   ██║    ██║██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝  ║\n║   ██║ █╗ ██║███████║██████╔╝██████╔╝██║   ██║██║██╔██╗ ██║   ██║     ║\n║   ██║███╗██║██╔══██║██╔══██╗██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║     ║\n║   ╚███╔███╔╝██║  ██║██║  ██║██║     ╚██████╔╝██║██║ ╚████║   ██║     ║\n║    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝     ║\n║                    CORPORATE PORTAL v5.1.1                    ║\n╚══════════════════════════════════════════════════════════════╝');
        
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        
        pusher = initPusher();
        pool = createDatabasePool();
        if (!pool) throw new Error('Не удалось создать пул БД');
        
        await initDatabase();
        dbInitialized = true;  // 🔥 ПОМЕЧАЕМ ЧТО БД ИНИЦИАЛИЗИРОВАНА
        
        await initAchievements();
        initCronJobs();
        
        server = app.listen(PORT, '0.0.0.0', () => {
            SERVER_STATE.started = new Date();
            SERVER_STATE.isReady = true;
            logger.info(`WARPOINT Hub запущен на порту ${PORT}`);
            logger.info(`Окружение: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`Время: ${getTobolskDateTime()}`);
            logger.info('Директор по умолчанию: Денис / denis_1');
        });
        
        setupServerHandlers();
        
        // Пост-инициализация
        setTimeout(async () => {
            try {
                const check = await query("SELECT id FROM employees WHERE name = 'Денис' AND is_active = TRUE AND deleted_at IS NULL");
                if (check.rows.length === 0) { 
                    logger.warn('Директор не найден, создаём...'); 
                    await createDefaultDirector(); 
                } else {
                    const passCheck = await query("SELECT username FROM passwords WHERE username = 'Денис'");
                    if (passCheck.rows.length === 0) { 
                        const hashedPassword = await hashPassword('denis_1'); 
                        await query("INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)", [hashedPassword]); 
                    }
                }
                const achievementsCheck = await query("SELECT COUNT(*) FROM achievements");
                if (parseInt(achievementsCheck.rows[0].count) === 0) { 
                    logger.warn('Достижения не найдены, инициализируем...'); 
                    await initAchievements(); 
                }
            } catch (err) { 
                logger.error('Ошибка пост-инициализации:', err.message); 
            }
        }, 3000);
        
        // Мониторинг памяти
        setInterval(() => { 
            const mem = process.memoryUsage(); 
            logger.debug(`Память: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`); 
        }, 300000);
        
        // Очистка старых уведомлений
        setInterval(async () => { 
            try { 
                const result = await query("DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'"); 
                if (result.rowCount > 0) logger.debug(`Очищено уведомлений: ${result.rowCount}`); 
            } catch (e) {} 
        }, 86400000);
        
        // Первое обновление погоды
        setTimeout(() => { 
            updateWeatherJob().catch(err => logger.error('Погода:', err.message)); 
        }, 5000);
        
        // Авто-парсинг (если включен)
        setTimeout(async () => {
            try {
                const parserData = await query("SELECT val FROM system_settings WHERE key = 'auto_parse_enabled'");
                if (parserData.rows[0]?.val === 'true') { 
                    logger.info('Запуск авто-парсинга...'); 
                    bookingParser.parseAvailability().catch(e => logger.error('Ошибка авто-парсинга:', e.message)); 
                }
            } catch (e) {}
        }, 10000);
        
    } catch (err) { 
        logger.error('КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА:', err.message, err.stack); 
        process.exit(1); 
    }
}

function setupServerHandlers() {
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
    process.on('uncaughtException', (err) => { 
        if (err.message.includes('EADDRINUSE')) {
            logger.error('Порт занят — выходим');
            process.exit(0);
        }
        logger.error('UNCAUGHT EXCEPTION:', err.message);
    });
}

// 🔥 ЗАПУСКАЕМ ТОЛЬКО ОДИН РАЗ
startServer().catch(err => { 
    logger.error('Fatal error:', err); 
    process.exit(1); 
});

// Экспорт для тестов
module.exports = { app, startServer, gracefulShutdown, query, addNotification, checkAndAwardAchievements };

console.log('✅ ЧАСТЬ 8/10 загружена');