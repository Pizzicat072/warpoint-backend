// Удалить сотрудника (soft delete)
app.delete('/api/employees/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор может удалять сотрудников' });
    }
    
    try {
        const { id } = req.params;
        const emp = await query("SELECT role FROM employees WHERE id = $1", [id]);
        if (emp.rows[0]?.role === 'director') {
            return res.status(403).json({ success: false, error: 'Нельзя удалить директора' });
        }
        
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE id = $1", [id]);
        res.json({ success: true, message: 'Сотрудник уволен' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Сменить пароль сотрудника (директор)
app.put('/api/employees/:id/password', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор может менять пароли' });
    }
    
    try {
        const { id } = req.params;
        const { password } = req.body;
        if (!password || password.length < 3) {
            return res.status(400).json({ success: false, error: 'Пароль должен быть не менее 3 символов' });
        }
        
        const emp = await query("SELECT name FROM employees WHERE id = $1", [id]);
        if (emp.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Сотрудник не найден' });
        }
        
        const hashedPassword = await hashPassword(password);
        await query(
            "INSERT INTO passwords (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = $2, updated_at = NOW()",
            [emp.rows[0].name, hashedPassword]
        );
        
        res.json({ success: true, message: 'Пароль изменён' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 18. API — ЗАДАЧИ
// ============================================

app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { executor, status, limit = 100 } = req.query;
        let sql = `SELECT t.*, COALESCE(json_agg(s.*) FILTER (WHERE s.id IS NOT NULL), '[]') as subtasks 
                   FROM tasks t LEFT JOIN subtasks s ON s.task_id = t.id WHERE t.is_archived = FALSE`;
        const params = [];
        
        if (executor) { sql += ` AND t.executor = $${params.length + 1}`; params.push(executor); }
        if (status) { sql += ` AND t.status = $${params.length + 1}`; params.push(status); }
        
        sql += ` GROUP BY t.id ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        
        const result = await query(sql, params);
        res.json({ success: true, tasks: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { task } = req.body;
        const author = req.user.role === 'director' ? (task.author || req.user.username) : req.user.username;
        
        const wpReward = { low: 3, medium: 8, high: 15 }[task.priority] || 8;
        
        const result = await query(
            `INSERT INTO tasks (name, author, executor, priority, deadline, comment, status, is_group_task, group_members, wp_reward)
             VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', $7, $8, $9) RETURNING *`,
            [task.name, author, task.executor, task.priority || 'medium', task.deadline, task.comment, task.is_group_task, JSON.stringify(task.group_members), wpReward]
        );
        
        if (task.subtasks) {
            for (const sub of task.subtasks) {
                await query("INSERT INTO subtasks (task_id, name) VALUES ($1, $2)", [result.rows[0].id, sub.name]);
            }
        }
        
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const current = await query("SELECT * FROM tasks WHERE id = $1", [id]);
        if (current.rows.length === 0) return res.status(404).json({ success: false, error: 'Задача не найдена' });
        
        const task = current.rows[0];
        
        // Если задача завершается — начисляем WP
        if (updates.status === 'completed' && task.status !== 'completed' && task.executor) {
            await query("UPDATE employees SET coins = coins + $1, total_tasks_completed = total_tasks_completed + 1 WHERE name = $2", [task.wp_reward || 8, task.executor]);
        }
        
        const fields = [];
        const values = [];
        let idx = 1;
        const allowed = ['name', 'executor', 'priority', 'deadline', 'progress', 'comment', 'status'];
        
        for (const f of allowed) {
            if (updates[f] !== undefined) {
                fields.push(`${f} = $${idx++}`);
                values.push(updates[f]);
            }
        }
        
        if (updates.status === 'completed') {
            fields.push(`completed_at = NOW()`);
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const task = await query("SELECT author FROM tasks WHERE id = $1", [id]);
        
        if (req.user.role !== 'director' && req.user.role !== 'manager' && task.rows[0]?.author !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав на удаление' });
        }
        
        await query("DELETE FROM tasks WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 19. API — ШТРАФЫ
// ============================================

app.get('/api/fines', authMiddleware, async (req, res) => {
    try {
        const { employee, status } = req.query;
        let sql = "SELECT * FROM fines WHERE 1=1";
        const params = [];
        
        if (employee) { sql += ` AND employee = $${params.length + 1}`; params.push(employee); }
        if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
        sql += " ORDER BY date DESC, created_at DESC LIMIT 500";
        
        const result = await query(sql, params);
        res.json({ success: true, fines: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fines', authMiddleware, async (req, res) => {
    if (!['director', 'manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { fine } = req.body;
        const result = await query(
            `INSERT INTO fines (date, employee, type, amount, coins, rating, description, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING *`,
            [fine.date || getTobolskDate(), fine.employee, fine.type, fine.amount || 0, fine.coins || 0, fine.rating || 0, fine.description, req.user.username]
        );
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/fines/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const result = await query(
            "UPDATE fines SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
            [status, id]
        );
        
        if (status === 'approved') {
            const fine = result.rows[0];
            if (fine.coins > 0) {
                await query("UPDATE employees SET coins = GREATEST(coins - $1, 0) WHERE name = $2", [fine.coins, fine.employee]);
            }
            if (fine.rating !== 0) {
                await query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [fine.rating, fine.employee]);
            }
        }
        
        res.json({ success: true, fine: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 20. API — ГРАФИК СМЕН
// ============================================

app.get('/api/schedule', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sql = "SELECT * FROM schedule WHERE 1=1";
        const params = [];
        
        if (month && year) {
            sql += ` AND EXTRACT(MONTH FROM date) = $${params.length + 1} AND EXTRACT(YEAR FROM date) = $${params.length + 2}`;
            params.push(month, year);
        }
        sql += " ORDER BY date DESC, employee";
        
        const result = await query(sql, params);
        res.json({ success: true, schedule: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee, shift_time, shift_status } = req.body;
    
    // Проверка прав
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const existing = await query("SELECT id FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        
        let result;
        if (existing.rows.length > 0) {
            result = await query(
                "UPDATE schedule SET shift_time = $1, shift_status = $2, updated_at = NOW() WHERE date = $3 AND employee = $4 RETURNING *",
                [shift_time, shift_status || 'working', date, employee]
            );
        } else {
            result = await query(
                "INSERT INTO schedule (date, employee, shift_time, shift_status) VALUES ($1, $2, $3, $4) RETURNING *",
                [date, employee, shift_time, shift_status || 'working']
            );
        }
        
        triggerPusher('private-warpoint-sync', 'schedule-updated', { date, employee, shift_time });
        res.json({ success: true, shift: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/schedule/shift', authMiddleware, async (req, res) => {
    const { date, employee } = req.body;
    
    if (req.user.role !== 'director' && req.user.role !== 'manager' && employee !== req.user.username) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM schedule WHERE date = $1 AND employee = $2", [date, employee]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 21. API — ОБМЕН СМЕНАМИ
// ============================================

app.post('/api/exchange/create', authMiddleware, async (req, res) => {
    try {
        const { toEmployee, toDate, toShiftTime, fromDate, fromShiftTime, comment } = req.body;
        const fromEmployee = req.user.username;
        
        if (fromEmployee === toEmployee) {
            return res.status(400).json({ success: false, error: 'Нельзя обменяться с собой' });
        }
        
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        
        const result = await query(
            `INSERT INTO exchange_requests (from_employee, to_employee, from_date, to_date, from_shift_time, to_shift_time, comment, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [fromEmployee, toEmployee, fromDate, toDate, fromShiftTime, toShiftTime, comment, expiresAt]
        );
        
        res.json({ success: true, requestId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/exchange/pending', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT * FROM exchange_requests WHERE to_employee = $1 AND status = 'pending' ORDER BY created_at DESC",
            [req.user.username]
        );
        res.json({ success: true, requests: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/exchange/accept/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const request = await query("SELECT * FROM exchange_requests WHERE id = $1 AND status = 'pending'", [id]);
        
        if (request.rows.length === 0) return res.status(404).json({ success: false, error: 'Запрос не найден' });
        if (request.rows[0].to_employee !== req.user.username) return res.status(403).json({ success: false, error: 'Не ваш запрос' });
        
        const r = request.rows[0];
        
        // Меняем смены
        await query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.from_employee, r.to_date, r.to_employee]);
        await query("UPDATE schedule SET employee = $1 WHERE date = $2 AND employee = $3", [r.to_employee, r.from_date, r.from_employee]);
        await query("UPDATE exchange_requests SET status = 'accepted' WHERE id = $1", [id]);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

console.log('✅ ЧАСТЬ 4/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 5/8: API ВП, ЗАРПЛАТЫ, ФОНДА, ЧАТА, МАГАЗИНА
// ============================================

// ============================================
// 22. API — ВП (МЕРОПРИЯТИЯ)
// ============================================

app.get('/api/vp', authMiddleware, async (req, res) => {
    try {
        const { month, year, archived } = req.query;
        let sql = "SELECT * FROM vp_bookings WHERE 1=1";
        const params = [];
        
        if (month && year) {
            sql += ` AND EXTRACT(MONTH FROM event_date) = $${params.length + 1} AND EXTRACT(YEAR FROM event_date) = $${params.length + 2}`;
            params.push(month, year);
        }
        
        if (archived === 'false' || !archived) {
            sql += ` AND is_archived = FALSE`;
        }
        
        sql += " ORDER BY event_date DESC, event_time DESC LIMIT 500";
        
        const result = await query(sql, params);
        res.json({ success: true, bookings: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/vp', authMiddleware, async (req, res) => {
    const canCreate = ['director', 'manager'].includes(req.user.role) || 
                      (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canCreate) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { vp } = req.body;
        const result = await query(
            `INSERT INTO vp_bookings (admin, event_date, event_time, customer_name, amount, payment_type, booking_date, duration, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [vp.admin, vp.eventDate, vp.eventTime, vp.customerName, vp.amount || 2000, 
             vp.paymentType || 'evotor_card', getTobolskDate(), vp.duration || 1, req.user.username]
        );
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/vp/:id', authMiddleware, async (req, res) => {
    const canEdit = ['director', 'manager'].includes(req.user.role) || 
                    (req.user.role === 'admin' && req.user.can_edit_vp);
    if (!canEdit) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const fields = [];
        const values = [];
        let idx = 1;
        const allowed = ['event_date', 'event_time', 'customer_name', 'admin', 'amount', 'payment_type', 'comment', 'duration', 'photo_status', 'script_status', 'is_archived'];
        
        for (const f of allowed) {
            if (updates[f] !== undefined) {
                fields.push(`${f} = $${idx++}`);
                values.push(updates[f]);
            }
        }
        
        if (fields.length === 0) {
            return res.json({ success: true, message: 'Нет изменений' });
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(id);
        
        const result = await query(`UPDATE vp_bookings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        res.json({ success: true, vp: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/vp/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM vp_bookings WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 23. API — ЗАРПЛАТА
// ============================================

app.get('/api/salary', authMiddleware, async (req, res) => {
    try {
        const { month, year } = req.query;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const employees = await query(
            "SELECT id, name, role, avatar, avatar_url FROM employees WHERE role != 'director' AND is_active = TRUE ORDER BY name"
        );
        
        const dailyData = await query("SELECT * FROM salary_daily WHERE month_year = $1", [monthYear]);
        
        res.json({ success: true, employees: employees.rows, dailyData: dailyData.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/salary/day', authMiddleware, async (req, res) => {
    try {
        const { employee_id, day, month, year } = req.query;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const result = await query(
            `SELECT oklad, event, turnover, bonus35, video, extra_motivation 
             FROM salary_daily WHERE employee_id = $1 AND day_number = $2 AND month_year = $3`,
            [employee_id, day, monthYear]
        );
        
        res.json({ success: true, data: result.rows[0] || { oklad: 0, event: 0, turnover: 0, bonus35: 0, video: 0, extra_motivation: 0 } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/salary/day/save', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { employee_id, day_number, month, year, oklad, event, turnover, bonus35, video, extra_motivation } = req.body;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        await query(
            `INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET
                oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover,
                bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation,
                updated_at = NOW()`,
            [employee_id, day_number, monthYear, oklad || 0, event || 0, turnover || 0, bonus35 || 0, video || 0, extra_motivation || 0]
        );
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/salary/apply-all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { day_number, month, year, ...fields } = req.body;
        const monthYear = `${year}-${String(month).padStart(2, '0')}`;
        
        const operators = await query("SELECT id FROM employees WHERE role = 'operator' AND is_active = TRUE");
        
        for (const op of operators.rows) {
            await query(
                `INSERT INTO salary_daily (employee_id, day_number, month_year, oklad, event, turnover, bonus35, video, extra_motivation)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (employee_id, day_number, month_year) DO UPDATE SET
                    oklad = EXCLUDED.oklad, event = EXCLUDED.event, turnover = EXCLUDED.turnover,
                    bonus35 = EXCLUDED.bonus35, video = EXCLUDED.video, extra_motivation = EXCLUDED.extra_motivation`,
                [op.id, day_number, monthYear, fields.oklad || 0, fields.event || 0, fields.turnover || 0, 
                 fields.bonus35 || 0, fields.video || 0, fields.extra_motivation || 0]
            );
        }
        
        res.json({ success: true, updated: operators.rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 24. API — КОРПОРАТИВНЫЙ ФОНД
// ============================================

app.get('/api/fund', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        res.json({ success: true, amount: result.rows[0]?.amount || 0 });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fund/update', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { amount, comment } = req.body;
        await query(
            "INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, 'update', $2, $3)",
            [amount, comment, req.user.id]
        );
        res.json({ success: true, amount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/fund/add', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { sum, comment } = req.body;
        const current = await query("SELECT amount FROM corporate_fund ORDER BY id DESC LIMIT 1");
        const newAmount = (current.rows[0]?.amount || 0) + sum;
        
        if (newAmount < 0) {
            return res.status(400).json({ success: false, error: 'Недостаточно средств' });
        }
        
        await query(
            "INSERT INTO corporate_fund (amount, operation_type, comment, created_by) VALUES ($1, $2, $3, $4)",
            [newAmount, sum > 0 ? 'add' : 'subtract', comment, req.user.id]
        );
        res.json({ success: true, amount: newAmount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 25. API — ЧАТ
// ============================================

app.post('/api/chat', authMiddleware, async (req, res) => {
    try {
        const { room, message } = req.body;
        if (!message?.text || message.text.length > 2000) {
            return res.status(400).json({ success: false, error: 'Неверное сообщение' });
        }
        
        const result = await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *",
            [room || 'general', message.sender, message.text, Date.now()]
        );
        
        triggerPusher('private-warpoint-sync', 'new-message', { room: room || 'general', message: result.rows[0] });
        res.json({ success: true, message: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/private', authMiddleware, async (req, res) => {
    try {
        const { to, message } = req.body;
        const result = await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ($1, $2, $3, $4) RETURNING *",
            [to, message.sender, message.text, Date.now()]
        );
        
        triggerPusher(`private-user-${transliterate(to)}`, 'private-message', { from: message.sender, message: result.rows[0] });
        res.json({ success: true, message: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/announcement', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { announcement } = req.body;
        await query(
            "INSERT INTO messages (room, sender, text, time) VALUES ('general', $1, $2, $3)",
            [announcement.sender, JSON.stringify(announcement), Date.now()]
        );
        
        triggerPusher('private-warpoint-sync', 'announcement', { announcement });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/chat/history/:room', authMiddleware, async (req, res) => {
    try {
        const { room } = req.params;
        const result = await query(
            "SELECT * FROM messages WHERE room = $1 AND is_deleted = FALSE ORDER BY time ASC LIMIT 500",
            [room]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/chat/delete', authMiddleware, async (req, res) => {
    try {
        const { room, messageTime } = req.body;
        const msg = await query("SELECT sender FROM messages WHERE room = $1 AND time = $2", [room, messageTime]);
        
        if (msg.rows.length === 0) return res.status(404).json({ success: false });
        if (req.user.role !== 'director' && msg.rows[0].sender !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        
        await query("UPDATE messages SET is_deleted = TRUE WHERE room = $1 AND time = $2", [room, messageTime]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 26. API — МАГАЗИН (ПОДАРКИ)
// ============================================

app.get('/api/gifts', authMiddleware, (req, res) => {
    const gifts = [
        { id: 'flower', name: '🌸 Букет', icon: '🌸', price: 25, rating: 8 },
        { id: 'star', name: '⭐ Звезда', icon: '⭐', price: 75, rating: 25 },
        { id: 'pizza', name: '🍕 Пицца', icon: '🍕', price: 150, rating: 50 },
        { id: 'trophy', name: '🏆 Трофей', icon: '🏆', price: 300, rating: 100 },
        { id: 'crown', name: '👑 Корона', icon: '👑', price: 500, rating: 175 }
    ];
    res.json({ success: true, gifts });
});

app.post('/api/gifts', authMiddleware, async (req, res) => {
    try {
        const { recipient, giftId, price, ratingChange, quantity, isAnonymous } = req.body;
        const sender = isAnonymous ? '🕵️ Аноним' : req.user.username;
        
        await transaction(async (client) => {
            if (!isAnonymous) {
                const total = price * quantity;
                const user = await client.query("SELECT coins FROM employees WHERE name = $1 FOR UPDATE", [req.user.username]);
                if (user.rows[0].coins < total) throw new Error('Недостаточно WP');
                
                await client.query("UPDATE employees SET coins = coins - $1, total_gifts_sent = total_gifts_sent + $2 WHERE name = $3", [total, quantity, req.user.username]);
            }
            
            await client.query(
                `INSERT INTO stickers (sender, employee, gift_id, quantity, is_anonymous)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (employee, gift_id, sender, DATE(created_at)) DO UPDATE SET quantity = stickers.quantity + $4`,
                [sender, recipient, giftId, quantity, isAnonymous || false]
            );
            
            if (ratingChange) {
                await client.query("UPDATE employees SET rating = rating + $1, total_gifts_received = total_gifts_received + $2 WHERE name = $3", [ratingChange * quantity, quantity, recipient]);
            }
        });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 27. API — СТАТУСЫ И СТИЛИ
// ============================================

app.get('/api/user/statuses', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT status_id, status_name, status_icon, price, is_active FROM user_statuses WHERE employee_id = $1",
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/statuses/buy', authMiddleware, async (req, res) => {
    try {
        const { statusId, statusName, statusIcon, price, rating } = req.body;
        
        const existing = await query("SELECT id FROM user_statuses WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, error: 'Статус уже куплен' });
        }
        
        await transaction(async (client) => {
            const user = await client.query("SELECT coins FROM employees WHERE id = $1 FOR UPDATE", [req.user.id]);
            if (user.rows[0].coins < price) throw new Error('Недостаточно WP');
            
            await client.query("UPDATE employees SET coins = coins - $1 WHERE id = $2", [price, req.user.id]);
            await client.query(
                "INSERT INTO user_statuses (employee_id, status_id, status_name, status_icon, price) VALUES ($1, $2, $3, $4, $5)",
                [req.user.id, statusId, statusName, statusIcon, price]
            );
            if (rating) await client.query("UPDATE employees SET rating = rating + $1 WHERE id = $2", [rating, req.user.id]);
        });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/statuses/activate', authMiddleware, async (req, res) => {
    try {
        const { statusId } = req.body;
        await query("UPDATE user_statuses SET is_active = FALSE WHERE employee_id = $1", [req.user.id]);
        await query("UPDATE user_statuses SET is_active = TRUE WHERE employee_id = $1 AND status_id = $2", [req.user.id, statusId]);
        await query("UPDATE employees SET active_status = (SELECT status_name FROM user_statuses WHERE employee_id = $1 AND status_id = $2) WHERE id = $1", [req.user.id, statusId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

console.log('✅ ЧАСТЬ 5/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 6/8: БАЗА ЗНАНИЙ, ДОСТИЖЕНИЯ, ОТЧЁТЫ, АДМИНКА
// ============================================

// ============================================
// 28. API — БАЗА ЗНАНИЙ
// ============================================

app.get('/api/knowledge/categories', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            `SELECT c.*, COUNT(a.id) as articles_count 
             FROM knowledge_categories c 
             LEFT JOIN knowledge_articles a ON a.category_id = c.id 
             GROUP BY c.id ORDER BY c.sort_order, c.name`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/categories', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { name, icon, description } = req.body;
        const result = await query(
            "INSERT INTO knowledge_categories (name, icon, description) VALUES ($1, $2, $3) RETURNING *",
            [name, icon || '📁', description]
        );
        res.json({ success: true, category: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ success: false, error: 'Категория уже существует' });
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        const { id } = req.params;
        const { name, icon, description, sort_order } = req.body;
        const result = await query(
            "UPDATE knowledge_categories SET name = COALESCE($1, name), icon = COALESCE($2, icon), description = COALESCE($3, description), sort_order = COALESCE($4, sort_order) WHERE id = $5 RETURNING *",
            [name, icon, description, sort_order, id]
        );
        res.json({ success: true, category: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/knowledge/categories/:id', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    try {
        await query("DELETE FROM knowledge_categories WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, limit = 100 } = req.query;
        let sql = "SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE 1=1";
        const params = [];
        
        if (category_id) { sql += ` AND a.category_id = $${params.length + 1}`; params.push(category_id); }
        sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));
        
        const result = await query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT a.*, c.name as category_name FROM knowledge_articles a LEFT JOIN knowledge_categories c ON c.id = a.category_id WHERE a.id = $1",
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false });
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/articles', authMiddleware, async (req, res) => {
    try {
        const { category_id, title, content } = req.body;
        const result = await query(
            "INSERT INTO knowledge_articles (category_id, title, content, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
            [category_id, title, content, req.user.username]
        );
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, category_id } = req.body;
        
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [id]);
        if (article.rows.length === 0) return res.status(404).json({ success: false });
        
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0].created_by !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        
        const result = await query(
            "UPDATE knowledge_articles SET title = COALESCE($1, title), content = COALESCE($2, content), category_id = COALESCE($3, category_id), updated_at = NOW() WHERE id = $4 RETURNING *",
            [title, content, category_id, id]
        );
        res.json({ success: true, article: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/knowledge/articles/:id', authMiddleware, async (req, res) => {
    try {
        const article = await query("SELECT created_by FROM knowledge_articles WHERE id = $1", [req.params.id]);
        if (req.user.role !== 'director' && req.user.role !== 'manager' && article.rows[0]?.created_by !== req.user.username) {
            return res.status(403).json({ success: false, error: 'Нет прав' });
        }
        await query("DELETE FROM knowledge_articles WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/knowledge/articles/:id/view', authMiddleware, async (req, res) => {
    try {
        await query("UPDATE knowledge_articles SET views = views + 1 WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 29. API — ДОСТИЖЕНИЯ
// ============================================

app.get('/api/achievements', authMiddleware, async (req, res) => {
    try {
        const achievements = await query(`
            SELECT a.*, 
                   CASE WHEN ua.user_id IS NOT NULL THEN TRUE ELSE FALSE END as unlocked,
                   CASE WHEN pa.user_id IS NOT NULL THEN TRUE ELSE FALSE END as pending
            FROM achievements a
            LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
            LEFT JOIN pending_achievements pa ON pa.achievement_id = a.id AND pa.user_id = $1
            ORDER BY a.sort_order, a.id
        `, [req.user.id]);
        
        const stats = await query(`
            SELECT COUNT(DISTINCT a.id) as total, COUNT(DISTINCT ua.achievement_id) as unlocked
            FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
        `, [req.user.id]);
        
        res.json({ 
            success: true, 
            achievements: achievements.rows,
            stats: { total: parseInt(stats.rows[0].total), unlocked: parseInt(stats.rows[0].unlocked) }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/achievements/claim', authMiddleware, async (req, res) => {
    try {
        const { achievementId } = req.body;
        
        const pending = await query(
            "SELECT * FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2",
            [req.user.id, achievementId]
        );
        if (pending.rows.length === 0) return res.status(400).json({ success: false, error: 'Достижение недоступно' });
        
        const ach = await query("SELECT * FROM achievements WHERE id = $1", [achievementId]);
        
        await transaction(async (client) => {
            await client.query("DELETE FROM pending_achievements WHERE user_id = $1 AND achievement_id = $2", [req.user.id, achievementId]);
            await client.query("INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)", [req.user.id, achievementId]);
            await client.query("UPDATE employees SET coins = coins + $1 WHERE id = $2", [ach.rows[0].coins_reward, req.user.id]);
        });
        
        res.json({ success: true, coins: ach.rows[0].coins_reward, achievement: ach.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 30. API — ОТЧЁТЫ И ПАРСИНГ
// ============================================

app.get('/api/parsing/latest', authMiddleware, async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'data', 'booking-availability.json');
        if (!fs.existsSync(filePath)) {
            return res.json({ success: true, dates: {} });
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/parsing/run', authMiddleware, async (req, res) => {
    if (!['director', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Нет прав' });
    }
    
    res.json({ success: true, message: 'Парсинг запущен' });
    
    setImmediate(async () => {
        try {
            await bookingParser.parseAvailability();
        } catch (err) {
            console.error('❌ Ошибка парсинга:', err.message);
        }
    });
});

app.get('/api/parsing/progress', authMiddleware, (req, res) => {
    res.json({ 
        success: true, 
        isParsing: bookingParser.isParsingNow(), 
        progress: bookingParser.getProgress() 
    });
});

app.get('/api/weather', async (req, res) => {
    try {
        const weather = await fetchWeather();
        res.json({ success: true, ...weather });
    } catch (err) {
        res.json({ success: true, temp: 0, desc: 'Нет данных', icon: '🌡️' });
    }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const result = await query(
            "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
            [req.user.id, parseInt(limit)]
        );
        res.json({ success: true, transactions: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    try {
        const today = getTobolskDate();
        
        const onShift = await query("SELECT COUNT(*) FROM schedule WHERE date = $1 AND shift_time IS NOT NULL", [today]);
        const tasks = await query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as done FROM tasks WHERE is_archived = FALSE");
        const fines = await query("SELECT COUNT(*) FROM fines WHERE EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE)");
        
        res.json({
            success: true,
            onShift: parseInt(onShift.rows[0].count),
            tasks: { total: parseInt(tasks.rows[0].total), done: parseInt(tasks.rows[0].done) },
            finesThisMonth: parseInt(fines.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 31. API — АДМИНИСТРИРОВАНИЕ
// ============================================

app.get('/api/admin/theme', authMiddleware, async (req, res) => {
    try {
        const result = await query("SELECT value FROM system_settings WHERE key = 'global_theme'");
        res.json({ success: true, theme: result.rows[0]?.value || 'vr-portal' });
    } catch (err) {
        res.json({ success: true, theme: 'vr-portal' });
    }
});

app.post('/api/admin/theme', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { theme } = req.body;
        await query(
            "INSERT INTO system_settings (key, value) VALUES ('global_theme', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [theme]
        );
        res.json({ success: true, theme });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/bonus/employee', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        const { name, coins, rating } = req.body;
        if (coins) await query("UPDATE employees SET coins = coins + $1 WHERE name = $2", [coins, name]);
        if (rating) await query("UPDATE employees SET rating = rating + $1 WHERE name = $2", [rating, name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/reset-all', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await query("UPDATE employees SET deleted_at = NOW(), is_active = FALSE WHERE role != 'director'");
        await query("TRUNCATE tasks, subtasks, fines, schedule, exchange_requests, vp_bookings, salary_daily, messages, stickers, user_achievements, pending_achievements, transactions CASCADE");
        res.json({ success: true, message: 'Данные сброшены' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/equal-start', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await query("UPDATE employees SET coins = 100, rating = 0, hours = 0, total_shifts = 0, total_tasks_completed = 0, total_gifts_sent = 0, total_gifts_received = 0");
        await query("TRUNCATE tasks, subtasks, fines, schedule, exchange_requests, vp_bookings, salary_daily, stickers, user_achievements, pending_achievements, transactions CASCADE");
        await query("INSERT INTO corporate_fund (amount, operation_type) VALUES (0, 'reset')");
        res.json({ success: true, message: 'Равный старт выполнен' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/init-achievements', authMiddleware, async (req, res) => {
    if (req.user.role !== 'director') {
        return res.status(403).json({ success: false, error: 'Только директор' });
    }
    
    try {
        await initAchievements();
        res.json({ success: true, message: 'Достижения переинициализированы' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 32. API — УВЕДОМЛЕНИЯ
// ============================================

app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await query(
            "SELECT * FROM notifications WHERE recipient = $1 ORDER BY created_at DESC LIMIT 50",
            [req.user.username]
        );
        const unread = await query(
            "SELECT COUNT(*) FROM notifications WHERE recipient = $1 AND read = FALSE",
            [req.user.username]
        );
        res.json({ success: true, notifications: result.rows, unread: parseInt(unread.rows[0].count) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/notifications/read', authMiddleware, async (req, res) => {
    try {
        const { all, notification_id } = req.body;
        if (all) {
            await query("UPDATE notifications SET read = TRUE WHERE recipient = $1", [req.user.username]);
        } else if (notification_id) {
            await query("UPDATE notifications SET read = TRUE WHERE id = $1 AND recipient = $2", [notification_id, req.user.username]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const { all } = req.body;
        if (all) {
            await query("DELETE FROM notifications WHERE recipient = $1", [req.user.username]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 33. PUSHER АВТОРИЗАЦИЯ
// ============================================

app.post('/api/pusher/auth', authMiddleware, (req, res) => {
    if (!pusher) return res.status(500).json({ error: 'Pusher not configured' });
    
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    
    if (channel.startsWith('private-user-')) {
        const username = channel.replace('private-user-', '');
        if (transliterate(req.user.username) !== username && req.user.role !== 'director') {
            return res.status(403).json({ error: 'Access denied' });
        }
    }
    
    const auth = pusher.authorizeChannel(socketId, channel);
    res.send(auth);
});

console.log('✅ ЧАСТЬ 6/8 загружена');
// ============================================
// WARPOINT HUB — SERVER v5.0 ULTRA MEGA EDITION
// ЧАСТЬ 7/8: СТАТИКА, HEALTH CHECK, SHUTDOWN, ЗАПУСК
// ============================================

// ============================================
// 34. СТАТИЧЕСКИЕ ФАЙЛЫ И SPA
// ============================================

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница "О проекте"
app.get('/about.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

// Страницы из папки pages
app.get('/pages/:page', (req, res) => {
    const pagePath = path.join(__dirname, 'public', 'pages', req.params.page);
    if (fs.existsSync(pagePath)) {
        res.sendFile(pagePath);
    } else {
        res.status(404).send('Page not found');
    }
});

// SPA fallback — все остальные маршруты отдают index.html
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// 35. HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: SERVER_STATE.version,
        environment: process.env.NODE_ENV || 'development'
    };
    
    try {
        await query('SELECT 1');
        health.database = 'ok';
    } catch (err) {
        health.status = 'degraded';
        health.database = 'error';
    }
    
    health.pusher = pusher ? 'configured' : 'not_configured';
    
    const memory = process.memoryUsage();
    health.memory = {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
    };
    
    res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// 36. ОБРАБОТКА ОШИБОК
// ============================================

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, error: 'Endpoint not found' });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err.message);
    
    if (res.headersSent) return next(err);
    
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON' });
    }
    
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================
// 37. GRACEFUL SHUTDOWN
// ============================================

function gracefulShutdown(signal) {
    if (SERVER_STATE.isShuttingDown) return;
    
    SERVER_STATE.isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    if (server) {
        server.close(() => {
            console.log('✅ HTTP server closed');
        });
        
        setTimeout(() => {
            console.error('❌ Could not close connections in time, forcing shutdown');
            process.exit(1);
        }, 10000);
    }
    
    if (pool) {
        pool.end().then(() => {
            console.log('✅ Database pool closed');
        }).catch(err => {
            console.error('❌ Error closing pool:', err.message);
        });
    }
    
    if (bookingParser && typeof bookingParser.closeBrowser === 'function') {
        bookingParser.closeBrowser().catch(() => {});
    }
    
    console.log('👋 WARPOINT Hub shutting down...');
    
    setTimeout(() => {
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
    }, 2000);
}

// ============================================
// 38. ЗАПУСК СЕРВЕРА
// ============================================

async function startServer() {
    try {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║                                                              ║');
        console.log('║   ██╗    ██╗ █████╗ ██████╗ ██████╗  ██████╗ ██╗███╗   ██╗████████╗  ║');
        console.log('║   ██║    ██║██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║████╗  ██║╚══██╔══╝  ║');
        console.log('║   ██║ █╗ ██║███████║██████╔╝██████╔╝██║   ██║██║██╔██╗ ██║   ██║     ║');
        console.log('║   ██║███╗██║██╔══██║██╔══██╗██╔═══╝ ██║   ██║██║██║╚██╗██║   ██║     ║');
        console.log('║   ╚███╔███╔╝██║  ██║██║  ██║██║     ╚██████╔╝██║██║ ╚████║   ██║     ║');
        console.log('║    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝╚═╝  ╚═══╝   ╚═╝     ║');
        console.log('║                                                              ║');
        console.log('║                    CORPORATE PORTAL v5.0.0                    ║');
        console.log('║                                                              ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        
        // Инициализируем Pusher
        pusher = initPusher();
        
        // Создаём пул БД
        pool = createDatabasePool();
        if (!pool) throw new Error('Не удалось создать пул БД');
        
        // Инициализируем БД
        await initDatabase();
        
        // Инициализируем достижения
        await initAchievements();
        
        // Запускаем cron-задачи
        initCronJobs();
        
        // Запускаем сервер
        server = app.listen(PORT, '0.0.0.0', () => {
            SERVER_STATE.started = new Date();
            SERVER_STATE.isReady = true;
            
            console.log(`\n🚀 WARPOINT Hub запущен на порту ${PORT}`);
            console.log(`🌍 Окружение: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🕐 Часовой пояс: ${TIMEZONE}`);
            console.log(`📊 Текущее время: ${getTobolskNow().toLocaleString()}`);
            console.log(`\n👤 Директор по умолчанию: Денис / denis_1`);
            console.log(`\n✨ Готов к работе!\n`);
        });
        
        // Настройка keep-alive
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;
        
        // Обработчики сигналов
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));
        
        // Обработчики ошибок
        process.on('uncaughtException', (err) => {
            console.error('❌ UNCAUGHT EXCEPTION:', err.message);
            if (err.message.includes('EADDRINUSE')) {
                console.error(`\n❌ Порт ${PORT} уже занят!\n`);
                process.exit(1);
            }
        });
        
        process.on('unhandledRejection', (reason) => {
            console.error('❌ UNHANDLED REJECTION:', reason);
        });
        
        // 🔥 ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА ДИРЕКТОРА (через 3 секунды)
        setTimeout(async () => {
            try {
                console.log('🔍 Проверка директора...');
                const check = await query("SELECT id FROM employees WHERE name = 'Денис'");
                
                if (check.rows.length === 0) {
                    console.log('⚠️ Директор не найден, создаём...');
                    await createDefaultDirector();
                } else {
                    console.log('✅ Директор в порядке');
                    
                    // Проверяем пароль
                    const passCheck = await query("SELECT username FROM passwords WHERE username = 'Денис'");
                    if (passCheck.rows.length === 0) {
                        const hashedPassword = await hashPassword('denis_1');
                        await query("INSERT INTO passwords (username, password_hash) VALUES ('Денис', $1)", [hashedPassword]);
                        console.log('   ✅ Пароль создан');
                    }
                }
            } catch (err) {
                console.error('❌ Ошибка проверки:', err.message);
            }
        }, 3000);
        
        // Мониторинг памяти
        setInterval(() => {
            const mem = process.memoryUsage();
            console.log(`📊 Память: RSS=${Math.round(mem.rss/1024/1024)}MB, Heap=${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB`);
        }, 60000);
        
        // Первое обновление погоды
        setTimeout(() => {
            updateWeatherJob().catch(err => console.error('❌ Погода:', err.message));
        }, 5000);
        
    } catch (err) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

// ============================================
// 39. ЭКСПОРТ И ЗАПУСК
// ============================================

// Запускаем сервер
startServer().catch(err => {
    console.error('❌ Ошибка запуска:', err);
    process.exit(1);
});

// Экспорт для тестирования
module.exports = { app, startServer, gracefulShutdown };

console.log('✅ ЧАСТЬ 7/8 загружена');
