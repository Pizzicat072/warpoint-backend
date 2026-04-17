// ============================================
// GIFTS API (ИСПРАВЛЕНО: учёт отправителя)
// ============================================

app.post('/api/gifts', authMiddleware, async (req, res) => {
    const { recipient, giftId, price, ratingChange, sender, quantity } = req.body;
    const totalCost = price * (quantity || 1);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        if (sender !== '🕵️ Аноним') { 
            const senderResult = await client.query('SELECT id, coins FROM employees WHERE name = $1', [sender]); 
            if (senderResult.rows.length > 0 && senderResult.rows[0].coins >= totalCost) { 
                const balanceBefore = senderResult.rows[0].coins;
                const balanceAfter = balanceBefore - totalCost;
                await client.query('UPDATE employees SET coins = coins - $1 WHERE name = $2', [totalCost, sender]); 
                await logTransaction(senderResult.rows[0].id, 'gift_send', -totalCost, balanceBefore, balanceAfter, null, `Подарок для ${recipient}`);
            } else {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Недостаточно монет' });
            }
        }
        
        const recipientResult = await client.query('SELECT id, coins FROM employees WHERE name = $1', [recipient]);
        if (recipientResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Получатель не найден' });
        }
        
        await client.query('UPDATE employees SET rating = rating + $1 WHERE name = $2', [ratingChange * (quantity || 1), recipient]);
        
        // 🔥 ИСПРАВЛЕНО: сохраняем отправителя
        const actualSender = sender === '🕵️ Аноним' ? '🕵️ Аноним' : sender;
        await client.query(
            `INSERT INTO stickers (sender, employee, gift_id, quantity) VALUES ($1, $2, $3, $4) 
             ON CONFLICT (employee, gift_id, sender) DO UPDATE SET quantity = stickers.quantity + $4`,
            [actualSender, recipient, giftId, quantity || 1]
        );
        
        await client.query('COMMIT');
        
        try { 
            await sendGlobalNotification('gift_sent', { sender: actualSender, recipient, giftName: giftId }); 
        } catch (err) {}
        
        const achievementResult = await checkAndGrantAchievements(recipientResult.rows[0].id, recipient);
        res.json({ success: true, newAchievements: achievementResult.achievements }); 
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

// ============================================
// WEATHER API
// ============================================

app.get('/api/weather', async (req, res) => {
    if (res.headersSent) return;
    
    try {
        const weather = await fetchWeather();
        if (res.headersSent) return;
        
        res.json({ 
            success: true, 
            temp: weather.temperature, 
            tempDisplay: weather.temperatureDisplay, 
            feelsLike: weather.feelsLike, 
            feelsLikeDisplay: weather.feelsLikeDisplay, 
            desc: weather.description, 
            icon: weather.icon 
        });
    } catch (err) {
        console.error('❌ Ошибка погоды:', err.message);
        if (!res.headersSent) {
            res.json({ success: true, temp: 0, tempDisplay: '0', desc: 'Нет данных', icon: '🌡️' });
        }
    }
});

// ============================================
// ACHIEVEMENTS API
// ============================================

app.get('/api/achievements', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query('SELECT * FROM achievements ORDER BY sort_order'); 
        const userAchievements = await pool.query('SELECT achievement_id FROM user_achievements WHERE user_id = $1', [req.user.id]); 
        const pendingAchievements = await pool.query('SELECT achievement_id FROM pending_achievements WHERE user_id = $1', [req.user.id]); 
        const unlockedIds = new Set(userAchievements.rows.map(r => r.achievement_id)); 
        const pendingIds = new Set(pendingAchievements.rows.map(r => r.achievement_id)); 
        const achievements = result.rows.map(ach => ({ ...ach, unlocked: unlockedIds.has(ach.id), pending: pendingIds.has(ach.id) })); 
        res.json({ success: true, achievements }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/achievements/claim', authMiddleware, async (req, res) => {
    const { achievementId } = req.body; 
    const userId = req.user.id;
    
    if (!achievementId) return res.status(400).json({ error: 'ID достижения обязателен' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const ach = await client.query('SELECT * FROM achievements WHERE id = $1', [achievementId]); 
        if (ach.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Достижение не найдено' });
        }
        
        const pending = await client.query('SELECT id FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2', [userId, achievementId]);
        if (pending.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Достижение не ожидает получения' });
        }
        
        const userRes = await client.query('SELECT coins FROM employees WHERE id = $1', [userId]);
        const balanceBefore = userRes.rows[0]?.coins || 0;
        const balanceAfter = balanceBefore + ach.rows[0].coins_reward;
        
        await client.query('UPDATE employees SET coins = coins + $1 WHERE id = $2', [ach.rows[0].coins_reward, userId]);
        await client.query('DELETE FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2', [userId, achievementId]);
        await client.query('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)', [userId, achievementId]);
        await logTransaction(userId, 'achievement', ach.rows[0].coins_reward, balanceBefore, balanceAfter, null, `Достижение: ${ach.rows[0].name}`);
        
        await client.query('COMMIT');
        res.json({ success: true, coins: ach.rows[0].coins_reward }); 
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

app.post('/api/achievements/check', authMiddleware, async (req, res) => {
    try { 
        const result = await checkAndGrantAchievements(req.user.id, req.user.username); 
        res.json({ success: true, newAchievements: result.achievements }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================
// PARSING API
// ============================================

const { BookingParser } = require('./parsing-booking.js');

app.get('/api/parsing/latest', authMiddleware, async (req, res) => {
    const dataPath = path.join(__dirname, 'data', 'booking-availability.json');
    try { 
        if (fs.existsSync(dataPath)) { 
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            res.json({ success: true, ...data }); 
        } else { 
            res.json({ success: false, error: 'Нет данных', dates: {} }); 
        } 
    } catch (err) { 
        console.error('❌ Ошибка чтения данных парсинга:', err);
        res.status(500).json({ success: false, error: err.message }); 
    }
});

app.get('/api/parsing/progress', authMiddleware, async (req, res) => {
    const progressPath = path.join(__dirname, 'data', 'parsing-progress.json');
    try { 
        if (fs.existsSync(progressPath)) { 
            const data = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
            res.json(data); 
        } else { 
            res.json({ step: 0, percent: 0, message: 'Ожидание запуска', isParsing: false }); 
        } 
    } catch (err) { 
        res.json({ step: 0, percent: 0, message: 'Ошибка', isParsing: false }); 
    }
});

app.post('/api/parsing/run', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    console.log('🚀 Запуск парсинга бронирований...');
    
    try { 
        const parser = new BookingParser(); 
        parser.parseAvailability().then(result => {
            console.log('✅ Парсинг завершён:', result.success ? 'успешно' : 'с ошибкой');
        }).catch(err => {
            console.error('❌ Ошибка парсинга:', err);
        });
        
        res.json({ success: true, message: 'Парсинг запущен' }); 
    } catch (err) { 
        console.error('❌ Ошибка запуска парсинга:', err);
        res.status(500).json({ success: false, error: err.message }); 
    }
});

app.post('/api/parsing/reset', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const progressPath = path.join(__dirname, 'data', 'parsing-progress.json');
    const dataPath = path.join(__dirname, 'data', 'booking-availability.json');
    try { 
        if (fs.existsSync(progressPath)) fs.unlinkSync(progressPath);
        if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
        res.json({ success: true, message: 'Данные парсинга сброшены' }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================
// USER API
// ============================================

app.get('/api/user/login-streak', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query(`SELECT last_bonus_claimed_at, bonus_streak FROM employees WHERE id = $1`, [req.user.id]); 
        const streak = result.rows[0]?.bonus_streak || 1; 
        const lastClaimed = result.rows[0]?.last_bonus_claimed_at; 
        const today = getTobolskNow().toISOString().split('T')[0]; 
        const hasClaimedToday = lastClaimed && new Date(lastClaimed).toISOString().split('T')[0] === today; 
        res.json({ success: true, streak, hasClaimedToday, nextBonusAmount: Math.min(streak + 1, 7) }); 
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
        res.json({ ...result, newAchievements }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
    try { 
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const result = await pool.query(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [req.user.id, limit]); 
        res.json({ success: true, transactions: result.rows }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

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
// STATUSES API
// ============================================

app.get('/api/statuses', authMiddleware, async (req, res) => {
    const statuses = [
        { id: 'lazy', name: '🦥 Профессиональный ленивец', icon: '🦥', price: 300, rating: 8, desc: 'Мастер откладывания' },
        { id: 'coffee', name: '☕ Кофеман', icon: '☕', price: 200, rating: 5, desc: 'Без кофе не работает' },
        { id: 'zombie', name: '🧟 Зомби', icon: '🧟', price: 250, rating: 6, desc: 'Работает на автопилоте' }
    ];
    res.json({ success: true, data: statuses });
});

app.get('/api/user/statuses', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query('SELECT * FROM user_statuses WHERE employee_id = $1', [req.user.id]); 
        res.json({ success: true, data: result.rows }); 
    } catch (err) { 
        res.json({ success: true, data: [] }); 
    }
});

app.post('/api/statuses/buy', authMiddleware, async (req, res) => {
    const { statusId, statusName, statusIcon, price, rating } = req.body; 
    const userId = req.user.id;
    
    if (!statusId || !statusName) return res.status(400).json({ error: 'Не указан статус' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const userResult = await client.query('SELECT coins FROM employees WHERE id = $1', [userId]); 
        const currentCoins = userResult.rows[0]?.coins || 0;
        if (currentCoins < price) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Недостаточно монет' });
        }
        
        const balanceBefore = currentCoins;
        const balanceAfter = balanceBefore - price;
        
        await client.query('UPDATE employees SET coins = coins - $1 WHERE id = $2', [price, userId]); 
        await logTransaction(userId, 'shop_purchase', -price, balanceBefore, balanceAfter, null, `Покупка статуса "${statusName}"`);
        await client.query(`INSERT INTO user_statuses (employee_id, status_id, status_name, status_icon, price, rating) VALUES ($1, $2, $3, $4, $5, $6)`, [userId, statusId, statusName, statusIcon, price, rating || 0]);
        
        await client.query('COMMIT');
        
        const achievementResult = await checkAndGrantAchievements(userId, req.user.username);
        res.json({ success: true, newAchievements: achievementResult.achievements }); 
    } catch (err) { 
        await client.query('ROLLBACK');
        if (err.code === '23505') return res.status(400).json({ error: 'Статус уже куплен' });
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

app.post('/api/statuses/activate', authMiddleware, async (req, res) => {
    const { statusId } = req.body; 
    const userId = req.user.id;
    if (!statusId) return res.status(400).json({ error: 'Не указан статус' });
    
    try { 
        await pool.query('UPDATE user_statuses SET is_active = FALSE WHERE employee_id = $1', [userId]); 
        await pool.query('UPDATE user_statuses SET is_active = TRUE WHERE employee_id = $1 AND status_id = $2', [userId, statusId]); 
        const status = await pool.query('SELECT status_name FROM user_statuses WHERE employee_id = $1 AND status_id = $2', [userId, statusId]); 
        if (status.rows.length > 0) { 
            await pool.query('UPDATE employees SET active_status = $1 WHERE id = $2', [status.rows[0].status_name, userId]); 
        } 
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
    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
    
    try { 
        const employees = await pool.query('SELECT id, name, role, avatar, avatar_url FROM employees WHERE role != $1', ['director']); 
        const dailyData = await pool.query('SELECT * FROM salary_daily_new WHERE month_year = $1', [monthYear]); 
        res.json({ success: true, employees: employees.rows, dailyData: dailyData.rows }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/salary/day', authMiddleware, async (req, res) => {
    const { employee_id, day, month, year } = req.query;
    const employeeId = parseInt(employee_id);
    const dayNumber = parseInt(day);
    
    if (isNaN(employeeId) || isNaN(dayNumber)) {
        return res.status(400).json({ error: 'Неверные параметры' });
    }
    
    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
    try {
        const result = await pool.query(
            `SELECT oklad, event, turnover, bonus35, video, extra_motivation 
             FROM salary_daily_new 
             WHERE employee_id = $1 AND day_number = $2 AND month_year = $3`,
            [employeeId, dayNumber, monthYear]
        );
        res.json(result.rows[0] || { oklad: 0, event: 0, turnover: 0, bonus35: 0, video: 0, extra_motivation: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/salary/day/save', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { employee_id, day_number, month, year, oklad, event, turnover, bonus35, video, extra_motivation } = req.body;
    
    if (!employee_id || !day_number) return res.status(400).json({ error: 'Не указаны обязательные поля' });
    
    const monthYear = `${year}-${String(month).padStart(2, '0')}`;
    try {
        await pool.query(
            `INSERT INTO salary_daily_new (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             ON CONFLICT (employee_id, day_number, month_year) 
             DO UPDATE SET oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover, 
                           bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation`,
            [employee_id, day_number, monthYear, oklad || 0, event || 0, turnover || 0, bonus35 || 0, video || 0, extra_motivation || 0]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// VP API
// ============================================

app.get('/api/vp', authMiddleware, async (req, res) => {
    const { month, year, archived } = req.query;
    let query = `SELECT * FROM vp_bookings WHERE EXTRACT(MONTH FROM event_date) = $1 AND EXTRACT(YEAR FROM event_date) = $2`;
    const params = [month, year];
    
    if (archived === 'false' || !archived) {
        query += ` AND (is_archived = FALSE OR is_archived IS NULL)`;
    }
    query += ` ORDER BY event_date DESC`;
    
    try { 
        const result = await pool.query(query, params); 
        res.json(result.rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const { vp } = req.body;
    if (!vp || !vp.customerName || !vp.admin || !vp.eventDate) {
        return res.status(400).json({ error: 'Не заполнены обязательные поля' });
    }
    
    // 🔥 Добавляем duration (по умолчанию 1)
    const duration = vp.duration || 1;
    
    try { 
        await pool.query(
            `INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, created_by, photo_status, script_status, duration) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'not_sent', $9)`,
            [vp.admin, vp.eventDate, vp.eventTime, vp.customerName, vp.amount, vp.paymentType, vp.bookingDate, req.user.username, duration]
        ); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    const { photoStatus, scriptStatus, is_archived, eventDate, eventTime, customerName, admin, amount, paymentType, comment, duration } = req.body;
    
    try {
        const existing = await pool.query('SELECT * FROM vp_bookings WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Мероприятие не найдено' });
        
        const validPhotoStatus = ['pending', 'sent'];
        const validScriptStatus = ['not_sent', 'sent'];
        
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        
        if (photoStatus !== undefined) {
            if (!validPhotoStatus.includes(photoStatus)) return res.status(400).json({ error: 'Неверный photoStatus' });
            updateFields.push(`photo_status = $${paramIndex++}`);
            values.push(photoStatus);
        }
        if (scriptStatus !== undefined) {
            if (!validScriptStatus.includes(scriptStatus)) return res.status(400).json({ error: 'Неверный scriptStatus' });
            updateFields.push(`script_status = $${paramIndex++}`);
            values.push(scriptStatus);
        }
        if (is_archived !== undefined) { updateFields.push(`is_archived = $${paramIndex++}`); values.push(is_archived); }
        if (eventDate !== undefined) { updateFields.push(`event_date = $${paramIndex++}`); values.push(eventDate); }
        if (eventTime !== undefined) { updateFields.push(`event_time = $${paramIndex++}`); values.push(eventTime); }
        if (customerName !== undefined) { updateFields.push(`customer_name = $${paramIndex++}`); values.push(customerName); }
        if (admin !== undefined) { updateFields.push(`admin = $${paramIndex++}`); values.push(admin); }
        if (amount !== undefined) { updateFields.push(`amount = $${paramIndex++}`); values.push(amount); }
        if (paymentType !== undefined) { updateFields.push(`payment_type = $${paramIndex++}`); values.push(paymentType); }
        if (comment !== undefined) { updateFields.push(`comment = $${paramIndex++}`); values.push(comment); }
if (duration !== undefined) {
    updateFields.push(`duration = $${paramIndex++}`);
    values.push(duration);
}
        
        if (updateFields.length > 0) {
            updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(id);
            await pool.query(`UPDATE vp_bookings SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`, values);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('VP update error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/vp/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    try { 
        await pool.query('DELETE FROM vp_bookings WHERE id = $1', [id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================
// KNOWLEDGE API
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
    if (req.user.role !== 'director' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Доступ запрещён' });
    }
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    
    try { 
        await pool.query('INSERT INTO knowledge_categories (name, icon) VALUES ($1, $2)', [name, icon || '📁']); 
        res.json({ success: true }); 
    } catch (err) { 
        if (err.code === '23505') return res.status(400).json({ error: 'Категория уже существует' });
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    const { name, icon } = req.body;
    try { 
        await pool.query('UPDATE knowledge_categories SET name = $1, icon = $2 WHERE id = $3', [name, icon, id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') return res.status(403).json({ error: 'Доступ запрещён' });
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    try { 
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
    if (!title || !category_id) return res.status(400).json({ error: 'Название и категория обязательны' });
    
    try { 
        await pool.query('INSERT INTO knowledge_articles (category_id, title, content, created_by) VALUES ($1, $2, $3, $4)', [category_id, title, content, req.user.username]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    const { title, content } = req.body;
    try { 
        await pool.query('UPDATE knowledge_articles SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [title, content, id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    try { 
        await pool.query('DELETE FROM knowledge_articles WHERE id = $1', [id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID статьи' });
    
    const userId = req.user.id;
    try {
        await pool.query('UPDATE knowledge_articles SET views = views + 1 WHERE id = $1', [id]);
        await pool.query(`INSERT INTO knowledge_views (user_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// FUND API
// ============================================

app.get('/api/fund', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1'); 
        res.json({ success: true, amount: result.rows[0]?.amount || 0 }); 
    } catch (err) { 
        res.json({ success: true, amount: 0 }); 
    }
});

app.post('/api/fund/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { amount, reset } = req.body;
    try { 
        if (reset) {
            await pool.query('INSERT INTO corporate_fund (amount) VALUES (0)');
        } else {
            await pool.query('INSERT INTO corporate_fund (amount) VALUES ($1)', [amount || 0]);
        }
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/fund/add', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { sum } = req.body;
    try { 
        const current = await pool.query('SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1'); 
        const newAmount = (current.rows[0]?.amount || 0) + sum; 
        await pool.query('INSERT INTO corporate_fund (amount) VALUES ($1)', [newAmount]); 
        res.json({ success: true, amount: newAmount }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================
// ADMIN API
// ============================================

app.get('/api/admin/theme', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key = $1', ['global_theme']); 
        res.json({ success: true, theme: result.rows[0]?.setting_value || 'vr-portal' }); 
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
        await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('global_theme', $1) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [theme]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/admin/bonus/employee', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { name, coins, rating } = req.body;
    
    if (coins < 0) return res.status(400).json({ error: 'Сумма монет не может быть отрицательной' });
    
    try { 
        await pool.query('UPDATE employees SET coins = coins + $1, rating = rating + $2 WHERE name = $3', [coins || 0, rating || 0, name]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/admin/reset-all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const directorRes = await client.query(`SELECT id, name FROM employees WHERE role = 'director' LIMIT 1`);
        if (directorRes.rows.length === 0) throw new Error('Директор не найден!');
        const directorId = directorRes.rows[0].id;
        const directorName = directorRes.rows[0].name;
        
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
        
        await client.query(`DELETE FROM employees WHERE id != $1`, [directorId]);
        await client.query(`DELETE FROM passwords WHERE username != $1`, [directorName]);
        
        await client.query(`DELETE FROM vp_bookings`);
        await client.query(`DELETE FROM salary_daily_new`);
        await client.query(`DELETE FROM knowledge_articles`);
        await client.query(`DELETE FROM knowledge_categories`);
        
        await client.query(`UPDATE employees SET coins = 100, rating = 0, hours = 0, bonus_streak = 1, last_bonus_claimed_at = NULL, active_status = NULL, status = '💼 Работаю' WHERE id = $1`, [directorId]);
        
        await client.query(`DELETE FROM corporate_fund`);
        await client.query(`INSERT INTO corporate_fund (amount) VALUES (0)`);
        
        await client.query('COMMIT');
        res.json({ success: true, message: '✅ Все данные сброшены. Чистый лист!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/admin/equal-start', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
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
        await client.query(`DELETE FROM vp_bookings`);
        await client.query(`DELETE FROM salary_daily_new`);
        
        await client.query(`UPDATE employees SET coins = 100, rating = 0, hours = 0, bonus_streak = 1, last_bonus_claimed_at = NULL, active_status = NULL, status = '💼 Работаю'`);
        
        await client.query(`DELETE FROM corporate_fund`);
        await client.query(`INSERT INTO corporate_fund (amount) VALUES (0)`);
        
        await client.query('COMMIT');
        res.json({ success: true, message: '🚀 Равный старт! Статистика обнулена у всех сотрудников.' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// USER STYLES API
// ============================================

app.post('/api/user/apply-style', authMiddleware, async (req, res) => {
    const { style } = req.body;
    try { 
        await pool.query('UPDATE employees SET dashboard_style = $1 WHERE id = $2', [style, req.user.id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/user/buy-style', authMiddleware, async (req, res) => {
    const { style, price } = req.body; 
    const userId = req.user.id;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const userResult = await client.query('SELECT coins FROM employees WHERE id = $1', [userId]);
        const currentCoins = userResult.rows[0]?.coins || 0;
        if (currentCoins < price) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Недостаточно монет' });
        }
        
        const balanceBefore = currentCoins;
        const balanceAfter = balanceBefore - price;
        
        await client.query('UPDATE employees SET coins = coins - $1 WHERE id = $2', [price, userId]);
        await logTransaction(userId, 'shop_purchase', -price, balanceBefore, balanceAfter, null, `Покупка стиля "${style}"`);
        
        let boughtStyles = ['glass'];
        const styleResult = await client.query('SELECT bought_styles FROM employees WHERE id = $1', [userId]);
        if (styleResult.rows[0]?.bought_styles) {
            try { boughtStyles = JSON.parse(styleResult.rows[0].bought_styles); } catch(e) {}
        }
        if (!boughtStyles.includes(style)) boughtStyles.push(style);
        await client.query('UPDATE employees SET bought_styles = $1 WHERE id = $2', [JSON.stringify(boughtStyles), userId]);
        
        await client.query('COMMIT');
        
        const achievementResult = await checkAndGrantAchievements(userId, req.user.username);
        res.json({ success: true, boughtStyles, remainingCoins: balanceAfter, newAchievements: achievementResult.achievements });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// EXCHANGE API
// ============================================

app.post('/api/exchange/create', authMiddleware, async (req, res) => {
    const { toEmployee, toDate, toShiftTime, fromDate, fromShiftTime, comment } = req.body;
    const fromEmployee = req.user.username;
    
    if (fromEmployee === toEmployee) return res.status(400).json({ error: 'Нельзя обменяться с самим собой' });
    
    const fromDateFormatted = formatDateToYMD(fromDate);
    const toDateFormatted = formatDateToYMD(toDate);
    
    const existing = await pool.query(
        `SELECT id FROM exchange_requests WHERE ((from_employee=$1 AND to_employee=$2) OR (from_employee=$2 AND to_employee=$1)) AND status='pending'`,
        [fromEmployee, toEmployee]
    );
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Активный запрос уже существует' });
    
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    
    const result = await pool.query(
        `INSERT INTO exchange_requests (from_employee, to_employee, from_date, to_date, from_shift_time, to_shift_time, comment, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [fromEmployee, toEmployee, fromDateFormatted, toDateFormatted, fromShiftTime, toShiftTime, comment, expiresAt]
    );
    
    const pusherInstance = app.get('pusher');
    if (pusherInstance) {
        pusherInstance.trigger(`private-user-${transliterate(toEmployee)}`, 'client-private-message', {
            message: {
                sender: fromEmployee,
                text: `📅 Предложение обмена сменами`,
                time: Date.now(),
                action_data: {
                    type: 'exchange_request',
                    request_id: result.rows[0].id,
                    from_employee: fromEmployee,
                    to_employee: toEmployee,
                    from_date: fromDateFormatted,
                    to_date: toDateFormatted,
                    from_time: fromShiftTime,
                    to_time: toShiftTime,
                    comment: comment,
                    status: 'pending'
                }
            },
            from: fromEmployee
        });
    }
    
    res.json({ success: true, requestId: result.rows[0].id });
});

app.get('/api/exchange/pending', authMiddleware, async (req, res) => {
    try { 
        const r = await pool.query(`SELECT *, from_date::text as fd, to_date::text as td FROM exchange_requests WHERE to_employee=$1 AND status='pending' ORDER BY created_at DESC`, [req.user.username]); 
        res.json({ success: true, requests: r.rows.map(x => ({ ...x, from_date: x.fd, to_date: x.td })) }); 
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.get('/api/exchange/my', authMiddleware, async (req, res) => {
    try { 
        const r = await pool.query(`SELECT *, from_date::text as fd, to_date::text as td FROM exchange_requests WHERE from_employee=$1 ORDER BY created_at DESC`, [req.user.username]); 
        res.json({ success: true, requests: r.rows.map(x => ({ ...x, from_date: x.fd, to_date: x.td })) }); 
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/exchange/accept/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    const u = req.user.username;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const r = await client.query(`SELECT * FROM exchange_requests WHERE id=$1 AND status='pending'`, [id]);
        if (r.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Запрос не найден' });
        }
        const d = r.rows[0];
        if (d.to_employee !== u) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Не ваш запрос' });
        }
        
        await client.query(`UPDATE schedule SET employee=$1 WHERE date=$2 AND employee=$3`, [d.from_employee, d.to_date, d.to_employee]);
        await client.query(`UPDATE schedule SET employee=$1 WHERE date=$2 AND employee=$3`, [d.to_employee, d.from_date, d.from_employee]);
        await client.query(`UPDATE exchange_requests SET status='accepted' WHERE id=$1`, [id]);
        
        await client.query('COMMIT');
        
        const pusherInstance = app.get('pusher');
        if (pusherInstance) {
            pusherInstance.trigger(`private-user-${transliterate(d.from_employee)}`, 'personal-notification', { type: 'exchange_accepted', icon: '🔄', title: 'Обмен принят!', text: `${u} принял(а) ваш запрос на обмен сменами`, time: Date.now() });
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: d.to_date, employee: d.from_employee, timestamp: Date.now() });
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date: d.from_date, employee: d.to_employee, timestamp: Date.now() });
        }
        
        try { await sendGlobalNotification('exchange_accepted', { from: d.from_employee, to: d.to_employee }); } catch (err) {}
        
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/exchange/reject/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    await pool.query(`UPDATE exchange_requests SET status='rejected' WHERE id=$1 AND to_employee=$2`, [id, req.user.username]);
    res.json({ success: true });
});

app.post('/api/exchange/cancel/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });
    
    await pool.query(`UPDATE exchange_requests SET status='cancelled' WHERE id=$1 AND from_employee=$2`, [id, req.user.username]);
    res.json({ success: true });
});

// ============================================
// ЗАЩИЩЁННЫЕ CRON-ЗАДАЧИ
// ============================================

let isProcessingShift = false;
let isProcessingTasks = false;
let isProcessingExchange = false;
let isProcessingArchive = false;
let isProcessingWeather = false;

cron.schedule('5 0 * * *', async () => {
    if (isProcessingShift) return;
    isProcessingShift = true;
    try { await processShiftEarnings(); } catch (e) { console.error('Shift earnings error:', e); } finally { isProcessingShift = false; }
});

cron.schedule('0 * * * *', async () => {
    if (isProcessingTasks) return;
    isProcessingTasks = true;
    try { await checkAndPenalizeOverdueTasks(); } catch (e) { console.error('Tasks check error:', e); } finally { isProcessingTasks = false; }
});

cron.schedule('0 * * * *', async () => {
    if (isProcessingExchange) return;
    isProcessingExchange = true;
    try { await autoExpireExchangeRequests(); } catch (e) { console.error('Exchange expire error:', e); } finally { isProcessingExchange = false; }
});

cron.schedule('0 3 * * *', async () => {
    if (isProcessingArchive) return;
    isProcessingArchive = true;
    try { 
        const threeDaysAgo = new Date(); 
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3); 
        await pool.query(`UPDATE tasks SET is_archived = true WHERE status = 'completed' AND completed_at <= $1`, [threeDaysAgo]); 
    } catch (e) { 
        console.error('Archive error:', e); 
    } finally { 
        isProcessingArchive = false; 
    }
});

cron.schedule('*/30 * * * *', async () => {
    if (isProcessingWeather) return;
    isProcessingWeather = true;
    try { await fetchWeather(); } catch (e) { console.error('Weather error:', e); } finally { isProcessingWeather = false; }
});

// ============================================
// МОНИТОРИНГ ПАМЯТИ
// ============================================

setInterval(() => {
    const used = process.memoryUsage();
    console.log(`📊 Память: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}/${Math.round(used.heapTotal / 1024 / 1024)}MB`);
    if (used.rss > 400 * 1024 * 1024) { console.error('❌ КРИТИЧЕСКАЯ УТЕЧКА ПАМЯТИ!'); }
}, 60000);

// ============================================
// PUSHER AUTH (ДОБАВЛЕНО)
// ============================================

app.post('/api/pusher/auth', authMiddleware, (req, res) => {
    const pusherInstance = app.get('pusher');
    if (!pusherInstance) {
        return res.status(500).json({ error: 'Pusher not configured' });
    }
    
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    
    // Проверка прав доступа к каналу
    if (channel.startsWith('private-user-')) {
        const username = channel.replace('private-user-', '');
        // Только сам пользователь может подписаться на свой канал
        if (transliterate(req.user.username) !== username && req.user.role !== 'director') {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    
    const auth = pusherInstance.authorizeChannel(socketId, channel);
    res.send(auth);
});

// ============================================
// СТАТИЧЕСКИЕ ФАЙЛЫ
// ============================================

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/about.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'about.html')); });
app.get('/pages/:page', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'pages', req.params.page)); });

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

(async () => {
    await initDatabase();
    await initAchievements();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 WARPOINT Server running on port ${PORT}`);
        console.log(`👤 Директор: Денис / denis_1`);
        console.log(`🛡️ Защита от SQL-инъекций активирована`);
        console.log(`🔐 Пароли хешируются (bcrypt)`);
        console.log(`🔒 Rate limiting активирован`);
        console.log(`📊 Мониторинг памяти включен\n`);
    });
})();