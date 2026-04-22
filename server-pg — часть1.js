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
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
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
            INSERT INTO system_settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO NOTHING
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

