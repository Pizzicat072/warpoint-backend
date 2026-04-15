const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Убираем жесткий путь к Chrome, пусть puppeteer сам ищет или берет из @sparticuz/chromium
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'warpoint-secret-key-2024';

// ============================================
// POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Важно для Render.com!
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
pool.on('connect', () => console.log('📊 Database connected'));
pool.on('error', (err) => console.error('❌ Database error:', err));

// ============================================
// PUSHER CONFIG
// ============================================

const pusher = new Pusher({
    appId: '2132614',
    key: '91e6eb7093c4b16a3275',
    secret: 'bdb04959199327724ca8',
    cluster: 'ap1',
    useTLS: true
});

app.set('pusher', pusher);

// ============================================
// WEATHER PARSING
// ============================================

const { fetchWeather, getLastWeather } = require('./parsing-weather.js');

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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

function formatDateRussian(dateStr) {
    if (!dateStr) return '—';
    
    let dateString = dateStr;
    if (typeof dateStr !== 'string') {
        if (dateStr instanceof Date) {
            const year = dateStr.getFullYear();
            const month = String(dateStr.getMonth() + 1).padStart(2, '0');
            const day = String(dateStr.getDate()).padStart(2, '0');
            dateString = `${year}-${month}-${day}`;
        } else {
            return '—';
        }
    }
    
    const parts = dateString.split('-');
    if (parts.length !== 3) return '—';
    
    const day = parseInt(parts[2]);
    const month = parseInt(parts[1]);
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${day} ${monthNames[month - 1]}`;
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
        if (ru[char]) {
            result += ru[char];
        } else if (char.match(/[a-zA-Z0-9]/)) {
            result += char.toLowerCase();
        }
    }
    
    result = result.replace(/[^a-z0-9]/g, '');
    
    if (result === '' || result.length < 3) {
        const defaultNames = {
            'Денис': 'denis',
            'Андрей': 'andrey',
            'Максим': 'maxim',
            'Иван': 'ivan',
            'Анна': 'anna',
            'Катя': 'katya',
            'Сергей': 'sergey',
            'Алексей': 'alexey'
        };
        result = defaultNames[name] || name.toLowerCase().replace(/[^a-z]/g, '');
    }
    
    if (result === '') result = 'user';
    return result;
}

const femaleNames = ['Анна', 'Катя', 'Екатерина', 'Ольга', 'Мария', 'Елена', 'Татьяна', 'Наталья', 'Ирина', 'Светлана', 'Виктория', 'Юлия', 'Анастасия', 'Дарья', 'Алина', 'Ксения', 'Полина', 'Валерия', 'Евгения'];

// ============================================
// ФУНКЦИЯ ОТПРАВКИ ГЛОБАЛЬНЫХ УВЕДОМЛЕНИЙ
// ============================================

async function sendGlobalNotification(type, data, excludeUser = null) {
    const pusherInstance = app.get('pusher');
    if (!pusherInstance) return;
    
    const notifications = {
        gift_sent: {
            icon: '🎁',
            title: 'Новый подарок!',
            text: `${data.sender} подарил(а) ${data.recipient} ${data.giftName}`
        },
        task_completed: {
            icon: '✅',
            title: 'Задача выполнена!',
            text: `${data.executor} выполнил(а) задачу «${data.taskName}»`
        },
        achievement_unlocked: {
            icon: '🏆',
            title: 'Новое достижение!',
            text: `${data.username} получил(а) достижение «${data.achievementName}» (+${data.coins} WP)`
        },
        new_employee: {
            icon: '👤',
            title: 'Новый сотрудник!',
            text: `${data.name} присоединился(ась) к команде!`
        },
        exchange_accepted: {
            icon: '🔄',
            title: 'Обмен сменами!',
            text: `${data.from} и ${data.to} обменялись сменами`
        },
        fine_approved: {
            icon: '⚠️',
            title: 'Штраф подтверждён',
            text: `${data.employee} получил(а) штраф: ${data.reason}`
        }
    };
    
    const config = notifications[type];
    if (config) {
        const finalData = {
            type: type,
            icon: config.icon,
            title: config.title,
            text: config.text,
            excludeUser: excludeUser,
            time: Date.now()
        };
        
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
// INIT DATABASE
// ============================================

async function initDatabase() {
    const tableQueries = [
        `CREATE TABLE IF NOT EXISTS achievements (
            id VARCHAR(100) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            category VARCHAR(50),
            required_value INTEGER NOT NULL,
            coins_reward INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS user_achievements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, achievement_id)
        )`,
        `CREATE TABLE IF NOT EXISTS pending_achievements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            achievement_id VARCHAR(100) REFERENCES achievements(id) ON DELETE CASCADE,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, achievement_id)
        )`,
        `CREATE TABLE IF NOT EXISTS system_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            avatar VARCHAR(10) DEFAULT '👤',
            avatar_url TEXT,
            status VARCHAR(100) DEFAULT '💼 Работаю',
            coins INTEGER DEFAULT 100,
            rating INTEGER DEFAULT 0,
            role VARCHAR(50) DEFAULT 'operator',
            hours INTEGER DEFAULT 0,
          
            birthday DATE,
            phone VARCHAR(20),
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            dashboard_style VARCHAR(50) DEFAULT 'glass',
            bought_styles TEXT DEFAULT '["glass"]',
            can_edit_vp BOOLEAN DEFAULT FALSE,
            active_status VARCHAR(100) DEFAULT NULL,
            last_bonus_claimed_at TIMESTAMP,
            bonus_streak INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS passwords (
            username VARCHAR(100) PRIMARY KEY,
            password VARCHAR(255) NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            room VARCHAR(100) NOT NULL,
            sender VARCHAR(100) NOT NULL,
            text TEXT NOT NULL,
            time BIGINT NOT NULL,
            action_data JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS stickers (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(100),
            employee VARCHAR(100) NOT NULL,
            gift_id VARCHAR(50) NOT NULL,
            quantity INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee, gift_id)
        )`,
        `CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            author VARCHAR(100) NOT NULL,
            executor VARCHAR(100) NOT NULL,
            priority VARCHAR(20) DEFAULT 'medium',
            deadline DATE,
            progress INTEGER DEFAULT 0,
            comment TEXT,
            recurring VARCHAR(20) DEFAULT 'none',
            status VARCHAR(20) DEFAULT 'in_progress',
            parent_id INTEGER DEFAULT NULL,
            is_group_task VARCHAR(20) DEFAULT NULL,
            group_members JSONB DEFAULT NULL,
            group_progress JSONB DEFAULT NULL,
            is_archived BOOLEAN DEFAULT FALSE,
            penalty_applied BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP DEFAULT NULL,
            archived_at TIMESTAMP DEFAULT NULL,
            restored_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS subtasks (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            completed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS task_attachments (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            file_data TEXT,
            file_size INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS fines (
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
            manager_comment TEXT,
            director_comment TEXT,
            director_decision VARCHAR(20),
            appeal_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS fine_attachments (
            id SERIAL PRIMARY KEY,
            fine_id INTEGER REFERENCES fines(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            file_data TEXT,
            file_size INTEGER,
            type VARCHAR(20) DEFAULT 'evidence',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS schedule (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            shift_time VARCHAR(10),
            shift_status VARCHAR(30) DEFAULT 'working',
            version INTEGER DEFAULT 1,
            is_special BOOLEAN DEFAULT FALSE,
            special_end_time VARCHAR(100),
            shift_paid BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(date, employee)
        )`,
        `CREATE TABLE IF NOT EXISTS schedule_special_cases (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            cases JSONB DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS exchange_requests (
            id SERIAL PRIMARY KEY,
            from_employee VARCHAR(100) NOT NULL,
            to_employee VARCHAR(100) NOT NULL,
            from_date DATE NOT NULL,
            to_date DATE NOT NULL,
            from_shift_time VARCHAR(10),
            to_shift_time VARCHAR(10),
            status VARCHAR(20) DEFAULT 'pending',
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS vp_bookings (
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
            cancelled BOOLEAN DEFAULT FALSE,
            cancelled_at TIMESTAMP,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            comment TEXT,
            is_archived BOOLEAN DEFAULT FALSE
        )`,
        `CREATE TABLE IF NOT EXISTS salary_daily_new (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            day_number INTEGER NOT NULL,
            month_year VARCHAR(7) NOT NULL,
            oklad INTEGER DEFAULT 0,
            event INTEGER DEFAULT 0,
            turnover INTEGER DEFAULT 0,
            bonus35 INTEGER DEFAULT 0,
            video INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, day_number, month_year)
        )`,
        `CREATE TABLE IF NOT EXISTS corporate_fund (
            id SERIAL PRIMARY KEY,
            amount INTEGER DEFAULT 0,
            period_type VARCHAR(20) DEFAULT 'all',
            period_start DATE,
            period_end DATE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS knowledge_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            icon VARCHAR(10) DEFAULT '📁',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS knowledge_articles (
            id SERIAL PRIMARY KEY,
            category_id INTEGER REFERENCES knowledge_categories(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            content TEXT,
            views INTEGER DEFAULT 0,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS knowledge_views (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            article_id INTEGER REFERENCES knowledge_articles(id) ON DELETE CASCADE,
            viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, article_id)
        )`,
        `CREATE TABLE IF NOT EXISTS user_statuses (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            status_id VARCHAR(50) NOT NULL,
            status_name VARCHAR(100) NOT NULL,
            status_icon VARCHAR(10) NOT NULL,
            price INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            description TEXT,
            purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT FALSE,
            UNIQUE(employee_id, status_id)
        )`,
        `CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            amount INTEGER NOT NULL,
            balance_before INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reference_id INTEGER,
            comment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS daily_bonus_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            streak_day INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS shift_earnings (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            hours_worked NUMERIC(5,2) NOT NULL,
            wp_earned INTEGER NOT NULL,
            paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date)
        )`,
        `CREATE TABLE IF NOT EXISTS global_notifications (
            id SERIAL PRIMARY KEY,
            type VARCHAR(50),
            icon VARCHAR(10),
            title VARCHAR(255),
            text TEXT,
            time BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    // 🔥 Добавляем недостающие колонки (миграция)
    try {
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS penalty_applied BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
        console.log('✅ Миграция: добавлены недостающие колонки');
    } catch (err) {
        console.log('⚠️ Ошибка миграции:', err.message);
    }
}
    for (const query of tableQueries) {
        try {
            await pool.query(query);
        } catch (err) {
            console.error('Error creating table:', err.message);
        }
    }
    
    // Индексы для производительности
    try {
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room, time DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_executor_status ON tasks(executor, status)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_fines_employee_date ON fines(employee, date DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_views_user ON knowledge_views(user_id)`);
    } catch (err) {}
    
    // Создаём директора
    try {
        const directorCheck = await pool.query('SELECT * FROM employees WHERE role = $1 LIMIT 1', ['director']);
        if (directorCheck.rows.length === 0) {
            await pool.query(
    `INSERT INTO employees (name, avatar, coins, rating, role, birthday, phone, dashboard_style, bought_styles, bonus_streak) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, 
    ['Денис', '👑', 100, 0, 'director', '', '', 'glass', '["glass"]', 1]
);
            await pool.query('INSERT INTO passwords (username, password) VALUES ($1, $2)', ['Денис', 'denis_1']);
            console.log('✅ Директор Денис создан');
        }
    } catch (err) {}
    
    // Корпоративный фонд
    try {
        const fundCheck = await pool.query('SELECT id FROM corporate_fund LIMIT 1');
        if (fundCheck.rows.length === 0) {
            await pool.query('INSERT INTO corporate_fund (amount) VALUES (0)');
        }
    } catch (err) {}
    
    // Обновляем существующих сотрудников
    try {
        await pool.query(`UPDATE employees SET bonus_streak = 1 WHERE bonus_streak IS NULL`);
    } catch (err) {}
    
    console.log('✅ Database initialized');
}
// ============================================
// INIT ACHIEVEMENTS - ПОЛНЫЙ СПИСОК
// ============================================

async function initAchievements() {
    const achievements = [
        // БЛОК 1: РАБОТА И СМЕНЫ (work) - 42 достижения
        ...Array.from({ length: 42 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,12,14,16,18,20,25,30,35,40,45,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
            const coins = [50,30,30,30,50,30,50,30,30,100,60,60,60,60,100,80,100,80,100,80,150,120,150,120,180,200,150,200,250,300,400,500,600,700,800,900,1000,1200,1500,2000,2500,3000];
            return {
                id: `shift_${milestones[i]}`,
                name: milestones[i] === 1 ? '🥇 Первая смена' : `📅 ${milestones[i]} смен`,
                description: `Отработать ${milestones[i]} смен`,
                category: 'work',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 100 + i
            };
        }),
        
        // БЛОК 2: ЗАДАЧИ (tasks) - 29 достижений
        ...Array.from({ length: 29 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,60,70,80,90,100,150,200,250,300,400,500];
            const coins = [30,20,20,20,30,20,30,20,20,50,40,60,50,80,60,80,60,100,100,120,120,150,200,250,300,350,400,500,600];
            return {
                id: `task_${milestones[i]}`,
                name: milestones[i] === 1 ? '✅ Первая задача' : `📋 ${milestones[i]} задач`,
                description: `Выполнить ${milestones[i]} задач`,
                category: 'tasks',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 200 + i
            };
        }),
        
        // БЛОК 3: ПОДАРКИ (gifts) - 24 достижения
        ...Array.from({ length: 24 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50,60,70,80,90,100,120,150,200];
            const coins = [20,15,15,15,20,15,20,15,15,30,25,40,30,50,60,80,80,100,100,120,150,180,200,250];
            return {
                id: `gift_${milestones[i]}`,
                name: milestones[i] === 1 ? '🎁 Первый подарок' : `🎁 ${milestones[i]} подарков`,
                description: `Отправить ${milestones[i]} подарков`,
                category: 'gifts',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 300 + i
            };
        }),
        
        // БЛОК 4: РЕЙТИНГ (rating) - 26 достижений
        ...Array.from({ length: 26 }, (_, i) => {
            const milestones = [10,20,30,40,50,60,70,80,90,100,120,140,160,180,200,250,300,350,400,450,500,600,700,800,900,1000];
            const coins = [30,20,20,20,30,20,30,20,20,50,40,40,40,40,60,50,80,70,100,90,120,150,180,200,250,300];
            return {
                id: `rating_${milestones[i]}`,
                name: milestones[i] === 10 ? '⭐ Начинающий' : `⭐ ${milestones[i]} рейтинга`,
                description: `Достичь ${milestones[i]} рейтинга`,
                category: 'rating',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 400 + i
            };
        }),
        
        // БЛОК 5: ЕЖЕДНЕВНЫЙ ВХОД (streak) - 19 достижений
        ...Array.from({ length: 19 }, (_, i) => {
            const milestones = [3,5,7,10,14,21,30,40,50,60,70,80,90,100,150,200,250,300,365];
            const coins = [30,50,80,100,150,200,300,350,400,450,500,550,600,700,900,1200,1500,2000,3000];
            return {
                id: `streak_${milestones[i]}`,
                name: milestones[i] === 365 ? '📅 Год в системе' : `🔥 ${milestones[i]} дней подряд`,
                description: `Входить в систему ${milestones[i]} дней подряд`,
                category: 'streak',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 500 + i
            };
        }),
        
        // БЛОК 6: ОБМЕН СМЕНАМИ (exchange) - 16 достижений
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [50,40,40,40,50,40,50,40,40,60,80,100,120,150,200,250];
            return {
                id: `exchange_${milestones[i]}`,
                name: milestones[i] === 1 ? '🔄 Первый обмен' : `🔄 ${milestones[i]} обменов`,
                description: `Успешно обменяться ${milestones[i]} раз`,
                category: 'exchange',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 600 + i
            };
        }),
        
        // БЛОК 7: ОБЩЕНИЕ В ЧАТЕ (chat) - 15 достижений
        ...Array.from({ length: 15 }, (_, i) => {
            const milestones = [1,5,10,20,30,50,75,100,150,200,300,400,500,750,1000];
            const coins = [15,30,40,50,60,80,100,120,150,180,200,250,300,400,500];
            return {
                id: `chat_${milestones[i]}`,
                name: milestones[i] === 1 ? '💬 Первое сообщение' : `💬 ${milestones[i]} сообщений`,
                description: `Написать ${milestones[i]} сообщений в чате`,
                category: 'chat',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 700 + i
            };
        }),
        
        // БЛОК 8: ПОКУПКИ В МАГАЗИНЕ (shop) - 16 достижений
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [20,15,15,15,20,15,20,15,15,30,40,50,60,80,100,120];
            return {
                id: `shop_${milestones[i]}`,
                name: milestones[i] === 1 ? '🛒 Первая покупка' : `🛒 ${milestones[i]} покупок`,
                description: `Купить ${milestones[i]} предметов в магазине`,
                category: 'shop',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 800 + i
            };
        }),
        
        // БЛОК 9: БАЗА ЗНАНИЙ (knowledge) - 16 достижений
        ...Array.from({ length: 16 }, (_, i) => {
            const milestones = [1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50];
            const coins = [15,10,10,10,15,10,15,10,10,20,25,30,35,40,50,60];
            return {
                id: `knowledge_${milestones[i]}`,
                name: milestones[i] === 1 ? '📚 Первая статья' : `📚 ${milestones[i]} статей`,
                description: `Прочитать ${milestones[i]} статей в базе знаний`,
                category: 'knowledge',
                required_value: milestones[i],
                coins_reward: coins[i],
                sort_order: 900 + i
            };
        }),
        
        // БЛОК 10: ОСОБЫЕ ДОСТИЖЕНИЯ (special) - 15 достижений
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
// ФУНКЦИЯ ДЛЯ ЛОГИРОВАНИЯ ТРАНЗАКЦИЙ
// ============================================

async function logTransaction(userId, type, amount, balanceBefore, balanceAfter, referenceId = null, comment = null) {
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

// ============================================
// ФУНКЦИЯ ПРОВЕРКИ ПРОСРОЧЕННЫХ ЗАДАЧ
// ============================================

async function checkAndPenalizeOverdueTasks() {
    const today = new Date().toISOString().split('T')[0];
    
    const overdueTasks = await pool.query(`
        SELECT id, name, author, executor, priority, is_group_task, group_members, penalty_applied
        FROM tasks 
        WHERE deadline < $1 
          AND status != 'completed' 
          AND status != 'failed'
          AND (penalty_applied IS NULL OR penalty_applied = false)
    `, [today]);
    
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
            await pool.query(`
                INSERT INTO fines (date, employee, type, description, status, created_by, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            `, [today, executor, 'task_overdue', description, 'pending', '🤖 Система']);
            createdCount++;
        }
        
        await pool.query(`UPDATE tasks SET penalty_applied = true, status = 'overdue' WHERE id = $1`, [task.id]);
    }
    
    return createdCount;
}

// ============================================
// ФУНКЦИЯ НАЧИСЛЕНИЯ WP ЗА СМЕНЫ (2 WP в час)
// ============================================

async function processShiftEarnings() {
    console.log('💰 Начисление WP за отработанные смены...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    try {
        const shifts = await pool.query(`
            SELECT s.employee, s.shift_time, s.is_special, s.special_end_time, 
                   e.id as user_id, e.coins as current_coins
            FROM schedule s
            JOIN employees e ON e.name = s.employee
            WHERE s.date = $1::date 
              AND s.shift_time IS NOT NULL
              AND (s.shift_status IS NULL OR s.shift_status = 'working')
              AND (s.shift_paid IS NULL OR s.shift_paid = false)
        `, [yesterdayStr]);
        
        let totalPaid = 0;
        
        for (const shift of shifts.rows) {
            const [startHour] = shift.shift_time.split(':').map(Number);
            let endHour = 22;
            if (shift.is_special && shift.special_end_time) {
                endHour = parseInt(shift.special_end_time.split(':')[0]);
            }
            let hoursWorked = Math.max(0, endHour - startHour);
            const wpEarned = Math.floor(hoursWorked * 2);
            
            if (wpEarned > 0) {
                const balanceBefore = shift.current_coins;
                const balanceAfter = balanceBefore + wpEarned;
                
                await pool.query(`UPDATE employees SET coins = coins + $1 WHERE id = $2`, [wpEarned, shift.user_id]);
                await pool.query(`UPDATE schedule SET shift_paid = true WHERE date = $1::date AND employee = $2`, [yesterdayStr, shift.employee]);
                await pool.query(`INSERT INTO shift_earnings (user_id, date, hours_worked, wp_earned) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, date) DO UPDATE SET hours_worked = EXCLUDED.hours_worked, wp_earned = EXCLUDED.wp_earned`, [shift.user_id, yesterdayStr, hoursWorked, wpEarned]);
                await logTransaction(shift.user_id, 'shift_earn', wpEarned, balanceBefore, balanceAfter, null, `Смена ${shift.shift_time}-${endHour}:00 (${hoursWorked.toFixed(1)} ч)`);
                
                await checkAndGrantAchievements(shift.user_id, shift.employee);
                
                totalPaid += wpEarned;
                console.log(`   💰 ${shift.employee}: +${wpEarned} WP (${hoursWorked.toFixed(1)} ч × 2)`);
            }
        }
        if (totalPaid > 0) console.log(`✅ Начислено ${totalPaid} WP за смены`);
    } catch (err) {
        console.error('❌ Ошибка начисления за смены:', err);
    }
}

// ============================================
// ФУНКЦИЯ ОБНОВЛЕНИЯ СТРИКА И БОНУСА
// ============================================

async function updateLoginStreak(userId, username) {
    const now = getTobolskNow();
    const today = now.toISOString().split('T')[0];
    const user = await pool.query('SELECT last_bonus_claimed_at, bonus_streak, coins FROM employees WHERE id = $1', [userId]);
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
    await pool.query(`UPDATE employees SET coins = coins + $1, last_bonus_claimed_at = CURRENT_TIMESTAMP, bonus_streak = $2 WHERE id = $3`, [wpBonus, newStreak, userId]);
    await pool.query(`INSERT INTO daily_bonus_history (user_id, streak_day, amount, claimed_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [userId, newStreak, wpBonus]);
    await logTransaction(userId, 'login_streak', wpBonus, balanceBefore, balanceAfter, null, `День ${newStreak} из ${daysInMonth}`);
    if (newStreak === daysInMonth) {
        await pool.query(`UPDATE employees SET active_status = '⭐ MVP' WHERE id = $1`, [userId]);
    }
    
    await checkAndGrantAchievements(userId, username);
    
    return { claimed: true, streak: newStreak, bonus: wpBonus, maxStreak: daysInMonth };
}
// ============================================
// СБОР СТАТИСТИКИ ПОЛЬЗОВАТЕЛЯ (ПОЛНАЯ ВЕРСИЯ)
// ============================================

async function getUserStats(userId, username) {
    console.log(`   📊 Сбор статистики для ${username}...`);
    
    const roleRes = await pool.query('SELECT role FROM employees WHERE id = $1', [userId]);
    const role = roleRes.rows[0]?.role || 'operator';
    const isWorker = role === 'operator' || role === 'admin';
    const isDirector = role === 'director';
    const isManager = role === 'manager';
    
    let shiftsCount = 0, tasksCount = 0, giftsCount = 0, rating = 0, streak = 1, coins = 0;
    let exchangesCount = 0, messagesCount = 0, shopCount = 0, knowledgeCount = 0;
    let avatarsCount = 0, statusesCount = 0, stylesCount = 0, achievementsCount = 0;
    
    // 🔥 Баланс монет
    const coinsRes = await pool.query('SELECT coins FROM employees WHERE id = $1', [userId]);
    coins = coinsRes.rows[0]?.coins || 0;
    
    // Смены
    if (isWorker) {
        const shiftsRes = await pool.query(
            `SELECT COUNT(*) as count FROM schedule 
             WHERE employee = $1 
               AND shift_time IS NOT NULL 
               AND (shift_status IS NULL OR shift_status = 'working')`,
            [username]
        );
        shiftsCount = parseInt(shiftsRes.rows[0]?.count) || 0;
    }
    
    // Задачи
    if (isDirector || isManager) {
        const tasksRes = await pool.query(`SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'`);
        tasksCount = parseInt(tasksRes.rows[0]?.count) || 0;
    } else {
        const tasksRes = await pool.query(
            `SELECT COUNT(*) as count FROM tasks WHERE executor = $1 AND status = 'completed'`,
            [username]
        );
        tasksCount = parseInt(tasksRes.rows[0]?.count) || 0;
    }
    
    // 🔥 Подарки (отправленные) - ВРЕМЕННО 0
    giftsCount = 0;
    
    // Рейтинг
    const ratingRes = await pool.query('SELECT rating FROM employees WHERE id = $1', [userId]);
    rating = ratingRes.rows[0]?.rating || 0;
    
    // Стрик
    const streakRes = await pool.query('SELECT bonus_streak FROM employees WHERE id = $1', [userId]);
    streak = streakRes.rows[0]?.bonus_streak || 1;
    
    // Обмен сменами
    if (isWorker) {
        const exchangesRes = await pool.query(
            `SELECT COUNT(*) as count FROM exchange_requests 
             WHERE (from_employee = $1 OR to_employee = $1) AND status = 'accepted'`,
            [username]
        );
        exchangesCount = parseInt(exchangesRes.rows[0]?.count) || 0;
    }
    
    // Сообщения в чате
    const messagesRes = await pool.query(
        `SELECT COUNT(*) as count FROM messages WHERE sender = $1`,
        [username]
    );
    messagesCount = parseInt(messagesRes.rows[0]?.count) || 0;
    
    // Покупки в магазине
    const shopRes = await pool.query(
        `SELECT COUNT(*) as count FROM transactions WHERE user_id = $1 AND type = 'shop_purchase'`,
        [userId]
    );
    shopCount = parseInt(shopRes.rows[0]?.count) || 0;
    
    // База знаний
    const knowledgeRes = await pool.query(
        `SELECT COUNT(DISTINCT article_id) as count FROM knowledge_views WHERE user_id = $1`,
        [userId]
    );
    knowledgeCount = parseInt(knowledgeRes.rows[0]?.count) || 0;
    
    // Коллекции
    const avatarsRes = await pool.query(
        `SELECT COUNT(DISTINCT avatar) as count FROM employees WHERE id = $1 AND avatar IS NOT NULL AND avatar != '' AND avatar != '👤'`,
        [userId]
    );
    avatarsCount = parseInt(avatarsRes.rows[0]?.count) || 0;
    
    const statusesRes = await pool.query(
        `SELECT COUNT(*) as count FROM user_statuses WHERE employee_id = $1`,
        [userId]
    );
    statusesCount = parseInt(statusesRes.rows[0]?.count) || 0;
    
    const stylesRes = await pool.query(
        `SELECT bought_styles FROM employees WHERE id = $1`,
        [userId]
    );
    if (stylesRes.rows[0]?.bought_styles) {
        try {
            const styles = JSON.parse(stylesRes.rows[0].bought_styles);
            stylesCount = Array.isArray(styles) ? styles.length : 0;
        } catch(e) { stylesCount = 0; }
    }
    
    // Полученные достижения
    const achievementsRes = await pool.query(
        `SELECT COUNT(*) as count FROM user_achievements WHERE user_id = $1`,
        [userId]
    );
    achievementsCount = parseInt(achievementsRes.rows[0]?.count) || 0;
    
    const hasAvatar = avatarsCount > 0;
    const hasFullProfile = await checkHasFullProfile(userId);
    
    console.log(`      📊 ИТОГО: смен=${shiftsCount}, задач=${tasksCount}, подарков=${giftsCount}, рейтинг=${rating}, стрик=${streak}, обменов=${exchangesCount}, сообщ=${messagesCount}, покупок=${shopCount}, статей=${knowledgeCount}, аватаров=${avatarsCount}, статусов=${statusesCount}, стилей=${stylesCount}, достижений=${achievementsCount}, монет=${coins}`);
    
    return {
        shifts: shiftsCount,
        tasks: tasksCount,
        gifts: giftsCount,
        rating: rating,
        streak: streak,
        exchanges: exchangesCount,
        messages: messagesCount,
        shop: shopCount,
        knowledge: knowledgeCount,
        avatars: avatarsCount,
        statuses: statusesCount,
        styles: stylesCount,
        achievements: achievementsCount,
        coins: coins,
        hasAvatar: hasAvatar,
        hasFullProfile: hasFullProfile,
        role: role,
        isWorker: isWorker
    };
}

// ============================================
// ПРОВЕРКА ОСОБЫХ УСЛОВИЙ
// ============================================

async function checkHasAvatar(userId) {
    const res = await pool.query(
        `SELECT avatar, avatar_url FROM employees WHERE id = $1`,
        [userId]
    );
    if (res.rows.length === 0) return false;
    const emp = res.rows[0];
    return (emp.avatar && emp.avatar !== '👤') || (emp.avatar_url && emp.avatar_url.length > 0);
}

async function checkHasFullProfile(userId) {
    const res = await pool.query(
        `SELECT birthday, phone FROM employees WHERE id = $1`,
        [userId]
    );
    if (res.rows.length === 0) return false;
    const emp = res.rows[0];
    return emp.birthday && emp.phone && emp.birthday !== '' && emp.phone !== '';
}

// ============================================
// ПРОВЕРКА УСЛОВИЙ ДОСТИЖЕНИЙ
// ============================================

function checkAchievementCondition(achievement, stats) {
    const category = achievement.category;
    const required = achievement.required_value;
    const id = achievement.id;
    
    // Для смен и обменов - только для работяг
    if ((category === 'work' || category === 'exchange') && !stats.isWorker) {
        return false;
    }
    
    // Особые достижения
    if (category === 'special') {
        if (id === 'first_login') return true;
        if (id === 'set_avatar') return stats.hasAvatar;
        if (id === 'complete_profile') return stats.hasFullProfile;
        if (id === 'bonus_7') return stats.streak >= 7;
        if (id === 'bonus_30') return stats.streak >= 30;
        if (id === 'first_task_completed') return stats.tasks >= 1;
        if (id === 'first_gift_sent') return stats.gifts >= 1;
        if (id === 'first_exchange') return stats.exchanges >= 1;
        if (id === 'first_shop_purchase') return stats.shop >= 1;
        if (id === 'first_knowledge') return stats.knowledge >= 1;
        if (id === 'all_avatars') return stats.avatars >= 5;
        if (id === 'all_statuses') return stats.statuses >= 5;
        if (id === 'all_styles') return stats.styles >= 5;
        if (id === 'rich_1000') return stats.coins >= 1000;
        if (id === 'warpoint_legend') return stats.achievements >= 100;
        return false;
    }
    
    // Обычные достижения - проверяем что статистика НЕ МЕНЬШЕ требуемого
    switch (category) {
        case 'work': return stats.shifts >= required;
        case 'tasks': return stats.tasks >= required;
        case 'gifts': return stats.gifts >= required;
        case 'rating': return stats.rating >= required;
        case 'streak': return stats.streak >= required;
        case 'exchange': return stats.exchanges >= required;
        case 'chat': return stats.messages >= required;
        case 'shop': return stats.shop >= required;
        case 'knowledge': return stats.knowledge >= required;
        default: return false;
    }
}
// ============================================
// ПРОВЕРКА И ВЫДАЧА ДОСТИЖЕНИЙ
// ============================================

async function checkAndGrantAchievements(userId, username) {
    console.log(`\n🏆 ===== ПРОВЕРКА ДОСТИЖЕНИЙ ДЛЯ ${username} (ID: ${userId}) =====`);
    
    try {
        const allAchievements = await pool.query('SELECT * FROM achievements ORDER BY sort_order, id');
        
        const unlocked = await pool.query(
            'SELECT achievement_id FROM user_achievements WHERE user_id = $1',
            [userId]
        );
        const unlockedIds = new Set(unlocked.rows.map(r => r.achievement_id));
        
        const pending = await pool.query(
            'SELECT achievement_id FROM pending_achievements WHERE user_id = $1',
            [userId]
        );
        const pendingIds = new Set(pending.rows.map(r => r.achievement_id));
        
        const stats = await getUserStats(userId, username);
        
        const newAchievements = [];
        let grantedCount = 0;
        
        for (const ach of allAchievements.rows) {
            if (unlockedIds.has(ach.id) || pendingIds.has(ach.id)) continue;
            
            const completed = checkAchievementCondition(ach, stats);
            
            if (completed) {
                await pool.query(
                    `INSERT INTO pending_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [userId, ach.id]
                );
                grantedCount++;
                
                newAchievements.push({
                    id: ach.id,
                    name: ach.name,
                    description: ach.description,
                    coins: ach.coins_reward,
                    category: ach.category
                });
                
                console.log(`   🎁 НОВОЕ: ${ach.name} (+${ach.coins_reward} WP)`);
                
                // 🔥 ОТПРАВЛЯЕМ ТОЛЬКО ОДНО УВЕДОМЛЕНИЕ ЗА РАЗ
                // Убрать множественные вызовы!
            }
        }
        
        // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЯ ТОЛЬКО ПОСЛЕ ЦИКЛА, ОДНИМ СПИСКОМ
        if (newAchievements.length > 0) {
            const pusherInstance = app.get('pusher');
            
            // Глобальное уведомление - одно на все новые достижения
            if (newAchievements.length === 1) {
                const ach = newAchievements[0];
                await sendGlobalNotification('achievement_unlocked', {
                    username: username,
                    achievementName: ach.name,
                    coins: ach.coins
                });
            } else if (newAchievements.length > 1) {
                await sendGlobalNotification('achievement_unlocked', {
                    username: username,
                    achievementName: `${newAchievements.length} достижений`,
                    coins: newAchievements.reduce((sum, a) => sum + a.coins, 0)
                });
            }
            
            // Личное уведомление - одно на все
            if (pusherInstance) {
                pusherInstance.trigger(`private-user-${transliterate(username)}`, 'personal-notification', {
                    type: 'achievement',
                    icon: '🏆',
                    title: 'Новые достижения!',
                    text: `Вы получили ${newAchievements.length} достижений (+${newAchievements.reduce((sum, a) => sum + a.coins, 0)} WP)`,
                    time: Date.now()
                });
            }
        }
        
        console.log(`   ✅ ВЫДАНО: ${grantedCount} новых достижений`);
        console.log(`🏆 ===== ПРОВЕРКА ЗАВЕРШЕНА =====\n`);
        
        return { granted: grantedCount, achievements: newAchievements };
        
    } catch (err) {
        console.error('❌ Ошибка проверки достижений:', err);
        return { granted: 0, achievements: [] };
    }
}
// ============================================
// ОСОБЫЕ СЛУЧАИ В ГРАФИКЕ API
// ============================================

app.get('/api/schedule/special-cases', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT date, cases FROM schedule_special_cases`);
        const data = {};
        result.rows.forEach(row => { data[row.date] = row.cases; });
        res.json({ success: true, data: data });
    } catch (err) {
        res.json({ success: true, data: {} });
    }
});

app.post('/api/schedule/special-cases', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { date, cases } = req.body;
    try {
        await pool.query(`INSERT INTO schedule_special_cases (date, cases, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (date) DO UPDATE SET cases = EXCLUDED.cases, updated_at = CURRENT_TIMESTAMP`, [date, cases]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ОБМЕН СМЕНАМИ API
// ============================================

app.post('/api/exchange/create', authMiddleware, async (req, res) => {
    const { toEmployee, toDate, toShiftTime, fromDate, fromShiftTime, comment } = req.body;
    const fromEmployee = req.user.username;
    if (fromEmployee === toEmployee) {
        return res.status(400).json({ error: 'Нельзя обменяться с самим собой' });
    }
    const fromDateFormatted = formatDateToYMD(fromDate);
    const toDateFormatted = formatDateToYMD(toDate);
    
    const existingRequest = await pool.query(`SELECT id FROM exchange_requests WHERE ((from_employee = $1 AND to_employee = $2) OR (from_employee = $2 AND to_employee = $1)) AND status = 'pending'`, [fromEmployee, toEmployee]);
    if (existingRequest.rows.length > 0) {
        return res.status(400).json({ error: 'Активный запрос на обмен уже существует' });
    }
    
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    const result = await pool.query(`INSERT INTO exchange_requests (from_employee, to_employee, from_date, to_date, from_shift_time, to_shift_time, comment, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [fromEmployee, toEmployee, fromDateFormatted, toDateFormatted, fromShiftTime, toShiftTime, comment, expiresAt]);
    const requestId = result.rows[0].id;
    
    const pusherInstance = app.get('pusher');
    if (pusherInstance) {
        const isFemale = femaleNames.includes(fromEmployee);
        const hisHer = isFemale ? 'Её' : 'Его';
        const message = {
            sender: '🔄 Система',
            text: `📅 **Предложение обмена сменами**\n\n👤 ${fromEmployee} хочет обменяться с вами!\n\n📌 ${hisHer} смена: ${formatDateRussian(fromDateFormatted)} в ${fromShiftTime}\n📌 Ваша смена: ${formatDateRussian(toDateFormatted)} в ${toShiftTime}\n\n💬 Комментарий: ${comment || 'Без комментария'}`,
            time: Date.now(),
            action_data: { type: 'exchange_request', request_id: requestId, from_employee: fromEmployee, to_employee: toEmployee, from_date: fromDateFormatted, to_date: toDateFormatted, from_time: fromShiftTime, to_time: toShiftTime, comment: comment, status: 'pending' }
        };
        await pool.query(`INSERT INTO messages (room, sender, text, time, action_data) VALUES ($1, $2, $3, $4, $5)`, [toEmployee, message.sender, message.text, message.time, message.action_data]);
        pusherInstance.trigger(`private-user-${transliterate(toEmployee)}`, 'client-private-message', { message: message, from: fromEmployee });
    }
    res.json({ success: true, requestId: requestId });
});

app.post('/api/exchange/accept/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user.username;
    
    const request = await pool.query(`SELECT *, from_date::text as from_date_str, to_date::text as to_date_str FROM exchange_requests WHERE id = $1 AND status = 'pending'`, [id]);
    if (request.rows.length === 0) {
        return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }
    
    const reqData = request.rows[0];
    const fromDateStr = reqData.from_date_str;
    const toDateStr = reqData.to_date_str;
    const fromShiftTime = reqData.from_shift_time;
    const toShiftTime = reqData.to_shift_time;
    
    console.log('📥 ПРИНЯТИЕ ЗАПРОСА НА ОБМЕН ДАТАМИ:');
    console.log(`   ${reqData.from_employee} (${fromDateStr} ${fromShiftTime}) ⇄ ${reqData.to_employee} (${toDateStr} ${toShiftTime})`);
    
    if (reqData.to_employee !== currentUser) {
        return res.status(403).json({ error: 'Вы не можете принять этот запрос' });
    }
    if (new Date(reqData.expires_at) < new Date()) {
        await pool.query(`UPDATE exchange_requests SET status = 'expired' WHERE id = $1`, [id]);
        return res.status(400).json({ error: 'Срок действия запроса истёк' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const fromShift = await client.query(`SELECT shift_time, shift_status, is_special, special_end_time FROM schedule WHERE date = $1::date AND employee = $2`, [fromDateStr, reqData.from_employee]);
        const toShift = await client.query(`SELECT shift_time, shift_status, is_special, special_end_time FROM schedule WHERE date = $1::date AND employee = $2`, [toDateStr, reqData.to_employee]);
        
        const fromTime = fromShift.rows[0]?.shift_time || null;
        const fromStatus = fromShift.rows[0]?.shift_status || 'working';
        const fromSpecial = fromShift.rows[0]?.is_special || false;
        const fromSpecialEnd = fromShift.rows[0]?.special_end_time || null;
        
        const toTime = toShift.rows[0]?.shift_time || null;
        const toStatus = toShift.rows[0]?.shift_status || 'working';
        const toSpecial = toShift.rows[0]?.is_special || false;
        const toSpecialEnd = toShift.rows[0]?.special_end_time || null;
        
        if (fromTime !== null) {
            await client.query(`
                INSERT INTO schedule (date, employee, shift_time, shift_status, is_special, special_end_time)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (date, employee) DO UPDATE SET
                    shift_time = EXCLUDED.shift_time,
                    shift_status = EXCLUDED.shift_status,
                    is_special = EXCLUDED.is_special,
                    special_end_time = EXCLUDED.special_end_time
            `, [toDateStr, reqData.from_employee, fromTime, fromStatus, fromSpecial, fromSpecialEnd]);
        } else {
            await client.query(`DELETE FROM schedule WHERE date = $1::date AND employee = $2`, [toDateStr, reqData.from_employee]);
        }
        
        if (toTime !== null) {
            await client.query(`
                INSERT INTO schedule (date, employee, shift_time, shift_status, is_special, special_end_time)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (date, employee) DO UPDATE SET
                    shift_time = EXCLUDED.shift_time,
                    shift_status = EXCLUDED.shift_status,
                    is_special = EXCLUDED.is_special,
                    special_end_time = EXCLUDED.special_end_time
            `, [fromDateStr, reqData.to_employee, toTime, toStatus, toSpecial, toSpecialEnd]);
        } else {
            await client.query(`DELETE FROM schedule WHERE date = $1::date AND employee = $2`, [fromDateStr, reqData.to_employee]);
        }
        
        await client.query(`DELETE FROM schedule WHERE date = $1::date AND employee = $2`, [fromDateStr, reqData.from_employee]);
        await client.query(`DELETE FROM schedule WHERE date = $1::date AND employee = $2`, [toDateStr, reqData.to_employee]);
        
        const fromTranslit = transliterate(reqData.from_employee);
        const toTranslit = transliterate(reqData.to_employee);
        const exchangeMark = `ex_${fromTranslit}_${toTranslit}`;
        
        await client.query(`UPDATE schedule SET is_special = true, special_end_time = $1 WHERE date = $2::date AND employee = $3`, [exchangeMark, toDateStr, reqData.from_employee]);
        await client.query(`UPDATE schedule SET is_special = true, special_end_time = $1 WHERE date = $2::date AND employee = $3`, [exchangeMark, fromDateStr, reqData.to_employee]);
        
        await client.query(`UPDATE exchange_requests SET status = 'accepted' WHERE id = $1`, [id]);
        
        const fromEmpRes = await pool.query('SELECT id FROM employees WHERE name = $1', [reqData.from_employee]);
        const toEmpRes = await pool.query('SELECT id FROM employees WHERE name = $1', [reqData.to_employee]);
        if (fromEmpRes.rows.length > 0) {
            await checkAndGrantAchievements(fromEmpRes.rows[0].id, reqData.from_employee);
        }
        if (toEmpRes.rows.length > 0) {
            await checkAndGrantAchievements(toEmpRes.rows[0].id, reqData.to_employee);
        }
        
        await client.query('COMMIT');
        
        const pusherInstance = app.get('pusher');
        if (pusherInstance) {
            const isFromFemale = femaleNames.includes(reqData.from_employee);
            const isToFemale = femaleNames.includes(reqData.to_employee);
            const fromHisHer = isFromFemale ? 'Её' : 'Его';
            const toHisHer = isToFemale ? 'Её' : 'Его';
            
            const acceptMessageTo = {
                sender: '✅ Система',
                text: `Вы **ПРИНЯЛИ** предложение обмена сменами от ${reqData.from_employee}!\n\n📌 Теперь ${toHisHer} смена ${formatDateRussian(toDateStr)} (${toShiftTime}) → передана вам\n📌 Ваша смена ${formatDateRussian(fromDateStr)} (${fromShiftTime}) → передана ${reqData.from_employee}\n\nСмены успешно обменяны!`,
                time: Date.now()
            };
            
            await client.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [currentUser, acceptMessageTo.sender, acceptMessageTo.text, acceptMessageTo.time]);
            pusherInstance.trigger(`private-user-${transliterate(currentUser)}`, 'client-private-message', { message: acceptMessageTo, from: 'Система' });
            
            const acceptMessageFrom = {
                sender: '✅ Система',
                text: `${reqData.to_employee} **ПРИНЯЛ${isToFemale ? 'А' : ''}** ваше предложение обмена сменами!\n\n📌 Ваша смена ${formatDateRussian(fromDateStr)} (${fromShiftTime}) → передана ${reqData.to_employee}\n📌 ${toHisHer} смена ${formatDateRussian(toDateStr)} (${toShiftTime}) → передана вам\n\nСмены успешно обменяны!`,
                time: Date.now()
            };
            
            await client.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [reqData.from_employee, acceptMessageFrom.sender, acceptMessageFrom.text, acceptMessageFrom.time]);
            pusherInstance.trigger(`private-user-${transliterate(reqData.from_employee)}`, 'client-private-message', { message: acceptMessageFrom, from: 'Система' });
            
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: fromDateStr, employee: reqData.from_employee, shift_time: null, timestamp: Date.now() });
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: toDateStr, employee: reqData.to_employee, shift_time: null, timestamp: Date.now() });
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: toDateStr, employee: reqData.from_employee, shift_time: fromTime, timestamp: Date.now() });
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: fromDateStr, employee: reqData.to_employee, shift_time: toTime, timestamp: Date.now() });
            
            // 🔥 Глобальное уведомление об обмене
            try {
                await sendGlobalNotification('exchange_accepted', {
                    from: reqData.from_employee,
                    to: reqData.to_employee
                });
            } catch (err) {
                console.error('Ошибка отправки уведомления об обмене:', err);
            }
        }
        
        res.json({ success: true, message: 'Обмен смен подтверждён' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error accepting exchange:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/exchange/reject/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user.username;
    const request = await pool.query(`SELECT * FROM exchange_requests WHERE id = $1 AND status = 'pending'`, [id]);
    if (request.rows.length === 0) {
        return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }
    const reqData = request.rows[0];
    if (reqData.to_employee !== currentUser) {
        return res.status(403).json({ error: 'Вы не можете отклонить этот запрос' });
    }
    await pool.query(`UPDATE exchange_requests SET status = 'rejected' WHERE id = $1`, [id]);
    
    const pusherInstance = app.get('pusher');
    if (pusherInstance) {
        const isToFemale = femaleNames.includes(currentUser);
        
        await pool.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [currentUser, '❌ Система', `Вы **ОТКЛОНИЛИ** предложение обмена сменами от ${reqData.from_employee}.`, Date.now()]);
        pusherInstance.trigger(`private-user-${transliterate(currentUser)}`, 'client-private-message', { 
            message: { sender: '❌ Система', text: `Вы **ОТКЛОНИЛИ** предложение обмена сменами от ${reqData.from_employee}.`, time: Date.now() }, 
            from: 'Система' 
        });
        
        await pool.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [reqData.from_employee, '❌ Система', `${currentUser} **ОТКЛОНИЛ${isToFemale ? 'А' : ''}** ваше предложение обмена сменами.`, Date.now()]);
        pusherInstance.trigger(`private-user-${transliterate(reqData.from_employee)}`, 'client-private-message', { 
            message: { sender: '❌ Система', text: `${currentUser} **ОТКЛОНИЛ${isToFemale ? 'А' : ''}** ваше предложение обмена сменами.`, time: Date.now() }, 
            from: 'Система' 
        });
    }
    res.json({ success: true, message: 'Запрос отклонён' });
});

app.get('/api/exchange/pending', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT *, from_date::text as from_date_str, to_date::text as to_date_str FROM exchange_requests WHERE to_employee = $1 AND status = 'pending' ORDER BY created_at DESC`, [req.user.username]);
        const requests = result.rows.map(row => ({ ...row, from_date: row.from_date_str, to_date: row.to_date_str }));
        res.json({ success: true, requests: requests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/exchange/my', authMiddleware, async (req, res) => {
    const { status } = req.query;
    let query = `SELECT *, from_date::text as from_date_str, to_date::text as to_date_str FROM exchange_requests WHERE from_employee = $1`;
    const params = [req.user.username];
    if (status && status !== 'all') {
        query += ` AND status = $2`;
        params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    try {
        const result = await pool.query(query, params);
        const requests = result.rows.map(row => ({ ...row, from_date: row.from_date_str, to_date: row.to_date_str }));
        res.json({ success: true, requests: requests });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/exchange/cancel/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const currentUser = req.user.username;
    const request = await pool.query(`SELECT * FROM exchange_requests WHERE id = $1 AND from_employee = $2 AND status = 'pending'`, [id, currentUser]);
    if (request.rows.length === 0) {
        return res.status(404).json({ error: 'Запрос не найден или уже обработан' });
    }
    const reqData = request.rows[0];
    await pool.query(`UPDATE exchange_requests SET status = 'cancelled' WHERE id = $1`, [id]);
    
    const pusherInstance = app.get('pusher');
    if (pusherInstance) {
        const isFromFemale = femaleNames.includes(currentUser);
        await pool.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [reqData.to_employee, '❌ Система', `${currentUser} **ОТМЕНИЛ${isFromFemale ? 'А' : ''}** предложение обмена сменами.`, Date.now()]);
        pusherInstance.trigger(`private-user-${transliterate(reqData.to_employee)}`, 'client-private-message', { 
            message: { sender: '❌ Система', text: `${currentUser} **ОТМЕНИЛ${isFromFemale ? 'А' : ''}** предложение обмена сменами.`, time: Date.now() }, 
            from: 'Система' 
        });
    }
    res.json({ success: true, message: 'Запрос отменён' });
});

async function autoExpireExchangeRequests() {
    console.log('🕐 Проверка просроченных запросов на обмен...');
    try {
        const expiredRequests = await pool.query(`SELECT id, from_employee, to_employee FROM exchange_requests WHERE status = 'pending' AND expires_at < NOW()`);
        for (const req of expiredRequests.rows) {
            await pool.query(`UPDATE exchange_requests SET status = 'expired' WHERE id = $1`, [req.id]);
            const pusherInstance = app.get('pusher');
            if (pusherInstance) {
                await pool.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [req.from_employee, '⏰ Система', `Ваше предложение обмена сменами для ${req.to_employee} **АВТОМАТИЧЕСКИ ОТМЕНЕНО**.\n\nСотрудник не ответил в течение 24 часов.`, Date.now()]);
                pusherInstance.trigger(`private-user-${transliterate(req.from_employee)}`, 'client-private-message', { message: { sender: '⏰ Система', text: `Ваше предложение обмена сменами для ${req.to_employee} **АВТОМАТИЧЕСКИ ОТМЕНЕНО**.\n\nСотрудник не ответил в течение 24 часов.`, time: Date.now() }, from: 'Система' });
                
                await pool.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [req.to_employee, '⏰ Система', `Предложение обмена сменами от ${req.from_employee} **АВТОМАТИЧЕСКИ ОТМЕНЕНО**.\n\nВы не ответили в течение 24 часов.`, Date.now()]);
                pusherInstance.trigger(`private-user-${transliterate(req.to_employee)}`, 'client-private-message', { message: { sender: '⏰ Система', text: `Предложение обмена сменами от ${req.from_employee} **АВТОМАТИЧЕСКИ ОТМЕНЕНО**.\n\nВы не ответили в течение 24 часов.`, time: Date.now() }, from: 'Система' });
            }
        }
        if (expiredRequests.rows.length > 0) console.log(`✅ Автоматически отменено ${expiredRequests.rows.length} просроченных запросов`);
    } catch (err) {
        console.error('Ошибка авто-отмены запросов:', err);
    }
}

// ============================================
// STATUSES API
// ============================================

app.get('/api/statuses', authMiddleware, async (req, res) => {
    const statuses = [
        { id: 'lazy', name: '🦥 Профессиональный ленивец', icon: '🦥', price: 300, rating: 8, desc: 'Мастер спорта по откладыванию' },
        { id: 'coffee', name: '☕ Зависим от кофеина', icon: '☕', price: 250, rating: 6, desc: 'Без кофе - не человек' },
        { id: 'zombie', name: '🧟 Зомби до обеда', icon: '🧟', price: 250, rating: 6, desc: 'Просыпаюсь к третьей банке' },
        { id: 'excuse', name: '🎯 Мастер отмазок', icon: '🎯', price: 400, rating: 11, desc: 'Придумаю оправдание чему угодно' },
        { id: 'cringe', name: '🎭 Маскировщик кринжа', icon: '🎭', price: 350, rating: 9, desc: 'Делаю вид, что ничего не произошло' },
        { id: 'drama', name: '🎬 Режиссёр драмы', icon: '🎬', price: 380, rating: 8, desc: 'Раздуваю проблему из ничего' },
        { id: 'puzzle', name: '🧩 Пазл-сотрудник', icon: '🧩', price: 300, rating: 6, desc: 'Без коллег бесполезен' },
        { id: 'double', name: '🎭 Двойной агент', icon: '🎭', price: 450, rating: 10, desc: 'Своим - одно, чужим - другое' }
    ];
    res.json({ success: true, data: statuses });
});

app.get('/api/user/statuses', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query('SELECT * FROM user_statuses WHERE employee_id = $1 ORDER BY purchased_at DESC', [userId]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

app.post('/api/statuses/buy', authMiddleware, async (req, res) => {
    const { statusId, statusName, statusIcon, price, rating, description } = req.body;
    const userId = req.user.id;
    
    try {
        const userResult = await pool.query('SELECT coins FROM employees WHERE id = $1', [userId]);
        const currentCoins = userResult.rows[0]?.coins || 0;
        
        if (currentCoins < price) {
            return res.status(400).json({ error: 'Недостаточно монет' });
        }
        
        const existing = await pool.query(
            'SELECT id FROM user_statuses WHERE employee_id = $1 AND status_id = $2',
            [userId, statusId]
        );
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Статус уже куплен' });
        }
        
        const balanceBefore = currentCoins;
        const balanceAfter = balanceBefore - price;
        
        await pool.query('UPDATE employees SET coins = coins - $1 WHERE id = $2', [price, userId]);
        await pool.query(
            `INSERT INTO user_statuses (employee_id, status_id, status_name, status_icon, price, rating, description) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, statusId, statusName, statusIcon, price, rating, description]
        );
        await logTransaction(userId, 'shop_purchase', -price, balanceBefore, balanceAfter, null, `Покупка статуса "${statusName}"`);
        
        const achievementResult = await checkAndGrantAchievements(userId, req.user.username);
        
        res.json({ 
            success: true,
            newAchievements: achievementResult.achievements
        });
        
    } catch (err) {
        console.error('❌ Ошибка покупки статуса:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/statuses/activate', authMiddleware, async (req, res) => {
    const { statusId } = req.body;
    const userId = req.user.id;
    try {
        const statusResult = await pool.query('SELECT id, status_name FROM user_statuses WHERE employee_id = $1 AND status_id = $2', [userId, statusId]);
        if (statusResult.rows.length === 0) return res.status(404).json({ error: 'Статус не найден' });
        await pool.query('UPDATE user_statuses SET is_active = FALSE WHERE employee_id = $1', [userId]);
        await pool.query('UPDATE user_statuses SET is_active = TRUE WHERE employee_id = $1 AND status_id = $2', [userId, statusId]);
        await pool.query('UPDATE employees SET active_status = $1 WHERE id = $2', [statusResult.rows[0].status_name, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// AUTH
// ============================================

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await pool.query('SELECT * FROM passwords WHERE username = $1', [username]);
        
        if (user.rows.length > 0 && user.rows[0].password === password) {
            const profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
            
            if (profile.rows.length === 0) {
                return res.status(401).json({ error: 'Сотрудник не найден' });
            }
            
            await pool.query('UPDATE employees SET last_active = CURRENT_TIMESTAMP WHERE name = $1', [username]);
            
            const token = jwt.sign(
                { username: username, role: profile.rows[0].role, id: profile.rows[0].id }, 
                JWT_SECRET, 
                { expiresIn: '7d' }
            );
            
            const achievementResult = await checkAndGrantAchievements(profile.rows[0].id, username);
            
            res.json({ 
                success: true, 
                user: profile.rows[0], 
                token,
                newAchievements: achievementResult.achievements
            });
            
        } else {
            res.status(401).json({ error: 'Неверный логин или пароль' });
        }
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// DAILY BONUS API
// ============================================

app.get('/api/user/login-streak', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT last_bonus_claimed_at, bonus_streak, coins FROM employees WHERE id = $1`, [req.user.id]);
        const lastClaimed = result.rows[0]?.last_bonus_claimed_at;
        const streak = result.rows[0]?.bonus_streak || 1;
        const now = getTobolskNow();
        const today = now.toISOString().split('T')[0];
        const hasClaimedToday = lastClaimed && new Date(lastClaimed).toISOString().split('T')[0] === today;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        let nextBonusAmount = streak + 1;
        if (nextBonusAmount > daysInMonth) nextBonusAmount = 1;
        let timeRemaining = null;
        if (hasClaimedToday && lastClaimed) {
            const nextBonusTime = new Date(lastClaimed);
            nextBonusTime.setDate(nextBonusTime.getDate() + 1);
            const diffMs = nextBonusTime.getTime() - now.getTime();
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                timeRemaining = `${hours}ч ${minutes}мин`;
            }
        } else {
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999);
            const diffMs = endOfDay.getTime() - now.getTime();
            if (diffMs > 0) {
                const hours = Math.floor(diffMs / (1000 * 60 * 60));
                const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                timeRemaining = `${hours}ч ${minutes}мин`;
            }
        }
        res.json({ success: true, streak: streak, hasClaimedToday: hasClaimedToday, nextBonusAmount: nextBonusAmount, maxStreak: daysInMonth, timeRemaining: timeRemaining, lastClaimed: lastClaimed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/claim-daily-bonus', authMiddleware, async (req, res) => {
    try {
        const result = await updateLoginStreak(req.user.id, req.user.username);
        
        let newAchievements = [];
        
        if (result.claimed) {
            const achievementResult = await checkAndGrantAchievements(req.user.id, req.user.username);
            newAchievements = achievementResult.achievements;
        }
        
        res.json({ 
            ...result, 
            newAchievements: newAchievements 
        });
    } catch (err) {
        console.error('❌ Ошибка получения бонуса:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TRANSACTIONS API
// ============================================

app.get('/api/transactions', authMiddleware, async (req, res) => {
    const { limit = 100, offset = 0, type = 'all' } = req.query;
    const userId = req.user.id;
    try {
        let query = `SELECT t.*, to_char(t.created_at, 'DD.MM.YYYY HH24:MI') as formatted_date, to_char(t.created_at, 'YYYY-MM-DD') as date_only FROM transactions t WHERE t.user_id = $1`;
        const params = [userId];
        if (type !== 'all') {
            query += ` AND t.type = $${params.length + 1}`;
            params.push(type);
        }
        query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        const result = await pool.query(query, params);
        const countQuery = `SELECT COUNT(*) FROM transactions WHERE user_id = $1${type !== 'all' ? ' AND type = $2' : ''}`;
        const countParams = type !== 'all' ? [userId, type] : [userId];
        const countResult = await pool.query(countQuery, countParams);
        res.json({ success: true, transactions: result.rows, total: parseInt(countResult.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/transactions/summary', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await pool.query(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as total_earned, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) as total_spent, COUNT(CASE WHEN amount > 0 THEN 1 END) as earned_count, COUNT(CASE WHEN amount < 0 THEN 1 END) as spent_count FROM transactions WHERE user_id = $1 AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE)`, [userId]);
        res.json({ success: true, summary: result.rows[0] });
    } catch (err) {
        res.json({ success: true, summary: { total_earned: 0, total_spent: 0, earned_count: 0, spent_count: 0 } });
    }
});

// ============================================
// API /data
// ============================================

app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        const employees = await pool.query('SELECT * FROM employees ORDER BY name');
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500');
        const fines = await pool.query('SELECT * FROM fines ORDER BY date DESC LIMIT 500');
        const messages = await pool.query('SELECT * FROM messages ORDER BY time DESC LIMIT 500');
        const schedule = await pool.query('SELECT * FROM schedule');
        const messagesByRoom = {};
        messages.rows.forEach(msg => {
            if (!messagesByRoom[msg.room]) messagesByRoom[msg.room] = [];
            messagesByRoom[msg.room].push(msg);
        });
        const scheduleByDate = {};
        schedule.rows.forEach(s => {
            const dateStr = s.date instanceof Date ? s.date.toISOString().split('T')[0] : s.date;
            if (!scheduleByDate[dateStr]) scheduleByDate[dateStr] = {};
            scheduleByDate[dateStr][s.employee] = { time: s.shift_time, status: s.shift_status, is_special: s.is_special, special_end_time: s.special_end_time };
        });
        res.json({
            employees: employees.rows.map(e => e.name),
            profiles: employees.rows.reduce((acc, e) => { 
                acc[e.name] = {
    id: e.id, name: e.name, avatar: e.avatar, avatar_url: e.avatar_url,
    status: e.status, coins: e.coins, rating: e.rating, role: e.role,
    hours: e.hours, birthday: e.birthday,
    phone: e.phone, last_active: e.last_active, dashboard_style: e.dashboard_style,
    bought_styles: e.bought_styles, can_edit_vp: e.can_edit_vp || false,
    active_status: e.active_status, bonus_streak: e.bonus_streak || 1,
    last_bonus_claimed_at: e.last_bonus_claimed_at
};
                return acc; 
            }, {}),
            tasks: tasks.rows, fines: fines.rows, schedule: scheduleByDate, messages: messagesByRoom
        });
    } catch (err) { 
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// SCHEDULE API
// ============================================

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status, is_special, special_end_time } = req.body;
    const currentUserRole = req.user.role;
    const currentUserName = req.user.username;
    
    if (currentUserRole !== 'director' && currentUserRole !== 'manager' && employee !== currentUserName) {
        return res.status(403).json({ error: 'Нет прав на редактирование этой смены' });
    }
    
    try {
        const dateForDb = formatDateToYMD(date);
        
        const existing = await pool.query(
            'SELECT id FROM schedule WHERE date = $1::date AND employee = $2',
            [dateForDb, employee]
        );
        
        let result;
        if (existing.rows.length > 0) {
            result = await pool.query(
                `UPDATE schedule 
                 SET shift_time = $1, shift_status = $2, is_special = $3, special_end_time = $4, shift_paid = false, updated_at = CURRENT_TIMESTAMP 
                 WHERE date = $5::date AND employee = $6 
                 RETURNING *`,
                [shift_time || null, shift_status || 'working', is_special || false, special_end_time || null, dateForDb, employee]
            );
        } else {
            result = await pool.query(
                `INSERT INTO schedule (date, employee, shift_time, shift_status, is_special, special_end_time) 
                 VALUES ($1::date, $2, $3, $4, $5, $6) 
                 RETURNING *`,
                [dateForDb, employee, shift_time || null, shift_status || 'working', is_special || false, special_end_time || null]
            );
        }
        
        const pusherInstance = app.get('pusher');
        if (pusherInstance) {
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', {
                date: date,
                employee: employee,
                shift_time: shift_time,
                shift_status: shift_status,
                timestamp: Date.now()
            });
        }
        const empCheck = await pool.query('SELECT id FROM employees WHERE name = $1', [employee]);
if (empCheck.rows.length > 0) {
    await checkAndGrantAchievements(empCheck.rows[0].id, employee);
}

        res.json({ success: true, data: result.rows[0] });
        
        const empRes = await pool.query('SELECT id FROM employees WHERE name = $1', [employee]);
        if (empRes.rows.length > 0) {
            await checkAndGrantAchievements(empRes.rows[0].id, employee);
        }
        
    } catch (err) {
        console.error('❌ Ошибка сохранения смены:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, date::text as date, employee, shift_time, shift_status, is_special, special_end_time, shift_paid FROM schedule ORDER BY date DESC, employee`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee } = req.body;
    const currentUserRole = req.user.role;
    const currentUserName = req.user.username;
    if (currentUserRole !== 'director' && currentUserRole !== 'manager' && employee !== currentUserName) {
        return res.status(403).json({ error: 'Нет прав на удаление этой смены' });
    }
    try {
        await pool.query('DELETE FROM schedule WHERE date = $1::date AND employee = $2', [date, employee]);
        const pusherInstance = app.get('pusher');
        if (pusherInstance) {
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: date, employee: employee, deleted: true, timestamp: Date.now() });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TASKS API
// ============================================

app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT t.*, COALESCE(json_agg(DISTINCT s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`);
        const tasks = result.rows.map(row => ({
            id: row.id, name: row.name, author: row.author, executor: row.executor, priority: row.priority || 'medium',
            deadline: row.deadline ? row.deadline.toISOString().split('T')[0] : null, progress: row.progress || 0,
            comment: row.comment, recurring: row.recurring || 'none', status: row.status || 'in_progress',
            parent_id: row.parent_id, created_at: row.created_at, updated_at: row.updated_at,
            subtasks: row.subtasks || [], is_group_task: row.is_group_task, group_members: row.group_members,
            group_progress: row.group_progress, is_archived: row.is_archived || false,
            penalty_applied: row.penalty_applied || false, completed_at: row.completed_at, archived_at: row.archived_at
        }));
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    const { task } = req.body;
    if (!task || !task.name) return res.status(400).json({ error: 'Не указано название задачи' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let groupMembersJson = null;
        if (task.group_members && Array.isArray(task.group_members)) {
            groupMembersJson = JSON.stringify(task.group_members);
        }
        
        const result = await client.query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, progress, comment, recurring, status, is_group_task, group_members) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                task.name,
                task.author || req.user.username,
                task.executor,
                task.priority || 'medium',
                task.deadline || null,
                task.progress || 0,
                task.comment || null,
                task.recurring || 'none',
                task.status || 'in_progress',
                task.is_group_task || null,
                groupMembersJson
            ]
        );
        
        const newTask = result.rows[0];
        
        if (task.subtasks && task.subtasks.length > 0) {
            for (const sub of task.subtasks) {
                await client.query(
                    `INSERT INTO subtasks (task_id, name, completed) VALUES ($1, $2, $3)`,
                    [newTask.id, sub.name, sub.completed || false]
                );
            }
        }
        
        await client.query('COMMIT');
        
        const finalTask = await pool.query(
            `SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks 
             FROM tasks t 
             LEFT JOIN subtasks s ON s.task_id = t.id 
             WHERE t.id = $1 
             GROUP BY t.id`,
            [newTask.id]
        );
        
        res.json({ success: true, task: finalTask.rows[0] });
        
        if (task.executor) {
            const executorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [task.executor]);
            if (executorRes.rows.length > 0) {
                await checkAndGrantAchievements(executorRes.rows[0].id, task.executor);
            }
        }
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка создания задачи:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    try {
        const existingTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existingTask.rows.length === 0) {
            return res.status(404).json({ error: 'Задача не найдена' });
        }
        
        const oldTask = existingTask.rows[0];
        let newAchievements = [];
        
        if (updates.status === 'completed' && oldTask.status !== 'completed') {
            let wpReward = 0;
            if (oldTask.priority === 'high') wpReward = 15;
            else if (oldTask.priority === 'medium') wpReward = 8;
            else if (oldTask.priority === 'low') wpReward = 3;
            
            if (wpReward > 0) {
                const executor = await pool.query('SELECT id, coins FROM employees WHERE name = $1', [oldTask.executor]);
                if (executor.rows.length > 0) {
                    const balanceBefore = executor.rows[0].coins;
                    const balanceAfter = balanceBefore + wpReward;
                    
                    await pool.query('UPDATE employees SET coins = coins + $1 WHERE name = $2', [wpReward, oldTask.executor]);
                    await logTransaction(
                        executor.rows[0].id, 
                        'task_reward', 
                        wpReward, 
                        balanceBefore, 
                        balanceAfter, 
                        oldTask.id, 
                        `Выполнена задача "${oldTask.name}"`
                    );
                    
                    // 🔥 Уведомление автору задачи
                    const authorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [oldTask.author]);
                    const pusherInstance = app.get('pusher');
                    if (pusherInstance && authorRes.rows.length > 0) {
                        pusherInstance.trigger(`private-user-${transliterate(oldTask.author)}`, 'personal-notification', {
                            type: 'task_completed',
                            icon: '✅',
                            title: 'Задача выполнена!',
                            text: `${oldTask.executor} выполнил(а) задачу «${oldTask.name}»`,
                            time: Date.now()
                        });
                    }
                    
                    // 🔥 Глобальное уведомление
                    try {
                        await sendGlobalNotification('task_completed', {
                            executor: oldTask.executor,
                            taskName: oldTask.name
                        });
                    } catch (err) {
                        console.error('Ошибка отправки уведомления о задаче:', err);
                    }
                }
            }
            
            const executorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [oldTask.executor]);
            if (executorRes.rows.length > 0) {
                const result = await checkAndGrantAchievements(executorRes.rows[0].id, oldTask.executor);
                newAchievements = result.achievements;
            }
        }
        
        const allowedFields = ['name', 'executor', 'priority', 'deadline', 'progress', 'comment', 'status', 'recurring', 'is_archived', 'completed_at'];
        const setClauses = [];
        const values = [];
        let paramIndex = 1;
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClauses.push(`${field} = $${paramIndex}`);
                values.push(updates[field]);
                paramIndex++;
            }
        }
        
        setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
        
        if (setClauses.length > 1) {
            values.push(id);
            const query = `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
            await pool.query(query, values);
        }
        
        const updatedTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        // Уже есть, но проверьте что вызывается
const executorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [oldTask.executor]);
if (executorRes.rows.length > 0) {
    await checkAndGrantAchievements(executorRes.rows[0].id, oldTask.executor);
}
        res.json({ 
            success: true, 
            task: updatedTask.rows[0],
            newAchievements: newAchievements
        });
        
    } catch (err) {
        console.error('❌ Ошибка обновления задачи:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const taskCheck = await pool.query('SELECT id, author, status, priority, executor, is_group_task, group_members FROM tasks WHERE id = $1', [id]);
        if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Задача не найдена' });
        const task = taskCheck.rows[0];
        const currentUser = req.user.username;
        const currentUserRole = req.user.role;
        if (task.status === 'overdue' && currentUserRole !== 'director' && currentUserRole !== 'manager') {
            return res.status(403).json({ error: 'Просроченные задачи может удалять только директор или управляющий' });
        }
        const canDelete = currentUserRole === 'director' || currentUserRole === 'manager' || (task.author === currentUser && task.status !== 'completed' && task.status !== 'overdue');
        if (!canDelete) return res.status(403).json({ error: 'Нет прав на удаление этой задачи' });
        await pool.query('DELETE FROM subtasks WHERE task_id = $1', [id]);
        await pool.query('DELETE FROM task_attachments WHERE task_id = $1', [id]);
        await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
        res.json({ success: true, message: 'Задача удалена' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============================================
// FINES API
// ============================================

app.get('/api/fines', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM fines ORDER BY date DESC, created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/fines', authMiddleware, async (req, res) => {
    const { fine } = req.body;
    if (!fine || !fine.employee) return res.status(400).json({ error: 'Не указан сотрудник' });
    try {
        const date = fine.date || new Date().toISOString().split('T')[0];
        const result = await pool.query(`INSERT INTO fines (date, employee, type, amount, coins, rating, description, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`, [date, fine.employee, fine.type || 'other', parseInt(fine.amount) || 0, parseInt(fine.coins) || 0, parseInt(fine.rating) || 0, fine.description || '', fine.status || 'pending', fine.createdBy || req.user.username]);
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/fines/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { status, amount, coins, rating, manager_comment, director_comment } = req.body;
    try {
        const fineResult = await pool.query('SELECT * FROM fines WHERE id = $1', [id]);
        if (fineResult.rows.length === 0) return res.status(404).json({ error: 'Штраф не найден' });
        const oldFine = fineResult.rows[0];
        const result = await pool.query(`UPDATE fines SET status = COALESCE($1, status), amount = COALESCE($2, amount), coins = COALESCE($3, coins), rating = COALESCE($4, rating), manager_comment = COALESCE($5, manager_comment), director_comment = COALESCE($6, director_comment), updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *`, [status, amount, coins, rating, manager_comment, director_comment, id]);
        const updatedFine = result.rows[0];
        if (status === 'approved' && oldFine.status !== 'approved') {
            const fineAmount = updatedFine.amount || 0;
            const fineCoins = updatedFine.coins || 0;
            const fineRating = updatedFine.rating || 0;
            if (fineAmount > 0) {
                const current = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1');
                const currentAmount = current.rows.length > 0 ? current.rows[0].amount : 0;
                await pool.query('INSERT INTO corporate_fund (amount, updated_at) VALUES ($1, CURRENT_TIMESTAMP)', [currentAmount + fineAmount]);
            }
            if (fineCoins > 0) {
                const userResult = await pool.query('SELECT id, coins FROM employees WHERE name = $1', [oldFine.employee]);
                if (userResult.rows.length > 0) {
                    const balanceBefore = userResult.rows[0].coins;
                    const balanceAfter = Math.max(0, balanceBefore - fineCoins);
                    await pool.query(`UPDATE employees SET coins = GREATEST(coins - $1, 0) WHERE name = $2`, [fineCoins, oldFine.employee]);
                    await logTransaction(userResult.rows[0].id, 'fine', -fineCoins, balanceBefore, balanceAfter, id, `Штраф: ${oldFine.description || 'Нарушение'}`);
                }
            }
            if (fineRating !== 0) {
                await pool.query(`UPDATE employees SET rating = rating + $1 WHERE name = $2`, [fineRating, oldFine.employee]);
                const empRes = await pool.query('SELECT id FROM employees WHERE name = $1', [oldFine.employee]);
                if (empRes.rows.length > 0) {
                    await checkAndGrantAchievements(empRes.rows[0].id, oldFine.employee);
                }
            }
            
            // 🔥 Уведомление о штрафе
            const pusherInstance = app.get('pusher');
            if (pusherInstance) {
                pusherInstance.trigger(`private-user-${transliterate(oldFine.employee)}`, 'personal-notification', {
                    type: 'fine_approved',
                    icon: '⚠️',
                    title: 'Штраф подтверждён',
                    text: `Вам назначен штраф: ${oldFine.description || 'Нарушение'} (${fineAmount} ₽)`,
                    time: Date.now()
                });
            }
            
            try {
                await sendGlobalNotification('fine_approved', {
                    employee: oldFine.employee,
                    reason: oldFine.description || 'Нарушение'
                });
            } catch (err) {
                console.error('Ошибка отправки уведомления о штрафе:', err);
            }
        }
        res.json({ success: true, fine: updatedFine });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/fines/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    try {
        const result = await pool.query('DELETE FROM fines WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Нарушение не найдено' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// CHAT API
// ============================================

app.post('/api/chat', authMiddleware, async (req, res) => {
    const { room, message } = req.body;
    
    try {
        const timeValue = typeof message.time === 'number' ? message.time : Date.now();
        
        await pool.query(
            'INSERT INTO messages (room, sender, text, time, action_data) VALUES ($1, $2, $3, $4, $5)',
            [room, message.sender, message.text, timeValue, message.action_data || null]
        );
        
        const senderRes = await pool.query('SELECT id FROM employees WHERE name = $1', [message.sender]);
        let newAchievements = [];
        
        if (senderRes.rows.length > 0) {
            const result = await checkAndGrantAchievements(senderRes.rows[0].id, message.sender);
            newAchievements = result.achievements;
        }
        
        res.json({ 
            success: true,
            newAchievements: newAchievements
        });
        
    } catch (err) {
        console.error('❌ Ошибка отправки сообщения:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat/delete', authMiddleware, async (req, res) => {
    const { room, messageTime, sender } = req.body;
    const currentUser = req.user.username;
    const currentUserRole = req.user.role;
    try {
        const messageCheck = await pool.query('SELECT sender FROM messages WHERE room = $1 AND time = $2', [room, messageTime]);
        if (messageCheck.rows.length === 0) return res.status(404).json({ error: 'Сообщение не найдено' });
        const msgSender = messageCheck.rows[0].sender;
        if (currentUser !== msgSender && currentUserRole !== 'director') {
            return res.status(403).json({ error: 'Нет прав на удаление этого сообщения' });
        }
        await pool.query('DELETE FROM messages WHERE room = $1 AND time = $2', [room, messageTime]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/chat/delete-bulk', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    const { period, room, timeThreshold } = req.body;
    try {
        const result = await pool.query('DELETE FROM messages WHERE room = $1 AND time < $2', [room, timeThreshold]);
        res.json({ success: true, deletedCount: result.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/history/:room', authMiddleware, async (req, res) => {
    const { room } = req.params;
    try {
        const result = await pool.query('SELECT * FROM messages WHERE room = $1 ORDER BY time ASC LIMIT 500', [room]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// EMPLOYEES API
// ============================================

app.get('/api/employees/achievements-count', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.name, COUNT(ua.achievement_id) as achievements_count
            FROM employees e
            LEFT JOIN user_achievements ua ON ua.user_id = e.id
            GROUP BY e.id, e.name
            ORDER BY e.name
        `);
        
        const counts = {};
        result.rows.forEach(row => {
            counts[row.name] = parseInt(row.achievements_count) || 0;
        });
        
        res.json({ success: true, counts: counts });
    } catch (err) {
        console.error('Ошибка получения количества достижений:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', authMiddleware, async (req, res) => {
    const { name, role, password, birthday, phone } = req.body;
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    try {
        const result = await pool.query(`INSERT INTO employees (name, role, birthday, phone, bonus_streak) VALUES ($1, $2, $3, $4, 1) RETURNING id`, [name, role || 'operator', birthday || null, phone || null]);
        await pool.query('INSERT INTO passwords (username, password) VALUES ($1, $2)', [name, password]);
        
        // 🔥 Глобальное уведомление о новом сотруднике
        try {
            await sendGlobalNotification('new_employee', { name: name });
        } catch (err) {
            console.error('Ошибка отправки уведомления о новом сотруднике:', err);
        }
        
        res.json({ success: true, employeeId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/employees/:name', authMiddleware, async (req, res) => {
    const { name } = req.params;
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    if (name === 'Денис') return res.status(400).json({ error: 'Нельзя удалить директора' });
    try {
        await pool.query('DELETE FROM employees WHERE name = $1', [name]);
        await pool.query('DELETE FROM passwords WHERE username = $1', [name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Изменение роли сотрудника (только директор)
app.put('/api/employees/:name/role', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Только директор' });
    }
    
    const { name } = req.params;
    const { role } = req.body;
    
    const validRoles = ['operator', 'admin', 'manager'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Недопустимая роль' });
    }
    
    try {
        // Нельзя менять роль директору
        const empRes = await pool.query('SELECT role FROM employees WHERE name = $1', [name]);
        if (empRes.rows.length === 0) {
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }
        if (empRes.rows[0].role === 'director') {
            return res.status(403).json({ error: 'Нельзя изменить роль директора' });
        }
        
        await pool.query('UPDATE employees SET role = $1 WHERE name = $2', [role, name]);
        
        res.json({ success: true, message: `Роль сотрудника ${name} изменена на ${role}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/profiles/:name', authMiddleware, async (req, res) => {
    const { name } = req.params;
    const updates = req.body;
    try {
        const allowedFields = ['avatar', 'avatar_url', 'status', 'coins', 'rating', 'hours', 'phone', 'birthday', 'name', 'can_edit_vp', 'active_status'];
        const filteredUpdates = {};
        for (const key of allowedFields) {
            if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
        }
        if (Object.keys(filteredUpdates).length === 0) return res.json({ success: true });
        const setClause = Object.keys(filteredUpdates).map((key, i) => `${key} = $${i + 2}`).join(', ');
        await pool.query(`UPDATE employees SET ${setClause} WHERE name = $1`, [name, ...Object.values(filteredUpdates)]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// LAST ACTIVITY API
// ============================================

app.get('/api/last-activity', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT name, EXTRACT(EPOCH FROM last_active) * 1000 as last_active FROM employees');
        const lastActivity = {};
        result.rows.forEach(row => { lastActivity[row.name] = row.last_active; });
        res.json({ success: true, data: lastActivity });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/heartbeat', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE employees SET last_active = CURRENT_TIMESTAMP WHERE name = $1', [req.user.username]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// GIFTS API (ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ)
// ============================================

app.post('/api/gifts', authMiddleware, async (req, res) => {
    const { recipient, giftId, price, ratingChange, sender, quantity } = req.body;
    
    console.log('🎁 ЗАПРОС НА ОТПРАВКУ ПОДАРКА:');
    console.log(`   Отправитель: ${sender}`);
    console.log(`   Получатель: ${recipient}`);
    console.log(`   Подарок: ${giftId}`);
    console.log(`   Цена: ${price}`);
    console.log(`   Количество: ${quantity}`);
    
    try {
        const giftPrices = { 
            flower: 25, chocolate: 40, star: 75, honey: 120, 
            pizza: 150, trophy: 300, crown: 500,
            trash: 25, socks: 75, brick: 150, abibas: 300, poop: 500
        };
        const actualPrice = giftPrices[giftId] || price;
        const totalCost = actualPrice * (quantity || 1);
        
        console.log(`   Общая стоимость: ${totalCost} WP`);
        
        let newAchievements = [];
        
        // 1. Списываем монеты у отправителя
        if (sender !== '🕵️ Аноним') {
            const senderResult = await pool.query('SELECT id, coins FROM employees WHERE name = $1', [sender]);
            if (senderResult.rows.length > 0) {
                const senderCoins = senderResult.rows[0].coins;
                
                console.log(`   Баланс отправителя до: ${senderCoins} WP`);
                
                if (senderCoins < totalCost) {
                    return res.status(400).json({ error: 'Недостаточно монет у отправителя' });
                }
                
                const balanceBefore = senderCoins;
                const balanceAfter = balanceBefore - totalCost;
                
                await pool.query('UPDATE employees SET coins = coins - $1 WHERE name = $2', [totalCost, sender]);
                
                console.log(`   Баланс отправителя после: ${balanceAfter} WP`);
                
                await logTransaction(
                    senderResult.rows[0].id, 
                    'gift_send', 
                    -totalCost, 
                    balanceBefore, 
                    balanceAfter, 
                    null, 
                    `Отправлен подарок "${giftId}" для ${recipient}`
                );
                
                const result = await checkAndGrantAchievements(senderResult.rows[0].id, sender);
                newAchievements = result.achievements;
            }
        }
        
        // 2. Получателю начисляем рейтинг
        const recipientResult = await pool.query('SELECT id, rating, coins FROM employees WHERE name = $1', [recipient]);
        if (recipientResult.rows.length > 0) {
            const ratingBefore = recipientResult.rows[0].rating;
            const ratingAfter = ratingBefore + (ratingChange * (quantity || 1));
            
            console.log(`   Рейтинг получателя до: ${ratingBefore}`);
            
            await pool.query(
                'UPDATE employees SET rating = rating + $1 WHERE name = $2', 
                [ratingChange * (quantity || 1), recipient]
            );
            
            console.log(`   Рейтинг получателя после: ${ratingAfter}`);
            console.log(`   Монеты получателя НЕ изменились: ${recipientResult.rows[0].coins} WP`);
            
            await checkAndGrantAchievements(recipientResult.rows[0].id, recipient);
        }
        
        // 3. Записываем подарок
        await pool.query(
            `INSERT INTO stickers (employee, gift_id, quantity) VALUES ($1, $2, $3) 
             ON CONFLICT (employee, gift_id) DO UPDATE SET quantity = stickers.quantity + $3`,
            [recipient, giftId, quantity || 1]
        );
        
        console.log('✅ Подарок успешно отправлен!');
        
        // 4. Уведомления
        const giftNames = {
            flower: '🌸 Букет цветов', chocolate: '🍫 Шоколад', star: '⭐ Золотая звезда', 
            honey: '🍯 Мёд', pizza: '🍕 Пицца', trophy: '🏆 Трофей', crown: '👑 Корона',
            trash: '🗑️ Мешок мусора', socks: '🧦 Носки', brick: '🧱 Кирпич', 
            abibas: '👟 Кеды Abibas', poop: '💩 Шоколадный сюрприз'
        };
        const giftName = giftNames[giftId] || giftId;
        const senderName = sender === '🕵️ Аноним' ? 'Анонимный отправитель' : sender;
        
        try {
            await sendGlobalNotification('gift_sent', {
                sender: senderName,
                recipient: recipient,
                giftName: giftName
            });
        } catch (err) {
            console.error('Ошибка отправки глобального уведомления о подарке:', err);
        }
        
        const pusherInstance = app.get('pusher');
        if (pusherInstance) {
            try {
                pusherInstance.trigger(`private-user-${transliterate(recipient)}`, 'personal-notification', {
                    type: 'gift_received',
                    icon: '🎁',
                    title: 'Вам подарок!',
                    text: `${senderName} подарил вам ${giftName} ${quantity > 1 ? `(x${quantity})` : ''}!`,
                    time: Date.now()
                });
            } catch (err) {
                console.error('Ошибка отправки личного уведомления о подарке:', err);
            }
        }
        
        res.json({ 
            success: true,
            message: `Подарок отправлен ${recipient}!`,
            newAchievements: newAchievements
        });
        
    } catch (err) {
        console.error('❌ Ошибка отправки подарка:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN BONUS
// ============================================

app.post('/api/admin/bonus/employee', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { name, coins, rating } = req.body;
    try {
        const userResult = await pool.query('SELECT id, coins FROM employees WHERE name = $1', [name]);
        if (userResult.rows.length > 0) {
            const balanceBefore = userResult.rows[0].coins;
            const balanceAfter = balanceBefore + (coins || 0);
            await pool.query('UPDATE employees SET coins = coins + $1, rating = rating + $2 WHERE name = $3', [coins || 0, rating || 0, name]);
            await logTransaction(userResult.rows[0].id, 'admin_bonus', coins || 0, balanceBefore, balanceAfter, null, `Бонус от директора${rating ? ` +${rating}⭐` : ''}`);
            await checkAndGrantAchievements(userResult.rows[0].id, name);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// WEATHER API
// ============================================

let cachedWeather = null;
let lastWeatherFetch = 0;
let isFetchingWeather = false;

app.get('/api/weather', async (req, res) => {
    try {
        const forceUpdate = req.query.force === '1';
        const now = Date.now();
        if (forceUpdate || !cachedWeather || (now - lastWeatherFetch) > 5 * 60 * 1000) {
            console.log('🔄 Принудительное обновление погоды...');
            isFetchingWeather = true;
            try {
                const weather = await fetchWeather();
                if (weather && !weather.isError) {
                    cachedWeather = weather;
                    lastWeatherFetch = now;
                    console.log(`✅ Погода обновлена: ${weather.temperatureDisplay}°C (${weather.source})`);
                }
            } finally {
                isFetchingWeather = false;
            }
        }
        if (cachedWeather) {
            return res.json({ 
                success: true, 
                temp: cachedWeather.temperature,
                tempDisplay: cachedWeather.temperatureDisplay,
                feelsLike: cachedWeather.feelsLike,
                feelsLikeDisplay: cachedWeather.feelsLikeDisplay,
                desc: cachedWeather.description,
                icon: cachedWeather.icon
            });
        }
        res.json({ success: true, temp: 0, tempDisplay: '0', feelsLike: null, feelsLikeDisplay: null, desc: 'Нет данных', icon: '🌡️' });
    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.json({ success: true, temp: 0, tempDisplay: '0', feelsLike: null, feelsLikeDisplay: null, desc: 'Ошибка', icon: '🌡️' });
    }
});

// ============================================
// SALARY API
// ============================================

app.get('/api/salary', authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    try {
        const employees = await pool.query('SELECT id, name, role, avatar, avatar_url FROM employees WHERE role != $1 ORDER BY name', ['director']);
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        let salaryData = { rows: [] };
        try {
            salaryData = await pool.query(`SELECT employee_id, day_number, oklad, event, turnover, bonus35, video FROM salary_daily_new WHERE month_year = $1`, [monthYear]);
        } catch (err) {}
        res.json({ success: true, employees: employees.rows, dailyData: salaryData.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/salary/day/save', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { employee_id, day_number, month, year, oklad, event, turnover, bonus35, video } = req.body;
    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
    try {
        await pool.query(`INSERT INTO salary_daily_new (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover, bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, updated_at = CURRENT_TIMESTAMP`, [employee_id, day_number, monthYear, oklad || 0, event || 0, turnover || 0, bonus35 || 0, video || 0]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/salary/day', authMiddleware, async (req, res) => {
    const { employee_id, day, month, year } = req.query;
    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
    try {
        const result = await pool.query(`SELECT * FROM salary_daily_new WHERE employee_id = $1 AND day_number = $2 AND month_year = $3`, [employee_id, day, monthYear]);
        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// VP API
// ============================================

app.get('/api/vp', authMiddleware, async (req, res) => {
    const { month, year, archived } = req.query;
    try {
        let query = `SELECT id, admin, event_date, TO_CHAR(event_time, 'HH24:MI') as event_time, customer_name, amount, payment_type, booking_date, photo_status, script_status, is_archived, created_by, created_at, updated_at, comment FROM vp_bookings`;
        const conditions = [];
        const params = [];
        if (archived === 'true') conditions.push('is_archived = true');
        else if (archived !== 'all') conditions.push('(is_archived = false OR is_archived IS NULL)');
        if (month && year) {
            conditions.push('EXTRACT(MONTH FROM event_date) = $' + (params.length + 1) + ' AND EXTRACT(YEAR FROM event_date) = $' + (params.length + 2));
            params.push(month, year);
        }
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY event_date DESC, event_time DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    const { vp } = req.body;
    if (!vp) return res.status(400).json({ error: 'Нет данных мероприятия' });
    if (req.user.role !== 'director' && req.user.role !== 'manager' && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const result = await pool.query(`INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, photo_status, script_status, created_by, comment) VALUES ($1, $2, $3::time without time zone, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [vp.admin, vp.eventDate, vp.eventTime, vp.customerName, vp.amount || 2000, vp.paymentType || 'evotor_card', vp.bookingDate || new Date().toISOString().split('T')[0], vp.photoStatus || 'pending', vp.scriptStatus || 'not_sent', req.user.username, vp.comment || null]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { eventDate, eventTime, customerName, admin, amount, paymentType, photoStatus, scriptStatus, comment, is_archived } = req.body;
    if (req.user.role !== 'director' && req.user.role !== 'manager' && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const current = await pool.query('SELECT * FROM vp_bookings WHERE id = $1', [id]);
        if (current.rows.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        const cur = current.rows[0];
        const result = await pool.query(`UPDATE vp_bookings SET event_date = $1, event_time = $2::time without time zone, customer_name = $3, admin = $4, amount = $5, payment_type = $6, photo_status = $7, script_status = $8, comment = $9, is_archived = $10, updated_at = CURRENT_TIMESTAMP WHERE id = $11 RETURNING *`, [eventDate !== undefined ? eventDate : cur.event_date, eventTime !== undefined ? eventTime : cur.event_time, customerName !== undefined ? customerName : cur.customer_name, admin !== undefined ? admin : cur.admin, amount !== undefined ? amount : cur.amount, paymentType !== undefined ? paymentType : cur.payment_type, photoStatus !== undefined ? photoStatus : cur.photo_status, scriptStatus !== undefined ? scriptStatus : cur.script_status, comment !== undefined ? comment : cur.comment, is_archived !== undefined ? is_archived : (cur.is_archived || false), id]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/vp/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    if (req.user.role !== 'director' && req.user.role !== 'manager' && req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    try {
        const check = await pool.query('SELECT id FROM vp_bookings WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        await pool.query('DELETE FROM vp_bookings WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// KNOWLEDGE BASE API
// ============================================

app.get('/api/knowledge/categories', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM knowledge_categories ORDER BY name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

app.post('/api/knowledge/categories', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    const { name, icon } = req.body;
    try {
        const result = await pool.query('INSERT INTO knowledge_categories (name, icon) VALUES ($1, $2) RETURNING *', [name, icon || '📁']);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    const { id } = req.params;
    const { name, icon } = req.body;
    try {
        const result = await pool.query('UPDATE knowledge_categories SET name = $1, icon = $2 WHERE id = $3 RETURNING *', [name, icon, id]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM knowledge_articles WHERE category_id = $1', [id]);
        await pool.query('DELETE FROM knowledge_categories WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM knowledge_articles ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.json({ success: true, data: [] });
    }
});

app.post('/api/knowledge/articles', authMiddleware, async (req, res) => {
    const { category_id, title, content } = req.body;
    try {
        const result = await pool.query('INSERT INTO knowledge_articles (category_id, title, content, created_by, views) VALUES ($1, $2, $3, $4, $5) RETURNING *', [category_id, title, content, req.user.username, 0]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;
    try {
        const result = await pool.query('UPDATE knowledge_articles SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *', [title, content, id]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM knowledge_views WHERE article_id = $1', [id]);
        await pool.query('DELETE FROM knowledge_articles WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        await pool.query('UPDATE knowledge_articles SET views = views + 1 WHERE id = $1', [id]);
        await pool.query(`INSERT INTO knowledge_views (user_id, article_id) VALUES ($1, $2) ON CONFLICT (user_id, article_id) DO NOTHING`, [userId, id]);
        
        const achievementResult = await checkAndGrantAchievements(userId, req.user.username);
        
        res.json({ success: true, newAchievements: achievementResult.achievements });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// PARSING API
// ============================================

const { BookingParser } = require('./parsing-booking.js');
let parsingInProgress = false;

app.get('/api/parsing/latest', authMiddleware, async (req, res) => {
    const dataPath = path.join(__dirname, 'data', 'booking-availability.json');
    try {
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            res.json(data);
        } else {
            res.json({ success: false, error: 'Нет данных' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/parsing/progress', authMiddleware, async (req, res) => {
    const progressPath = path.join(__dirname, 'data', 'parsing-progress.json');
    try {
        if (fs.existsSync(progressPath)) {
            const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
            res.json(progress);
        } else {
            res.json({ step: 0, percent: 0, message: 'Ожидание запуска' });
        }
    } catch (err) {
        res.json({ step: 0, percent: 0, message: 'Ошибка' });
    }
});

app.post('/api/parsing/run', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    if (parsingInProgress) return res.json({ success: false, error: 'Парсинг уже выполняется' });
    parsingInProgress = true;
    const progressPath = path.join(__dirname, 'data', 'parsing-progress.json');
    if (fs.existsSync(progressPath)) try { fs.unlinkSync(progressPath); } catch(e) {}
    setTimeout(async () => {
        try {
            const parser = new BookingParser();
            await parser.parseAvailability();
        } catch (err) {
            const errorProgress = { step: 0, percent: 0, message: `Ошибка: ${err.message}`, timestamp: Date.now() };
            fs.writeFileSync(progressPath, JSON.stringify(errorProgress, null, 2));
        } finally {
            parsingInProgress = false;
        }
    }, 100);
    res.json({ success: true, message: 'Парсинг запущен' });
});

app.post('/api/parsing/reset', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    parsingInProgress = false;
    const progressPath = path.join(__dirname, 'data', 'parsing-progress.json');
    if (fs.existsSync(progressPath)) {
        try { fs.unlinkSync(progressPath); } catch(e) {}
    }
    res.json({ success: true });
});

// ============================================
// CORPORATE FUND API
// ============================================

app.get('/api/fund', authMiddleware, async (req, res) => {
    try {
        let result = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1');
        let amount = 0;
        if (result.rows.length > 0) {
            amount = result.rows[0].amount;
        } else {
            await pool.query('INSERT INTO corporate_fund (amount) VALUES (0)');
        }
        res.json({ success: true, amount: amount });
    } catch (err) {
        res.json({ success: true, amount: 0 });
    }
});

app.post('/api/fund/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { amount, reset } = req.body;
    try {
        const current = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1');
        const currentAmount = current.rows.length > 0 ? current.rows[0].amount : 0;
        let newAmount = 0;
        if (reset) newAmount = 0;
        else if (amount !== undefined) newAmount = amount;
        else newAmount = currentAmount;
        await pool.query('INSERT INTO corporate_fund (amount, updated_at) VALUES ($1, CURRENT_TIMESTAMP)', [newAmount]);
        res.json({ success: true, amount: newAmount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/fund/add', authMiddleware, async (req, res) => {
    const { sum } = req.body;
    if (!sum || sum === 0) return res.json({ success: true });
    try {
        const current = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1');
        const currentAmount = current.rows.length > 0 ? current.rows[0].amount : 0;
        const newAmount = currentAmount + sum;
        await pool.query('INSERT INTO corporate_fund (amount, updated_at) VALUES ($1, CURRENT_TIMESTAMP)', [newAmount]);
        res.json({ success: true, amount: newAmount });
    } catch (err) {
        res.json({ success: true });
    }
});

// ============================================
// ГЛОБАЛЬНАЯ ТЕМА API
// ============================================

app.get('/api/admin/theme', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key = $1', ['global_theme']);
        let theme = 'vr-portal';
        if (result.rows.length > 0 && result.rows[0].setting_value) {
            theme = result.rows[0].setting_value;
        }
        res.json({ success: true, theme: theme });
    } catch (err) {
        res.json({ success: true, theme: 'vr-portal' });
    }
});

app.post('/api/admin/theme', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { theme } = req.body;
    const validThemes = ['vr-portal', 'hacker', 'glitch', 'explosion', 'depth', 'charge'];
    if (!validThemes.includes(theme)) return res.status(400).json({ error: 'Неверное название темы' });
    try {
        await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('global_theme', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`, [theme]);
        res.json({ success: true, theme: theme });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// USER STYLES API
// ============================================

app.post('/api/user/apply-style', authMiddleware, async (req, res) => {
    const { style } = req.body;
    const userId = req.user.id;
    try {
        await pool.query('UPDATE employees SET dashboard_style = $1 WHERE id = $2', [style, userId]);
        res.json({ success: true, style: style });
    } catch (err) {
        res.json({ success: true, style: style });
    }
});

app.post('/api/user/buy-style', authMiddleware, async (req, res) => {
    const { style, price } = req.body;
    const userId = req.user.id;
    try {
        const userResult = await pool.query('SELECT coins FROM employees WHERE id = $1', [userId]);
        const currentCoins = userResult.rows[0]?.coins || 0;
        if (currentCoins < price) return res.status(400).json({ error: 'Недостаточно монет' });
        
        const balanceBefore = currentCoins;
        const balanceAfter = balanceBefore - price;
        
        await pool.query('UPDATE employees SET coins = coins - $1 WHERE id = $2', [price, userId]);
        await logTransaction(userId, 'shop_purchase', -price, balanceBefore, balanceAfter, null, `Покупка стиля "${style}"`);
        
        let boughtStyles = ['glass'];
        const styleResult = await pool.query('SELECT bought_styles FROM employees WHERE id = $1', [userId]);
        if (styleResult.rows[0]?.bought_styles) {
            try { boughtStyles = JSON.parse(styleResult.rows[0].bought_styles); } catch(e) {}
        }
        if (!boughtStyles.includes(style)) boughtStyles.push(style);
        await pool.query('UPDATE employees SET bought_styles = $1 WHERE id = $2', [JSON.stringify(boughtStyles), userId]);
        
        const achievementResult = await checkAndGrantAchievements(userId, req.user.username);
        
        res.json({ 
            success: true, 
            boughtStyles: boughtStyles, 
            remainingCoins: balanceAfter,
            newAchievements: achievementResult.achievements
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ДОСТИЖЕНИЯ API
// ============================================

app.get('/api/achievements', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    try {
        const achievementsRes = await pool.query('SELECT * FROM achievements ORDER BY sort_order, id');
        
        const userAchievementsRes = await pool.query(
            'SELECT achievement_id FROM user_achievements WHERE user_id = $1',
            [userId]
        );
        
        const pendingAchievementsRes = await pool.query(
            'SELECT achievement_id FROM pending_achievements WHERE user_id = $1',
            [userId]
        );
        
        const unlockedIds = new Set(userAchievementsRes.rows.map(r => r.achievement_id));
        const pendingIds = new Set(pendingAchievementsRes.rows.map(r => r.achievement_id));
        
        const achievements = achievementsRes.rows.map(ach => ({
            id: ach.id,
            name: ach.name,
            description: ach.description,
            category: ach.category,
            required: ach.required_value,
            coins: ach.coins_reward,
            unlocked: unlockedIds.has(ach.id),
            pending: pendingIds.has(ach.id)
        }));
        
        res.json({ success: true, achievements });
    } catch (err) {
        console.error('Ошибка получения достижений:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/achievements/claim', authMiddleware, async (req, res) => {
    const { achievementId } = req.body;
    const userId = req.user.id;
    
    try {
        // Проверяем, не получено ли уже
        const existing = await pool.query(
            'SELECT id FROM user_achievements WHERE user_id = $1 AND achievement_id = $2',
            [userId, achievementId]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Награда уже получена' });
        }
        
        // Проверяем, есть ли в pending
        const pending = await pool.query(
            'SELECT id FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2',
            [userId, achievementId]
        );
        
        if (pending.rows.length === 0) {
            return res.status(400).json({ error: 'Достижение ещё не выполнено' });
        }
        
        const achRes = await pool.query('SELECT * FROM achievements WHERE id = $1', [achievementId]);
        if (achRes.rows.length === 0) {
            return res.status(404).json({ error: 'Достижение не найдено' });
        }
        const achievement = achRes.rows[0];
        
        const userRes = await pool.query('SELECT coins FROM employees WHERE id = $1', [userId]);
        const balanceBefore = userRes.rows[0]?.coins || 0;
        const balanceAfter = balanceBefore + achievement.coins_reward;
        
        await pool.query('UPDATE employees SET coins = coins + $1 WHERE id = $2', [achievement.coins_reward, userId]);
        
        // 🔥 Удаляем ТОЛЬКО ЭТО достижение из pending
        await pool.query('DELETE FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2', [userId, achievementId]);
        
        // 🔥 Добавляем ТОЛЬКО ЭТО достижение в user_achievements
        await pool.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)', [userId, achievementId]);
        
        await logTransaction(userId, 'achievement', achievement.coins_reward, balanceBefore, balanceAfter, null, `Награда за достижение "${achievement.name}"`);
        
        res.json({ success: true, coins: achievement.coins_reward, balance: balanceAfter });
        
    } catch (err) {
        console.error('Ошибка получения награды:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/achievements/check', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const username = req.user.username;
        const result = await checkAndGrantAchievements(userId, username);
        res.json({ success: true, newAchievements: result.achievements });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/init-achievements', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    try {
        await initAchievements();
        res.json({ success: true, message: 'Достижения инициализированы' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/achievements/:id/winners', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const winnersRes = await pool.query(`SELECT e.name FROM user_achievements ua JOIN employees e ON ua.user_id = e.id WHERE ua.achievement_id = $1 ORDER BY ua.claimed_at`, [id]);
        res.json({ success: true, winners: winnersRes.rows.map(w => w.name) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// CRON JOBS
// ============================================

cron.schedule('5 0 * * *', async () => {
    console.log('🕐 Запуск начисления WP за смены...');
    await processShiftEarnings();
});

cron.schedule('0 * * * *', async () => {
    console.log('🕐 Проверка просроченных задач...');
    const count = await checkAndPenalizeOverdueTasks();
    if (count > 0) console.log(`⚠️ Создано ${count} нарушений за просроченные задачи`);
});

cron.schedule('0 * * * *', async () => {
    console.log('🕐 Проверка просроченных запросов на обмен...');
    await autoExpireExchangeRequests();
});

cron.schedule('0 3 * * *', async () => {
    console.log('📦 Запуск авто-архивации выполненных задач...');
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    try {
        const result = await pool.query(`UPDATE tasks SET is_archived = true, archived_at = CURRENT_TIMESTAMP WHERE status = 'completed' AND is_archived = false AND completed_at IS NOT NULL AND completed_at <= $1 RETURNING id, name`, [threeDaysAgo]);
        if (result.rows.length > 0) console.log(`✅ Заархивировано ${result.rows.length} задач`);
    } catch (err) {
        console.error('❌ Ошибка авто-архивации:', err);
    }
});

cron.schedule('0 * * * *', async () => {
    console.log('🕐 Запланированный парсинг погоды...');
    try {
        const weather = await fetchWeather();
        if (weather && !weather.isError) {
            console.log(`✅ Плановое обновление погоды: ${weather.temperatureDisplay}°C (${weather.source})`);
        }
    } catch (err) {
        console.error('❌ Ошибка планового парсинга погоды:', err.message);
    }
});

setTimeout(async () => {
    console.log('🔄 Первичный парсинг погоды...');
    try {
        const weather = await fetchWeather();
        if (weather && !weather.isError) {
            console.log(`✅ Погода при старте: ${weather.temperatureDisplay}°C (${weather.source})`);
        }
    } catch (err) {
        console.error('❌ Ошибка первичного парсинга погоды:', err.message);
    }
}, 5000);

// ============================================
// ЗАПУСК ПРОВЕРКИ ПРИ СТАРТЕ
// ============================================

setTimeout(async () => {
    await fetchWeather();
    const count = await checkAndPenalizeOverdueTasks();
    if (count > 0) console.log(`⚠️ При старте создано ${count} нарушений за просроченные задачи`);
    await processShiftEarnings();
    await autoExpireExchangeRequests();
}, 5000);

// ============================================
// PUSHER AUTH
// ============================================

app.post('/api/pusher/auth', (req, res) => {
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    const token = req.headers['authorization']?.split(' ')[1];
    let user = null;
    if (token) {
        try { user = jwt.verify(token, JWT_SECRET); } catch(err) {}
    }
    if (!user) user = { username: 'guest', role: 'guest', id: 0 };
    try {
        if (!channel.startsWith('private-')) {
            return res.send(pusher.authorizeChannel(socketId, channel));
        }
        if (channel === 'private-warpoint-sync') {
            const auth = pusher.authorizeChannel(socketId, channel, { user_id: user.username, user_info: { name: user.username, role: user.role } });
            return res.send(auth);
        }
        if (channel.startsWith('private-user-')) {
            const targetUser = channel.replace('private-user-', '');
            const currentUserTranslit = transliterate(user.username);
            if (currentUserTranslit === targetUser || user.role === 'director') {
                const auth = pusher.authorizeChannel(socketId, channel, { user_id: user.username, user_info: { name: user.username, role: user.role } });
                return res.send(auth);
            } else {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }
        const auth = pusher.authorizeChannel(socketId, channel);
        res.send(auth);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============================================
// АДМИН: СБРОС ДАННЫХ
// ============================================

// 🧹 Чистый лист (удалить ВСЁ кроме директора) - БЕЗ СПЕЦ-ПРАВ
app.post('/api/admin/reset-all', authMiddleware, async (req, res) => {
    console.log('🧹 ===== ЗАПРОС НА ПОЛНЫЙ СБРОС ДАННЫХ =====');
    
    if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Только директор' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Получаем директора
        const directorRes = await client.query(`SELECT id, name FROM employees WHERE role = 'director' LIMIT 1`);
        if (directorRes.rows.length === 0) {
            throw new Error('Директор не найден!');
        }
        const directorId = directorRes.rows[0].id;
        const directorName = directorRes.rows[0].name;
        console.log(`👑 Директор: ${directorName} (ID: ${directorId})`);
        
        console.log('📋 1. Очистка зависимых таблиц...');
        
        // Удаляем в правильном порядке (сначала зависимые таблицы)
        await client.query(`DELETE FROM user_achievements`);
        await client.query(`DELETE FROM pending_achievements`);
        await client.query(`DELETE FROM user_statuses`);
        await client.query(`DELETE FROM transactions`);
        await client.query(`DELETE FROM daily_bonus_history`);
        await client.query(`DELETE FROM shift_earnings`);
        await client.query(`DELETE FROM stickers`);
        await client.query(`DELETE FROM knowledge_views`);
        await client.query(`DELETE FROM subtasks`);
        await client.query(`DELETE FROM task_attachments`);
        await client.query(`DELETE FROM tasks`);
        await client.query(`DELETE FROM fine_attachments`);
        await client.query(`DELETE FROM fines`);
        await client.query(`DELETE FROM schedule_special_cases`);
        await client.query(`DELETE FROM schedule`);
        await client.query(`DELETE FROM exchange_requests`);
        await client.query(`DELETE FROM messages`);
        await client.query(`DELETE FROM global_notifications`);
        
        console.log('📋 2. Удаление сотрудников (кроме директора)...');
        
        // Теперь можно удалить сотрудников
        await client.query(`DELETE FROM employees WHERE id != $1`, [directorId]);
        await client.query(`DELETE FROM passwords WHERE username != $1`, [directorName]);
        
        console.log('📋 3. Очистка оставшихся таблиц...');
        
        // Таблицы без внешних ключей к employees
        await client.query(`DELETE FROM vp_bookings`);
        await client.query(`DELETE FROM salary_daily_new`);
        await client.query(`DELETE FROM knowledge_articles`);
        await client.query(`DELETE FROM knowledge_categories`);
        
        console.log('📋 4. Сброс статистики директора и фонда...');
        
        // Сброс статистики директора
        await client.query(`UPDATE employees SET coins = 100, rating = 0, hours = 0, bonus_streak = 1, last_bonus_claimed_at = NULL, active_status = NULL, status = '💼 Работаю' WHERE id = $1`, [directorId]);
        
        // Сброс фонда
        await client.query(`DELETE FROM corporate_fund`);
        await client.query(`INSERT INTO corporate_fund (amount) VALUES (0)`);
        
        await client.query('COMMIT');
        console.log('✅ Полный сброс завершён');
        
        res.json({ success: true, message: '✅ Все данные сброшены. Чистый лист!' });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка сброса:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});
// 🚀 Равный старт - БЕЗ СПЕЦ-ПРАВ
app.post('/api/admin/equal-start', authMiddleware, async (req, res) => {
    console.log('🚀 ===== ЗАПРОС НА РАВНЫЙ СТАРТ =====');
    
    if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Только директор' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('📋 Очистка таблиц...');
        
        // Удаляем в правильном порядке
        await client.query(`DELETE FROM user_achievements`);
        await client.query(`DELETE FROM pending_achievements`);
        await client.query(`DELETE FROM user_statuses`);
        await client.query(`DELETE FROM transactions`);
        await client.query(`DELETE FROM daily_bonus_history`);
        await client.query(`DELETE FROM shift_earnings`);
        await client.query(`DELETE FROM stickers`);
        await client.query(`DELETE FROM subtasks`);
        await client.query(`DELETE FROM task_attachments`);
        await client.query(`DELETE FROM tasks`);
        await client.query(`DELETE FROM fine_attachments`);
        await client.query(`DELETE FROM fines`);
        await client.query(`DELETE FROM schedule_special_cases`);
        await client.query(`DELETE FROM schedule`);
        await client.query(`DELETE FROM exchange_requests`);
        await client.query(`DELETE FROM messages`);
        await client.query(`DELETE FROM global_notifications`);
        
        console.log('📋 Сброс статистики сотрудников...');
        
        // Сброс статистики (НЕ УДАЛЯЕМ СОТРУДНИКОВ)
        await client.query(`UPDATE employees SET coins = 100, rating = 0, hours = 0, bonus_streak = 1, last_bonus_claimed_at = NULL, active_status = NULL, status = '💼 Работаю'`);
        
        
        // Фонд
        await client.query(`DELETE FROM corporate_fund`);
        await client.query(`INSERT INTO corporate_fund (amount) VALUES (0)`);
        
        await client.query('COMMIT');
        console.log('✅ Равный старт завершён');
        
        res.json({ success: true, message: '🚀 Равный старт! Статистика обнулена.' });
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка равного старта:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});
// ============================================
// STATIC & START
// ============================================

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/reports.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'pages', 'reports.html')); });
app.get('/about.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'about.html')); });

// Инициализация базы данных и достижений при запуске
(async () => {
    await initDatabase();
    await initAchievements();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 WARPOINT Server running on port ${PORT}`);
        console.log(`👤 Директор: Денис / denis_1`);
        console.log(`💰 Новая экономика WP-коинов активна!`);
        console.log(`🔄 Автоматический обмен сменами активен!`);
        console.log(`📊 Вкладки: Задачи, Нарушения, График, ВП, Зарплата`);
        console.log(`🏆 Система достижений: 235+ достижений!\n`);
    });
})();