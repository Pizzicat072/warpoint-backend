const express = require('express');
const cors = require('cors');
const Pusher = require('pusher');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

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

// Путь к файлу хранилища
const DATA_FILE = path.join(__dirname, 'data', 'storage.json');

// Инициализация хранилища
function initStorage() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            employees: [],
            profiles: {},
            scheduleData: {},
            monthsList: [],
            tasks: [],
            lastActivity: {}
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    }
}

function loadData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { employees: [], profiles: {}, tasks: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function broadcastEvent(event, data) {
    try {
        await pusher.trigger('public-warpoint-sync', event, data);
        console.log(`📡 Event sent: ${event}`);
    } catch(e) { 
        console.error('Pusher error:', e);
    }
}

// API ENDPOINTS
app.get('/api/data', (req, res) => {
    res.json(loadData());
});

app.post('/api/employees', async (req, res) => {
    const { employee, profile } = req.body;
    const data = loadData();
    if (data.employees.includes(employee)) {
        return res.status(400).json({ error: 'Сотрудник уже существует' });
    }
    data.employees.push(employee);
    data.profiles[employee] = profile;
    saveData(data);
    await broadcastEvent('client-employee-add', { employee, profile });
    res.json({ success: true });
});

app.delete('/api/employees/:name', async (req, res) => {
    const { name } = req.params;
    const data = loadData();
    data.employees = data.employees.filter(e => e !== name);
    delete data.profiles[name];
    saveData(data);
    await broadcastEvent('client-employee-delete', { employee: name });
    res.json({ success: true });
});

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

app.post('/api/tasks', async (req, res) => {
    const { task } = req.body;
    const data = loadData();
    data.tasks.push(task);
    saveData(data);
    await broadcastEvent('client-task-add', { task });
    res.json({ success: true });
});

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

app.delete('/api/tasks/completed', async (req, res) => {
    const data = loadData();
    data.tasks = data.tasks.filter(t => t.status !== 'Выполнено');
    saveData(data);
    await broadcastEvent('client-task-delete', { all: true });
    res.json({ success: true });
});

app.delete('/api/admin/reset', async (req, res) => {
    const initialData = {
        employees: [],
        profiles: {},
        scheduleData: {},
        monthsList: [],
        tasks: [],
        lastActivity: {}
    };
    saveData(initialData);
    await broadcastEvent('client-reset-all-data', { confirm: 'yes' });
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
initStorage();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WARPOINT Backend запущен!`);
    console.log(`📍 Адрес: http://localhost:${PORT}`);
    console.log(`📡 Pusher публичный канал: public-warpoint-sync`);
});