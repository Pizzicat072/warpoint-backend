const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// Убираем жесткий путь к Chrome, пусть puppeteer сам ищет или берет из @sparticuz/chromium
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'warpoint-secret-key-2024';

// ============================================
// ОБРАБОТКА НЕОБРАБОТАННЫХ ОШИБОК
// ============================================

process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err.message);
    // Не завершаем процесс!
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION:', reason);
    // Не завершаем процесс!
});

// ============================================
// POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000
});

pool.on('connect', () => console.log('📊 Database connected'));
pool.on('error', (err) => console.error('❌ Database error:', err));

// ============================================
// PUSHER CONFIG (С ОГРАНИЧЕНИЕМ РЕКОННЕКТОВ)
// ============================================

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID || '2132614',
    key: process.env.PUSHER_KEY || '91e6eb7093c4b16a3275',
    secret: process.env.PUSHER_SECRET || 'bdb04959199327724ca8',
    cluster: process.env.PUSHER_CLUSTER || 'ap1',
    useTLS: true,
    maxRetries: 3,
    retryDelay: 5000
});

app.set('pusher', pusher);

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Таймаут для всех запросов
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
// INIT DATABASE (С МИГРАЦИЯМИ)
// ============================================

async function initDatabase() {
    const tableQueries = [
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
            is_archived BOOLEAN DEFAULT FALSE,
            penalty_applied BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP DEFAULT NULL,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS schedule (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            shift_time VARCHAR(10),
            shift_status VARCHAR(30) DEFAULT 'working',
            shift_paid BOOLEAN DEFAULT FALSE,
            UNIQUE(date, employee)
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            room VARCHAR(100) NOT NULL,
            sender VARCHAR(100) NOT NULL,
            text TEXT NOT NULL,
            time BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    for (const query of tableQueries) {
        try {
            await pool.query(query);
        } catch (err) {
            console.error('Error creating table:', err.message);
        }
    }
    
    // Миграции
    try {
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS penalty_applied BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP DEFAULT NULL`);
        await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE schedule ADD COLUMN IF NOT EXISTS shift_paid BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS bonus_streak INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_bonus_claimed_at TIMESTAMP DEFAULT NULL`);
        console.log('✅ Миграции: добавлены недостающие колонки');
    } catch (err) {
        console.log('⚠️ Ошибка миграций:', err.message);
    }
    
    // Создаём директора
    try {
        const directorCheck = await pool.query('SELECT * FROM employees WHERE role = $1 LIMIT 1', ['director']);
        if (directorCheck.rows.length === 0) {
            await pool.query(
                `INSERT INTO employees (name, avatar, coins, rating, role, bonus_streak) 
                 VALUES ($1, $2, $3, $4, $5, $6)`, 
                ['Денис', '👑', 100, 0, 'director', 1]
            );
            await pool.query('INSERT INTO passwords (username, password) VALUES ($1, $2)', ['Денис', 'denis_1']);
            console.log('✅ Директор Денис создан');
        }
    } catch (err) {}
    
    console.log('✅ Database initialized');
}

// ============================================
// API ENDPOINTS (ТОЛЬКО ОСНОВНЫЕ)
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
            
            res.json({ 
                success: true, 
                user: profile.rows[0], 
                token,
                newAchievements: []
            });
            
        } else {
            res.status(401).json({ error: 'Неверный логин или пароль' });
        }
    } catch (err) {
        console.error('❌ Ошибка входа:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        const employees = await pool.query('SELECT * FROM employees ORDER BY name');
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100');
        const schedule = await pool.query('SELECT * FROM schedule');
        
        const scheduleByDate = {};
        schedule.rows.forEach(s => {
            const dateStr = s.date instanceof Date ? s.date.toISOString().split('T')[0] : s.date;
            if (!scheduleByDate[dateStr]) scheduleByDate[dateStr] = {};
            scheduleByDate[dateStr][s.employee] = { time: s.shift_time, status: s.shift_status };
        });
        
        res.json({
            employees: employees.rows.map(e => e.name),
            profiles: employees.rows.reduce((acc, e) => { 
                acc[e.name] = {
                    id: e.id, name: e.name, avatar: e.avatar, avatar_url: e.avatar_url,
                    status: e.status, coins: e.coins, rating: e.rating, role: e.role,
                    hours: e.hours, bonus_streak: e.bonus_streak || 1,
                    active_status: e.active_status
                };
                return acc; 
            }, {}),
            tasks: tasks.rows,
            schedule: scheduleByDate,
            messages: {}
        });
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

app.get('/api/weather', async (req, res) => {
    res.json({ 
        success: true, 
        temp: 0, 
        tempDisplay: '0', 
        feelsLike: null, 
        feelsLikeDisplay: null, 
        desc: 'Тестовый режим', 
        icon: '🌡️' 
    });
});

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
// СТАТИЧЕСКИЕ ФАЙЛЫ
// ============================================

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/about.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'about.html')); });

// ============================================
// МОНИТОРИНГ ПАМЯТИ (КАЖДЫЕ 30 СЕКУНД)
// ============================================

setInterval(() => {
    const used = process.memoryUsage();
    console.log(`📊 Память: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}/${Math.round(used.heapTotal / 1024 / 1024)}MB`);
    
    // Если памяти больше 400 MB — принудительный перезапуск
    if (used.rss > 400 * 1024 * 1024) {
        console.error('❌ КРИТИЧЕСКАЯ УТЕЧКА ПАМЯТИ! Перезапуск через 5 секунд...');
        setTimeout(() => process.exit(1), 5000);
    }
}, 30000);

// ============================================
// ЗАПУСК СЕРВЕРА (БЕЗ ФОНОВЫХ ЗАДАЧ!)
// ============================================

(async () => {
    await initDatabase();
    
    // initAchievements() отключен для теста
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 WARPOINT Server running on port ${PORT}`);
        console.log(`👤 Директор: Денис / denis_1`);
        console.log(`⚠️ ТЕСТОВЫЙ РЕЖИМ: все фоновые задачи отключены`);
        console.log(`📊 Мониторинг памяти включен\n`);
    });
})();