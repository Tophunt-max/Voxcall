import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const admin = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
admin.use('*', authMiddleware, adminMiddleware);

// GET /api/admin/dashboard
admin.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const [users, hosts, calls, revenue] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM users WHERE role = "user"').first<any>(),
    db.prepare('SELECT COUNT(*) as count FROM hosts').first<any>(),
    db.prepare('SELECT COUNT(*) as count FROM call_sessions WHERE DATE(created_at, "unixepoch") = DATE("now")').first<any>(),
    db.prepare('SELECT SUM(coins_charged) as total FROM call_sessions WHERE status = "ended"').first<any>(),
  ]);
  return c.json({ total_users: users?.count, total_hosts: hosts?.count, calls_today: calls?.count, total_revenue_coins: revenue?.total });
});

// GET /api/admin/analytics — last 7 days chart data
admin.get('/analytics', async (c) => {
  const dbA = c.env.DB;
  // Last 7 days daily revenue + calls
  const callRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day,
           COUNT(*) as calls,
           COALESCE(SUM(coins_charged),0) as revenue
    FROM call_sessions
    WHERE created_at > unixepoch('now','-7 days')
    GROUP BY day ORDER BY day ASC
  `).all<any>();
  // Last 7 days new users per day
  const userRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day, COUNT(*) as users
    FROM users
    WHERE created_at > unixepoch('now','-7 days')
    GROUP BY day ORDER BY day ASC
  `).all<any>();
  // Role distribution
  const roles = await dbA.prepare(`
    SELECT role, COUNT(*) as cnt FROM users GROUP BY role
  `).all<any>();
  // Avg call duration
  const avg = await dbA.prepare(`
    SELECT COALESCE(AVG(duration_seconds),0) as avg_duration FROM call_sessions WHERE status='ended'
  `).first<any>();

  // Build a 7-day map
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    days.push(dt.toISOString().slice(0, 10));
  }
  const callMap: Record<string, { calls: number; revenue: number }> = {};
  (callRows.results || []).forEach((r: any) => { callMap[r.day] = { calls: r.calls, revenue: r.revenue }; });
  const userMap: Record<string, number> = {};
  (userRows.results || []).forEach((r: any) => { userMap[r.day] = r.users; });

  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weekly = days.map(day => {
    const label = DAY_LABELS[new Date(day).getDay()];
    return { day: label, date: day, revenue: callMap[day]?.revenue ?? 0, calls: callMap[day]?.calls ?? 0, users: userMap[day] ?? 0 };
  });

  const roleMap: Record<string, number> = {};
  (roles.results || []).forEach((r: any) => { roleMap[r.role] = r.cnt; });

  return c.json({
    weekly,
    role_distribution: [
      { name: 'Users', value: roleMap['user'] ?? 0 },
      { name: 'Hosts', value: roleMap['host'] ?? 0 },
      { name: 'Admins', value: roleMap['admin'] ?? 0 },
    ],
    avg_call_duration: Math.round(avg?.avg_duration ?? 0),
  });
});

// GET /api/admin/users
admin.get('/users', async (c) => {
  const { page = '1', limit = '20', search } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let q = 'SELECT id, name, email, role, coins, is_verified, created_at FROM users';
  const params: any[] = [];
  if (search) { q += ' WHERE name LIKE ? OR email LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  const result = await db(c).prepare(q).bind(...params).all();
  return c.json(result.results);
});

function db(c: any) { return c.env.DB as D1Database; }

// PATCH /api/admin/users/:id
admin.patch('/users/:id', async (c) => {
  const { id } = c.req.param();
  const { coins, role, is_verified } = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  if (coins !== undefined) { sets.push('coins = ?'); vals.push(coins); }
  if (role !== undefined) { sets.push('role = ?'); vals.push(role); }
  if (is_verified !== undefined) { sets.push('is_verified = ?'); vals.push(is_verified); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);
  await db(c).prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// GET /api/admin/hosts
admin.get('/hosts', async (c) => {
  const result = await db(c).prepare(
    'SELECT h.*, u.name, u.email, u.avatar_url FROM hosts h JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC'
  ).all();
  return c.json(result.results.map((h: any) => ({ ...h, specialties: JSON.parse(h.specialties || '[]'), languages: JSON.parse(h.languages || '[]') })));
});

// PATCH /api/admin/hosts/:id
admin.patch('/hosts/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { is_active, is_top_rated, identity_verified, level, audio_coins_per_minute, video_coins_per_minute, coins_per_minute } = body;
  const sets: string[] = []; const vals: any[] = [];
  if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active); }
  if (is_top_rated !== undefined) { sets.push('is_top_rated = ?'); vals.push(is_top_rated); }
  if (identity_verified !== undefined) { sets.push('identity_verified = ?'); vals.push(identity_verified); }
  if (level !== undefined) { sets.push('level = ?'); vals.push(Math.min(5, Math.max(1, parseInt(level)))); }
  if (audio_coins_per_minute !== undefined) { sets.push('audio_coins_per_minute = ?'); vals.push(parseInt(audio_coins_per_minute)); }
  if (video_coins_per_minute !== undefined) { sets.push('video_coins_per_minute = ?'); vals.push(parseInt(video_coins_per_minute)); }
  if (coins_per_minute !== undefined) { sets.push('coins_per_minute = ?'); vals.push(parseInt(coins_per_minute)); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  await db(c).prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// POST /api/admin/hosts/:id/level — manually set host level
admin.post('/hosts/:id/level', async (c) => {
  const { id } = c.req.param();
  const { level } = await c.req.json<{ level: number }>();
  const lvl = Math.min(5, Math.max(1, parseInt(String(level))));
  await db(c).prepare('UPDATE hosts SET level = ?, updated_at = unixepoch() WHERE id = ?').bind(lvl, id).run();
  return c.json({ success: true, level: lvl });
});

// DEFAULT level config (fallback if not set in DB)
const DEFAULT_LEVEL_CONFIG = [
  { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform' },
  { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established' },
  { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise' },
  { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier' },
  { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer' },
];

async function getLevelConfig(d: D1Database): Promise<typeof DEFAULT_LEVEL_CONFIG> {
  try {
    const row = await d.prepare("SELECT value FROM app_settings WHERE key = 'level_config'").first<any>();
    if (row?.value) return JSON.parse(row.value);
  } catch (_) {}
  return DEFAULT_LEVEL_CONFIG;
}

// GET /api/admin/level-config
admin.get('/level-config', async (c) => {
  const config = await getLevelConfig(db(c));
  return c.json(config);
});

// PUT /api/admin/level-config
admin.put('/level-config', async (c) => {
  const body = await c.req.json<typeof DEFAULT_LEVEL_CONFIG>();
  if (!Array.isArray(body) || body.length !== 5) return c.json({ error: 'Invalid config: must be array of 5 levels' }, 400);
  const normalized = body.map((l, i) => ({
    level: i + 1,
    name: String(l.name || DEFAULT_LEVEL_CONFIG[i].name),
    badge: String(l.badge || DEFAULT_LEVEL_CONFIG[i].badge),
    color: String(l.color || DEFAULT_LEVEL_CONFIG[i].color),
    min_calls: Math.max(0, parseInt(String(l.min_calls)) || 0),
    min_rating: Math.min(5, Math.max(0, parseFloat(String(l.min_rating)) || 0)),
    coin_reward: Math.max(0, parseInt(String(l.coin_reward)) || 0),
    description: String(l.description || ''),
  }));
  await db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('level_config', ?, unixepoch())")
    .bind(JSON.stringify(normalized)).run();
  return c.json({ success: true, config: normalized });
});

// POST /api/admin/hosts/recalculate-levels — auto-recalculate all host levels using DB config
admin.post('/hosts/recalculate-levels', async (c) => {
  const d = db(c);
  const config = await getLevelConfig(d);
  const sorted = [...config].sort((a, b) => b.level - a.level); // highest first
  const stmts: D1PreparedStatement[] = [];
  for (const lvl of sorted) {
    if (lvl.level === 1) {
      stmts.push(d.prepare("UPDATE hosts SET level = 1 WHERE level IS NULL OR level < 1"));
    } else {
      stmts.push(d.prepare(
        `UPDATE hosts SET level = ? WHERE (level IS NULL OR level < ?) AND review_count >= ? AND rating >= ?`
      ).bind(lvl.level, lvl.level, lvl.min_calls, lvl.min_rating));
    }
  }
  await d.batch(stmts);
  return c.json({ success: true, config });
});

// GET /api/admin/withdrawals
admin.get('/withdrawals', async (c) => {
  const result = await db(c).prepare(
    `SELECT wr.*, h.display_name, u.name, u.email FROM withdrawal_requests wr
     JOIN hosts h ON h.id = wr.host_id JOIN users u ON u.id = h.user_id
     ORDER BY wr.created_at DESC`
  ).all();
  return c.json(result.results);
});

// PATCH /api/admin/withdrawals/:id
admin.patch('/withdrawals/:id', async (c) => {
  const { id } = c.req.param();
  const { status, admin_note } = await c.req.json();
  await db(c).prepare('UPDATE withdrawal_requests SET status = ?, admin_note = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(status, admin_note ?? null, id).run();
  return c.json({ success: true });
});

// GET/POST/PATCH /api/admin/coin-plans
admin.get('/coin-plans', async (c) => {
  const result = await db(c).prepare('SELECT * FROM coin_plans ORDER BY coins ASC').all();
  return c.json(result.results);
});
admin.post('/coin-plans', async (c) => {
  const { name, coins, price, bonus_coins, is_popular } = await c.req.json();
  const id = crypto.randomUUID();
  await db(c).prepare('INSERT INTO coin_plans (id, name, coins, price, bonus_coins, is_popular) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, coins, price, bonus_coins ?? 0, is_popular ?? 0).run();
  return c.json({ id, success: true }, 201);
});
admin.patch('/coin-plans/:id', async (c) => {
  const { id } = c.req.param();
  const { name, coins, price, bonus_coins, is_popular, is_active } = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  const fields = { name, coins, price, bonus_coins, is_popular, is_active };
  for (const [k, v] of Object.entries(fields)) { if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); } }
  vals.push(id);
  await db(c).prepare(`UPDATE coin_plans SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// GET/PATCH app settings
admin.get('/settings', async (c) => {
  const result = await db(c).prepare('SELECT * FROM app_settings').all();
  const obj: any = {};
  result.results.forEach((r: any) => { obj[r.key] = r.value; });
  return c.json(obj);
});
admin.patch('/settings', async (c) => {
  const body = await c.req.json();
  const stmts = Object.entries(body).map(([k, v]) =>
    db(c).prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())').bind(k, String(v))
  );
  await db(c).batch(stmts);
  return c.json({ success: true });
});

// Talk Topics CRUD
admin.get('/talk-topics', async (c) => {
  const result = await db(c).prepare('SELECT * FROM talk_topics ORDER BY name ASC').all();
  return c.json(result.results);
});
admin.post('/talk-topics', async (c) => {
  const body = await c.req.json() as any;
  const id = 'topic-' + Date.now();
  await db(c).prepare('INSERT INTO talk_topics (id, name, icon, is_active) VALUES (?, ?, ?, 1)')
    .bind(id, body.name, body.icon || '💬').run();
  return c.json({ id, ...body });
});
admin.patch('/talk-topics/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const fields = Object.entries(body).map(([k]) => `${k} = ?`).join(', ');
  await db(c).prepare(`UPDATE talk_topics SET ${fields} WHERE id = ?`).bind(...Object.values(body), id).run();
  return c.json({ success: true });
});
admin.delete('/talk-topics/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM talk_topics WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// Coin transactions
admin.get('/coin-transactions', async (c) => {
  const result = await db(c).prepare(`
    SELECT ct.*, u.name as user_name, u.email as user_email
    FROM coin_transactions ct
    LEFT JOIN users u ON ct.user_id = u.id
    ORDER BY ct.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

// Ratings
admin.get('/ratings', async (c) => {
  const result = await db(c).prepare(`
    SELECT r.*, u.name as user_name, h.display_name as host_display_name
    FROM ratings r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN hosts h ON r.host_id = h.id
    ORDER BY r.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

// Notifications: list + send
admin.get('/notifications', async (c) => {
  const result = await db(c).prepare(`
    SELECT n.*, u.name as user_name, u.email as user_email
    FROM notifications n
    LEFT JOIN users u ON n.user_id = u.id
    ORDER BY n.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});
admin.post('/notifications/send', async (c) => {
  const body = await c.req.json() as any;
  const { title, body: msgBody, type = 'system', target, userId } = body;
  const now = Math.floor(Date.now() / 1000);
  let targetUsers: any[] = [];
  if (target === 'all') {
    const r = await db(c).prepare('SELECT id FROM users').all();
    targetUsers = r.results;
  } else if (target === 'hosts') {
    const r = await db(c).prepare('SELECT u.id FROM users u INNER JOIN hosts h ON h.user_id = u.id').all();
    targetUsers = r.results;
  } else if (target === 'user' && userId) {
    targetUsers = [{ id: userId }];
  }
  if (targetUsers.length === 0) return c.json({ sent: 0 });
  const stmts = targetUsers.map((u: any) => {
    const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    return db(c).prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, u.id, type, title, msgBody, now);
  });
  await db(c).batch(stmts);
  return c.json({ sent: targetUsers.length });
});

// Call sessions
admin.get('/calls', async (c) => {
  const result = await db(c).prepare(`
    SELECT cs.*, 
      u.name as caller_name, u.email as caller_email,
      h.display_name as host_display_name
    FROM call_sessions cs
    LEFT JOIN users u ON cs.caller_id = u.id
    LEFT JOIN hosts h ON cs.host_id = h.id
    ORDER BY cs.created_at DESC LIMIT 200
  `).all();
  return c.json(result.results);
});

// FAQs CRUD
admin.get('/faqs', async (c) => {
  const result = await db(c).prepare('SELECT * FROM faqs ORDER BY order_index ASC, created_at ASC').all();
  return c.json(result.results);
});
admin.post('/faqs', async (c) => {
  const body = await c.req.json() as any;
  const id = 'faq-' + Date.now();
  await db(c).prepare(
    'INSERT INTO faqs (id, question, answer, order_index, is_active) VALUES (?, ?, ?, ?, 1)'
  ).bind(id, body.question, body.answer, body.order_index || 0).run();
  return c.json({ id, ...body });
});
admin.patch('/faqs/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const fields = Object.entries(body).map(([k]) => `${k} = ?`).join(', ');
  const vals = [...Object.values(body), id];
  await db(c).prepare(`UPDATE faqs SET ${fields}, updated_at = unixepoch() WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/faqs/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM faqs WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Host KYC Applications ───────────────────────────────────────────────────

// GET /api/admin/host-applications — list all applications
admin.get('/host-applications', async (c) => {
  const { status } = c.req.query();
  let q = `SELECT ha.*, u.email, u.avatar_url FROM host_applications ha
            JOIN users u ON u.id = ha.user_id`;
  const params: any[] = [];
  if (status) { q += ' WHERE ha.status = ?'; params.push(status); }
  q += ' ORDER BY ha.submitted_at DESC';
  const result = await db(c).prepare(q).bind(...params).all<any>();
  return c.json(result.results.map(r => ({
    ...r,
    specialties: JSON.parse(r.specialties || '[]'),
    languages: JSON.parse(r.languages || '[]'),
  })));
});

// GET /api/admin/host-applications/:id — single application detail
admin.get('/host-applications/:id', async (c) => {
  const { id } = c.req.param();
  const app = await db(c)
    .prepare(`SELECT ha.*, u.email, u.name as user_name, u.avatar_url
              FROM host_applications ha JOIN users u ON u.id = ha.user_id
              WHERE ha.id = ?`)
    .bind(id).first<any>();
  if (!app) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ...app,
    specialties: JSON.parse(app.specialties || '[]'),
    languages: JSON.parse(app.languages || '[]'),
  });
});

// PATCH /api/admin/host-applications/:id/review — approve or reject
admin.patch('/host-applications/:id/review', async (c) => {
  const { id } = c.req.param();
  const { action, rejection_reason } = await c.req.json<{ action: 'approve' | 'reject'; rejection_reason?: string }>();
  const { sub } = c.get('user');
  const d = db(c);

  if (!['approve', 'reject'].includes(action)) {
    return c.json({ error: 'action must be approve or reject' }, 400);
  }

  const app = await d.prepare('SELECT * FROM host_applications WHERE id = ?').bind(id).first<any>();
  if (!app) return c.json({ error: 'Application not found' }, 404);

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await d.prepare(
    `UPDATE host_applications SET status=?, rejection_reason=?, reviewed_by=?, reviewed_at=unixepoch(), updated_at=unixepoch() WHERE id=?`
  ).bind(newStatus, rejection_reason ?? null, sub, id).run();

  if (action === 'approve') {
    // Create host record + update user role
    const hostId = `host_${app.user_id}`;
    const existing = await d.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(app.user_id).first();
    if (!existing) {
      await d.batch([
        d.prepare(
          `INSERT INTO hosts (id, user_id, display_name, specialties, languages, audio_coins_per_minute, video_coins_per_minute, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        ).bind(hostId, app.user_id, app.display_name, app.specialties, app.languages, app.audio_rate ?? 5, app.video_rate ?? 8),
        d.prepare(`UPDATE users SET role='host', phone=COALESCE(phone,?), updated_at=unixepoch() WHERE id=?`)
          .bind(app.phone ?? null, app.user_id),
      ]);
    } else {
      await d.prepare(`UPDATE hosts SET display_name=?, specialties=?, is_active=1 WHERE user_id=?`)
        .bind(app.display_name, app.specialties, app.user_id).run();
      await d.prepare(`UPDATE users SET role='host', updated_at=unixepoch() WHERE id=?`).bind(app.user_id).run();
    }
  }

  return c.json({ success: true, status: newStatus });
});

export default admin;


