// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ИСПРАВЛЕННАЯ И ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
// ============================================

// ============================================
// 1. ИМПОРТЫ
// ============================================
const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Парсеры
const { fetchWeather, getLastWeather } = require('./parsing-weather.js');
const { BookingParser } = require('./parsing-booking.js');

dotenv.config();

// ============================================
// 2. КОНФИГУРАЦИЯ
// ============================================
const app = express();

// 🔥 ВАЖНО ДЛЯ RENDER: используем process.env.PORT
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'warpoint-secret-key-2024-ultra-secure';
const TIMEZONE = 'Asia/Yekaterinburg';

// Настройки БД
const DB_CONFIG = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,                          // Уменьшено для Render бесплатного
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
    application_name: 'warpoint_hub_v5'
};

// Настройки Pusher
const PUSHER_CONFIG = {
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
};

// Настройки Bcrypt
const BCRYPT_SALT_ROUNDS = 10;

// Настройки лимитов (исправленные, без конфликтов)
const RATE_LIMIT_CONFIG = {
    GLOBAL: { windowMs: 60 * 1000, max: 200 },
    LOGIN: { windowMs: 15 * 60 * 1000, max: 10 },
    API: { windowMs: 60 * 1000, max: 150 }
};

// ============================================
// 3. ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ============================================
let pool = null;
let pusher = null;
let server = null;

const SERVER_STATE = {
    started: null,
    isReady: false,
    isShuttingDown: false,
    version: '5.0.0'
};

// Парсеры
const bookingParser = new BookingParser();

// ============================================
// 4. УТИЛИТЫ (ТОЛЬКО ОДИН РАЗ)
// ============================================

// Время Тобольска
function getTobolskNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function getTobolskDate() {
    return getTobolskNow().toISOString().split('T')[0];
}

// Транслитерация
function transliterate(name) {
    if (!name) return 'user';
    const ru = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    let result = '';
    for (let char of name.toLowerCase()) result += ru[char] || char;
    return result.replace(/[^a-z0-9]/g, '') || 'user';
}

// Хеширование пароля
async function hashPassword(password) {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

async function comparePassword(password, hash) {
    if (!hash) return false;
    return await bcrypt.compare(password, hash);
}

// JWT
function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// ============================================
// 5. БАЗА ДАННЫХ (ТОЛЬКО ОДИН РАЗ)
// ============================================
function createDatabasePool() {
    if (pool) return pool;
    pool = new Pool(DB_CONFIG);
    pool.on('error', (err) => {
        console.error('❌ DB Pool Error:', err.message);
        if (err.message.includes('Connection terminated')) {
            pool = null;
            setTimeout(createDatabasePool, 5000);
        }
    });
    console.log('✅ Пул БД создан');
    return pool;
}

async function query(text, params) {
    if (!pool) pool = createDatabasePool();
    try {
        const result = await pool.query(text, params);
        return result;
    } catch (err) {
        console.error('❌ SQL Error:', err.message, text.substring(0, 100));
        throw err;
    }
}

async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ============================================
// 6. PUSHER
// ============================================
function initPusher() {
    if (!PUSHER_CONFIG.appId || !PUSHER_CONFIG.key || !PUSHER_CONFIG.secret) {
        console.warn('⚠️ Pusher не настроен');
        return null;
    }
    try {
        pusher = new Pusher(PUSHER_CONFIG);
        console.log('✅ Pusher инициализирован');
        return pusher;
    } catch (err) {
        console.error('❌ Pusher error:', err.message);
        return null;
    }
}

async function triggerPusher(channel, event, data) {
    if (!pusher) return false;
    try {
        await pusher.trigger(channel, event, data);
        return true;
    } catch (err) {
        console.error('❌ Pusher trigger error:', err.message);
        return false;
    }
}

// ============================================
// 7. MIDDLEWARE (ПРАВИЛЬНЫЙ ПОРЯДОК!)
// ============================================
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate Limiter (ОДИН глобальный, без конфликтов)
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || req.socket.remoteAddress,
    skip: (req) => req.path === '/health' || req.path === '/api/health'
});
app.use(limiter);

// Auth Middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

console.log('✅ ЧАСТЬ 1/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 2/8: ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
// ============================================

// ============================================
// 8. ОПРЕДЕЛЕНИЯ ТАБЛИЦ
// ============================================
const TABLE_DEFINITIONS = {
    // Системные настройки
    system_settings: `
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Сотрудники
    employees: `
        CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            avatar VARCHAR(10) DEFAULT '👤',
            avatar_url TEXT,
            status VARCHAR(100) DEFAULT '💼 Работаю',
            active_status VARCHAR(100),
            coins INTEGER DEFAULT 100,
            rating INTEGER DEFAULT 0,
            role VARCHAR(50) DEFAULT 'operator',
            hours NUMERIC(10,2) DEFAULT 0,
            birthday DATE,
            phone VARCHAR(20),
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            dashboard_style VARCHAR(50) DEFAULT 'glass',
            bought_styles TEXT DEFAULT '["glass"]',
            can_edit_vp BOOLEAN DEFAULT FALSE,
            bonus_streak INTEGER DEFAULT 1,
            last_bonus_claimed_at TIMESTAMP,
            total_shifts INTEGER DEFAULT 0,
            total_tasks_completed INTEGER DEFAULT 0,
            total_gifts_sent INTEGER DEFAULT 0,
            total_gifts_received INTEGER DEFAULT 0,
            total_messages INTEGER DEFAULT 0,
            total_exchanges INTEGER DEFAULT 0,
            deleted_at TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Пароли
    passwords: `
        CREATE TABLE IF NOT EXISTS passwords (
            username VARCHAR(100) PRIMARY KEY,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Достижения
    achievements: `
        CREATE TABLE IF NOT EXISTS achievements (
            id VARCHAR(100) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            category VARCHAR(50),
            required_value INTEGER NOT NULL,
            coins_reward INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            icon VARCHAR(10) DEFAULT '🏆',
            color VARCHAR(7) DEFAULT '#fbbf24',
            is_hidden BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Достижения пользователей
    user_achievements: `
        CREATE TABLE IF NOT EXISTS user_achievements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, achievement_id)
        )
    `,
    
    // Задачи
    tasks: `
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            author VARCHAR(100) NOT NULL,
            executor VARCHAR(100),
            priority VARCHAR(20) DEFAULT 'medium',
            deadline DATE,
            progress INTEGER DEFAULT 0,
            comment TEXT,
            status VARCHAR(20) DEFAULT 'in_progress',
            is_group_task VARCHAR(20),
            group_members JSONB,
            is_archived BOOLEAN DEFAULT FALSE,
            penalty_applied BOOLEAN DEFAULT FALSE,
            wp_reward INTEGER DEFAULT 0,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Подзадачи
    subtasks: `
        CREATE TABLE IF NOT EXISTS subtasks (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            completed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Штрафы
    fines: `
        CREATE TABLE IF NOT EXISTS fines (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            type VARCHAR(50) DEFAULT 'other',
            amount INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            description TEXT,
            status VARCHAR(30) DEFAULT 'pending',
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // График смен
    schedule: `
        CREATE TABLE IF NOT EXISTS schedule (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            shift_time VARCHAR(10),
            shift_status VARCHAR(30) DEFAULT 'working',
            is_special BOOLEAN DEFAULT FALSE,
            special_end_time VARCHAR(100),
            shift_paid BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, employee)
        )
    `,
    
    // Обмен сменами
    exchange_requests: `
        CREATE TABLE IF NOT EXISTS exchange_requests (
            id SERIAL PRIMARY KEY,
            from_employee VARCHAR(100) NOT NULL,
            to_employee VARCHAR(100) NOT NULL,
            from_date DATE NOT NULL,
            to_date DATE NOT NULL,
            from_shift_time VARCHAR(10),
            to_shift_time VARCHAR(10),
            status VARCHAR(20) DEFAULT 'pending',
            comment TEXT,
            expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // ВП (мероприятия)
    vp_bookings: `
        CREATE TABLE IF NOT EXISTS vp_bookings (
            id SERIAL PRIMARY KEY,
            admin VARCHAR(50) NOT NULL,
            event_date DATE NOT NULL,
            event_time TIME NOT NULL,
            customer_name VARCHAR(255) NOT NULL,
            amount INTEGER DEFAULT 2000,
            payment_type VARCHAR(30) DEFAULT 'evotor_card',
            booking_date DATE NOT NULL,
            photo_status VARCHAR(20) DEFAULT 'pending',
            script_status VARCHAR(20) DEFAULT 'not_sent',
            duration INTEGER DEFAULT 1,
            is_archived BOOLEAN DEFAULT FALSE,
            comment TEXT,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Зарплата
    salary_daily: `
        CREATE TABLE IF NOT EXISTS salary_daily (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            day_number INTEGER NOT NULL,
            month_year VARCHAR(7) NOT NULL,
            oklad INTEGER DEFAULT 0,
            event INTEGER DEFAULT 0,
            turnover INTEGER DEFAULT 0,
            bonus35 INTEGER DEFAULT 0,
            video INTEGER DEFAULT 0,
            extra_motivation INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, day_number, month_year)
        )
    `,
    
    // Корпоративный фонд
    corporate_fund: `
        CREATE TABLE IF NOT EXISTS corporate_fund (
            id SERIAL PRIMARY KEY,
            amount INTEGER DEFAULT 0,
            operation_type VARCHAR(20),
            comment TEXT,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Сообщения чата
    messages: `
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            room VARCHAR(100) NOT NULL,
            sender VARCHAR(100) NOT NULL,
            text TEXT NOT NULL,
            time BIGINT NOT NULL,
            action_data JSONB,
            is_deleted BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Подарки/стикеры
    stickers: `
        CREATE TABLE IF NOT EXISTS stickers (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(100),
            employee VARCHAR(100) NOT NULL,
            gift_id VARCHAR(50) NOT NULL,
            quantity INTEGER DEFAULT 1,
            is_anonymous BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Статусы пользователей
    user_statuses: `
        CREATE TABLE IF NOT EXISTS user_statuses (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            status_id VARCHAR(50) NOT NULL,
            status_name VARCHAR(100) NOT NULL,
            status_icon VARCHAR(10) NOT NULL,
            price INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT FALSE,
            purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, status_id)
        )
    `,
    
    // Транзакции
    transactions: `
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            amount INTEGER NOT NULL,
            balance_before INTEGER DEFAULT 0,
            balance_after INTEGER DEFAULT 0,
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Категории базы знаний
    knowledge_categories: `
        CREATE TABLE IF NOT EXISTS knowledge_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            icon VARCHAR(10) DEFAULT '📁',
            description TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Статьи базы знаний
    knowledge_articles: `
        CREATE TABLE IF NOT EXISTS knowledge_articles (
            id SERIAL PRIMARY KEY,
            category_id INTEGER REFERENCES knowledge_categories(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            content TEXT,
            views INTEGER DEFAULT 0,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Уведомления
    notifications: `
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            recipient VARCHAR(100) NOT NULL,
            type VARCHAR(50) NOT NULL,
            data JSONB,
            read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Аудит лог
    audit_log: `
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(50),
            entity_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    
    // Версия схемы
    schema_migrations: `
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name VARCHAR(255),
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `
};

// ============================================
// 9. ИНДЕКСЫ
// ============================================
const INDEX_DEFINITIONS = [
    `CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_is_active ON employees(is_active) WHERE is_active = TRUE`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_executor_status ON tasks(executor, status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived) WHERE is_archived = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_fines_employee_date ON fines(employee, date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date)`,
    `CREATE INDEX IF NOT EXISTS idx_schedule_employee ON schedule(employee)`,
    `CREATE INDEX IF NOT EXISTS idx_vp_event_date ON vp_bookings(event_date)`,
    `CREATE INDEX IF NOT EXISTS idx_vp_is_archived ON vp_bookings(is_archived) WHERE is_archived = FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`
];

// ============================================
// 10. ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ БД
// ============================================
async function initDatabase() {
    if (!pool) pool = createDatabasePool();
    
    console.log('🗄️ Инициализация базы данных...');
    const startTime = Date.now();
    
    try {
        // Проверяем версию схемы
        const versionResult = await query(
            "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
        ).catch(() => ({ rows: [] }));
        
        const currentVersion = versionResult.rows[0]?.version || 0;
        console.log(`   Текущая версия схемы: ${currentVersion}`);
        
        // Создаём таблицы
        let tablesCreated = 0;
        for (const [tableName, definition] of Object.entries(TABLE_DEFINITIONS)) {
            await query(definition);
            tablesCreated++;
        }
        console.log(`   ✅ Создано/проверено ${tablesCreated} таблиц`);
        
        // Создаём индексы
        for (const indexDef of INDEX_DEFINITIONS) {
            await query(indexDef).catch(() => {});
        }
        console.log(`   ✅ Индексы созданы`);
        
        // Выполняем миграции
        await runMigrations();
        
        // Добавляем начальные данные
        await initSystemSettings();
        
        // 🔥 Создаём директора (САМОЕ ВАЖНОЕ!)
        await createDefaultDirector();
        
        // Инициализируем фонд
        await initCorporateFund();
        
        // Записываем версию
        await query(`
            INSERT INTO schema_migrations (version, name)
            VALUES (5, 'WARPOINT HUB v5.0')
            ON CONFLICT (version) DO NOTHING
        `);
        
        const duration = Date.now() - startTime;
        console.log(`✅ База данных инициализирована за ${duration}ms`);
        
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err.message);
        throw err;
    }
}

// ============================================
// 11. МИГРАЦИИ
// ============================================
async function runMigrations() {
    console.log('🔄 Выполнение миграций...');
    
    // Добавляем недостающие колонки в employees
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
        { name: 'dashboard_style', type: 'VARCHAR(50)', default: "'glass'" },
        { name: 'bought_styles', type: 'TEXT', default: "'[\"glass\"]'" },
        { name: 'bonus_streak', type: 'INTEGER', default: '1' },
        { name: 'last_bonus_claimed_at', type: 'TIMESTAMP', default: null },
        { name: 'phone', type: 'VARCHAR(20)', default: null },
        { name: 'birthday', type: 'DATE', default: null }
    ];
    
    for (const col of employeeColumns) {
        await addColumnIfNotExists('employees', col.name, col.type, col.default);
    }
    
    // Другие миграции
    await addColumnIfNotExists('tasks', 'wp_reward', 'INTEGER', '0');
    await addColumnIfNotExists('tasks', 'penalty_applied', 'BOOLEAN', 'FALSE');
    await addColumnIfNotExists('achievements', 'icon', 'VARCHAR(10)', "'🏆'");
    await addColumnIfNotExists('achievements', 'color', 'VARCHAR(7)', "'#fbbf24'");
    await addColumnIfNotExists('messages', 'is_deleted', 'BOOLEAN', 'FALSE');
    await addColumnIfNotExists('salary_daily', 'extra_motivation', 'INTEGER', '0');
    
    console.log('   ✅ Миграции выполнены');
}

async function addColumnIfNotExists(table, column, type, defaultValue = null) {
    try {
        const check = await query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
        `, [table, column]);
        
        if (check.rows.length === 0) {
            let sql = `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`;
            if (defaultValue !== null) sql += ` DEFAULT ${defaultValue}`;
            await query(sql);
            console.log(`   ➕ ${table}.${column}`);
        }
    } catch (err) {
        console.error(`   ⚠️ ${table}.${column}: ${err.message}`);
    }
}

// ============================================
// 12. НАЧАЛЬНЫЕ ДАННЫЕ
// ============================================
async function initSystemSettings() {
    const settings = [
        { key: 'app_version', value: '5.0.0' },
        { key: 'global_theme', value: 'vr-portal' }
    ];
    
    for (const s of settings) {
        await query(`
            INSERT INTO system_settings (setting_key, setting_value)
            VALUES ($1, $2)
            ON CONFLICT (setting_key) DO NOTHING
        `, [s.key, s.value]).catch(() => {});
    }
}

async function initCorporateFund() {
    const check = await query("SELECT id FROM corporate_fund LIMIT 1");
    if (check.rows.length === 0) {
        await query(`
            INSERT INTO corporate_fund (amount, operation_type, comment)
            VALUES (0, 'initial', 'Начальное состояние')
        `);
    }
}

// ============================================
// 13. СОЗДАНИЕ ДИРЕКТОРА (ГЛАВНОЕ!)
// ============================================
async function createDefaultDirector() {
    try {
        console.log('🔍 Проверка директора...');
        
        // Проверяем существование
        const check = await query("SELECT id FROM employees WHERE name = 'Денис'");
        
        if (check.rows.length > 0) {
            console.log('   ✅ Директор уже существует');
            
            // Проверяем пароль
            const passCheck = await query("SELECT username FROM passwords WHERE username = 'Денис'");
            if (passCheck.rows.length === 0) {
                const hashedPassword = await hashPassword('denis_1');
                await query(
                    "INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)",
                    [hashedPassword]
                );
                console.log('   ✅ Пароль создан');
            }
            return;
        }
        
        // Создаём директора
        console.log('📝 Создание директора...');
        const result = await query(`
            INSERT INTO employees (name, avatar, coins, rating, role, dashboard_style, bought_styles, bonus_streak, is_active)
            VALUES ('Денис', '👑', 1000, 0, 'director', 'glass', '["glass"]', 1, TRUE)
            RETURNING id
        `);
        
        const directorId = result.rows[0].id;
        console.log(`   ✅ Директор создан (id: ${directorId})`);
        
        // Создаём пароль
        const hashedPassword = await hashPassword('denis_1');
        await query(
            "INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)",
            [hashedPassword]
        );
        console.log('   ✅ Пароль: denis_1');
        
    } catch (err) {
        console.error('❌ Ошибка создания директора:', err.message);
    }
}

console.log('✅ ЧАСТЬ 2/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 3/8: ДОСТИЖЕНИЯ, CRON-ЗАДАЧИ, API АВТОРИЗАЦИИ
// ============================================

// ============================================
// 14. СИСТЕМА ДОСТИЖЕНИЙ
// ============================================

const ACHIEVEMENT_CATEGORIES = {
    work: { name: 'Смены', icon: '📅', color: '#3b82f6' },
    tasks: { name: 'Задачи', icon: '✅', color: '#10b981' },
    gifts: { name: 'Подарки', icon: '🎁', color: '#ec4899' },
    rating: { name: 'Рейтинг', icon: '⭐', color: '#fbbf24' },
    streak: { name: 'Ежедневный вход', icon: '🔥', color: '#f97316' },
    exchange: { name: 'Обмен', icon: '🔄', color: '#8b5cf6' },
    chat: { name: 'Чат', icon: '💬', color: '#06b6d4' },
    shop: { name: 'Магазин', icon: '🛒', color: '#a78bfa' },
    knowledge: { name: 'База знаний', icon: '📚', color: '#14b8a6' },
    special: { name: 'Особые', icon: '✨', color: '#fbbf24' },
    legendary: { name: 'Легендарные', icon: '👑', color: '#fbbf24' }
};

function generateAllAchievements() {
    const achievements = [];
    
    // Смены (42 достижения)
    const shiftMilestones = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
    const shiftCoins = [50,30,30,30,50,30,50,30,30,100,60,60,60,60,100,80,100,80,100,80,150,120,150,120,180,200,150,200,250,300,400,500,600,700,800,900,1000,1200,1500,2000,2500,3000];
    
    shiftMilestones.forEach((m, i) => {
        achievements.push({
            id: `shift_${m}`,
            name: m === 1 ? '🥇 Первая смена' : `📅 ${m} смен`,
            description: `Отработать ${m} ${getShiftWord(m)}`,
            category: 'work',
            required_value: m,
            coins_reward: shiftCoins[i] || 100,
            sort_order: 100 + i,
            icon: m === 1 ? '🥇' : (m <= 10 ? '📅' : '📆')
        });
    });
    
    // Задачи (29 достижений)
    const taskMilestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,60,70,80,90,100,150,200,250,300,400,500];
    const taskCoins = [30,20,20,20,30,20,30,20,20,50,40,60,50,80,60,80,60,100,100,120,120,150,200,250,300,350,400,500,600];
    
    taskMilestones.forEach((m, i) => {
        achievements.push({
            id: `task_${m}`,
            name: m === 1 ? '✅ Первая задача' : `📋 ${m} задач`,
            description: `Выполнить ${m} ${getTaskWord(m)}`,
            category: 'tasks',
            required_value: m,
            coins_reward: taskCoins[i] || 50,
            sort_order: 200 + i,
            icon: m === 1 ? '🎯' : '📋'
        });
    });
    
    // Подарки (24 достижения)
    const giftMilestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50,60,70,80,90,100,120,150,200];
    const giftCoins = [20,15,15,15,20,15,20,15,15,30,25,40,30,50,60,80,80,100,100,120,150,180,200,250];
    
    giftMilestones.forEach((m, i) => {
        achievements.push({
            id: `gift_${m}`,
            name: m === 1 ? '🎁 Первый подарок' : `🎁 ${m} подарков`,
            description: `Отправить ${m} ${getGiftWord(m)}`,
            category: 'gifts',
            required_value: m,
            coins_reward: giftCoins[i] || 30,
            sort_order: 300 + i,
            icon: '🎁'
        });
    });
    
    // Рейтинг (26 достижений)
    const ratingMilestones = [10,20,30,40,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
    const ratingCoins = [30,20,20,20,30,20,30,20,20,50,40,40,40,40,60,50,80,70,100,90,120,150,180,200,250,300];
    
    ratingMilestones.forEach((m, i) => {
        const rank = getRatingRank(m);
        achievements.push({
            id: `rating_${m}`,
            name: `${rank.icon} ${rank.name}`,
            description: `Достичь ${m} рейтинга`,
            category: 'rating',
            required_value: m,
            coins_reward: ratingCoins[i] || 50,
            sort_order: 400 + i,
            icon: rank.icon
        });
    });
    
    // Стрик (19 достижений)
    const streakMilestones = [3,5,7,10,14,21,30,40,50,60,70,80,90,100,150,200,250,300,365];
    const streakCoins = [30,50,80,100,150,200,300,350,400,450,500,550,600,700,900,1200,1500,2000,3000];
    
    streakMilestones.forEach((m, i) => {
        achievements.push({
            id: `streak_${m}`,
            name: m === 365 ? '📅 Год в системе' : `🔥 ${m} дней подряд`,
            description: `Входить в систему ${m} ${getDayWord(m)} подряд`,
            category: 'streak',
            required_value: m,
            coins_reward: streakCoins[i] || 100,
            sort_order: 500 + i,
            icon: '🔥'
        });
    });
    
    // Особые (30+ достижений)
    const specialAchievements = [
        { id: 'first_login', name: '🎉 Добро пожаловать', description: 'Первый вход в систему', coins: 50, icon: '🎉' },
        { id: 'set_avatar', name: '🖼️ Свой стиль', description: 'Установить аватар', coins: 50, icon: '🖼️' },
        { id: 'complete_profile', name: '📝 Полный профиль', description: 'Заполнить профиль', coins: 100, icon: '📝' },
        { id: 'first_task_completed', name: '🎯 Первая задача', description: 'Выполнить первую задачу', coins: 30, icon: '🎯' },
        { id: 'first_gift_sent', name: '🎁 Первый подарок', description: 'Отправить подарок', coins: 25, icon: '🎁' },
        { id: 'first_exchange', name: '🔄 Первый обмен', description: 'Обменяться сменами', coins: 40, icon: '🔄' },
        { id: 'first_shop_purchase', name: '🛍️ Первая покупка', description: 'Купить в магазине', coins: 20, icon: '🛍️' },
        { id: 'first_knowledge', name: '📖 Первое знание', description: 'Прочитать статью', coins: 15, icon: '📖' },
        { id: 'rich_1000', name: '💰 Капиталист', description: 'Накопить 1000 WP', coins: 200, icon: '💰' },
        { id: 'rich_5000', name: '💰 Миллионер', description: 'Накопить 5000 WP', coins: 500, icon: '💰' }
    ];
    
    specialAchievements.forEach((ach, i) => {
        achievements.push({
            ...ach,
            category: 'special',
            required_value: 1,
            sort_order: 1000 + i
        });
    });
    
    // Легендарные (10 достижений)
    const legendaryAchievements = [
        { id: 'warpoint_legend', name: '🏆 Легенда WARPOINT', description: 'Выполнить 100 достижений', coins: 5000, icon: '🏆' },
        { id: 'thousand_shifts', name: '💪 Тысячник', description: 'Отработать 1000 смен', coins: 5000, icon: '💪' },
        { id: 'thousand_tasks', name: '📋 Мастер задач', description: 'Выполнить 1000 задач', coins: 3000, icon: '📋' },
        { id: 'millionaire', name: '💎 WP-миллионер', description: 'Накопить 100000 WP', coins: 10000, icon: '💎' }
    ];
    
    legendaryAchievements.forEach((ach, i) => {
        achievements.push({
            ...ach,
            category: 'legendary',
            required_value: 1,
            sort_order: 2000 + i
        });
    });
    
    return achievements;
}

// Вспомогательные функции склонения
function getShiftWord(n) { const l = n % 10, t = n % 100; if (t >= 11 && t <= 19) return 'смен'; if (l === 1) return 'смену'; if (l >= 2 && l <= 4) return 'смены'; return 'смен'; }
function getTaskWord(n) { const l = n % 10, t = n % 100; if (t >= 11 && t <= 19) return 'задач'; if (l === 1) return 'задачу'; if (l >= 2 && l <= 4) return 'задачи'; return 'задач'; }
function getGiftWord(n) { const l = n % 10, t = n % 100; if (t >= 11 && t <= 19) return 'подарков'; if (l === 1) return 'подарок'; if (l >= 2 && l <= 4) return 'подарка'; return 'подарков'; }
function getDayWord(n) { const l = n % 10, t = n % 100; if (t >= 11 && t <= 19) return 'дней'; if (l === 1) return 'день'; if (l >= 2 && l <= 4) return 'дня'; return 'дней'; }
function getRatingRank(r) { if (r >= 5000) return { name: 'Легенда', icon: '👑' }; if (r >= 3000) return { name: 'Профессионал', icon: '💎' }; if (r >= 1500) return { name: 'Эксперт', icon: '🏆' }; if (r >= 500) return { name: 'Мастер', icon: '🔥' }; return { name: 'Новичок', icon: '🌱' }; }

async function initAchievements() {
    console.log('🏆 Инициализация достижений...');
    const achievements = generateAllAchievements();
    console.log(`   Сгенерировано ${achievements.length} достижений`);
    
    let inserted = 0, updated = 0;
    for (const ach of achievements) {
        try {
            const result = await query(`
                INSERT INTO achievements (id, name, description, category, required_value, coins_reward, sort_order, icon, color)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    category = EXCLUDED.category,
                    required_value = EXCLUDED.required_value,
                    coins_reward = EXCLUDED.coins_reward,
                    sort_order = EXCLUDED.sort_order,
                    icon = EXCLUDED.icon,
                    color = EXCLUDED.color
                RETURNING (SELECT CASE WHEN xmax = 0 THEN 'inserted' ELSE 'updated' END)
            `, [ach.id, ach.name, ach.description, ach.category, ach.required_value, ach.coins_reward, ach.sort_order, ach.icon, ACHIEVEMENT_CATEGORIES[ach.category]?.color || '#fbbf24']);
            
            if (result.rows[0]?.xmax === 0) inserted++; else updated++;
        } catch (err) {
            console.error(`   ❌ ${ach.id}: ${err.message}`);
        }
    }
    console.log(`✅ Достижения (новых: ${inserted}, обновлено: ${updated})`);
}

// ============================================
// 15. CRON-ЗАДАЧИ
// ============================================

const CRON_FLAGS = { isProcessingShift: false, isProcessingTasks: false, isProcessingExchange: false };

async function processShiftEarnings() {
    if (CRON_FLAGS.isProcessingShift) return;
    CRON_FLAGS.isProcessingShift = true;
    
    try {
        const yesterday = getTobolskDate();
        const result = await query(`
            UPDATE employees e SET coins = coins + (s.hours * 2), hours = hours + s.hours
            FROM (
                SELECT employee, SUM(EXTRACT(HOUR FROM (COALESCE(special_end_time, '22:00')::time - shift_time::time))) as hours
                FROM schedule WHERE date = $1 AND shift_time IS NOT NULL AND shift_paid = FALSE
                GROUP BY employee
            ) s
            WHERE e.name = s.employee
        `, [yesterday]);
        
        await query("UPDATE schedule SET shift_paid = TRUE WHERE date = $1", [yesterday]);
    } catch (err) {
        console.error('❌ Ошибка начисления WP:', err.message);
    } finally {
        CRON_FLAGS.isProcessingShift = false;
    }
}

async function checkOverdueTasks() {
    if (CRON_FLAGS.isProcessingTasks) return;
    CRON_FLAGS.isProcessingTasks = true;
    
    try {
        const today = getTobolskDate();
        const overdue = await query(`
            SELECT id, name, executor FROM tasks 
            WHERE deadline < $1 AND status NOT IN ('completed', 'failed', 'overdue') AND is_archived = FALSE
        `, [today]);
        
        for (const task of overdue.rows) {
            if (task.executor) {
                await query(`
                    INSERT INTO fines (date, employee, type, description, status, created_by)
                    VALUES ($1, $2, 'task_overdue', $3, 'pending', '🤖 Система')
                `, [today, task.executor, `Просрочена задача: ${task.name}`]);
            }
            await query("UPDATE tasks SET status = 'overdue', penalty_applied = TRUE WHERE id = $1", [task.id]);
        }
        
        if (overdue.rows.length > 0) {
            console.log(`   ⚠️ Создано ${overdue.rows.length} штрафов за просрочку`);
        }
    } catch (err) {
        console.error('❌ Ошибка проверки задач:', err.message);
    } finally {
        CRON_FLAGS.isProcessingTasks = false;
    }
}

async function autoExpireExchanges() {
    if (CRON_FLAGS.isProcessingExchange) return;
    CRON_FLAGS.isProcessingExchange = true;
    
    try {
        const result = await query(`
            UPDATE exchange_requests SET status = 'expired' 
            WHERE status = 'pending' AND expires_at < NOW()
        `);
        if (result.rowCount > 0) console.log(`   🔄 Отменено ${result.rowCount} просроченных обменов`);
    } catch (err) {
        console.error('❌ Ошибка отмены обменов:', err.message);
    } finally {
        CRON_FLAGS.isProcessingExchange = false;
    }
}

async function updateWeatherJob() {
    try {
        await fetchWeather();
        console.log('🌤️ Погода обновлена');
    } catch (err) {
        console.error('❌ Ошибка погоды:', err.message);
    }
}

function initCronJobs() {
    console.log('⏰ Инициализация cron-задач...');
    cron.schedule('5 0 * * *', processShiftEarnings);
    cron.schedule('*/15 * * * *', checkOverdueTasks);
    cron.schedule('0 * * * *', autoExpireExchanges);
    cron.schedule('0 */2 * * *', updateWeatherJob);
    console.log('   ✅ Cron-задачи запущены');
}

// ============================================
// 16. API — АВТОРИЗАЦИЯ
// ============================================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Введите логин и пароль' });
        }
        
        const userResult = await query(
            `SELECT e.*, p.password_hash FROM employees e 
             LEFT JOIN passwords p ON p.username = e.name 
             WHERE e.name = $1 AND e.is_active = TRUE`,
            [username]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        
        const user = userResult.rows[0];
        
        if (!user.password_hash) {
            // Если пароля нет — создаём (для директора)
            if (user.role === 'director' && password === 'denis_1') {
                const hashedPassword = await hashPassword('denis_1');
                await query("INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2", [username, hashedPassword]);
                user.password_hash = hashedPassword;
            } else {
                return res.status(401).json({ success: false, error: 'Пароль не установлен' });
            }
        }
        
        const validPassword = await comparePassword(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        
        await query("UPDATE employees SET last_active = NOW() WHERE id = $1", [user.id]);
        
        delete user.password_hash;
        const token = generateToken({ id: user.id, username: user.name, role: user.role });
        
        res.json({ success: true, user, token });
        console.log(`✅ Вход: ${username}`);
        
    } catch (err) {
        console.error('❌ Ошибка входа:', err.message);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
    res.json({ success: true, message: 'Выход выполнен' });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT id, name, avatar, avatar_url, coins, rating, role, status, active_status, dashboard_style, bought_styles, can_edit_vp, bonus_streak FROM employees WHERE id = $1",
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

console.log('✅ ЧАСТЬ 3/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 4/8: API СОТРУДНИКОВ, ЗАДАЧ, ШТРАФОВ, ГРАФИКА, ОБМЕНОВ
// ============================================

// ============================================
// 17. API — СОТРУДНИКИ
// ============================================

// Получить всех сотрудников
app.get('/api/employees', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, avatar, avatar_url, status, active_status, coins, rating, role, hours, 
                    birthday, phone, last_active, dashboard_style, bought_styles, can_edit_vp, 
                    bonus_streak, total_shifts, total_tasks_completed, is_active
             FROM employees WHERE deleted_at IS NULL ORDER BY rating DESC, name ASC`
        );
        res.json({ success: true, employees: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Получить одного сотрудника
app.get('/api/employees/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        }
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Создать сотрудника (только директор)
app.post('/api/employees', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор может создавать сотрудников' });
    }
    
    try {
        const { name, password, role, birthday, phone } = req.body;
        if (!name || !password) {
            return res.status(400).json({ success: false, error: 'Имя и пароль обязательны' });
        }
        
        const existing = await query("SELECT id FROM employees WHERE name = $1", [name]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Сотрудник уже существует' });
        }
        
        const result = await query(
            `INSERT INTO employees (name, role, birthday, phone, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
            [name, role || 'operator', birthday || null, phone || null]
        );
        
        const hashedPassword = await hashPassword(password);
        await query("INSERT INTO passwords (username, password_hash) VALUES ($1, $2)", [name, hashedPassword]);
        
        res.json({ success: true, employee: result.rows[0] });
        console.log(`✅ Создан сотрудник: ${name}`);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Обновить сотрудника
app.put('/api/employees/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    // Проверка прав
    if (req.user.role !== 'director' && req.user.id != id) {
        return res.status(403).json({ success: false, error: 'Нет прав на редактирование' });
    }
    
    try {
        const allowedFields = ['avatar', 'avatar_url', 'status', 'active_status', 'phone', 'birthday', 'dashboard_style'];
        if (req.user.role === 'director') {
            allowedFields.push('name', 'role', 'coins', 'rating', 'can_edit_vp');
        }
        
        const fields = [];
        const values = [];
        let idx = 1;
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                fields.push(`${field} = $${idx++}`);
                values.push(updates[field]);
            }
        }
        
        if (fields.length === 0) {
            return res.json({ success: true, message: 'Нет полей для обновления' });
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await query(
            `UPDATE employees SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Удалить сотрудника (soft delete)
app.delete('/api/employees/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор может удалять сотрудников' });
    }
    
    try {
        const { id } = req.params;
        const emp = await query("SELECT role FROM employees WHERE id = $1", [id]);
        if (emp.rows[0]?.role === 'director') {
            return res.status(403).json({ success: false, error: 'Нельзя удалить директора' });
        }
        
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE id = $1", [id]);
        res.json({ success: true, message: 'Сотрудник уволен' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Сменить пароль сотрудника (директор)
app.put('/api/employees/:id/password', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор может менять пароли' });
    }
    
    try {
        const { id } = req.params;
        const { password } = req.body;
        if (!password || password.length < 3) {
            return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 3 символов' });
        }
        
        const emp = await query("SELECT name FROM employees WHERE id = $1", [id]);
        if (emp.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        }
        
        const hashedPassword = await hashPassword(password);
        await query(
            "INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2, updated_at = NOW()",
            [emp.rows[0].name, hashedPassword]
        );
        
        res.json({ success: true, message: 'Пароль изменён' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 18. API — ЗАДАЧИ
// ============================================

app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { executor, status, limit = 100 } = req.query;
        let sql = `SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks 
                   FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE t.is_archived = FALSE`;
        const params = [];
        
        if (executor) { sql += ` AND t.executor = $${params.length + 1}`; params.push(executor); }
        if (status) { sql += ` AND t.status = $${params.length + 1}`; params.push(status); }
        
        sql += ` GROUP BY t.id ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        
        const result = await query(sql, params);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { task } = req.body;
        const author = req.user.role === 'director' ? (task.author || req.user.username) : req.user.username;
        
        const wpReward = { low: 3, medium: 8, high: 15 }[task.priority] || 8;
        
        const result = await query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, comment, status, is_group_task, group_members, wp_reward)
             VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7, $8, $9) RETURNING *`,
            [task.name, author, task.executor, task.priority || 'medium', task.deadline, task.comment, task.is_group_task, JSON.stringify(task.group_members), wpReward]
        );
        
        if (task.subtasks) {
            for (const sub of task.subtasks) {
                await query("INSERT INTO subtasks (task_id, name) VALUES ($1, $2)", [result.rows[0].id, sub.name]);
            }
        }
        
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const current = await query("SELECT * FROM tasks WHERE id = $1", [id]);
        if (current.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        
        const task = current.rows[0];
        
        // Если задача завершается — начисляем WP
        if (updates.status === 'completed' && task.status !== 'completed' && task.executor) {
            await query("UPDATE employees SET coins = coins + $1, total_tasks_completed = total_tasks_completed + 1 WHERE name = $2", [task.wp_reward || 8, task.executor]);
        }
        
        const fields = [];
        const values = [];
        let idx = 1;
        const allowed = ['name', 'executor', 'priority', 'deadline', 'progress', 'comment', 'status'];
        
        for (const f of allowed) {
            if (updates[f] !== undefined) {
                fields.push(`${f} = $${idx++}`);
                values.push(updates[f]);
            }
        }
        
        if (updates.status === 'completed') {
            fields.push(`completed_at = NOW()`);
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await query("SELECT author FROM tasks WHERE id = $1", [id]);
        
        if (req.user.role !== 'director' && req.user.role !== 'manager' && task.rows[0]?.author !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав на удаление' });
        }
        
        await query("DELETE FROM tasks WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 19. API — ШТРАФЫ
// ============================================

app.get('/api/fines', authMiddleware, async (req, res) => {
    try {
        const { employee, status } = req.query;
        let sql = "SELECT * FROM fines WHERE 1=1";
        const params = [];
        
        if (employee) { sql += ` AND employee = $${params.length + 1}`; params.push(employee); }
        if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
        sql += " ORDER BY date DESC, created_at DESC LIMIT 500";
        
        const result = await query(sql, params);
        res.json({ success: true, fines: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fines', authMiddleware, async (req, res) => {
    if (!['director', 'manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { fine } = req.body;
        const result = await query(
            `INSERT INTO fines (date, employee, type, amount, coins, rating, description, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING *`,
            [fine.date || getTobolskDate(), fine.employee, fine.type, fine.amount || 0, fine.coins || 0, fine.rating || 0, fine.description, req.user.username]
        );
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/fines/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const result = await query(
            "UPDATE fines SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
            [status, id]
        );
        
        if (status === 'approved') {
            const fine = result.rows[0];
            if (fine.coins > 0) {
                await query("UPDATE employees SET coins = GREATEST(coins - $1, 0) WHERE name = $2", [fine.coins, fine.employee]);
            }
            if (fine.rating !== 0) {
                await query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [fine.rating, fine.employee]);
            }
        }
        
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 20. API — ГРАФИК СМЕН
// ============================================

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sql = "SELECT * FROM schedule WHERE 1=1";
        const params = [];
        
        if (month && year) {
            sql += ` AND EXTRACT(MONTH FROM date) = $${params.length + 1} AND EXTRACT(YEAR FROM date) = $${params.length + 2}`;
            params.push(month, year);
        }
        sql += " ORDER BY date DESC, employee";
        
        const result = await query(sql, params);
        res.json({ success: true, schedule: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status } = req.body;
    
    // Проверка прав
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const existing = await query("SELECT id FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        
        let result;
        if (existing.rows.length > 0) {
            result = await query(
                "UPDATE schedule SET shift_time = $1, shift_status = $2, updated_at = NOW() WHERE date = $3 AND employee = $4 RETURNING *",
                [shift_time, shift_status || 'working', date, employee]
            );
        } else {
            result = await query(
                "INSERT INTO schedule (date, employee, shift_time, shift_status) VALUES ($1, $2, $3, $4) RETURNING *",
                [date, employee, shift_time, shift_status || 'working']
            );
        }
        
        triggerPusher('private-warpoint-sync', 'schedule-updated', { date, employee, shift_time });
        res.json({ success: true, shift: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee } = req.body;
    
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 21. API — ОБМЕН СМЕНАМИ
// ============================================

app.post('/api/exchange/create', authMiddleware, async (req, res) => {
    try {
        const { toEmployee, toDate, toShiftTime, fromDate, fromShiftTime, comment } = req.body;
        const fromEmployee = req.user.username;
        
        if (fromEmployee === toEmployee) {
            return res.status(400).json({ success: false, error: 'Нельзя обменяться с собой' });
        }
        
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        const result = await query(
            `INSERT INTO exchange_requests (from_employee, to_employee, from_date, to_date, from_shift_time, to_shift_time, comment, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [fromEmployee, toEmployee, fromDate, toDate, fromShiftTime, toShiftTime, comment, expiresAt]
        );
        
        res.json({ success: true, requestId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/exchange/pending', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT * FROM exchange_requests WHERE to_employee = $1 AND status = 'pending' ORDER BY created_at DESC",
            [req.user.username]
        );
        res.json({ success: true, requests: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/exchange/accept/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await query("SELECT * FROM exchange_requests WHERE id = $1 AND status = 'pending'", [id]);
        
        if (request.rows.length === 0) return res.status(404).json({ success: false, error: 'Запрос не найден' });
        if (request.rows[0].to_employee !== req.user.username) return res.status(403).json({ success: false, error: 'Не ваш запрос' });
        
        const r = request.rows[0];
        
        // Меняем смены
        await query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.from_employee, r.to_date, r.to_employee]);
        await query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.to_employee, r.from_date, r.from_employee]);
        await query("UPDATE exchange_requests SET status = 'accepted' WHERE id = $1", [id]);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

console.log('✅ ЧАСТЬ 4/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 5/8: API ВП, ЗАРПЛАТЫ, ФОНДА, ЧАТА, МАГАЗИНА
// ============================================

// ============================================
// 22. API — ВП (МЕРОПРИЯТИЯ)
// ============================================

app.get('/api/vp', authMiddleware, async (req, res) => {
    try {
        const { month, year, archived } = req.query;
        let sql = "SELECT * FROM vp_bookings WHERE 1=1";
        const params = [];
        
        if (month && year) {
            sql += ` AND EXTRACT(MONTH FROM event_date) = $${params.length + 1} AND EXTRACT(YEAR FROM event_date) = $${params.length + 2}`;
            params.push(month, year);
        }
        
        if (archived === 'false' || !archived) {
            sql += ` AND is_archived = FALSE`;
        }
        
        sql += " ORDER BY event_date DESC, event_time DESC LIMIT 500";
        
        const result = await query(sql, params);
        res.json({ success: true, bookings: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    const canCreate = ['director', 'manager'].includes(req.user.role) || 
                      (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canCreate) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { vp } = req.body;
        const result = await query(
            `INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, duration, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [vp.admin, vp.eventDate, vp.eventTime, vp.customerName, vp.amount || 2000, 
             vp.paymentType || 'evotor_card', getTobolskDate(), vp.duration || 1, req.user.username]
        );
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    const canEdit = ['director', 'manager'].includes(req.user.role) || 
                    (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canEdit) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const fields = [];
        const values = [];
        let idx = 1;
        const allowed = ['event_date', 'event_time', 'customer_name', 'admin', 'amount', 'payment_type', 'comment', 'duration', 'photo_status', 'script_status', 'is_archived'];
        
        for (const f of allowed) {
            if (updates[f] !== undefined) {
                fields.push(`${f} = $${idx++}`);
                values.push(updates[f]);
            }
        }
        
        if (fields.length === 0) {
            return res.json({ success: true, message: 'Нет изменений' });
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await query(`UPDATE vp_bookings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/vp/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM vp_bookings WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 23. API — ЗАРПЛАТА
// ============================================

app.get('/api/salary', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const employees = await query(
            "SELECT id, name, role, avatar, avatar_url FROM employees WHERE role != 'director' AND is_active = TRUE ORDER BY name"
        );
        
        const dailyData = await query("SELECT * FROM salary_daily WHERE month_year = $1", [monthYear]);
        
        res.json({ success: true, employees: employees.rows, dailyData: dailyData.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/salary/day', authMiddleware, async (req, res) => {
    try {
        const { employee_id, day, month, year } = req.query;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const result = await query(
            `SELECT oklad, event, turnover, bonus35, video, extra_motivation 
             FROM salary_daily WHERE employee_id = $1 AND day_number = $2 AND month_year = $3`,
            [employee_id, day, monthYear]
        );
        
        res.json({ success: true, data: result.rows[0] || { oklad: 0, event: 0, turnover: 0, bonus35: 0, video: 0, extra_motivation: 0 } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/salary/day/save', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { employee_id, day_number, month, year, oklad, event, turnover, bonus35, video, extra_motivation } = req.body;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        await query(
            `INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET
                oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover,
                bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation,
                updated_at = NOW()`,
            [employee_id, day_number, monthYear, oklad || 0, event || 0, turnover || 0, bonus35 || 0, video || 0, extra_motivation || 0]
        );
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/salary/apply-all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { day_number, month, year, ...fields } = req.body;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const operators = await query("SELECT id FROM employees WHERE role = 'operator' AND is_active = TRUE");
        
        for (const op of operators.rows) {
            await query(
                `INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET
                    oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover,
                    bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation`,
                [op.id, day_number, monthYear, fields.oklad || 0, fields.event || 0, fields.turnover || 0, 
                 fields.bonus35 || 0, fields.video || 0, fields.extra_motivation || 0]
            );
        }
        
        res.json({ success: true, updated: operators.rows.length });
    } catch (17) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 24. API — КОРПОРАТИВНЫЙ ФОНД
// ============================================

app.get('/api/fund', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        res.json({ success: true, amount: result.rows[0]?.amount || 0 });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fund/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { amount, comment } = req.body;
        await query(
            "INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, 'update', $2, $3)",
            [amount, comment, req.user.id]
        );
        res.json({ success: true, amount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fund/add', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { sum, comment } = req.body;
        const current = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        const newAmount = (current.rows[0]?.amount || 0) + sum;
        
        if (newAmount < 0) {
            return res.status(400).json({ success: false, error: 'Недостаточно средств' });
        }
        
        await query(
            "INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, $2, $3, $4)",
            [newAmount, sum > 0 ? 'add' : 'subtract', comment, req.user.id]
        );
        res.json({ success: true, amount: newAmount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 25. API — ЧАТ
// ============================================

app.post('/api/chat', authMiddleware, async (req, res) => {
    try {
        const { room, message } = req.body;
        if (!message?.text || message.text.length > 2000) {
            return res.status(400).json({ success: false, error: 'Неверное сообщение' });
        }
        
        const result = await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *",
            [room || 'general', message.sender, message.text, Date.now()]
        );
        
        triggerPusher('private-warpoint-sync', 'new-message', { room: room || 'general', message: result.rows[0] });
        res.json({ success: true, message: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/private', authMiddleware, async (req, res) => {
    try {
        const { to, message } = req.body;
        const result = await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *",
            [to, message.sender, message.text, Date.now()]
        );
        
        triggerPusher(`private-user-${transliterate(to)}`, 'private-message', { from: message.sender, message: result.rows[0] });
        res.json({ success: true, message: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/announcement', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { announcement } = req.body;
        await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ('general', $1, $2, $3)",
            [announcement.sender, JSON.stringify(announcement), Date.now()]
        );
        
        triggerPusher('private-warpoint-sync', 'announcement', { announcement });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/chat/history/:room', authMiddleware, async (req, res) => {
    try {
        const { room } = req.params;
        const result = await query(
            "SELECT * FROM messages WHERE room = $1 AND is_deleted = FALSE ORDER BY time ASC LIMIT 500",
            [room]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/delete', authMiddleware, async (req, res) => {
    try {
        const { room, messageTime } = req.body;
        const msg = await query("SELECT sender FROM messages WHERE room = $1 AND time = $2", [room, messageTime]);
        
        if (msg.rows.length === 0) return res.status(404).json({ success: false });
        if (req.user.role !== 'director' && msg.rows[0].sender !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        
        await query("UPDATE messages SET is_deleted = TRUE WHERE room = $1 AND time = $2", [room, messageTime]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 26. API — МАГАЗИН (ПОДАРКИ)
// ============================================

app.get('/api/gifts', authMiddleware, (req, res) => {
    const gifts = [
        { id: 'flower', name: '🌸 Букет', icon: '🌸', price: 25, rating: 8 },
        { id: 'star', name: '⭐ Звезда', icon: '⭐', price: 75, rating: 25 },
        { id: 'pizza', name: '🍕 Пицца', icon: '🍕', price: 150, rating: 50 },
        { id: 'trophy', name: '🏆 Трофей', icon: '🏆', price: 300, rating: 100 },
        { id: 'crown', name: '👑 Корона', icon: '👑', price: 500, rating: 175 }
    ];
    res.json({ success: true, gifts });
});

app.post('/api/gifts', authMiddleware, async (req, res) => {
    try {
        const { recipient, giftId, price, ratingChange, quantity, isAnonymous } = req.body;
        const sender = isAnonymous ? '🕵️ Аноним' : req.user.username;
        
        await transaction(async (client) => {
            if (!isAnonymous) {
                const total = price * quantity;
                const user = await client.query("SELECT coins FROM employees WHERE name = $1 FOR UPDATE", [req.user.username]);
                if (user.rows[0].coins < total) throw new Error('Недостаточно WP');
                
                await client.query("UPDATE employees SET coins = coins - $1, total_gifts_sent = total_gifts_sent + $2 WHERE name = $3", [total, quantity, req.user.username]);
            }
            
            await client.query(
                `INSERT INTO stickers (sender, employee, gift_id, quantity, is_anonymous)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (employee, gift_id, sender, DATE(created_at)) DO UPDATE SET quantity = stickers.quantity + $4`,
                [sender, recipient, giftId, quantity, isAnonymous || false]
            );
            
            if (ratingChange) {
                await client.query("UPDATE employees SET rating = rating + $1, total_gifts_received = total_gifts_received + $2 WHERE name = $3", [ratingChange * quantity, quantity, recipient]);
            }
        });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 27. API — СТАТУСЫ И СТИЛИ
// ============================================

app.get('/api/user/statuses', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT status_id, status_name, status_icon, price, is_active FROM user_statuses WHERE employee_id = $1",
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/statuses/buy', authMiddleware, async (req, res) => {
    try {
        const { statusId, statusName, statusIcon, price, rating } = req.body;
        
        const existing = await query("SELECT id FROM user_statuses WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Статус уже куплен' });
        }
        
        await transaction(async (client) => {
            const user = await client.query("SELECT coins FROM employees WHERE id = $1 FOR UPDATE", [req.user.id]);
            if (user.rows[0].coins < price) throw new Error('Недостаточно WP');
            
            await client.query("UPDATE employees SET coins = coins - $1 WHERE id = $2", [price, req.user.id]);
            await client.query(
                "INSERT INTO user_statuses (employee_id, status_id, status_name, status_icon, price) VALUES ($1, $2, $3, $4, $5)",
                [req.user.id, statusId, statusName, statusIcon, price]
            );
            if (rating) await client.query("UPDATE employees SET rating = rating + $1 WHERE id = $2", [rating, req.user.id]);
        });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/statuses/activate', authMiddleware, async (req, res) => {
    try {
        const { statusId } = req.body;
        await query("UPDATE user_statuses SET is_active = FALSE WHERE employee_id = $1", [req.user.id]);
        await query("UPDATE user_statuses SET is_active = TRUE WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        await query("UPDATE employees SET active_status = (SELECT status_name FROM user_statuses WHERE employee_id = $1 AND status_id = $2) WHERE id = $1", [req.user.id, statusId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

console.log('✅ ЧАСТЬ 5/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 6/8: БАЗА ЗНАНИЙ, ДОСТИЖЕНИЯ, ОТЧЁТЫ, АДМИНКА
// ============================================

// ============================================
// 28. API — БАЗА ЗНАНИЙ
// ============================================

app.get('/api/knowledge/categories', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT c.*, COUNT(a.id) as articles_count 
             FROM knowledge_categories c 
             LEFT JOIN knowledge_articles a ON a.category_id = c.id 
             GROUP BY c.id ORDER BY c.sort_order, c.name`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/categories', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { name, icon, description } = req.body;
        const result = await query(
            "INSERT INTO knowledge_categories (name, icon, description) VALUES ($1, $2, $3) RETURNING *",
            [name, icon || '📁', description]
        );
        res.json({ success: true, category: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Категория уже существует' });
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const { name, icon, description, sort_order } = req.body;
        const result = await query(
            "UPDATE knowledge_categories SET name = COALESCE($1, name), icon = COALESCE($2, icon), description = COALESCE($3, description), sort_order = COALESCE($4, sort_order) WHERE id = $5 RETURNING *",
            [name, icon, description, sort_order, id]
        );
        res.json({ success: true, category: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM knowledge_categories WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, limit = 100 } = req.query;
        let sql = "SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE 1=1";
        const params = [];
        
        if (category_id) { sql += ` AND a.category_id = $${params.length + 1}`; params.push(category_id); }
        sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        
        const result = await query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE a.id = $1",
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false });
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, title, content } = req.body;
        const result = await query(
            "INSERT INTO knowledge_articles (category_id, title, content, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
            [category_id, title, content, req.user.username]
        );
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, category_id } = req.body;
        
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [id]);
        if (article.rows.length === 0) return res.status(404).json({ success: false });
        
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0].created_by !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        
        const result = await query(
            "UPDATE knowledge_articles SET title = COALESCE($1, title), content = COALESCE($2, content), category_id = COALESCE($3, category_id), updated_at = NOW() WHERE id = $4 RETURNING *",
            [title, content, category_id, id]
        );
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [req.params.id]);
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0]?.created_by !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        await query("DELETE FROM knowledge_articles WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    try {
        await query("UPDATE knowledge_articles SET views = views + 1 WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 29. API — ДОСТИЖЕНИЯ
// ============================================

app.get('/api/achievements', authMiddleware, async (req, res) => {
    try {
        const achievements = await query(`
            SELECT a.*, 
                   CASE WHEN ua.user_id IS NOT NULL THEN TRUE ELSE FALSE END as unlocked,
                   CASE WHEN pa.user_id IS NOT NULL THEN TRUE ELSE FALSE END as pending
            FROM achievements a
            LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
            LEFT JOIN pending_achievements pa ON pa.achievement_id = a.id AND pa.user_id = $1
            ORDER BY a.sort_order, a.id
        `, [req.user.id]);
        
        const stats = await query(`
            SELECT COUNT(DISTINCT a.id) as total, COUNT(DISTINCT ua.achievement_id) as unlocked
            FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
        `, [req.user.id]);
        
        res.json({ 
            success: true, 
            achievements: achievements.rows,
            stats: { total: parseInt(stats.rows[0].total), unlocked: parseInt(stats.rows[0].unlocked) }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/achievements/claim', authMiddleware, async (req, res) => {
    try {
        const { achievementId } = req.body;
        
        const pending = await query(
            "SELECT * FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2",
            [req.user.id, achievementId]
        );
        if (pending.rows.length === 0) return res.status(400).json({ success: false, error: 'Достижение недоступно' });
        
        const ach = await query("SELECT * FROM achievements WHERE id = $1", [achievementId]);
        
        await transaction(async (client) => {
            await client.query("DELETE FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2", [req.user.id, achievementId]);
            await client.query("INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)", [req.user.id, achievementId]);
            await client.query("UPDATE employees SET coins = coins + $1 WHERE id = $2", [ach.rows[0].coins_reward, req.user.id]);
        });
        
        res.json({ success: true, coins: ach.rows[0].coins_reward, achievement: ach.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 30. API — ОТЧЁТЫ И ПАРСИНГ
// ============================================

app.get('/api/parsing/latest', authMiddleware, async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'data', 'booking-availability.json');
        if (!fs.existsSync(filePath)) {
            return res.json({ success: true, dates: {} });
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/parsing/run', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    res.json({ success: true, message: 'Парсинг запущен' });
    
    setImmediate(async () => {
        try {
            await bookingParser.parseAvailability();
        } catch (err) {
            console.error('❌ Ошибка парсинга:', err.message);
        }
    });
});

app.get('/api/parsing/progress', authMiddleware, (req, res) => {
    res.json({ 
        success: true, 
        isParsing: bookingParser.isParsingNow(), 
        progress: bookingParser.getProgress() 
    });
});

app.get('/api/weather', async (req, res) => {
    try {
        const weather = await fetchWeather();
        res.json({ success: true, ...weather });
    } catch (err) {
        res.json({ success: true, temp: 0, desc: 'Нет данных', icon: '🌡️' });
    }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const result = await query(
            "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
            [req.user.id, parseInt(limit)]
        );
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    try {
        const today = getTobolskDate();
        
        const onShift = await query("SELECT COUNT(*) FROM schedule WHERE date = $1 AND shift_time IS NOT NULL", [today]);
        const tasks = await query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as done FROM tasks WHERE is_archived = FALSE");
        const fines = await query("SELECT COUNT(*) FROM fines WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)");
        
        res.json({
            success: true,
            onShift: parseInt(onShift.rows[0].count),
            tasks: { total: parseInt(tasks.rows[0].total), done: parseInt(tasks.rows[0].done) },
            finesThisMonth: parseInt(fines.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 31. API — АДМИНИСТРИРОВАНИЕ
// ============================================

app.get('/api/admin/theme', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'global_theme'");
        res.json({ success: true, theme: result.rows[0]?.setting_value || 'vr-portal' });
    } catch (err) {
        res.json({ success: true, theme: 'vr-portal' });
    }
});

app.post('/api/admin/theme', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { theme } = req.body;
        await query(
            "INSERT INTO system_settings (setting_key, setting_value) VALUES ('global_theme', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1",
            [theme]
        );
        res.json({ success: true, theme });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/bonus/employee', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { name, coins, rating } = req.body;
        if (coins) await query("UPDATE employees SET coins = coins + $1 WHERE name = $2", [coins, name]);
        if (rating) await query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [rating, name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/reset-all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE role != 'director'");
        await query("TRUNCATE tasks, subtasks, fines, schedule, exchange_requests, vp_bookings, salary_daily, messages, stickers, user_achievements, pending_achievements, transactions CASCADE");
        res.json({ success: true, message: 'Данные сброшены' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/equal-start', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await query("UPDATE employees SET coins = 100, rating = 0, hours = 0, total_shifts = 0, total_tasks_completed = 0, total_gifts_sent = 0, total_gifts_received = 0");
        await query("TRUNCATE tasks, subtasks, fines, schedule, exchange_requests, vp_bookings, salary_daily, stickers, user_achievements, pending_achievements, transactions CASCADE");
        await query("INSERT INTO corporate_fund (amount, operation_type) VALUES (0, 'reset')");
        res.json({ success: true, message: 'Равный старт выполнен' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/init-achievements', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await initAchievements();
        res.json({ success: true, message: 'Достижения переинициализированы' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 32. API — УВЕДОМЛЕНИЯ
// ============================================

app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT * FROM notifications WHERE recipient = $1 ORDER BY created_at DESC LIMIT 50",
            [req.user.username]
        );
        const unread = await query(
            "SELECT COUNT(*) FROM notifications WHERE recipient = $1 AND read = FALSE",
            [req.user.username]
        );
        res.json({ success: true, notifications: result.rows, unread: parseInt(unread.rows[0].count) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/notifications/read', authMiddleware, async (req, res) => {
    try {
        const { all, notification_id } = req.body;
        if (all) {
            await query("UPDATE notifications SET read = TRUE WHERE recipient = $1", [req.user.username]);
        } else if (notification_id) {
            await query("UPDATE notifications SET read = TRUE WHERE id = $1 AND recipient = $2", [notification_id, req.user.username]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const { all } = req.body;
        if (all) {
            await query("DELETE FROM notifications WHERE recipient = $1", [req.user.username]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 33. PUSHER АВТОРИЗАЦИЯ
// ============================================

app.post('/api/pusher/auth', authMiddleware, (req, res) => {
    if (!pusher) return res.status(500).json({ error: 'Pusher not configured' });
    
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    
    if (channel.startsWith('private-user-')) {
        const username = channel.replace('private-user-', '');
        if (transliterate(req.user.username) !== username && req.user.role !== 'director') {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    
    const auth = pusher.authorizeChannel(socketId, channel);
    res.send(auth);
});

console.log('✅ ЧАСТЬ 6/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 7/8: СТАТИКА, HEALTH CHECK, SHUTDOWN, ЗАПУСК
// ============================================

// ============================================
// 34. СТАТИЧЕСКИЕ ФАЙЛЫ И SPA
// ============================================

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница "О проекте"
app.get('/about.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// Страницы из папки pages
app.get('/pages/:page', (req, res) => {
    const pagePath = path.join(__dirname, 'public', 'pages', req.params.page);
    if (fs.existsSync(pagePath)) {
        res.sendFile(pagePath);
    } else {
        res.status(404).send('Page not found');
    }
});

// SPA fallback — все остальные маршруты отдают index.html
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// 35. HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: SERVER_STATE.version,
        environment: process.env.NODE_ENV || 'development'
    };
    
    try {
        await query('SELECT 1');
        health.database = 'ok';
    } catch (err) {
        health.status = 'degraded';
        health.database = 'error';
    }
    
    health.pusher = pusher ? 'configured' : 'not_configured';
    
    const memory = process.memoryUsage();
    health.memory = {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
    };
    
    res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// 36. ОБРАБОТКА ОШИБОК
// ============================================

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, error: 'Endpoint not found' });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    
    if (res.headersSent) return next(err);
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON' });
    }
    
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================
// 37. GRACEFUL SHUTDOWN
// ============================================

function gracefulShutdown(signal) {
    if (SERVER_STATE.isShuttingDown) return;
    
    SERVER_STATE.isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    if (server) {
        server.close(() => {
            console.log('✅ HTTP server closed');
        });
        
        setTimeout(() => {
            console.error('❌ Could not close connections in time, forcing shutdown');
            process.exit(1);
        }, 10000);
    }
    
    if (pool) {
        pool.end().then(() => {
            console.log('✅ Database pool closed');
        }).catch(err => {
            console.error('❌ Error closing pool:', err.message);
        });
    }
    
    if (bookingParser && typeof bookingParser.closeBrowser === 'function') {
        bookingParser.closeBrowser().catch(() => {});
    }
    
    console.log('👋 WARPOINT Hub shutting down...');
    
    setTimeout(() => {
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
    }, 2000);
}

// ============================================
// 38. ЗАПУСК СЕРВЕРА
// ============================================

async function startServer() {
    try {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║                                                              ║');
        console.log('║   ██╗    ██╗ █████╗ ██████╗ ██████╗  ██████╗ ██╗███╗   ██╗████████╗  ║');
        console.log('║   ██║    ██║██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝  ║');
        console.log('║   ██║ █╗ ██║███████║██████╔╝██████╔╝██║   ██║██║██╔██╗ ██║   ██║     ║');
        console.log('║   ██║███╗██║██╔══██║██╔══██╗██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║     ║');
        console.log('║   ╚███╔███╔╝██║  ██║██║  ██║██║     ╚██████╔╝██║██║ ╚████║   ██║     ║');
        console.log('║    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝     ║');
        console.log('║                                                              ║');
        console.log('║                    CORPORATE PORTAL v5.0.0                    ║');
        console.log('║                                                              ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        
        // Инициализируем Pusher
        pusher = initPusher();
        
        // Создаём пул БД
        pool = createDatabasePool();
        if (!pool) throw new Error('Не удалось создать пул БД');
        
        // Инициализируем БД
        await initDatabase();
        
        // Инициализируем достижения
        await initAchievements();
        
        // Запускаем cron-задачи
        initCronJobs();
        
        // Запускаем сервер
        server = app.listen(PORT, '0.0.0.0', () => {
            SERVER_STATE.started = new Date();
            SERVER_STATE.isReady = true;
            
            console.log(`\n🚀 WARPOINT Hub запущен на порту ${PORT}`);
            console.log(`🌍 Окружение: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🕐 Часовой пояс: ${TIMEZONE}`);
            console.log(`📊 Текущее время: ${getTobolskNow().toLocaleString()}`);
            console.log(`\n👤 Директор по умолчанию: Денис / denis_1`);
            console.log(`\n✨ Готов к работе!\n`);
        });
        
        // Настройка keep-alive
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;
        
        // Обработчики сигналов
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
        
        // Обработчики ошибок
        process.on('uncaughtException', (err) => {
            console.error('❌ UNCAUGHT EXCEPTION:', err.message);
            if (err.message.includes('EADDRINUSE')) {
                console.error(`\n❌ Порт ${PORT} уже занят!\n`);
                process.exit(1);
            }
        });
        
        process.on('unhandledRejection', (reason) => {
            console.error('❌ UNHANDLED REJECTION:', reason);
        });
        
        // 🔥 ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА ДИРЕКТОРА (через 3 секунды)
        setTimeout(async () => {
            try {
                console.log('🔍 Проверка директора...');
                const check = await query("SELECT id FROM employees WHERE name = 'Денис'");
                
                if (check.rows.length === 0) {
                    console.log('⚠️ Директор не найден, создаём...');
                    await createDefaultDirector();
                } else {
                    console.log('✅ Директор в порядке');
                    
                    // Проверяем пароль
                    const passCheck = await query("SELECT username FROM passwords WHERE username = 'Денис'");
                    if (passCheck.rows.length === 0) {
                        const hashedPassword = await hashPassword('denis_1');
                        await query("INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)", [hashedPassword]);
                        console.log('   ✅ Пароль создан');
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка проверки:', err.message);
            }
        }, 3000);
        
        // Мониторинг памяти
        setInterval(() => {
            const mem = process.memoryUsage();
            console.log(`📊 Память: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`);
        }, 60000);
        
        // Первое обновление погоды
        setTimeout(() => {
            updateWeatherJob().catch(err => console.error('❌ Погода:', err.message));
        }, 5000);
        
    } catch (err) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

// ============================================
// 39. ЭКСПОРТ И ЗАПУСК
// ============================================

// Запускаем сервер
startServer().catch(err => {
    console.error('❌ Ошибка запуска:', err);
    process.exit(1);
});

// Экспорт для тестирования
module.exports = { app, startServer, gracefulShutdown };

console.log('✅ ЧАСТЬ 7/8 загружена');
