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
app.use(bodyParser.json());
app.use(express.static('public'));

// Инициализация Pusher
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

const DATA_FILE = path.join(__dirname, 'data', 'storage.json');

function initStorage() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            employees: [],
            profiles: {},
            passwords: {},
            tasks: [],
            fines: [],
            schedule: {},
            messages: { general: [] }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    }
}

function loadData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch(e) {
        return { employees: [], profiles: {}, passwords: {}, tasks: [], fines: [], schedule: {}, messages: { general: [] } };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function broadcastEvent(event, data) {
    try {
        await pusher.trigger('private-warpoint-staff', event, data);
        console.log(`📡 Event sent: ${event}`);
    } catch(e) { 
        console.error('Pusher error:', e);
    }
}

// ==================== API ENDPOINTS ====================

// Получить все данные
app.get('/api/data', (req, res) => {
    res.json(loadData());
});

// Сохранить все данные
app.post('/api/data', async (req, res) => {
    const data = req.body;
    saveData(data);
    await broadcastEvent('full-update', data);
    res.json({ success: true });
});

// Создать сотрудника
app.post('/api/employees', async (req, res) => {
    const { employee, profile, login, password } = req.body;
    const data = loadData();
    if (data.employees.includes(employee)) {
        return res.status(400).json({ error: 'Сотрудник уже существует' });
    }
    data.employees.push(employee);
    data.profiles[employee] = profile;
    data.passwords[login || employee] = password;
    saveData(data);
    await broadcastEvent('client-employee-add', { employee, profile, login: login || employee, password });
    res.json({ success: true });
});

// Удалить сотрудника
app.delete('/api/employees/:name', async (req, res) => {
    const { name } = req.params;
    const data = loadData();
    data.employees = data.employees.filter(e => e !== name);
    delete data.profiles[name];
    // Удаляем пароль, если он был
    if(data.passwords[name]) delete data.passwords[name];
    saveData(data);
    await broadcastEvent('client-employee-delete', { employee: name, login: name });
    res.json({ success: true });
});

// Обновить профиль
app.put('/api/profiles/:name', async (req, res) => {
    const { name } = req.params;
    const { updates, user } = req.body;
    const data = loadData();
    if (data.profiles[name]) {
        data.profiles[name] = { ...data.profiles[name], ...updates };
        saveData(data);
        await broadcastEvent('client-profile-update', { employee: name, updates, user });
    }
    res.json({ success: true });
});

// Отправить подарок
app.post('/api/gifts', async (req, res) => {
    const { recipient, giftId, giftName, price, ratingChange, sender } = req.body;
    const data = loadData();
    if (data.profiles[recipient]) {
        data.profiles[recipient].coins -= price;
        data.profiles[recipient].rating += ratingChange;
        if (!data.profiles[recipient].stickers) data.profiles[recipient].stickers = {};
        if (!data.profiles[recipient].stickers[giftId]) data.profiles[recipient].stickers[giftId] = 0;
        data.profiles[recipient].stickers[giftId]++;
        saveData(data);
        await broadcastEvent('client-gift-send', { recipient, giftId, giftName, price, ratingChange, sender });
    }
    res.json({ success: true });
});

// Добавить задачу
app.post('/api/tasks', async (req, res) => {
    const { task } = req.body;
    const data = loadData();
    data.tasks.push(task);
    saveData(data);
    await broadcastEvent('client-task-add', { task });
    res.json({ success: true });
});

// Обновить задачу
app.put('/api/tasks/:index', async (req, res) => {
    const { index } = req.params;
    const { status } = req.body;
    const data = loadData();
    if (data.tasks[index]) {
        data.tasks[index].status = status;
        saveData(data);
        await broadcastEvent('client-task-update', { index: parseInt(index), status });
    }
    res.json({ success: true });
});

// Удалить задачу
app.delete('/api/tasks/:index', async (req, res) => {
    const { index } = req.params;
    const data = loadData();
    if (data.tasks[index]) {
        data.tasks.splice(parseInt(index), 1);
        saveData(data);
        await broadcastEvent('client-task-delete', { index: parseInt(index) });
    }
    res.json({ success: true });
});

// Добавить нарушение
app.post('/api/fines', async (req, res) => {
    const { fine } = req.body;
    const data = loadData();
    data.fines.push(fine);
    saveData(data);
    await broadcastEvent('client-fine-add', { fine });
    res.json({ success: true });
});

// Обновить нарушение
app.put('/api/fines/:index', async (req, res) => {
    const { index } = req.params;
    const { updates } = req.body;
    const data = loadData();
    if (data.fines[index]) {
        data.fines[index] = { ...data.fines[index], ...updates };
        saveData(data);
        await broadcastEvent('client-fine-update', { index: parseInt(index), updates });
    }
    res.json({ success: true });
});

// Удалить нарушение
app.delete('/api/fines/:index', async (req, res) => {
    const { index } = req.params;
    const data = loadData();
    if (data.fines[index]) {
        data.fines.splice(parseInt(index), 1);
        saveData(data);
        await broadcastEvent('client-fine-delete', { index: parseInt(index) });
    }
    res.json({ success: true });
});

// Сообщение в чат
app.post('/api/chat', async (req, res) => {
    const { room, message } = req.body;
    const data = loadData();
    if (!data.messages[room]) data.messages[room] = [];
    data.messages[room].push(message);
    saveData(data);
    await broadcastEvent('client-chat-message', { room, message });
    res.json({ success: true });
});

// Обновить график
app.post('/api/schedule', async (req, res) => {
    const { date, shifts } = req.body;
    const data = loadData();
    data.schedule[date] = shifts;
    saveData(data);
    await broadcastEvent('client-schedule-update', { date, shifts });
    res.json({ success: true });
});

// Установить пароль
app.post('/api/passwords', async (req, res) => {
    const { user, password } = req.body;
    const data = loadData();
    data.passwords[user] = password;
    saveData(data);
    await broadcastEvent('client-password-update', { user, password });
    res.json({ success: true });
});

// Бонусы всем
app.post('/api/admin/bonus', async (req, res) => {
    const { coins, rating } = req.body;
    const data = loadData();
    data.employees.forEach(e => {
        if (data.profiles[e]) {
            data.profiles[e].coins += coins;
            data.profiles[e].rating += rating;
        }
    });
    saveData(data);
    await broadcastEvent('client-admin-bonus', { coins, rating });
    res.json({ success: true });
});

// Сброс всех данных
app.post('/api/admin/reset', async (req, res) => {
    const initialData = {
        employees: [],
        profiles: {},
        passwords: {},
        tasks: [],
        fines: [],
        schedule: {},
        messages: { general: [] }
    };
    saveData(initialData);
    await broadcastEvent('client-reset-all-data', { confirm: 'yes' });
    res.json({ success: true });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
initStorage();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WARPOINT Backend запущен!`);
    console.log(`📍 Адрес: http://localhost:${PORT}`);
    console.log(`📡 Pusher канал: private-warpoint-staff`);
    console.log(`📁 Данные хранятся в: ${DATA_FILE}\n`);
});
