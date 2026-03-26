const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// Инициализация Pusher с проверкой наличия ключей
let pusher = null;
if (process.env.PUSHER_KEY && process.env.PUSHER_KEY !== 'your_pusher_key') {
    pusher = new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.PUSHER_CLUSTER || 'ap1',
        useTLS: true
    });
    console.log('✅ Pusher инициализирован');
} else {
    console.log('⚠️ Pusher не настроен, работа в офлайн режиме');
}

const DATA_FILE = path.join(__dirname, 'data', 'storage.json');

function initStorage() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('📁 Создана папка data');
    }
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            employees: ['Денис'],
            profiles: {
                'Денис': {
                    avatar: '👑',
                    name: 'Денис',
                    status: '💼 Работаю',
                    coins: 1000,
                    rating: 100,
                    background: 'bg_default',
                    role: 'director',
                    hours: 0,
                    stickers: {}
                }
            },
            passwords: {
                'Денис': 'admin101'
            },
            tasks: [],
            fines: [],
            schedule: {},
            messages: { general: [] }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('📁 Создан файл данных:', DATA_FILE);
    }
}

function loadData() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        // Инициализация отсутствующих полей
        if (!data.messages) data.messages = { general: [] };
        if (!data.schedule) data.schedule = {};
        if (!data.fines) data.fines = [];
        if (!data.tasks) data.tasks = [];
        if (!data.passwords) data.passwords = {};
        if (!data.profiles) data.profiles = {};
        if (!data.employees) data.employees = [];
        
        // Инициализация stickers для всех профилей
        Object.keys(data.profiles).forEach(key => {
            if (!data.profiles[key].stickers) data.profiles[key].stickers = {};
            if (data.profiles[key].hours === undefined) data.profiles[key].hours = 0;
            if (data.profiles[key].coins === undefined) data.profiles[key].coins = 100;
            if (data.profiles[key].rating === undefined) data.profiles[key].rating = 0;
        });
        
        return data;
    } catch (e) {
        console.error('Ошибка загрузки данных:', e);
        return { 
            employees: ['Денис'], 
            profiles: {
                'Денис': {
                    avatar: '👑',
                    name: 'Денис',
                    status: '💼 Работаю',
                    coins: 1000,
                    rating: 100,
                    background: 'bg_default',
                    role: 'director',
                    hours: 0,
                    stickers: {}
                }
            }, 
            passwords: { 'Денис': 'admin101' }, 
            tasks: [], 
            fines: [], 
            schedule: {}, 
            messages: { general: [] } 
        };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('Ошибка сохранения данных:', e);
        return false;
    }
}

async function broadcastEvent(event, data) {
    if (pusher) {
        try {
            await pusher.trigger('public-warpoint-sync', event, data);
            console.log(`📡 Event sent: ${event}`);
        } catch (e) {
            console.error('Pusher error:', e);
        }
    } else {
        console.log(`📡 [OFFLINE] Event: ${event}`, data);
    }
}

// API ENDPOINTS
app.get('/api/data', (req, res) => {
    const data = loadData();
    res.json(data);
});

app.post('/api/data', async (req, res) => {
    const saved = saveData(req.body);
    if (saved) {
        await broadcastEvent('full-update', req.body);
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения данных' });
    }
});

app.post('/api/employees', async (req, res) => {
    const { employee, profile, login, password } = req.body;
    const data = loadData();
    
    if (data.employees.includes(employee)) {
        return res.status(400).json({ error: 'Сотрудник уже существует' });
    }
    
    data.employees.push(employee);
    data.profiles[employee] = profile;
    data.passwords[login || employee] = password;
    
    if (saveData(data)) {
        await broadcastEvent('client-employee-add', { 
            employee, 
            profile, 
            login: login || employee, 
            password 
        });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.delete('/api/employees/:name', async (req, res) => {
    const { name } = req.params;
    const data = loadData();
    
    data.employees = data.employees.filter(e => e !== name);
    delete data.profiles[name];
    delete data.passwords[name];
    
    // Удаляем задачи, связанные с этим сотрудником
    data.tasks = data.tasks.filter(t => t.author !== name && t.executor !== name);
    
    if (saveData(data)) {
        await broadcastEvent('client-employee-delete', { employee: name, login: name });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.put('/api/profiles/:name', async (req, res) => {
    const { name } = req.params;
    const { updates, user } = req.body;
    const data = loadData();
    
    if (data.profiles[name]) {
        data.profiles[name] = { ...data.profiles[name], ...updates };
        
        // Если изменилось имя, обновляем во всех связанных данных
        if (updates.name && updates.name !== name) {
            const oldName = name;
            const newName = updates.name;
            
            // Обновляем в employees
            const index = data.employees.indexOf(oldName);
            if (index !== -1) data.employees[index] = newName;
            
            // Обновляем в tasks
            data.tasks = data.tasks.map(t => ({
                ...t,
                author: t.author === oldName ? newName : t.author,
                executor: t.executor === oldName ? newName : t.executor,
                authorName: t.authorName === oldName ? newName : t.authorName
            }));
            
            // Обновляем в fines
            data.fines = data.fines.map(f => ({
                ...f,
                employee: f.employee === oldName ? newName : f.employee
            }));
            
            // Обновляем в passwords
            if (data.passwords[oldName]) {
                data.passwords[newName] = data.passwords[oldName];
                delete data.passwords[oldName];
            }
            
            // Обновляем в schedule
            Object.keys(data.schedule).forEach(date => {
                if (data.schedule[date][oldName]) {
                    data.schedule[date][newName] = data.schedule[date][oldName];
                    delete data.schedule[date][oldName];
                }
            });
        }
        
        if (saveData(data)) {
            await broadcastEvent('client-profile-update', { employee: name, updates, user });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Сотрудник не найден' });
    }
});

app.post('/api/gifts', async (req, res) => {
    const { recipient, giftId, giftName, price, ratingChange, sender, quantity = 1 } = req.body;
    const data = loadData();
    
    if (data.profiles[recipient]) {
        // Находим отправителя для списания монет
        const senderName = sender === '🕵️ Аноним' ? null : sender;
        if (senderName && data.profiles[senderName]) {
            data.profiles[senderName].coins -= price;
        }
        
        data.profiles[recipient].coins -= price;
        data.profiles[recipient].rating += ratingChange;
        
        if (!data.profiles[recipient].stickers) data.profiles[recipient].stickers = {};
        if (!data.profiles[recipient].stickers[giftId]) data.profiles[recipient].stickers[giftId] = 0;
        data.profiles[recipient].stickers[giftId] += quantity;
        
        if (saveData(data)) {
            await broadcastEvent('client-gift-send', { 
                recipient, 
                giftId, 
                giftName, 
                price, 
                ratingChange, 
                sender,
                quantity 
            });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Получатель не найден' });
    }
});

app.post('/api/tasks', async (req, res) => {
    const { task } = req.body;
    const data = loadData();
    
    // Добавляем ID для задачи
    const taskWithId = {
        ...task,
        id: Date.now(),
        createdAt: new Date().toISOString()
    };
    
    data.tasks.push(taskWithId);
    
    if (saveData(data)) {
        await broadcastEvent('client-task-add', { task: taskWithId });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.put('/api/tasks/:index', async (req, res) => {
    const { index } = req.params;
    const { status } = req.body;
    const data = loadData();
    const idx = parseInt(index);
    
    if (data.tasks[idx]) {
        data.tasks[idx].status = status;
        if (status === 'Выполнено' && !data.tasks[idx].completedAt) {
            data.tasks[idx].completedAt = new Date().toISOString();
        }
        
        if (saveData(data)) {
            await broadcastEvent('client-task-update', { index: idx, status });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Задача не найдена' });
    }
});

app.delete('/api/tasks/:index', async (req, res) => {
    const { index } = req.params;
    const data = loadData();
    const idx = parseInt(index);
    
    if (data.tasks[idx]) {
        data.tasks.splice(idx, 1);
        
        if (saveData(data)) {
            await broadcastEvent('client-task-delete', { index: idx });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Задача не найдена' });
    }
});

app.post('/api/fines', async (req, res) => {
    const { fine } = req.body;
    const data = loadData();
    
    const fineWithId = {
        ...fine,
        id: Date.now(),
        createdAt: new Date().toISOString()
    };
    
    data.fines.push(fineWithId);
    
    if (saveData(data)) {
        await broadcastEvent('client-fine-add', { fine: fineWithId });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.put('/api/fines/:index', async (req, res) => {
    const { index } = req.params;
    const { updates } = req.body;
    const data = loadData();
    const idx = parseInt(index);
    
    if (data.fines[idx]) {
        data.fines[idx] = { ...data.fines[idx], ...updates };
        
        if (saveData(data)) {
            await broadcastEvent('client-fine-update', { index: idx, updates });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Нарушение не найдено' });
    }
});

app.delete('/api/fines/:index', async (req, res) => {
    const { index } = req.params;
    const data = loadData();
    const idx = parseInt(index);
    
    if (data.fines[idx]) {
        data.fines.splice(idx, 1);
        
        if (saveData(data)) {
            await broadcastEvent('client-fine-delete', { index: idx });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Ошибка сохранения' });
        }
    } else {
        res.status(404).json({ error: 'Нарушение не найдено' });
    }
});

app.post('/api/chat', async (req, res) => {
    const { room, message } = req.body;
    const data = loadData();
    
    if (!data.messages[room]) data.messages[room] = [];
    data.messages[room].push(message);
    
    // Ограничиваем количество сообщений в чате (последние 500)
    if (data.messages[room].length > 500) {
        data.messages[room] = data.messages[room].slice(-500);
    }
    
    if (saveData(data)) {
        await broadcastEvent('client-chat-message', { room, message });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/schedule', async (req, res) => {
    const { date, shifts } = req.body;
    const data = loadData();
    
    data.schedule[date] = shifts;
    
    if (saveData(data)) {
        await broadcastEvent('client-schedule-update', { date, shifts });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/passwords', async (req, res) => {
    const { user, password } = req.body;
    const data = loadData();
    
    data.passwords[user] = password;
    
    if (saveData(data)) {
        await broadcastEvent('client-password-update', { user, password });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/admin/bonus', async (req, res) => {
    const { coins, rating } = req.body;
    const data = loadData();
    
    data.employees.forEach(e => {
        if (data.profiles[e]) {
            data.profiles[e].coins += coins;
            data.profiles[e].rating += rating;
        }
    });
    
    if (saveData(data)) {
        await broadcastEvent('client-admin-bonus', { coins, rating });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сохранения' });
    }
});

app.post('/api/admin/reset', async (req, res) => {
    const initialData = { 
        employees: ['Денис'], 
        profiles: {
            'Денис': {
                avatar: '👑',
                name: 'Денис',
                status: '💼 Работаю',
                coins: 1000,
                rating: 100,
                background: 'bg_default',
                role: 'director',
                hours: 0,
                stickers: {}
            }
        }, 
        passwords: { 'Денис': 'admin101' }, 
        tasks: [], 
        fines: [], 
        schedule: {}, 
        messages: { general: [] } 
    };
    
    if (saveData(initialData)) {
        await broadcastEvent('client-reset-all-data', { confirm: 'yes' });
        res.json({ success: true });
    } else {
        res.status(500).json({ error: 'Ошибка сброса данных' });
    }
});

// Дополнительный эндпоинт для статистики
app.get('/api/stats', (req, res) => {
    const data = loadData();
    const stats = {
        totalEmployees: data.employees.length,
        totalTasks: data.tasks.length,
        completedTasks: data.tasks.filter(t => t.status === 'Выполнено').length,
        totalFines: data.fines.length,
        totalFinesAmount: data.fines.reduce((sum, f) => sum + (f.amount || 0), 0),
        topEmployee: null
    };
    
    // Находим сотрудника с максимальным рейтингом
    if (data.employees.length > 0) {
        let topEmployee = data.employees[0];
        let maxRating = data.profiles[topEmployee]?.rating || 0;
        
        data.employees.forEach(e => {
            const rating = data.profiles[e]?.rating || 0;
            if (rating > maxRating) {
                maxRating = rating;
                topEmployee = e;
            }
        });
        
        stats.topEmployee = { name: topEmployee, rating: maxRating };
    }
    
    res.json(stats);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера
initStorage();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WARPOINT Backend запущен!`);
    console.log(`📍 Адрес: http://localhost:${PORT}`);
    console.log(`📡 Pusher канал: public-warpoint-sync`);
    console.log(`📁 Файл данных: ${DATA_FILE}`);
    console.log(`👤 Тестовый вход: логин "Денис", пароль "admin101"\n`);
});
