// ============================================
// ПРОВЕРКА УСЛОВИЙ ДОСТИЖЕНИЙ
// ============================================

function checkAchievementCondition(achievement, stats) {
    const category = achievement.category;
    const required = achievement.required_value;
    const id = achievement.id;
    
    if ((category === 'work' || category === 'exchange') && !stats.isWorker) return false;
    
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
    try {
        const allAchievements = await pool.query('SELECT * FROM achievements ORDER BY sort_order, id');
        const unlocked = await pool.query('SELECT achievement_id FROM user_achievements WHERE user_id = $1', [userId]);
        const unlockedIds = new Set(unlocked.rows.map(r => r.achievement_id));
        const pending = await pool.query('SELECT achievement_id FROM pending_achievements WHERE user_id = $1', [userId]);
        const pendingIds = new Set(pending.rows.map(r => r.achievement_id));
        
        const stats = await getUserStats(userId, username);
        const newAchievements = [];
        let grantedCount = 0;
        
        for (const ach of allAchievements.rows) {
            if (unlockedIds.has(ach.id) || pendingIds.has(ach.id)) continue;
            if (checkAchievementCondition(ach, stats)) {
                await pool.query(`INSERT INTO pending_achievements (user_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, ach.id]);
                grantedCount++;
                newAchievements.push({ 
                    id: ach.id, 
                    name: ach.name, 
                    description: ach.description, 
                    coins: ach.coins_reward, 
                    category: ach.category,
                    icon: ach.icon || '🏆'
                });
            }
        }
        
        if (newAchievements.length > 0) {
            const pusherInstance = app.get('pusher');
            
            for (const ach of newAchievements) {
                await pool.query(
                    `INSERT INTO user_achievements (user_id, achievement_id, claimed_at) 
                     VALUES ($1, $2, CURRENT_TIMESTAMP) 
                     ON CONFLICT DO NOTHING`,
                    [userId, ach.id]
                );
            }
            
            if (pusherInstance) {
                pusherInstance.trigger(`private-user-${transliterate(username)}`, 'personal-notification', { 
                    type: 'achievement', 
                    icon: '🏆', 
                    title: 'Новые достижения!', 
                    text: `Вы получили ${newAchievements.length} достижений (+${newAchievements.reduce((sum, a) => sum + a.coins, 0)} WP)`, 
                    time: Date.now(),
                    achievements: newAchievements 
                });
            }
            
            await pool.query(`UPDATE employees SET rating = rating + $1 WHERE id = $2`, [newAchievements.reduce((sum, a) => sum + (a.coins || 0), 0), userId]);
        }
        return { granted: grantedCount, achievements: newAchievements };
    } catch (err) {
        console.error('❌ Ошибка проверки достижений:', err);
        return { granted: 0, achievements: [] };
    }
}

async function checkHasFullProfile(userId) {
    const res = await pool.query(`SELECT birthday, phone FROM employees WHERE id = $1`, [userId]);
    if (res.rows.length === 0) return false;
    const emp = res.rows[0];
    return emp.birthday && emp.phone && emp.birthday !== '' && emp.phone !== '';
}

// ============================================
// АВТО-ОТМЕНА ПРОСРОЧЕННЫХ ЗАПРОСОВ НА ОБМЕН
// ============================================

async function autoExpireExchangeRequests() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const expiredRequests = await client.query(
            `SELECT id, from_employee, to_employee FROM exchange_requests WHERE status = 'pending' AND expires_at < NOW()`
        );
        
        for (const req of expiredRequests.rows) {
            await client.query(`UPDATE exchange_requests SET status = 'expired' WHERE id = $1`, [req.id]);
            
            const pusherInstance = app.get('pusher');
            if (pusherInstance) {
                await client.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [req.from_employee, '⏰ Система', `Ваше предложение обмена сменами для ${req.to_employee} **АВТОМАТИЧЕСКИ ОТМЕНЕНО**.`, Date.now()]);
                pusherInstance.trigger(`private-user-${transliterate(req.from_employee)}`, 'client-private-message', { message: { sender: '⏰ Система', text: `Ваше предложение обмена для ${req.to_employee} автоматически отменено.`, time: Date.now() }, from: 'Система' });
                
                await client.query(`INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)`, [req.to_employee, '⏰ Система', `Предложение обмена от ${req.from_employee} автоматически отменено.`, Date.now()]);
                pusherInstance.trigger(`private-user-${transliterate(req.to_employee)}`, 'client-private-message', { message: { sender: '⏰ Система', text: `Предложение обмена от ${req.from_employee} автоматически отменено.`, time: Date.now() }, from: 'Система' });
            }
        }
        
        await client.query('COMMIT');
        if (expiredRequests.rows.length > 0) console.log(`✅ Автоматически отменено ${expiredRequests.rows.length} просроченных запросов`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка авто-отмены запросов:', err);
    } finally {
        client.release();
    }
}
// ============================================
// AUTH API (ИСПРАВЛЕНО)
// ============================================

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
    
    try {
        // 🔥 ИСПРАВЛЕНО: получаем хеш пароля
        const user = await pool.query('SELECT * FROM passwords WHERE username = $1', [username]);
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        // 🔥 ИСПРАВЛЕНО: сравниваем хеши
        const validPassword = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        
        const profile = await pool.query('SELECT * FROM employees WHERE name = $1', [username]);
        if (profile.rows.length === 0) {
            return res.status(401).json({ error: 'Сотрудник не найден' });
        }
        
        await pool.query('UPDATE employees SET last_active = CURRENT_TIMESTAMP WHERE name = $1', [username]);
        
        const token = jwt.sign({ username, role: profile.rows[0].role, id: profile.rows[0].id }, JWT_SECRET, { expiresIn: '7d' });
        const achievementResult = await checkAndGrantAchievements(profile.rows[0].id, username);
        
        res.json({ success: true, user: profile.rows[0], token, newAchievements: achievementResult.achievements });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 🔥 НОВОЕ: СМЕНА ПАРОЛЯ
app.put('/api/employees/:name/password', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Только директор может менять пароли' });
    }
    
    const { name } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 3) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 3 символов' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('UPDATE passwords SET password_hash = $1 WHERE username = $2', [hashedPassword, name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// GET /api/data - ПОЛУЧЕНИЕ ВСЕХ ДАННЫХ
// ============================================

app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        const employees = await pool.query('SELECT * FROM employees ORDER BY name');
        const tasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500');
        const fines = await pool.query('SELECT * FROM fines ORDER BY date DESC LIMIT 500');
        const messages = await pool.query('SELECT * FROM messages ORDER BY time DESC LIMIT 500');
        const schedule = await pool.query('SELECT * FROM schedule');
        
        const userAchievements = {};
        for (const emp of employees.rows) {
            const achievementsRes = await pool.query(
                `SELECT a.id, a.name, a.description, a.icon, a.coins_reward 
                 FROM user_achievements ua 
                 JOIN achievements a ON a.id = ua.achievement_id 
                 WHERE ua.user_id = $1 
                 ORDER BY ua.claimed_at DESC`,
                [emp.id]
            );
            userAchievements[emp.name] = achievementsRes.rows;
        }
        
        const userStatuses = {};
        for (const emp of employees.rows) {
            const statusesRes = await pool.query(
                `SELECT status_name FROM user_statuses WHERE employee_id = $1`,
                [emp.id]
            );
            userStatuses[emp.name] = statusesRes.rows.map(row => row.status_name);
        }
        
        const messagesByRoom = {};
        messages.rows.forEach(msg => { 
            if (!messagesByRoom[msg.room]) messagesByRoom[msg.room] = []; 
            messagesByRoom[msg.room].push(msg); 
        });
        
        const scheduleByDate = {};
        schedule.rows.forEach(s => { 
            const dateStr = s.date instanceof Date ? s.date.toISOString().split('T')[0] : s.date; 
            if (!scheduleByDate[dateStr]) scheduleByDate[dateStr] = {}; 
            scheduleByDate[dateStr][s.employee] = { 
                time: s.shift_time, 
                status: s.shift_status, 
                is_special: s.is_special, 
                special_end_time: s.special_end_time 
            }; 
        });
        
        res.json({ 
            employees: employees.rows.map(e => e.name), 
            profiles: employees.rows.reduce((acc, e) => { 
                acc[e.name] = { 
                    id: e.id, 
                    name: e.name, 
                    avatar: e.avatar, 
                    avatar_url: e.avatar_url, 
                    status: e.status, 
                    coins: e.coins, 
                    rating: e.rating, 
                    role: e.role, 
                    hours: parseFloat(e.hours) || 0, 
                    birthday: e.birthday, 
                    phone: e.phone, 
                    last_active: e.last_active, 
                    dashboard_style: e.dashboard_style, 
                    bought_styles: e.bought_styles, 
                    can_edit_vp: e.can_edit_vp || false, 
                    active_status: e.active_status, 
                    bonus_streak: e.bonus_streak || 1,
                    last_bonus_claimed_at: e.last_bonus_claimed_at,
                    bought_statuses: userStatuses[e.name] || []
                }; 
                return acc; 
            }, {}), 
            tasks: tasks.rows, 
            fines: fines.rows, 
            schedule: scheduleByDate, 
            messages: messagesByRoom,
            userAchievements: userAchievements
        });
    } catch (err) {
        console.error('Data error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// TASKS API
// ============================================

app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id GROUP BY t.id ORDER BY t.created_at DESC`);
        res.json(result.rows);
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
        if (task.group_members && Array.isArray(task.group_members)) groupMembersJson = JSON.stringify(task.group_members);
        
        const result = await client.query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, progress, comment, recurring, status, is_group_task, group_members) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [task.name, task.author || req.user.username, task.executor, task.priority || 'medium', task.deadline || null, task.progress || 0, task.comment || null, task.recurring || 'none', task.status || 'in_progress', task.is_group_task || null, groupMembersJson]
        );
        const newTask = result.rows[0];
        
        if (task.subtasks && task.subtasks.length > 0) {
            for (const sub of task.subtasks) {
                await client.query(`INSERT INTO subtasks (task_id, name, completed) VALUES ($1, $2, $3)`, [newTask.id, sub.name, sub.completed || false]);
            }
        }
        await client.query('COMMIT');
        
        const finalTask = await pool.query(`SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE t.id = $1 GROUP BY t.id`, [newTask.id]);
        res.json({ success: true, task: finalTask.rows[0] });
        
        if (task.executor) {
            const executorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [task.executor]);
            if (executorRes.rows.length > 0) await checkAndGrantAchievements(executorRes.rows[0].id, task.executor);
        }
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID задачи' });
    
    const updates = req.body;
    try {
        const existingTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (existingTask.rows.length === 0) return res.status(404).json({ error: 'Задача не найдена' });
        
        const oldTask = existingTask.rows[0];
        let newAchievements = [];
        
        if (updates.status === 'completed' && oldTask.status !== 'completed') {
            let wpReward = 0;
            if (oldTask.priority === 'high') wpReward = 15;
            else if (oldTask.priority === 'medium') wpReward = 8;
            else if (oldTask.priority === 'low') wpReward = 3;
            
            if (wpReward > 0 && oldTask.executor) {
                const executor = await pool.query('SELECT id, coins FROM employees WHERE name = $1', [oldTask.executor]);
                if (executor.rows.length > 0) {
                    const balanceBefore = executor.rows[0].coins;
                    const balanceAfter = balanceBefore + wpReward;
                    await pool.query('UPDATE employees SET coins = coins + $1 WHERE name = $2', [wpReward, oldTask.executor]);
                    await logTransaction(executor.rows[0].id, 'task_reward', wpReward, balanceBefore, balanceAfter, oldTask.id, `Выполнена задача "${oldTask.name}"`);
                    
                    const pusherInstance = app.get('pusher');
                    if (pusherInstance) {
                        pusherInstance.trigger(`private-user-${transliterate(oldTask.author)}`, 'personal-notification', { type: 'task_completed', icon: '✅', title: 'Задача выполнена!', text: `${oldTask.executor} выполнил(а) задачу «${oldTask.name}»`, time: Date.now() });
                    }
                    try { await sendGlobalNotification('task_completed', { executor: oldTask.executor, taskName: oldTask.name }); } catch (err) {}
                }
            }
            if (oldTask.executor) {
                const executorRes = await pool.query('SELECT id FROM employees WHERE name = $1', [oldTask.executor]);
                if (executorRes.rows.length > 0) {
                    const result = await checkAndGrantAchievements(executorRes.rows[0].id, oldTask.executor);
                    newAchievements = result.achievements;
                }
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
            await pool.query(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`, values);
        }
        
        const updatedTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        res.json({ success: true, task: updatedTask.rows[0], newAchievements });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID задачи' });
    
    try {
        const taskCheck = await pool.query('SELECT id, author, status FROM tasks WHERE id = $1', [id]);
        if (taskCheck.rows.length === 0) return res.status(404).json({ error: 'Задача не найдена' });
        
        const task = taskCheck.rows[0];
        const currentUser = req.user.username;
        const currentUserRole = req.user.role;
        const canDelete = currentUserRole === 'director' || currentUserRole === 'manager' || (task.author === currentUser && task.status !== 'completed');
        
        if (!canDelete) return res.status(403).json({ error: 'Нет прав на удаление' });
        
        await pool.query('DELETE FROM subtasks WHERE task_id = $1', [id]);
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
        const result = await pool.query('SELECT * FROM fines ORDER BY date DESC'); 
        res.json(result.rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/fines', authMiddleware, async (req, res) => {
    const { fine } = req.body;
    if (!fine || !fine.employee) return res.status(400).json({ error: 'Не указан сотрудник' });
    
    if (fine.amount < 0 || fine.coins < 0) {
        return res.status(400).json({ error: 'Сумма штрафа не может быть отрицательной' });
    }
    
    try {
        const date = fine.date || new Date().toISOString().split('T')[0];
        const result = await pool.query(
            `INSERT INTO fines (date, employee, type, amount, coins, rating, description, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [date, fine.employee, fine.type || 'other', fine.amount || 0, fine.coins || 0, fine.rating || 0, fine.description || '', fine.status || 'pending', fine.createdBy || req.user.username]
        );
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/fines/:id', authMiddleware, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID штрафа' });
    
    const { status, amount, coins, rating, director_comment } = req.body;
    
    if (amount !== undefined && amount < 0) return res.status(400).json({ error: 'Сумма штрафа не может быть отрицательной' });
    if (coins !== undefined && coins < 0) return res.status(400).json({ error: 'Сумма WP не может быть отрицательной' });
    
    try {
        const fineResult = await pool.query('SELECT * FROM fines WHERE id = $1', [id]);
        if (fineResult.rows.length === 0) return res.status(404).json({ error: 'Штраф не найден' });
        const oldFine = fineResult.rows[0];
        
        const result = await pool.query(
            `UPDATE fines SET status = COALESCE($1, status), amount = COALESCE($2, amount), coins = COALESCE($3, coins), rating = COALESCE($4, rating), director_comment = COALESCE($5, director_comment), updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *`,
            [status, amount, coins, rating, director_comment, id]
        );
        const updatedFine = result.rows[0];
        
        if (status === 'approved' && oldFine.status !== 'approved') {
            if (updatedFine.amount > 0) { 
                await pool.query('INSERT INTO corporate_fund (amount) VALUES ($1)', [updatedFine.amount]); 
            }
            if (updatedFine.coins > 0) { 
                await pool.query('UPDATE employees SET coins = GREATEST(coins - $1, 0) WHERE name = $2', [updatedFine.coins, oldFine.employee]); 
            }
            if (updatedFine.rating !== 0) { 
                await pool.query('UPDATE employees SET rating = rating + $1 WHERE name = $2', [updatedFine.rating, oldFine.employee]); 
            }
            
            const pusherInstance = app.get('pusher');
            if (pusherInstance) { 
                pusherInstance.trigger(`private-user-${transliterate(oldFine.employee)}`, 'personal-notification', { type: 'fine_approved', icon: '⚠️', title: 'Штраф подтверждён', text: `Вам назначен штраф: ${oldFine.description || 'Нарушение'}`, time: Date.now() }); 
            }
            try { 
                await sendGlobalNotification('fine_approved', { employee: oldFine.employee, reason: oldFine.description || 'Нарушение' }); 
            } catch (err) {}
        }
        res.json({ success: true, fine: updatedFine });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/fines/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID штрафа' });
    
    try { 
        await pool.query('DELETE FROM fines WHERE id = $1', [id]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ============================================
// SCHEDULE API
// ============================================

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query(`SELECT id, date::text as date, employee, shift_time, shift_status, is_special, special_end_time, shift_paid FROM schedule ORDER BY date DESC, employee`); 
        res.json(result.rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status, is_special, special_end_time } = req.body;
    const currentUserRole = req.user.role; 
    const currentUserName = req.user.username;
    
    if (currentUserRole !== 'director' && currentUserRole !== 'manager' && employee !== currentUserName) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    
    try {
        const dateForDb = formatDateToYMD(date);
        const existing = await pool.query('SELECT id FROM schedule WHERE date = $1::date AND employee = $2', [dateForDb, employee]);
        let result;
        if (existing.rows.length > 0) {
            result = await pool.query(
                `UPDATE schedule SET shift_time = $1, shift_status = $2, is_special = $3, special_end_time = $4, shift_paid = false, updated_at = CURRENT_TIMESTAMP WHERE date = $5::date AND employee = $6 RETURNING *`,
                [shift_time || null, shift_status || 'working', is_special || false, special_end_time || null, dateForDb, employee]
            );
        } else {
            result = await pool.query(
                `INSERT INTO schedule (date, employee, shift_time, shift_status, is_special, special_end_time) VALUES ($1::date, $2, $3, $4, $5, $6) RETURNING *`,
                [dateForDb, employee, shift_time || null, shift_status || 'working', is_special || false, special_end_time || null]
            );
        }
        const pusherInstance = app.get('pusher');
        if (pusherInstance) { 
            pusherInstance.trigger('private-warpoint-sync', 'schedule-updated', { date, employee, shift_time, shift_status, timestamp: Date.now() }); 
        }
        res.json({ success: true, data: result.rows[0] });
        
        const empRes = await pool.query('SELECT id FROM employees WHERE name = $1', [employee]);
        if (empRes.rows.length > 0) { 
            await checkAndGrantAchievements(empRes.rows[0].id, employee); 
        }
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee } = req.body;
    const currentUserRole = req.user.role; 
    const currentUserName = req.user.username;
    
    if (currentUserRole !== 'director' && currentUserRole !== 'manager' && employee !== currentUserName) {
        return res.status(403).json({ error: 'Нет прав' });
    }
    try { 
        await pool.query('DELETE FROM schedule WHERE date = $1::date AND employee = $2', [date, employee]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/schedule/special-cases', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query(`SELECT date, cases FROM schedule_special_cases`); 
        const data = {}; 
        result.rows.forEach(row => { data[row.date] = row.cases; }); 
        res.json({ success: true, data }); 
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
// EMPLOYEES API (ИСПРАВЛЕНО)
// ============================================

app.get('/api/employees/achievements-count', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query(`SELECT e.name, COUNT(ua.achievement_id) as achievements_count FROM employees e LEFT JOIN user_achievements ua ON ua.user_id = e.id GROUP BY e.id, e.name`); 
        const counts = {}; 
        result.rows.forEach(row => { counts[row.name] = parseInt(row.achievements_count) || 0; }); 
        res.json({ success: true, counts }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/employees', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    const { name, role, password, birthday, phone } = req.body;
    
    if (!name || !password) return res.status(400).json({ error: 'Имя и пароль обязательны' });
    
    try {
        // 🔥 ИСПРАВЛЕНО: хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(`INSERT INTO employees (name, role, birthday, phone, bonus_streak) VALUES ($1, $2, $3, $4, 1)`, [name, role || 'operator', birthday || null, phone || null]); 
        await pool.query('INSERT INTO passwords (username, password_hash) VALUES ($1, $2)', [name, hashedPassword]); 
        try { await sendGlobalNotification('new_employee', { name }); } catch (err) {} 
        res.json({ success: true }); 
    } catch (err) { 
        if (err.code === '23505') return res.status(400).json({ error: 'Сотрудник с таким именем уже существует' });
        res.status(500).json({ error: err.message }); 
    }
});

// 🔥 ИСПРАВЛЕНО: PUT /api/profiles/:name с логированием и очисткой avatar_url
app.put('/api/profiles/:name', authMiddleware, async (req, res) => {
    const { name } = req.params; 
    const updates = req.body;
    const currentUser = req.user;
    
    // Проверка прав: только директор или сам пользователь
    if (currentUser.role !== 'director' && currentUser.username !== name) {
        return res.status(403).json({ error: 'Нет прав на редактирование этого профиля' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Получаем старые значения для логирования
        const oldProfile = await client.query('SELECT * FROM employees WHERE name = $1', [name]);
        if (oldProfile.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }
        const oldData = oldProfile.rows[0];
        
        const allowedFields = ['avatar', 'avatar_url', 'status', 'phone', 'birthday', 'name', 'active_status']; 
        const filteredUpdates = {}; 
        
        for (const key of allowedFields) { 
            if (updates[key] !== undefined) {
                filteredUpdates[key] = updates[key];
                
                // 🔥 ИСПРАВЛЕНО: если меняем avatar, очищаем avatar_url
                if (key === 'avatar') {
                    filteredUpdates['avatar_url'] = null;
                }
                // 🔥 ИСПРАВЛЕНО: если меняем avatar_url, очищаем avatar
                if (key === 'avatar_url') {
                    filteredUpdates['avatar'] = null;
                }
            }
        }
        
        if (Object.keys(filteredUpdates).length === 0) {
            await client.query('COMMIT');
            return res.json({ success: true });
        }
        
        const setClause = Object.keys(filteredUpdates).map((key, i) => `${key} = $${i + 2}`).join(', '); 
        await client.query(`UPDATE employees SET ${setClause} WHERE name = $1`, [name, ...Object.values(filteredUpdates)]);
        
        // 🔥 Логируем изменения
        const userId = oldData.id;
        const changedBy = currentUser.id;
        for (const [field, newValue] of Object.entries(filteredUpdates)) {
            const oldValue = oldData[field];
            if (String(oldValue) !== String(newValue)) {
                await logProfileChange(userId, changedBy, field, String(oldValue || ''), String(newValue || ''));
            }
        }
        
        await client.query('COMMIT');
        res.json({ success: true }); 
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

// 🔥 ИСПРАВЛЕНО: DELETE /api/employees/:name с полной очисткой данных
app.delete('/api/employees/:name', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Доступ только директору' });
    if (req.params.name === 'Денис') return res.status(400).json({ error: 'Нельзя удалить директора' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const empRes = await client.query('SELECT id FROM employees WHERE name = $1', [req.params.name]);
        if (empRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Сотрудник не найден' });
        }
        const userId = empRes.rows[0].id;
        
        // 🔥 Удаляем все связанные данные
        await client.query('DELETE FROM messages WHERE sender = $1 OR room = $1', [req.params.name]);
        await client.query('UPDATE tasks SET executor = NULL WHERE executor = $1', [req.params.name]);
        await client.query('DELETE FROM fines WHERE employee = $1', [req.params.name]);
        await client.query('DELETE FROM schedule WHERE employee = $1', [req.params.name]);
        await client.query('DELETE FROM stickers WHERE employee = $1 OR sender = $1', [req.params.name]);
        await client.query('DELETE FROM exchange_requests WHERE from_employee = $1 OR to_employee = $1', [req.params.name]);
        await client.query('DELETE FROM user_achievements WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM pending_achievements WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_statuses WHERE employee_id = $1', [userId]);
        await client.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM daily_bonus_history WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM shift_earnings WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM knowledge_views WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM profile_history WHERE user_id = $1', [userId]);
        
        await client.query('DELETE FROM employees WHERE name = $1', [req.params.name]);
        await client.query('DELETE FROM passwords WHERE username = $1', [req.params.name]);
        
        await client.query('COMMIT');
        res.json({ success: true }); 
    } catch (err) { 
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message }); 
    } finally {
        client.release();
    }
});

app.put('/api/employees/:name/role', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    const { name } = req.params; 
    const { role } = req.body;
    try { 
        const empRes = await pool.query('SELECT role FROM employees WHERE name = $1', [name]); 
        if (empRes.rows.length === 0) return res.status(404).json({ error: 'Сотрудник не найден' }); 
        if (empRes.rows[0].role === 'director') return res.status(403).json({ error: 'Нельзя изменить роль директора' }); 
        await pool.query('UPDATE employees SET role = $1 WHERE name = $2', [role, name]); 
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
    if (!message || !message.text || message.text.length > 2000) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым или длиннее 2000 символов' });
    }
    try { 
        await pool.query('INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)', [room, message.sender, message.text, Date.now()]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/chat/private', authMiddleware, async (req, res) => {
    const { to, message } = req.body;
    if (!message || !message.text || message.text.length > 2000) {
        return res.status(400).json({ error: 'Сообщение не может быть пустым или длиннее 2000 символов' });
    }
    try { 
        await pool.query('INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)', [to, message.sender, message.text, Date.now()]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/chat/announcement', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Только директор или управляющий' });
    }
    const { announcement } = req.body;
    if (!announcement || !announcement.text || announcement.text.length > 1000) {
        return res.status(400).json({ error: 'Текст объявления не может быть пустым или длиннее 1000 символов' });
    }
    try { 
        await pool.query('INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4)', ['general', announcement.sender, JSON.stringify(announcement), Date.now()]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/chat/delete', authMiddleware, async (req, res) => {
    const { room, messageTime } = req.body;
    try { 
        await pool.query('DELETE FROM messages WHERE room = $1 AND time = $2', [room, messageTime]); 
        res.json({ success: true }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/chat/delete-bulk', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Только директор' });
    const { room, timeThreshold } = req.body;
    try { 
        const result = await pool.query('DELETE FROM messages WHERE room = $1 AND time < $2', [room, timeThreshold]); 
        res.json({ success: true, deletedCount: result.rowCount }); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/chat/history/:room', authMiddleware, async (req, res) => {
    try { 
        const result = await pool.query('SELECT * FROM messages WHERE room = $1 ORDER BY time ASC LIMIT 500', [req.params.room]); 
        res.json(result.rows); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});