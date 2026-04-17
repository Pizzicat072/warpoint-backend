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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || (() => { 
    console.error('⚠️ ВНИМАНИЕ: Используется JWT_SECRET по умолчанию! Настройте .env!'); 
    return 'warpoint-secret-key-2024'; 
})();

// 🔥 ВОТ ЭТУ СТРОКУ ДОБАВЬ:
app.set('trust proxy', 1);

// 🔥 RATE LIMITER ДЛЯ ВХОДА (защита от брутфорса)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком много попыток входа. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 🔥 ОБЩИЙ RATE LIMITER ДЛЯ API
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 100, // 100 запросов
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================
// ОБРАБОТКА НЕОБРАБОТАННЫХ ОШИБОК
// ============================================

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
});

// ============================================
// POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5, // 🔥 Увеличено с 3 до 5
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
    allowExitOnIdle: true
});

pool.on('error', (err) => console.error('❌ Database pool error:', err.message));

setInterval(() => {
    console.log(`📊 Пул БД: всего=${pool.totalCount}, свободных=${pool.idleCount}, ожидают=${pool.waitingCount}`);
}, 120000);

// ============================================
// PUSHER CONFIG
// ============================================

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true,
    maxRetries: 3,
    retryDelay: 5000
});

app.set('pusher', pusher);

// ============================================
// WEATHER PARSING
// ============================================

const { fetchWeather, getLastWeather } = require('./parsing-weather.js');
let lastWeatherData = null;

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🔥 Применяем rate limiter ко всем API-запросам
app.use('/api/', apiLimiter);

app.use((req, res, next) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            console.error(`⚠️ Request timeout: ${req.method} ${req.url}`);
            res.status(503).json({ error: 'Server timeout' });
        }
    }, 15000);
    
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    
    next();
});

const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getTobolskNow() {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
}

function formatDateToYMD(dateStr) {
    if (!dateStr) return null;
    if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }
    const parts = dateStr.split('T');
    return parts[0];
}

function transliterate(name) {
    const ru = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
        'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Е': 'e', 'Ё': 'e',
        'Ж': 'zh', 'З': 'z', 'И': 'i', 'Й': 'y', 'К': 'k', 'Л': 'l', 'М': 'm',
        'Н': 'n', 'О': 'o', 'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'У': 'u',
        'Ф': 'f', 'Х': 'h', 'Ц': 'ts', 'Ч': 'ch', 'Ш': 'sh', 'Щ': 'sch', 'Ъ': '',
        'Ы': 'y', 'Ь': '', 'Э': 'e', 'Ю': 'yu', 'Я': 'ya'
    };
    let result = '';
    for (let i = 0; i < name.length; i++) {
        const char = name[i];
        if (ru[char]) result += ru[char];
        else if (char.match(/[a-zA-Z0-9]/)) result += char.toLowerCase();
    }
    result = result.replace(/[^a-z0-9]/g, '');
    if (result === '' || result.length < 3) {
        const defaultNames = {'Денис':'denis','Андрей':'andrey','Максим':'maxim','Иван':'ivan','Анна':'anna','Катя':'katya','Сергей':'sergey','Алексей':'alexey'};
        result = defaultNames[name] || name.toLowerCase().replace(/[^a-z]/g, '');
    }
    if (result === '') result = 'user';
    return result;
}

// ============================================
// ФУНКЦИЯ ОТПРАВКИ ГЛОБАЛЬНЫХ УВЕДОМЛЕНИЙ
// ============================================

async function sendGlobalNotification(type, data, excludeUser = null) {
    const pusherInstance = app.get('pusher');
    if (!pusherInstance) return;
    
    const notifications = {
        gift_sent: { icon: '🎁', title: 'Новый подарок!', text: `${data.sender} подарил(а) ${data.recipient} ${data.giftName}` },
        task_completed: { icon: '✅', title: 'Задача выполнена!', text: `${data.executor} выполнил(а) задачу «${data.taskName}»` },
        achievement_unlocked: { icon: '🏆', title: 'Новое достижение!', text: `${data.username} получил(а) достижение «${data.achievementName}» (+${data.coins} WP)` },
        new_employee: { icon: '👤', title: 'Новый сотрудник!', text: `${data.name} присоединился(ась) к команде!` },
        exchange_accepted: { icon: '🔄', title: 'Обмен сменами!', text: `${data.from} и ${data.to} обменялись сменами` },
        fine_approved: { icon: '⚠️', title: 'Штраф подтверждён', text: `${data.employee} получил(а) штраф: ${data.reason}` }
    };
    
    const config = notifications[type];
    if (config) {
        const finalData = { type, icon: config.icon, title: config.title, text: config.text, excludeUser, time: Date.now() };
        pusherInstance.trigger('private-warpoint-sync', 'global-notification', finalData);
        try {
            await pool.query(
                `INSERT INTO global_notifications (type, icon, title, text, time) VALUES ($1, $2, $3, $4, $5)`,
                [type, config.icon, config.title, config.text, Date.now()]
            );
        } catch (err) {
            console.error('Ошибка сохранения глобального уведомления:', err);
        }
    }
}

// ============================================
// INIT DATABASE (ПОЛНАЯ С МИГРАЦИЯМИ)
// ============================================

async function initDatabase() {
    const tableQueries = [
        `CREATE TABLE IF NOT EXISTS achievements (id VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT, category VARCHAR(50), required_value INTEGER NOT NULL, coins_reward INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, icon VARCHAR(10) DEFAULT '🏆')`,
        `CREATE TABLE IF NOT EXISTS user_achievements (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE, claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, achievement_id))`,
        `CREATE TABLE IF NOT EXISTS pending_achievements (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE, completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, achievement_id))`,
        `CREATE TABLE IF NOT EXISTS system_settings (id SERIAL PRIMARY KEY, setting_key VARCHAR(100) UNIQUE NOT NULL, setting_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL, avatar VARCHAR(10) DEFAULT '👤', avatar_url TEXT, status VARCHAR(100) DEFAULT '💼 Работаю', coins INTEGER DEFAULT 100, rating INTEGER DEFAULT 0, role VARCHAR(50) DEFAULT 'operator', hours NUMERIC(10,2) DEFAULT 0, birthday DATE, phone VARCHAR(20), last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP, dashboard_style VARCHAR(50) DEFAULT 'glass', bought_styles TEXT DEFAULT '["glass"]', can_edit_vp BOOLEAN DEFAULT FALSE, active_status VARCHAR(100) DEFAULT NULL, last_bonus_claimed_at TIMESTAMP, bonus_streak INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS passwords (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, room VARCHAR(100) NOT NULL, sender VARCHAR(100) NOT NULL, text TEXT NOT NULL, time BIGINT NOT NULL, action_data JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS stickers (id SERIAL PRIMARY KEY, sender VARCHAR(100), employee VARCHAR(100) NOT NULL, gift_id VARCHAR(50) NOT NULL, quantity INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(employee, gift_id, sender))`,
        `CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, author VARCHAR(100) NOT NULL, executor VARCHAR(100), priority VARCHAR(20) DEFAULT 'medium', deadline DATE, progress INTEGER DEFAULT 0, comment TEXT, recurring VARCHAR(20) DEFAULT 'none', status VARCHAR(20) DEFAULT 'in_progress', parent_id INTEGER DEFAULT NULL, is_group_task VARCHAR(20) DEFAULT NULL, group_members JSONB DEFAULT NULL, group_progress JSONB DEFAULT NULL, is_archived BOOLEAN DEFAULT FALSE, penalty_applied BOOLEAN DEFAULT FALSE, completed_at TIMESTAMP DEFAULT NULL, archived_at TIMESTAMP DEFAULT NULL, restored_at TIMESTAMP DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS subtasks (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS task_attachments (id SERIAL PRIMARY KEY, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, filename VARCHAR(255) NOT NULL, file_data TEXT, file_size INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS fines (id SERIAL PRIMARY KEY, date DATE NOT NULL, employee VARCHAR(100) NOT NULL, type VARCHAR(50) DEFAULT 'other', amount INTEGER DEFAULT 0, coins INTEGER DEFAULT 0, rating INTEGER DEFAULT 0, description TEXT, status VARCHAR(30) DEFAULT 'pending', created_by VARCHAR(100), manager_comment TEXT, director_comment TEXT, director_decision VARCHAR(20), appeal_reason TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS fine_attachments (id SERIAL PRIMARY KEY, fine_id INTEGER REFERENCES fines(id) ON DELETE CASCADE, filename VARCHAR(255) NOT NULL, file_data TEXT, file_size INTEGER, type VARCHAR(20) DEFAULT 'evidence', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS schedule (id SERIAL PRIMARY KEY, date DATE NOT NULL, employee VARCHAR(100) NOT NULL, shift_time VARCHAR(10), shift_status VARCHAR(30) DEFAULT 'working', version INTEGER DEFAULT 1, is_special BOOLEAN DEFAULT FALSE, special_end_time VARCHAR(100), shift_paid BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(date, employee))`,
        `CREATE TABLE IF NOT EXISTS schedule_special_cases (id SERIAL PRIMARY KEY, date DATE NOT NULL UNIQUE, cases JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS exchange_requests (id SERIAL PRIMARY KEY, from_employee VARCHAR(100) NOT NULL, to_employee VARCHAR(100) NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL, from_shift_time VARCHAR(10), to_shift_time VARCHAR(10), status VARCHAR(20) DEFAULT 'pending', comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS vp_bookings (id SERIAL PRIMARY KEY, admin VARCHAR(50) NOT NULL, event_date DATE NOT NULL, event_time TIME NOT NULL, customer_name VARCHAR(255) NOT NULL, amount INTEGER DEFAULT 2000, payment_type VARCHAR(30) DEFAULT 'evotor_card', booking_date DATE NOT NULL, photo_status VARCHAR(20) DEFAULT 'pending', script_status VARCHAR(20) DEFAULT 'not_sent', cancelled BOOLEAN DEFAULT FALSE, cancelled_at TIMESTAMP, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, comment TEXT, is_archived BOOLEAN DEFAULT FALSE, duration INTEGER DEFAULT 1)`,
        `CREATE TABLE IF NOT EXISTS salary_daily_new (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, day_number INTEGER NOT NULL, month_year VARCHAR(7) NOT NULL, oklad INTEGER DEFAULT 0, event INTEGER DEFAULT 0, turnover INTEGER DEFAULT 0, bonus35 INTEGER DEFAULT 0, video INTEGER DEFAULT 0, extra_motivation INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(employee_id, day_number, month_year))`,
        `CREATE TABLE IF NOT EXISTS corporate_fund (id SERIAL PRIMARY KEY, amount INTEGER DEFAULT 0, period_type VARCHAR(20) DEFAULT 'all', period_start DATE, period_end DATE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS knowledge_categories (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, icon VARCHAR(10) DEFAULT '📁', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS knowledge_articles (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES knowledge_categories(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, content TEXT, views INTEGER DEFAULT 0, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS knowledge_views (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, article_id INTEGER REFERENCES knowledge_articles(id) ON DELETE CASCADE, viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, article_id))`,
        `CREATE TABLE IF NOT EXISTS user_statuses (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, status_id VARCHAR(50) NOT NULL, status_name VARCHAR(100) NOT NULL, status_icon VARCHAR(10) NOT NULL, price INTEGER DEFAULT 0, rating INTEGER DEFAULT 0, description TEXT, purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_active BOOLEAN DEFAULT FALSE, UNIQUE(employee_id, status_id))`,
        `CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, type VARCHAR(50) NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER DEFAULT 0, balance_after INTEGER DEFAULT 0, reference_id INTEGER, comment TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS daily_bonus_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, streak_day INTEGER NOT NULL, amount INTEGER NOT NULL, claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS shift_earnings (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, date DATE NOT NULL, hours_worked NUMERIC(5,2) NOT NULL, wp_earned INTEGER NOT NULL, paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, date))`,
        `CREATE TABLE IF NOT EXISTS global_notifications (id SERIAL PRIMARY KEY, type VARCHAR(50), icon VARCHAR(10), title VARCHAR(255), text TEXT, time BIGINT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        // 🔥 НОВАЯ ТАБЛИЦА: история изменений профиля
        `CREATE TABLE IF NOT EXISTS profile_history (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE, changed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL, field_name VARCHAR(50) NOT NULL, old_value TEXT, new_value TEXT, changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];
    
    for (const query of tableQueries) {
        try { await pool.query(query); } catch (err) { console.error('Error creating table:', err.message); }
    }
    
    try {
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_executor_status ON tasks(executor, status)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_fines_employee_date ON fines(employee, date DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_views_user ON knowledge_views(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)`); // 🔥 ДОБАВЛЕНО
     await pool.query(`CREATE INDEX IF NOT EXISTS idx_vp_event_date ON vp_bookings(event_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vp_is_archived ON vp_bookings(is_archived) WHERE is_archived = FALSE`);
    
} catch (err) {}
    
    // Миграции
    try {
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS penalty_applied BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE schedule ADD COLUMN IF NOT EXISTS shift_paid BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE exchange_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE vp_bookings ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
await pool.query(`ALTER TABLE vp_bookings ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS bonus_streak INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_bonus_claimed_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_before INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_after INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_id INTEGER DEFAULT NULL`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT NULL`);
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_status VARCHAR(100) DEFAULT NULL`);
        await pool.query(`ALTER TABLE salary_daily_new ADD COLUMN IF NOT EXISTS extra_motivation INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS icon VARCHAR(10) DEFAULT '🏆'`);
        // 🔥 ИСПРАВЛЕНО: меняем тип hours на NUMERIC для точности
        await pool.query(`ALTER TABLE employees ALTER COLUMN hours TYPE NUMERIC(10,2)`);
    } catch (err) {
        console.log('⚠️ Ошибка миграции:', err.message);
    }
    
    console.log('✅ Миграции: добавлены все недостающие колонки');
    
    // 🔥 ИСПРАВЛЕНО: хешируем пароль директора
    try {
        const directorCheck = await pool.query('SELECT * FROM employees WHERE role = $1 LIMIT 1', ['director']);
        if (directorCheck.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('denis_1', 10);
            await pool.query(
                `INSERT INTO employees (name, avatar, coins, rating, role, birthday, phone, dashboard_style, bought_styles, bonus_streak) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                ['Денис', '👑', 100, 0, 'director', '', '', 'glass', '["glass"]', 1]
            );
            await pool.query('INSERT INTO passwords (username, password_hash) VALUES ($1, $2)', ['Денис', hashedPassword]);
            console.log('✅ Директор Денис создан');
        }
    } catch (err) {
        console.error('❌ Ошибка создания директора:', err);
    }
    
    try { 
        const fundCheck = await pool.query('SELECT id FROM corporate_fund LIMIT 1'); 
        if (fundCheck.rows.length === 0) { 
            await pool.query('INSERT INTO corporate_fund (amount) VALUES (0)'); 
        } 
    } catch (err) {}
    
    try { 
        await pool.query(`UPDATE employees SET bonus_streak = 1 WHERE bonus_streak IS NULL`); 
    } catch (err) {}
    
    console.log('✅ Database initialized');
}

// ============================================
// INIT ACHIEVEMENTS (без изменений, та же функция)
// ============================================

async function initAchievements() {
    const achievements = [
        ...Array.from({ length: 42 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
            const coins = [50,30,30,30,50,30,50,30,30,100,60,60,60,60,100,80,100,80,100,80,150,120,150,120,180,200,150,200,250,300,400,500,600,700,800,900,1000,1200,1500,2000,2500,3000];
            return { id: `shift_${milestones[i]}`, name: milestones[i] === 1 ? '🥇 Первая смена' : `📅 ${milestones[i]} смен`, description: `Отработать ${milestones[i]} смен`, category: 'work', required_value: milestones[i], coins_reward: coins[i], sort_order: 100 + i };
        }),
        ...Array.from({ length: 29 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,60,70,80,90,100,150,200,250,300,400,500];
            const coins = [30,20,20,20,30,20,30,20,20,50,40,60,50,80,60,80,60,100,100,120,120,150,200,250,300,350,400,500,600];
            return { id: `task_${milestones[i]}`, name: milestones[i] === 1 ? '✅ Первая задача' : `📋 ${milestones[i]} задач`, description: `Выполнить ${milestones[i]} задач`, category: 'tasks', required_value: milestones[i], coins_reward: coins[i], sort_order: 200 + i };
        }),
        ...Array.from({ length: 24 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50,60,70,80,90,100,120,150,200];
            const coins = [20,15,15,15,20,15,20,15,15,30,25,40,30,50,60,80,80,100,100,120,150,180,200,250];
            return { id: `gift_${milestones[i]}`, name: milestones[i] === 1 ? '🎁 Первый подарок' : `🎁 ${milestones[i]} подарков`, description: `Отправить ${milestones[i]} подарков`, category: 'gifts', required_value: milestones[i], coins_reward: coins[i], sort_order: 300 + i };
        }),
        ...Array.from({ length: 26 }, (_, i) => {
            const milestones = [10,20,30,40,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
            const coins = [30,20,20,20,30,20,30,20,20,50,40,40,40,40,60,50,80,70,100,90,120,150,180,200,250,300];
            return { id: `rating_${milestones[i]}`, name: milestones[i] === 10 ? '⭐ Начинающий' : `⭐ ${milestones[i]} рейтинга`, description: `Достичь ${milestones[i]} рейтинга`, category: 'rating', required_value: milestones[i], coins_reward: coins[i], sort_order: 400 + i };
        }),
        ...Array.from({ length: 19 }, (_, i) => {
            const milestones = [3,5,7,10,14,21,30,40,50,60,70,80,90,100,150,200,250,300,365];
            const coins = [30,50,80,100,150,200,300,350,400,450,500,550,600,700,900,1200,1500,2000,3000];
            return { id: `streak_${milestones[i]}`, name: milestones[i] === 365 ? '📅 Год в системе' : `🔥 ${milestones[i]} дней подряд`, description: `Входить в систему ${milestones[i]} дней подряд`, category: 'streak', required_value: milestones[i], coins_reward: coins[i], sort_order: 500 + i };
        }),
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [50,40,40,40,50,40,50,40,40,60,80,100,120,150,200,250];
            return { id: `exchange_${milestones[i]}`, name: milestones[i] === 1 ? '🔄 Первый обмен' : `🔄 ${milestones[i]} обменов`, description: `Успешно обменяться ${milestones[i]} раз`, category: 'exchange', required_value: milestones[i], coins_reward: coins[i], sort_order: 600 + i };
        }),
        ...Array.from({ length: 15 }, (_, i) => {
            const milestones = [1,5,10,20,30,50,75,100,150,200,300,400,500,750,1000];
            const coins = [15,30,40,50,60,80,100,120,150,180,200,250,300,400,500];
            return { id: `chat_${milestones[i]}`, name: milestones[i] === 1 ? '💬 Первое сообщение' : `💬 ${milestones[i]} сообщений`, description: `Написать ${milestones[i]} сообщений в чате`, category: 'chat', required_value: milestones[i], coins_reward: coins[i], sort_order: 700 + i };
        }),
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [20,15,15,15,20,15,20,15,15,30,40,50,60,80,100,120];
            return { id: `shop_${milestones[i]}`, name: milestones[i] === 1 ? '🛒 Первая покупка' : `🛒 ${milestones[i]} покупок`, description: `Купить ${milestones[i]} предметов в магазине`, category: 'shop', required_value: milestones[i], coins_reward: coins[i], sort_order: 800 + i };
        }),
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [15,10,10,10,15,10,15,10,10,20,25,30,35,40,50,60];
            return { id: `knowledge_${milestones[i]}`, name: milestones[i] === 1 ? '📚 Первая статья' : `📚 ${milestones[i]} статей`, description: `Прочитать ${milestones[i]} статей в базе знаний`, category: 'knowledge', required_value: milestones[i], coins_reward: coins[i], sort_order: 900 + i };
        }),
        { id: 'first_login', name: '🎉 Добро пожаловать', description: 'Первый вход в систему', category: 'special', required_value: 1, coins_reward: 50, sort_order: 1001 },
        { id: 'set_avatar', name: '🖼️ Свой стиль', description: 'Установить аватар', category: 'special', required_value: 1, coins_reward: 50, sort_order: 1002 },
        { id: 'complete_profile', name: '📝 Полный профиль', description: 'Заполнить весь профиль', category: 'special', required_value: 1, coins_reward: 100, sort_order: 1003 },
        { id: 'bonus_7', name: '🔥 Неделя бонусов', description: 'Получить бонус 7 дней подряд', category: 'special', required_value: 7, coins_reward: 100, sort_order: 1004 },
        { id: 'bonus_30', name: '🔥 Месяц бонусов', description: 'Получить бонус 30 дней подряд', category: 'special', required_value: 30, coins_reward: 400, sort_order: 1005 },
        { id: 'first_task_completed', name: '🎯 Первая выполненная задача', description: 'Выполнить первую задачу', category: 'special', required_value: 1, coins_reward: 30, sort_order: 1006 },
        { id: 'first_gift_sent', name: '🎁 Первый подарок', description: 'Отправить первый подарок', category: 'special', required_value: 1, coins_reward: 25, sort_order: 1007 },
        { id: 'first_exchange', name: '🔄 Первый обмен', description: 'Успешно обменяться сменами', category: 'special', required_value: 1, coins_reward: 40, sort_order: 1008 },
        { id: 'first_shop_purchase', name: '🛍️ Первая покупка', description: 'Купить первый предмет в магазине', category: 'special', required_value: 1, coins_reward: 20, sort_order: 1009 },
        { id: 'first_knowledge', name: '📖 Первое знание', description: 'Прочитать первую статью', category: 'special', required_value: 1, coins_reward: 15, sort_order: 1010 },
        { id: 'all_avatars', name: '👤 Коллекционер аватаров', description: 'Собрать 5 разных аватаров', category: 'special', required_value: 5, coins_reward: 300, sort_order: 1011 },
        { id: 'all_statuses', name: '🏷️ Коллекционер статусов', description: 'Купить 5 разных статусов', category: 'special', required_value: 5, coins_reward: 500, sort_order: 1012 },
        { id: 'all_styles', name: '🎨 Коллекционер стилей', description: 'Купить 5 разных стилей дашборда', category: 'special', required_value: 5, coins_reward: 1000, sort_order: 1013 },
        { id: 'rich_1000', name: '💰 Капиталист', description: 'Накопить 1000 WP', category: 'special', required_value: 1000, coins_reward: 200, sort_order: 1014 },
        { id: 'warpoint_legend', name: '🏆 Легенда WARPOINT', description: 'Выполнить 100 достижений', category: 'special', required_value: 100, coins_reward: 5000, sort_order: 1015 }
    ];
    
    for (const ach of achievements) {
        await pool.query(
            `INSERT INTO achievements (id, name, description, category, required_value, coins_reward, sort_order) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (id) DO UPDATE SET 
                name = EXCLUDED.name, 
                description = EXCLUDED.description, 
                category = EXCLUDED.category, 
                required_value = EXCLUDED.required_value, 
                coins_reward = EXCLUDED.coins_reward, 
                sort_order = EXCLUDED.sort_order`,
            [ach.id, ach.name, ach.description, ach.category, ach.required_value, ach.coins_reward, ach.sort_order]
        );
    }
    console.log(`✅ Инициализировано ${achievements.length} достижений`);
}
// ============================================
// ЛОГИРОВАНИЕ ТРАНЗАКЦИЙ
// ============================================

async function logTransaction(userId, type, amount, balanceBefore, balanceAfter, referenceId = null, comment = null) {
    if (!userId) return;
    try {
        await pool.query(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference_id, comment) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, type, amount, balanceBefore, balanceAfter, referenceId, comment]
        );
    } catch (err) {
        console.error('Error logging transaction:', err);
    }
}

// 🔥 НОВОЕ: ЛОГИРОВАНИЕ ИЗМЕНЕНИЙ ПРОФИЛЯ
async function logProfileChange(userId, changedBy, fieldName, oldValue, newValue) {
    if (!userId) return;
    try {
        await pool.query(
            `INSERT INTO profile_history (user_id, changed_by, field_name, old_value, new_value) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, changedBy, fieldName, oldValue, newValue]
        );
    } catch (err) {
        console.error('Error logging profile change:', err);
    }
}

// ============================================
// ПРОВЕРКА ПРОСРОЧЕННЫХ ЗАДАЧ
// ============================================

async function checkAndPenalizeOverdueTasks() {
    const today = new Date().toISOString().split('T')[0];
    const overdueTasks = await pool.query(
        `SELECT id, name, author, executor, priority, is_group_task, group_members, penalty_applied 
         FROM tasks 
         WHERE deadline < $1 
           AND status != 'completed' 
           AND status != 'failed' 
           AND (penalty_applied IS NULL OR penalty_applied = false)`,
        [today]
    );
    
    let createdCount = 0;
    for (const task of overdueTasks.rows) {
        let executors = [];
        if (task.is_group_task === 'operators') { 
            const operators = await pool.query(`SELECT name FROM employees WHERE role = 'operator'`); 
            executors = operators.rows.map(row => row.name); 
        } else if (task.is_group_task === 'admins') { 
            const admins = await pool.query(`SELECT name FROM employees WHERE role = 'admin'`); 
            executors = admins.rows.map(row => row.name); 
        } else if (task.group_members && Array.isArray(task.group_members)) { 
            executors = task.group_members.map(m => m.name); 
        } else if (task.executor) { 
            executors = [task.executor]; 
        }
        
        const description = `📋 Просрочена задача: "${task.name}"\n📅 Дедлайн: ${task.deadline || 'не указан'}\n👤 Постановщик: ${task.author}`;
        
        for (const executor of executors) {
            await pool.query(
                `INSERT INTO fines (date, employee, type, description, status, created_by, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
                [today, executor, 'task_overdue', description, 'pending', '🤖 Система']
            );
            createdCount++;
        }
        await pool.query(`UPDATE tasks SET penalty_applied = true, status = 'overdue' WHERE id = $1`, [task.id]);
    }
    return createdCount;
}

// ============================================
// НАЧИСЛЕНИЕ WP ЗА СМЕНЫ (ИСПРАВЛЕНО)
// ============================================

async function processShiftEarnings() {
    console.log('💰 Начисление WP за отработанные смены...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const shifts = await client.query(
            `SELECT s.employee, s.shift_time, s.is_special, s.special_end_time, e.id as user_id, e.coins as current_coins 
             FROM schedule s 
             JOIN employees e ON e.name = s.employee 
             WHERE s.date = $1::date AND s.shift_time IS NOT NULL 
             AND (s.shift_status IS NULL OR s.shift_status = 'working') 
             AND (s.shift_paid IS NULL OR s.shift_paid = false)`,
            [yesterdayStr]
        );
        
        let totalPaid = 0;
        for (const shift of shifts.rows) {
            const [startHour] = shift.shift_time.split(':').map(Number);
            let endHour = 22;
            if (shift.is_special && shift.special_end_time && !shift.special_end_time.startsWith('exchange_')) {
                endHour = parseInt(shift.special_end_time.split(':')[0]);
            }
            let hoursWorked = Math.max(0, endHour - startHour);
            const wpEarned = Math.floor(hoursWorked * 2);
            
            if (wpEarned > 0) {
                const balanceBefore = shift.current_coins;
                const balanceAfter = balanceBefore + wpEarned;
                
                await client.query(`UPDATE employees SET coins = coins + $1 WHERE id = $2`, [wpEarned, shift.user_id]);
                
                // 🔥 ИСПРАВЛЕНО: обновляем часы сотрудника
                await client.query(`UPDATE employees SET hours = hours + $1 WHERE id = $2`, [hoursWorked, shift.user_id]);
                
                await client.query(`UPDATE schedule SET shift_paid = true WHERE date = $1::date AND employee = $2`, [yesterdayStr, shift.employee]);
                await client.query(
                    `INSERT INTO shift_earnings (user_id, date, hours_worked, wp_earned) VALUES ($1, $2, $3, $4) 
                     ON CONFLICT (user_id, date) DO UPDATE SET hours_worked = EXCLUDED.hours_worked, wp_earned = EXCLUDED.wp_earned`,
                    [shift.user_id, yesterdayStr, hoursWorked, wpEarned]
                );
                await logTransaction(shift.user_id, 'shift_earn', wpEarned, balanceBefore, balanceAfter, null, `Смена ${shift.shift_time}-${endHour}:00 (${hoursWorked.toFixed(1)} ч)`);
                await checkAndGrantAchievements(shift.user_id, shift.employee);
                totalPaid += wpEarned;
                console.log(`   💰 ${shift.employee}: +${wpEarned} WP (${hoursWorked.toFixed(1)} ч × 2)`);
            }
        }
        
        await client.query('COMMIT');
        if (totalPaid > 0) console.log(`✅ Начислено ${totalPaid} WP за смены`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка начисления за смены:', err);
    } finally {
        client.release();
    }
}

// ============================================
// ОБНОВЛЕНИЕ СТРИКА ВХОДА
// ============================================

async function updateLoginStreak(userId, username) {
    const now = getTobolskNow();
    const today = now.toISOString().split('T')[0];
    const user = await pool.query('SELECT last_bonus_claimed_at, bonus_streak, coins FROM employees WHERE id = $1', [userId]);
    
    if (user.rows.length === 0) return { claimed: false, streak: 1, bonus: 0 };
    
    const lastClaimed = user.rows[0]?.last_bonus_claimed_at;
    const currentStreak = user.rows[0]?.bonus_streak || 1;
    
    if (lastClaimed && new Date(lastClaimed).toISOString().split('T')[0] === today) {
        return { claimed: false, streak: currentStreak, bonus: 0 };
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const yesterdayClaimed = lastClaimed && new Date(lastClaimed).toISOString().split('T')[0] === yesterdayStr;
    
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let newStreak = yesterdayClaimed ? Math.min(currentStreak + 1, daysInMonth) : 1;
    let wpBonus = newStreak;
    
    const balanceBefore = user.rows[0]?.coins || 0;
    const balanceAfter = balanceBefore + wpBonus;
    
    await pool.query(
        `UPDATE employees SET coins = coins + $1, last_bonus_claimed_at = CURRENT_TIMESTAMP, bonus_streak = $2 WHERE id = $3`,
        [wpBonus, newStreak, userId]
    );
    await pool.query(
        `INSERT INTO daily_bonus_history (user_id, streak_day, amount, claimed_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [userId, newStreak, wpBonus]
    );
    await logTransaction(userId, 'login_streak', wpBonus, balanceBefore, balanceAfter, null, `День ${newStreak} из ${daysInMonth}`);
    
    if (newStreak === daysInMonth) {
        await pool.query(`UPDATE employees SET active_status = '⭐ MVP' WHERE id = $1`, [userId]);
    }
    
    await checkAndGrantAchievements(userId, username);
    return { claimed: true, streak: newStreak, bonus: wpBonus, maxStreak: daysInMonth };
}

// ============================================
// ПОЛУЧЕНИЕ СТАТИСТИКИ ПОЛЬЗОВАТЕЛЯ
// ============================================

async function getUserStats(userId, username) {
    const roleRes = await pool.query('SELECT role FROM employees WHERE id = $1', [userId]);
    const role = roleRes.rows[0]?.role || 'operator';
    const isWorker = role === 'operator' || role === 'admin';
    const isDirector = role === 'director';
    const isManager = role === 'manager';
    
    let shiftsCount = 0, tasksCount = 0, giftsCount = 0, rating = 0, streak = 1, coins = 0;
    let exchangesCount = 0, messagesCount = 0, shopCount = 0, knowledgeCount = 0;
    let avatarsCount = 0, statusesCount = 0, stylesCount = 0, achievementsCount = 0;
    
    const coinsRes = await pool.query('SELECT coins FROM employees WHERE id = $1', [userId]);
    coins = coinsRes.rows[0]?.coins || 0;
    
    const streakRes = await pool.query('SELECT bonus_streak FROM employees WHERE id = $1', [userId]);
    streak = streakRes.rows[0]?.bonus_streak || 1;
    
    if (isWorker) {
        const shiftsRes = await pool.query(
            `SELECT COUNT(*) as count FROM schedule WHERE employee = $1 AND shift_time IS NOT NULL AND (shift_status IS NULL OR shift_status = 'working')`,
            [username]
        );
        shiftsCount = parseInt(shiftsRes.rows[0]?.count) || 0;
    }
    
    if (isDirector || isManager) {
        const tasksRes = await pool.query(`SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND (is_archived IS NULL OR is_archived = false)`);
        tasksCount = parseInt(tasksRes.rows[0]?.count) || 0;
    } else {
        const tasksRes = await pool.query(`SELECT COUNT(*) as count FROM tasks WHERE executor = $1 AND status = 'completed' AND (is_archived IS NULL OR is_archived = false)`, [username]);
        tasksCount = parseInt(tasksRes.rows[0]?.count) || 0;
    }
    
    const ratingRes = await pool.query('SELECT rating FROM employees WHERE id = $1', [userId]);
    rating = ratingRes.rows[0]?.rating || 0;
    
    if (isWorker) {
        const exchangesRes = await pool.query(
            `SELECT COUNT(*) as count FROM exchange_requests WHERE (from_employee = $1 OR to_employee = $1) AND status = 'accepted'`,
            [username]
        );
        exchangesCount = parseInt(exchangesRes.rows[0]?.count) || 0;
    }
    
    const messagesRes = await pool.query(`SELECT COUNT(*) as count FROM messages WHERE sender = $1`, [username]);
    messagesCount = parseInt(messagesRes.rows[0]?.count) || 0;
    
    const shopRes = await pool.query(`SELECT COUNT(*) as count FROM transactions WHERE user_id = $1 AND type = 'shop_purchase'`, [userId]);
    shopCount = parseInt(shopRes.rows[0]?.count) || 0;
    
    const knowledgeRes = await pool.query(`SELECT COUNT(DISTINCT article_id) as count FROM knowledge_views WHERE user_id = $1`, [userId]);
    knowledgeCount = parseInt(knowledgeRes.rows[0]?.count) || 0;
    
    const avatarsRes = await pool.query(`SELECT COUNT(DISTINCT avatar) as count FROM employees WHERE id = $1 AND avatar IS NOT NULL AND avatar != '' AND avatar != '👤'`, [userId]);
    avatarsCount = parseInt(avatarsRes.rows[0]?.count) || 0;
    
    const statusesRes = await pool.query(`SELECT COUNT(*) as count FROM user_statuses WHERE employee_id = $1`, [userId]);
    statusesCount = parseInt(statusesRes.rows[0]?.count) || 0;
    
    const stylesRes = await pool.query(`SELECT bought_styles FROM employees WHERE id = $1`, [userId]);
    if (stylesRes.rows[0]?.bought_styles) {
        try { const styles = JSON.parse(stylesRes.rows[0].bought_styles); stylesCount = Array.isArray(styles) ? styles.length : 0; } catch(e) {}
    }
    
    const achievementsRes = await pool.query(`SELECT COUNT(*) as count FROM user_achievements WHERE user_id = $1`, [userId]);
    achievementsCount = parseInt(achievementsRes.rows[0]?.count) || 0;
    
    const hasAvatar = avatarsCount > 0;
    const hasFullProfile = await checkHasFullProfile(userId);
    
    const boughtStatusesRes = await pool.query(`SELECT status_name FROM user_statuses WHERE employee_id = $1`, [userId]);
    const boughtStatuses = boughtStatusesRes.rows.map(row => row.status_name);
    
    const userAchievementsRes = await pool.query(
        `SELECT a.id, a.name, a.description, a.icon, a.coins_reward 
         FROM user_achievements ua 
         JOIN achievements a ON a.id = ua.achievement_id 
         WHERE ua.user_id = $1 
         ORDER BY ua.claimed_at DESC`,
        [userId]
    );
    const userAchievements = userAchievementsRes.rows;
    
    return { 
        shifts: shiftsCount, 
        tasks: tasksCount, 
        gifts: giftsCount, 
        rating, 
        streak, 
        exchanges: exchangesCount, 
        messages: messagesCount, 
        shop: shopCount, 
        knowledge: knowledgeCount, 
        avatars: avatarsCount, 
        statuses: statusesCount, 
        styles: stylesCount, 
        achievements: achievementsCount, 
        coins, 
        hasAvatar, 
        hasFullProfile, 
        role, 
        isWorker,
        boughtStatuses,
        userAchievements
    };
}

