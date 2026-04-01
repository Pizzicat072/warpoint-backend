const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');

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
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true
});

pool.on('connect', () => console.log('📊 Database connected'));
pool.on('error', (err) => console.error('❌ Database error:', err));

async function initDatabase() {
    const queries = [
        // Существующие таблицы
        `CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            avatar VARCHAR(10) DEFAULT '👤',
            status VARCHAR(100) DEFAULT '💼 Работаю',
            coins INTEGER DEFAULT 100,
            rating INTEGER DEFAULT 0,
            role VARCHAR(50) DEFAULT 'operator',
            hours INTEGER DEFAULT 0,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS stickers (
            id SERIAL PRIMARY KEY,
            employee VARCHAR(100) NOT NULL,
            gift_id VARCHAR(50) NOT NULL,
            quantity INTEGER DEFAULT 1,
            UNIQUE(employee, gift_id)
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ЗАДАЧ
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ПОДЗАДАЧ
        `CREATE TABLE IF NOT EXISTS subtasks (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            completed BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ВЛОЖЕНИЙ ЗАДАЧ
        `CREATE TABLE IF NOT EXISTS task_attachments (
            id SERIAL PRIMARY KEY,
            task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            file_data TEXT,
            file_size INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ НАРУШЕНИЙ
        `CREATE TABLE IF NOT EXISTS fines (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            type VARCHAR(50) NOT NULL,
            amount INTEGER DEFAULT 0,
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
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ДОКАЗАТЕЛЬСТВ НАРУШЕНИЙ
        `CREATE TABLE IF NOT EXISTS fine_attachments (
            id SERIAL PRIMARY KEY,
            fine_id INTEGER REFERENCES fines(id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            file_data TEXT,
            file_size INTEGER,
            type VARCHAR(20) DEFAULT 'evidence',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ГРАФИКА (с поддержкой статусов)
        `CREATE TABLE IF NOT EXISTS schedule (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            employee VARCHAR(100) NOT NULL,
            shift_time VARCHAR(10),
            shift_status VARCHAR(30) DEFAULT 'working',
            version INTEGER DEFAULT 1,
            UNIQUE(date, employee)
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ВП (Игры/Мероприятия/ПО)
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
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ЗАРПЛАТЫ (сотрудники)
        `CREATE TABLE IF NOT EXISTS salary_employees (
            id SERIAL PRIMARY KEY,
            employee_name VARCHAR(100) UNIQUE NOT NULL,
            employee_type VARCHAR(20) DEFAULT 'Администратор',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ЗАРПЛАТЫ (ежедневные начисления)
        `CREATE TABLE IF NOT EXISTS salary_daily (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES salary_employees(id) ON DELETE CASCADE,
            motivation_type VARCHAR(50) NOT NULL,
            day_number INTEGER NOT NULL,
            amount INTEGER DEFAULT 0,
            month_year DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, motivation_type, day_number, month_year)
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ФОНДА НА КОРПОРАТИВ
        `CREATE TABLE IF NOT EXISTS corporate_fund (
            id SERIAL PRIMARY KEY,
            amount INTEGER DEFAULT 0,
            period_type VARCHAR(20) DEFAULT 'all',
            period_start DATE,
            period_end DATE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // НОВАЯ ТАБЛИЦА ДЛЯ ИСТОРИИ ФОНДА
        `CREATE TABLE IF NOT EXISTS corporate_fund_history (
            id SERIAL PRIMARY KEY,
            amount INTEGER NOT NULL,
            type VARCHAR(20) NOT NULL,
            reason TEXT,
            fine_id INTEGER REFERENCES fines(id) NULL,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        
        // Индексы
        `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
        `CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)`,
        `CREATE INDEX IF NOT EXISTS idx_fines_employee ON fines(employee)`,
        `CREATE INDEX IF NOT EXISTS idx_fines_status ON fines(status)`,
        `CREATE INDEX IF NOT EXISTS idx_schedule_date ON schedule(date)`,
        `CREATE INDEX IF NOT EXISTS idx_vp_bookings_date ON vp_bookings(event_date)`,
        `CREATE INDEX IF NOT EXISTS idx_salary_daily_month ON salary_daily(month_year)`
    ];
    
    for (const query of queries) {
        try {
            await pool.query(query);
        } catch (err) {
            console.error('Error creating table:', err.message);
        }
    }
    
    // Создание директора
    try {
        const directorCheck = await pool.query('SELECT * FROM employees WHERE name = $1', ['Денис']);
        if (directorCheck.rows.length === 0) {
            await pool.query('INSERT INTO employees (name, avatar, coins, rating, role) VALUES ($1, $2, $3, $4, $5)', ['Денис', '👑', 10000, 500, 'director']);
            await pool.query('INSERT INTO passwords (username, password) VALUES ($1, $2)', ['Денис', 'denis_1']);
            console.log('✅ Директор Денис создан');
        }
    } catch (err) {}
    
    // Инициализация сотрудников для зарплаты
    try {
        const salaryEmployees = ['Адм.-Катя', 'Адм.-Даня', 'Адм.-Кирилл', 'Опер.-Игорь', 'Опер.-Андрей', 'Опер.-Ярослав', 'Опер.-Демид'];
        for (const emp of salaryEmployees) {
            await pool.query(`INSERT INTO salary_employees (employee_name) VALUES ($1) ON CONFLICT (employee_name) DO NOTHING`, [emp]);
        }
    } catch (err) {}
    
    // Инициализация фонда
    try {
        const fundCheck = await pool.query('SELECT * FROM corporate_fund LIMIT 1');
        if (fundCheck.rows.length === 0) {
            await pool.query('INSERT INTO corporate_fund (amount, period_type) VALUES (0, $1)', ['all']);
        }
    } catch (err) {}
    
    console.log('✅ Database initialized');
}

connectWithRetry().then(connected => { if (connected) initDatabase(); });

async function connectWithRetry(retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const client = await pool.connect();
            client.release();
            console.log('✅ PostgreSQL connected!');
            return true;
        } catch (err) {
            console.log(`⚠️ Attempt ${i + 1}/${retries} failed`);
            if (i === retries - 1) return false;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    return false;
}

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
// AUTH
// ============================================

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await pool.query('SELECT * FROM passwords WHERE username = $1', [username]);
        if (user.rows.length > 0 && user.rows[0].password === password) {
            const profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
            await pool.query('UPDATE employees SET last_active = CURRENT_TIMESTAMP WHERE name = $1', [username]);
            const token = jwt.sign({ username: username, role: profile.rows[0].role, id: profile.rows[0].id }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, user: profile.rows[0], token });
        } else {
            res.status(401).json({ error: 'Неверный логин или пароль' });
        }
    } catch (err) { 
        res.status(500).json({ error: err.message });
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
            if (!scheduleByDate[s.date]) scheduleByDate[s.date] = {};
            scheduleByDate[s.date][s.employee] = { time: s.shift_time, status: s.shift_status };
        });
        
        res.json({
            employees: employees.rows.map(e => e.name),
            profiles: employees.rows.reduce((acc, e) => { acc[e.name] = e; return acc; }, {}),
            tasks: tasks.rows,
            fines: fines.rows,
            schedule: scheduleByDate,
            messages: messagesByRoom
        });
    } catch (err) { 
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TASKS API
// ============================================

app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY deadline ASC, created_at DESC');
        for (const task of tasks.rows) {
            const subtasks = await pool.query('SELECT * FROM subtasks WHERE task_id = $1', [task.id]);
            task.subtasks = subtasks.rows;
            const attachments = await pool.query('SELECT id, filename, file_size FROM task_attachments WHERE task_id = $1', [task.id]);
            task.attachments = attachments.rows;
        }
        res.json(tasks.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    const { task } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, progress, comment, recurring, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [task.name, task.author, task.executor, task.priority, task.deadline, task.progress || 0, task.comment, task.recurring, task.status || 'in_progress']
        );
        if (task.subtasks) {
            for (const sub of task.subtasks) {
                await client.query('INSERT INTO subtasks (task_id, name) VALUES ($1, $2)', [result.rows[0].id, sub.name]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        await pool.query(
            `UPDATE tasks SET name = $1, executor = $2, priority = $3, deadline = $4, progress = $5, comment = $6, status = $7, updated_at = CURRENT_TIMESTAMP
             WHERE id = $8`,
            [updates.name, updates.executor, updates.priority, updates.deadline, updates.progress, updates.comment, updates.status, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// FINES API
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO fines (date, employee, type, amount, description, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [fine.date, fine.employee, fine.type, fine.amount, fine.description, fine.status, fine.createdBy]
        );
        
        // Если штраф сразу подтверждён (директором) — добавляем в фонд
        if (fine.status === 'approved') {
            const fund = await client.query('SELECT * FROM corporate_fund LIMIT 1');
            const newAmount = (fund.rows[0]?.amount || 0) + fine.amount;
            await client.query('UPDATE corporate_fund SET amount = $1, updated_at = CURRENT_TIMESTAMP', [newAmount]);
            await client.query(
                `INSERT INTO corporate_fund_history (amount, type, reason, fine_id, created_by)
                 VALUES ($1, $2, $3, $4, $5)`,
                [fine.amount, 'auto', 'Штраф', result.rows[0].id, req.user.username]
            );
        }
        
        await client.query('COMMIT');
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/fines/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        await pool.query(
            `UPDATE fines SET status = $1, amount = $2, director_comment = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
            [updates.status, updates.amount, updates.comment, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// SCHEDULE API
// ============================================

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

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedule');
        res.json(schedule.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// VP API
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
// SALARY API
// ============================================

app.get('/api/salary', authMiddleware, async (req, res) => {
    const { month, year } = req.query;
    try {
        const monthYear = `${year}-${String(month).padStart(2, '0')}-01`;
        const employees = await pool.query('SELECT * FROM salary_employees WHERE is_active = true ORDER BY employee_name');
        const dailyData = await pool.query('SELECT * FROM salary_daily WHERE month_year = $1', [monthYear]);
        res.json({ employees: employees.rows, dailyData: dailyData.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/salary/update', authMiddleware, async (req, res) => {
    const { employee_id, motivation_type, day_number, amount, month_year } = req.body;
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
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
// CORPORATE FUND API
// ============================================

app.get('/api/fund', authMiddleware, async (req, res) => {
    try {
        const fund = await pool.query('SELECT * FROM corporate_fund LIMIT 1');
        const history = await pool.query('SELECT * FROM corporate_fund_history ORDER BY created_at DESC LIMIT 50');
        res.json({ fund: fund.rows[0] || { amount: 0, period_type: 'all' }, history: history.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/fund/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { amount, period_type, period_start, period_end, manual_amount, manual_reason, reset } = req.body;
    try {
        if (reset) {
            await pool.query('UPDATE corporate_fund SET amount = 0, updated_at = CURRENT_TIMESTAMP');
            await pool.query('INSERT INTO corporate_fund_history (amount, type, reason, created_by) VALUES (0, $1, $2, $3)', ['reset', 'Обнуление фонда', req.user.username]);
        } else if (manual_amount !== undefined) {
            const fund = await pool.query('SELECT * FROM corporate_fund LIMIT 1');
            const newAmount = (fund.rows[0]?.amount || 0) + manual_amount;
            await pool.query('UPDATE corporate_fund SET amount = $1, updated_at = CURRENT_TIMESTAMP', [newAmount]);
            await pool.query('INSERT INTO corporate_fund_history (amount, type, reason, created_by) VALUES ($1, $2, $3, $4)', [Math.abs(manual_amount), manual_amount > 0 ? 'manual_add' : 'manual_remove', manual_reason, req.user.username]);
        }
        if (period_type) {
            await pool.query('UPDATE corporate_fund SET period_type = $1, period_start = $2, period_end = $3, updated_at = CURRENT_TIMESTAMP', [period_type, period_start, period_end]);
        }
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
        await pool.query('INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)', [room, message.sender, message.text, message.time]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// EMPLOYEES API
// ============================================

app.post('/api/employees', authMiddleware, async (req, res) => {
    const { name, role, password } = req.body;
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    try {
        await pool.query('INSERT INTO employees (name, role) VALUES ($1, $2)', [name, role || 'operator']);
        await pool.query('INSERT INTO passwords (username, password) VALUES ($1, $2)', [name, password]);
        await pool.query('INSERT INTO salary_employees (employee_name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
        res.json({ success: true });
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
        await pool.query('UPDATE salary_employees SET is_active = false WHERE employee_name = $1', [name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profiles/:name', authMiddleware, async (req, res) => {
    const { name } = req.params;
    const updates = req.body;
    try {
        const setClause = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
        await pool.query(`UPDATE employees SET ${setClause} WHERE name = $1`, [name, ...Object.values(updates)]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// GIFTS API
// ============================================

app.post('/api/gifts', authMiddleware, async (req, res) => {
    const { recipient, giftId, giftName, price, ratingChange, sender, quantity } = req.body;
    try {
        if (sender !== '🕵️ Аноним') {
            await pool.query('UPDATE employees SET coins = coins - $1 WHERE name = $2', [price * quantity, sender]);
        }
        await pool.query('UPDATE employees SET coins = coins - $1, rating = rating + $2 WHERE name = $3', [price * quantity, ratingChange * quantity, recipient]);
        await pool.query(
            `INSERT INTO stickers (employee, gift_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (employee, gift_id) DO UPDATE SET quantity = stickers.quantity + $3`,
            [recipient, giftId, quantity]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ADMIN BONUS
// ============================================

app.post('/api/admin/bonus/all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { coins, rating } = req.body;
    try {
        await pool.query('UPDATE employees SET coins = coins + $1, rating = rating + $2', [coins || 0, rating || 0]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/bonus/employee', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { name, coins, rating } = req.body;
    try {
        await pool.query('UPDATE employees SET coins = coins + $1, rating = rating + $2 WHERE name = $3', [coins || 0, rating || 0, name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// KNOWLEDGE BASE (заглушки)
// ============================================

app.get('/api/knowledge/categories', authMiddleware, async (req, res) => {
    res.json([]);
});

app.post('/api/knowledge/categories', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.delete('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.post('/api/knowledge/articles', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    res.json({ success: true });
});

app.get('/api/knowledge/files/:id', authMiddleware, async (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============================================
// STATIC & START
// ============================================

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/reports.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reports.html')); });

process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled Rejection:', reason); });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WARPOINT Server running on port ${PORT}`);
    console.log(`👤 Директор: Денис / denis_1`);
    console.log(`📊 Вкладки: Задачи, Нарушения, График, ВП, Зарплата\n`);
});