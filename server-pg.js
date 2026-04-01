const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'warpoint-secret-key-2024';

// ============================================
// POSTGRESQL CONNECTION
// ============================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('connect', () => console.log('📊 PostgreSQL connected'));
pool.on('error', (err) => console.error('❌ Database error:', err.message));

// ============================================
// MIDDLEWARE - ВАЖНО: правильные CORS настройки
// ============================================
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============================================
// AUTH MIDDLEWARE - ИСПРАВЛЕННЫЙ
// ============================================
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    console.log('Auth header:', authHeader ? 'present' : 'missing');
    
    if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('Token verified for:', decoded.username);
        req.user = decoded;
        
        // Обновляем last_active
        await pool.query('UPDATE employees SET last_active = $1 WHERE name = $2', [Date.now(), decoded.username]);
        
        next();
    } catch (err) {
        console.error('JWT verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid token', details: err.message });
    }
};

// ============================================
// AUTH LOGIN
// ============================================
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    
    try {
        // Временный fallback для Дениса
        if (username === 'Денис' && password === 'denis_1') {
            console.log('✅ Temporary auth for Денис');
            
            let profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
            
            if (profile.rows.length === 0) {
                await pool.query(
                    'INSERT INTO employees (name, avatar, coins, rating, role, last_active) VALUES ($1, $2, $3, $4, $5, $6)',
                    ['Денис', '👑', 10000, 500, 'director', Date.now()]
                );
                profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
            }
            
            const token = jwt.sign(
                { username: username, role: profile.rows[0].role, id: profile.rows[0].id },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            console.log('Token created, sending response');
            return res.json({ success: true, token: token, user: profile.rows[0] });
        }
        
        // Нормальная проверка
        const user = await pool.query('SELECT * FROM passwords WHERE username = $1', [username]);
        if (user.rows.length > 0) {
            const valid = await bcrypt.compare(password, user.rows[0].password_hash);
            if (valid) {
                const profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
                await pool.query('UPDATE employees SET last_active = $1 WHERE name = $2', [Date.now(), username]);
                
                const token = jwt.sign(
                    { username: username, role: profile.rows[0].role, id: profile.rows[0].id },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );
                
                return res.json({ success: true, token: token, user: profile.rows[0] });
            }
        }
        
        res.status(401).json({ error: 'Неверный логин или пароль' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /data - с authMiddleware
// ============================================
app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        console.log('Fetching data for:', req.user.username);
        
        const employees = await pool.query('SELECT * FROM employees ORDER BY name');
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500');
        const fines = await pool.query('SELECT * FROM fines ORDER BY date DESC LIMIT 500');
        const messages = await pool.query('SELECT * FROM messages ORDER BY time DESC LIMIT 1000');
        const schedule = await pool.query('SELECT * FROM schedule');
        
        const messagesByRoom = {};
        messages.rows.forEach(msg => {
            if (!messagesByRoom[msg.room]) messagesByRoom[msg.room] = [];
            messagesByRoom[msg.room].push(msg);
        });
        
        const scheduleByDate = {};
        schedule.rows.forEach(s => {
            if (!scheduleByDate[s.date]) scheduleByDate[s.date] = {};
            scheduleByDate[s.date][s.employee] = { time: s.shift_time, status: s.shift_status };
        });
        
        const profiles = {};
        employees.rows.forEach(e => {
            profiles[e.name] = e;
        });
        
        res.json({
            employees: employees.rows.map(e => e.name),
            profiles: profiles,
            tasks: tasks.rows,
            fines: fines.rows,
            schedule: scheduleByDate,
            messages: messagesByRoom
        });
    } catch (err) {
        console.error('Error in /api/data:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /tasks
// ============================================
app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY deadline ASC NULLS LAST, created_at DESC');
        res.json(tasks.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    const { task } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, progress, comment, recurring, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [task.name, task.author, task.executor, task.priority, task.deadline, task.progress || 0, task.comment, task.recurring, task.status || 'in_progress']
        );
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /fines
// ============================================
app.get('/api/fines', authMiddleware, async (req, res) => {
    try {
        const fines = await pool.query('SELECT * FROM fines ORDER BY date DESC');
        res.json(fines.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/fines', authMiddleware, async (req, res) => {
    const { fine } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO fines (date, employee, type, severity, amount, description, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [fine.date, fine.employee, fine.type, fine.severity, fine.amount || 0, fine.description, fine.status || 'pending', fine.createdBy]
        );
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /schedule
// ============================================
app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedule');
        res.json(schedule.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status } = req.body;
    try {
        await pool.query(
            `INSERT INTO schedule (date, employee, shift_time, shift_status, version)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (date, employee) DO UPDATE SET
             shift_time = $3, shift_status = $4, version = schedule.version + 1`,
            [date, employee, shift_time || null, shift_status || 'working']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /vp
// ============================================
app.get('/api/vp', authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    try {
        let query = 'SELECT * FROM vp_bookings WHERE cancelled = false';
        const params = [];
        if (month && year) {
            query += ` AND EXTRACT(MONTH FROM event_date) = $1 AND EXTRACT(YEAR FROM event_date) = $2`;
            params.push(parseInt(month), parseInt(year));
        }
        query += ' ORDER BY event_date DESC, event_time DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    const { vp } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, photo_status, script_status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [vp.admin, vp.eventDate, vp.eventTime, vp.customerName, vp.amount, vp.paymentType, vp.bookingDate, vp.photoStatus, vp.scriptStatus, req.user.username]
        );
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        await pool.query(
            `UPDATE vp_bookings SET admin = $1, event_date = $2, event_time = $3, customer_name = $4, amount = $5, payment_type = $6, photo_status = $7, script_status = $8, updated_at = CURRENT_TIMESTAMP
             WHERE id = $9`,
            [updates.admin, updates.eventDate, updates.eventTime, updates.customerName, updates.amount, updates.paymentType, updates.photoStatus, updates.scriptStatus, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/vp/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE vp_bookings SET cancelled = true, cancelled_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /salary
// ============================================
app.get('/api/salary', authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    try {
        const monthYear = `${year}-${String(month).padStart(2, '0')}-01`;
        const employees = await pool.query('SELECT * FROM salary_employees WHERE is_active = true ORDER BY employee_name');
        const dailyData = await pool.query('SELECT * FROM salary_daily WHERE month_year = $1', [monthYear]);
        const motivations = ['Оклад', 'Мероприятие', 'Премия с оборота', 'Премия за 35 тыс.', 'Ролик', 'Уборка с/у'];
        res.json({ employees: employees.rows, dailyData: dailyData.rows, motivations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/salary/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { employee_id, motivation_type, day_number, amount, month_year } = req.body;
    try {
        await pool.query(
            `INSERT INTO salary_daily (employee_id, motivation_type, day_number, amount, month_year)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (employee_id, motivation_type, day_number, month_year)
             DO UPDATE SET amount = $4, updated_at = CURRENT_TIMESTAMP`,
            [employee_id, motivation_type, day_number, amount, month_year]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// API /employees
// ============================================
app.post('/api/employees', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { name, role, password } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        await pool.query('INSERT INTO employees (name, role) VALUES ($1, $2)', [name, role || 'operator']);
        await pool.query('INSERT INTO passwords (username, password_hash) VALUES ($1, $2)', [name, hash]);
        await pool.query('INSERT INTO salary_employees (employee_name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// STATIC & START
// ============================================
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// Создание таблиц
async function initDatabase() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE, avatar VARCHAR(10) DEFAULT '👤', status VARCHAR(100) DEFAULT '💼 Работаю', coins INTEGER DEFAULT 100, rating INTEGER DEFAULT 0, role VARCHAR(50) DEFAULT 'operator', hours INTEGER DEFAULT 0, last_active BIGINT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS passwords (username VARCHAR(100) PRIMARY KEY, password_hash VARCHAR(255))`,
        `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, room VARCHAR(100), sender VARCHAR(100), text TEXT, time BIGINT)`,
        `CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, name VARCHAR(255), author VARCHAR(100), executor VARCHAR(100), priority VARCHAR(20) DEFAULT 'medium', deadline DATE, progress INTEGER DEFAULT 0, comment TEXT, recurring VARCHAR(20) DEFAULT 'none', status VARCHAR(20) DEFAULT 'in_progress', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS fines (id SERIAL PRIMARY KEY, date DATE, employee VARCHAR(100), type VARCHAR(50), severity VARCHAR(20), amount INTEGER DEFAULT 0, description TEXT, status VARCHAR(30) DEFAULT 'pending', created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS schedule (id SERIAL PRIMARY KEY, date DATE, employee VARCHAR(100), shift_time VARCHAR(10), shift_status VARCHAR(30) DEFAULT 'working', UNIQUE(date, employee))`,
        `CREATE TABLE IF NOT EXISTS vp_bookings (id SERIAL PRIMARY KEY, admin VARCHAR(50), event_date DATE, event_time TIME, customer_name VARCHAR(255), amount INTEGER DEFAULT 2000, payment_type VARCHAR(30) DEFAULT 'evotor_card', booking_date DATE, photo_status VARCHAR(20) DEFAULT 'pending', script_status VARCHAR(20) DEFAULT 'not_sent', cancelled BOOLEAN DEFAULT FALSE, created_by VARCHAR(100), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS salary_employees (id SERIAL PRIMARY KEY, employee_name VARCHAR(100) UNIQUE, is_active BOOLEAN DEFAULT TRUE)`,
        `CREATE TABLE IF NOT EXISTS salary_daily (id SERIAL PRIMARY KEY, employee_id INTEGER REFERENCES salary_employees(id), motivation_type VARCHAR(50), day_number INTEGER, amount INTEGER DEFAULT 0, month_year DATE, UNIQUE(employee_id, motivation_type, day_number, month_year))`
    ];
    
    for (const q of queries) {
        try { await pool.query(q); } catch (err) { console.error('Table error:', err.message); }
    }
    
    try {
        const director = await pool.query('SELECT * FROM employees WHERE name = $1', ['Денис']);
        if (director.rows.length === 0) {
            const hash = await bcrypt.hash('denis_1', 10);
            await pool.query('INSERT INTO employees (name, avatar, coins, rating, role) VALUES ($1, $2, $3, $4, $5)', ['Денис', '👑', 10000, 500, 'director']);
            await pool.query('INSERT INTO passwords (username, password_hash) VALUES ($1, $2)', ['Денис', hash]);
            console.log('✅ Директор создан');
        }
    } catch (err) {}
    
    console.log('✅ Database initialized');
}

// Запуск
initDatabase().catch(console.error);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WARPOINT Server running on port ${PORT}`);
    console.log(`👤 Директор: Денис / denis_1\n`);
});