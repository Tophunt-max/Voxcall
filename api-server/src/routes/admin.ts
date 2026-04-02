import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sendFCMPush, getFCMTokens } from '../lib/fcm';
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

// GET /api/admin/analytics — daily chart data (supports ?days=7 or ?days=30)
admin.get('/analytics', async (c) => {
  const dbA = c.env.DB;
  const daysParam = parseInt(c.req.query('days') || '7');
  const days = [7, 30].includes(daysParam) ? daysParam : 7;
  // Daily revenue + calls for requested range
  const callRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day,
           COUNT(*) as calls,
           COALESCE(SUM(coins_charged),0) as revenue
    FROM call_sessions
    WHERE created_at > unixepoch('now','-${days} days')
    GROUP BY day ORDER BY day ASC
  `).all<any>();
  // New users per day for requested range
  const userRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day, COUNT(*) as users
    FROM users
    WHERE created_at > unixepoch('now','-${days} days')
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

  // Build a date range map (7 or 30 days)
  const dateRange: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    dateRange.push(dt.toISOString().slice(0, 10));
  }
  const callMap: Record<string, { calls: number; revenue: number }> = {};
  (callRows.results || []).forEach((r: any) => { callMap[r.day] = { calls: r.calls, revenue: r.revenue }; });
  const userMap: Record<string, number> = {};
  (userRows.results || []).forEach((r: any) => { userMap[r.day] = r.users; });

  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const weekly = dateRange.map(day => {
    const d = new Date(day);
    const label = days <= 7
      ? DAY_LABELS[d.getDay()]
      : `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
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
    `SELECT h.*, u.name, u.email, u.avatar_url,
      (SELECT COUNT(*) FROM call_sessions cs WHERE cs.host_id = h.id AND cs.status = 'ended') AS total_calls
    FROM hosts h JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC`
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
  if (audio_coins_per_minute !== undefined) { sets.push('audio_coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(audio_coins_per_minute)))); }
  if (video_coins_per_minute !== undefined) { sets.push('video_coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(video_coins_per_minute)))); }
  if (coins_per_minute !== undefined) { sets.push('coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(coins_per_minute)))); }
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
  const d = db(c);

  // Bug fix: when rejecting a withdrawal, refund the coins to the host's balance
  if (status === 'rejected') {
    const wr = await d.prepare('SELECT wr.coins, wr.status, h.user_id FROM withdrawal_requests wr JOIN hosts h ON h.id = wr.host_id WHERE wr.id = ?').bind(id).first<any>();
    if (!wr) return c.json({ error: 'Withdrawal request not found' }, 404);
    if (wr.status !== 'pending' && wr.status !== 'approved') {
      return c.json({ error: `Cannot reject a ${wr.status} withdrawal` }, 400);
    }
    await d.batch([
      d.prepare('UPDATE withdrawal_requests SET status = ?, admin_note = ?, updated_at = unixepoch() WHERE id = ?').bind(status, admin_note ?? null, id),
      d.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(wr.coins, wr.user_id),
      d.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID(), wr.user_id, 'refund', wr.coins, `Withdrawal rejected by admin — ${wr.coins} coins refunded`, id
      ),
    ]);
    return c.json({ success: true, refunded_coins: wr.coins });
  }

  await d.prepare('UPDATE withdrawal_requests SET status = ?, admin_note = ?, updated_at = unixepoch() WHERE id = ?')
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
admin.delete('/coin-plans/:id', async (c) => {
  const { id } = c.req.param();
  const existing = await db(c).prepare('SELECT id, is_active FROM coin_plans WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Plan not found' }, 404);
  if (existing.is_active) {
    const activeCount = await db(c).prepare('SELECT COUNT(*) as cnt FROM coin_plans WHERE is_active = 1').first<{cnt: number}>();
    if (activeCount && activeCount.cnt <= 1) return c.json({ error: 'Cannot delete the last active plan' }, 409);
  }
  await db(c).prepare('DELETE FROM coin_plans WHERE id = ?').bind(id).run();
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
  const id = crypto.randomUUID();
  await db(c).prepare('INSERT INTO talk_topics (id, name, icon, is_active) VALUES (?, ?, ?, 1)')
    .bind(id, body.name, body.icon || '💬').run();
  return c.json({ id, ...body });
});
admin.patch('/talk-topics/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const ALLOWED_KEYS = new Set(['name', 'icon', 'is_active']);
  const safe = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k)));
  if (Object.keys(safe).length === 0) return c.json({ error: 'No valid fields to update' }, 400);
  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  await db(c).prepare(`UPDATE talk_topics SET ${fields} WHERE id = ?`).bind(...Object.values(safe), id).run();
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

  // Save to D1 notifications table
  const stmts = targetUsers.map((u: any) => {
    const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    return db(c).prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, u.id, type, title, msgBody, now);
  });
  await db(c).batch(stmts);

  // Send actual Expo Push Notifications in batches of 100
  try {
    const userIds = targetUsers.map((u: any) => u.id);
    const batchSize = 100;
    let totalPushed = 0;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const tokens = await getFCMTokens(db(c), batch);
      if (tokens.length > 0) {
        const result = await sendFCMPush(c.env.FIREBASE_SERVICE_ACCOUNT, tokens, title, msgBody, { type, notif_type: type });
        totalPushed += result.sent;
      }
    }
    return c.json({ sent: targetUsers.length, pushed: totalPushed });
  } catch (err) {
    console.error('[Push] admin send error:', err);
    return c.json({ sent: targetUsers.length, pushed: 0 });
  }
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
  const ALLOWED_KEYS = new Set(['question', 'answer', 'order_index', 'is_active']);
  const safe = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k)));
  if (Object.keys(safe).length === 0) return c.json({ error: 'No valid fields to update' }, 400);
  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(safe), id];
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


// ─── Helper: log admin action ─────────────────────────────────────────────────
async function auditLog(d: D1Database, adminId: string, adminName: string, adminEmail: string, action: string, targetType: string, target: string, detail: string, ip = '') {
  const id = crypto.randomUUID();
  await d.prepare(
    'INSERT INTO audit_logs (id, admin_id, admin_name, admin_email, action, target_type, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, adminId, adminName, adminEmail, action, targetType, target, detail, ip).run().catch((err: any) => {
    console.error('[AuditLog] Failed to write audit log:', err?.message ?? err);
  });
}

// ─── Payouts (alias for withdrawals with enriched field names) ────────────────
admin.get('/payouts', async (c) => {
  const result = await db(c).prepare(`
    SELECT wr.id, wr.coins as coins_earned, wr.amount as inr_amount, wr.status,
      wr.payment_method as bank, wr.admin_note, wr.created_at as requested_at,
      strftime('%B %Y', datetime(wr.created_at, 'unixepoch')) as period,
      h.display_name as host_name, u.name, u.email as host_email
    FROM withdrawal_requests wr
    JOIN hosts h ON h.id = wr.host_id JOIN users u ON u.id = h.user_id
    ORDER BY wr.created_at DESC
  `).all();
  return c.json(result.results);
});

// ─── Deposits (Coin Purchases) ────────────────────────────────────────────────
admin.get('/deposits', async (c) => {
  const result = await db(c).prepare(`
    SELECT cp.*, u.name as user_name, u.email as user_email, u.phone as user_phone
    FROM coin_purchases cp
    LEFT JOIN users u ON u.id = cp.user_id
    ORDER BY cp.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

admin.patch('/deposits/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const sets: string[] = [];
  const vals: any[] = [];
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status); }
  if (body.admin_note !== undefined) { sets.push('admin_note = ?'); vals.push(body.admin_note); }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  if (body.status === 'refunded') {
    const purchase = await db(c).prepare('SELECT user_id, coins, bonus_coins, status FROM coin_purchases WHERE id = ?').bind(id).first<any>();
    if (!purchase) return c.json({ error: 'Deposit not found' }, 404);
    if (purchase.status === 'refunded') return c.json({ error: 'Deposit already refunded' }, 400);
    if (purchase.status !== 'success') return c.json({ error: 'Only successful deposits can be refunded' }, 400);
    const totalRefund = (purchase.coins || 0) + (purchase.bonus_coins || 0);
    await db(c).batch([
      db(c).prepare(`UPDATE coin_purchases SET ${sets.join(', ')} WHERE id = ?`).bind(...vals),
      db(c).prepare('UPDATE users SET coins = coins - ?, updated_at = unixepoch() WHERE id = ?').bind(totalRefund, purchase.user_id),
      db(c).prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID(), purchase.user_id, 'refund', -totalRefund, `Deposit refunded by admin`, id
      ),
    ]);
  } else {
    await db(c).prepare(`UPDATE coin_purchases SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  }
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'deposit', id, `Deposit ${id} updated: ${JSON.stringify(body)}`);
  return c.json({ success: true });
});

// ─── Promo Codes CRUD ─────────────────────────────────────────────────────────
admin.get('/promo-codes', async (c) => {
  const result = await db(c).prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all();
  return c.json(result.results);
});
admin.post('/promo-codes', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO promo_codes (id, code, type, discount_pct, bonus_coins, max_uses, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, String(body.code).toUpperCase(), body.type || 'percent', body.discount_pct || 0, body.bonus_coins || 0, body.max_uses || 100, body.expires_at || null, body.active !== false ? 1 : 0).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'create', 'promo_code', body.code, `Promo code created: ${body.code}`);
  return c.json({ id, success: true }, 201);
});
admin.patch('/promo-codes/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const fields = ['code', 'type', 'discount_pct', 'bonus_coins', 'max_uses', 'expires_at', 'active'];
  const sets: string[] = []; const vals: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'code' ? String(body[f]).toUpperCase() : body[f]); }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE promo_codes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/promo-codes/:id', async (c) => {
  const { id } = c.req.param();
  const row = await db(c).prepare('SELECT code FROM promo_codes WHERE id = ?').bind(id).first<any>();
  await db(c).prepare('DELETE FROM promo_codes WHERE id = ?').bind(id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'delete', 'promo_code', row?.code || id, `Promo code deleted`);
  return c.json({ success: true });
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
admin.get('/support-tickets', async (c) => {
  const result = await db(c).prepare('SELECT * FROM support_tickets ORDER BY created_at DESC').all();
  return c.json((result.results || []).map((t: any) => ({ ...t, messages: JSON.parse(t.messages || '[]') })));
});
admin.patch('/support-tickets/:id', async (c) => {
  const { id } = c.req.param();
  const { status, priority } = await c.req.json() as any;
  const sets: string[] = []; const vals: any[] = [];
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (priority !== undefined) { sets.push('priority = ?'); vals.push(priority); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.post('/support-tickets/:id/reply', async (c) => {
  const { id } = c.req.param();
  const { text } = await c.req.json() as any;
  const ticket = await db(c).prepare('SELECT messages FROM support_tickets WHERE id = ?').bind(id).first<any>();
  if (!ticket) return c.json({ error: 'Not found' }, 404);
  const messages = JSON.parse(ticket.messages || '[]');
  messages.push({ from: 'admin', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  await db(c).prepare('UPDATE support_tickets SET messages = ?, status = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(JSON.stringify(messages), 'in_progress', id).run();
  return c.json({ success: true, messages });
});

// ─── Content Reports ──────────────────────────────────────────────────────────
admin.get('/content-reports', async (c) => {
  const result = await db(c).prepare(
    `SELECT cr.*, 
      ru.name as reported_user_name, ru.phone as reported_user_phone, ru.email as reported_user_email, ru.avatar_url as reported_user_avatar,
      rp.name as reporter_display_name, rp.phone as reporter_phone, rp.email as reporter_email
     FROM content_reports cr
     LEFT JOIN users ru ON cr.reported_user_id = ru.id
     LEFT JOIN users rp ON cr.reporter_id = rp.id
     ORDER BY cr.created_at DESC`
  ).all();
  return c.json(result.results);
});
admin.get('/content-reports/stats', async (c) => {
  const stats = await db(c).prepare(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN status = 'actioned' THEN 1 ELSE 0 END) as actioned,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
      SUM(CASE WHEN created_at > unixepoch() - 86400 THEN 1 ELSE 0 END) as last_24h
     FROM content_reports`
  ).first<any>();
  return c.json(stats);
});
admin.patch('/content-reports/:id', async (c) => {
  const { id } = c.req.param();
  const { status, action_taken } = await c.req.json() as any;
  const d = db(c);
  const report = await d.prepare('SELECT * FROM content_reports WHERE id = ?').bind(id).first<any>();
  if (!report) return c.json({ error: 'Report not found' }, 404);
  await d.prepare('UPDATE content_reports SET status = ?, action_taken = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(status, action_taken ?? null, id).run();
  const u = c.get('user');
  if (report.reported_user_id && action_taken && action_taken !== 'dismiss') {
    const target = await d.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(report.reported_user_id).first<any>();
    if (target) {
      if (action_taken === 'banned') {
        const banId = crypto.randomUUID();
        await d.prepare(
          'INSERT OR IGNORE INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, banned_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(banId, target.id, target.name || '', target.email || '', report.reported_type || 'user', `Report: ${report.reason}`, 'permanent', u.email || 'Admin').run();
        await d.prepare('UPDATE users SET status = ? WHERE id = ?').bind('banned', target.id).run();
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'ban', 'user', target.name || target.id, `Banned via report: ${report.reason}`);
      } else if (action_taken === 'suspended_7d') {
        const banId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
        await d.prepare(
          'INSERT OR IGNORE INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, banned_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(banId, target.id, target.name || '', target.email || '', report.reported_type || 'user', `Report: ${report.reason}`, 'temporary', u.email || 'Admin', expiresAt).run();
        await d.prepare('UPDATE users SET status = ? WHERE id = ?').bind('suspended', target.id).run();
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'suspend', 'user', target.name || target.id, `Suspended 7 days via report: ${report.reason}`);
      } else if (action_taken === 'warned') {
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'warn', 'user', target.name || target.id, `Warning via report: ${report.reason}`);
      } else if (action_taken === 'content_removed') {
        if (report.reported_type === 'host') {
          await d.prepare('UPDATE hosts SET is_active = 0 WHERE user_id = ?').bind(target.id).run();
        }
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'content_removed', 'user', target.name || target.id, `Content removed via report: ${report.reason}`);
      }
    }
  }
  await auditLog(d, u.sub, u.email || 'Admin', u.email || '', action_taken || status, 'content_report', id, `Report ${status}: ${action_taken || ''}`);
  return c.json({ success: true });
});

// ─── User Bans ────────────────────────────────────────────────────────────────
admin.get('/bans', async (c) => {
  const result = await db(c).prepare('SELECT * FROM user_bans ORDER BY banned_at DESC').all();
  return c.json(result.results);
});
admin.post('/bans', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  let userId = body.user_id ?? null;
  let userName = body.user_name || body.email?.split('@')[0] || 'Unknown';
  if (!userId && body.email) {
    const u2 = await db(c).prepare('SELECT id, name FROM users WHERE email = ?').bind(body.email).first<any>();
    if (u2) { userId = u2.id; userName = u2.name; }
  }
  await db(c).prepare(
    'INSERT INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, device_id, banned_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, userName, body.email ?? '', body.type || 'user', body.reason, body.ban_type || 'permanent', body.device_id ?? null, 'Admin', body.expires_at || null).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'ban', 'user', userName, `${body.ban_type || 'permanent'} ban: ${body.reason}`);
  return c.json({ id, success: true }, 201);
});
admin.delete('/bans/:id', async (c) => {
  const { id } = c.req.param();
  const ban = await db(c).prepare('SELECT user_name, user_id FROM user_bans WHERE id = ?').bind(id).first<any>();
  await db(c).prepare('DELETE FROM user_bans WHERE id = ?').bind(id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'unban', 'user', ban?.user_name || id, 'Ban removed');
  return c.json({ success: true });
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
admin.get('/audit-logs', async (c) => {
  const result = await db(c).prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all();
  return c.json((result.results || []).map((l: any) => ({
    ...l,
    admin: l.admin_name || 'Admin',
    admin_email: l.admin_email || '',
    ts: new Date(l.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19),
  })));
});

// ─── Payment Gateways CRUD ───────────────────────────────────────────────────
admin.get('/payment-gateways', async (c) => {
  const result = await db(c).prepare('SELECT * FROM payment_gateways ORDER BY position ASC, created_at DESC').all();
  return c.json(result.results);
});
admin.post('/payment-gateways', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO payment_gateways (id, name, type, icon_emoji, platforms, instruction, redirect_url, is_active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
  ).bind(id, body.name, body.type || 'manual', body.icon_emoji || '💳', JSON.stringify(body.platforms || ['all']), body.instruction || '', body.redirect_url || '', body.is_active ? 1 : 1, body.position || 0).run();
  return c.json({ id, success: true });
});
admin.patch('/payment-gateways/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const sets: string[] = [], vals: any[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.type !== undefined) { sets.push('type = ?'); vals.push(body.type); }
  if (body.icon_emoji !== undefined) { sets.push('icon_emoji = ?'); vals.push(body.icon_emoji); }
  if (body.platforms !== undefined) { sets.push('platforms = ?'); vals.push(JSON.stringify(body.platforms)); }
  if (body.instruction !== undefined) { sets.push('instruction = ?'); vals.push(body.instruction); }
  if (body.redirect_url !== undefined) { sets.push('redirect_url = ?'); vals.push(body.redirect_url); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (body.position !== undefined) { sets.push('position = ?'); vals.push(body.position); }
  if (!sets.length) return c.json({ success: true });
  sets.push('updated_at = unixepoch()');
  await db(c).prepare(`UPDATE payment_gateways SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ success: true });
});
admin.delete('/payment-gateways/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM payment_gateways WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Banners CRUD ─────────────────────────────────────────────────────────────
admin.get('/banners', async (c) => {
  const result = await db(c).prepare('SELECT * FROM banners ORDER BY created_at DESC').all();
  return c.json(result.results);
});
admin.post('/banners', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO banners (id, title, subtitle, image_url, bg_color, cta_text, cta_link, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.title, body.subtitle || '', body.image_url || '', body.bg_color || '#7C3AED', body.cta_text || 'Learn More', body.cta_link || '', body.position || 'home_top', body.active !== false ? 1 : 0).run();
  return c.json({ id, success: true }, 201);
});
admin.patch('/banners/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const fields = ['title', 'subtitle', 'image_url', 'bg_color', 'cta_text', 'cta_link', 'position', 'active'];
  const sets: string[] = []; const vals: any[] = [];
  for (const f of fields) { if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); } }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE banners SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/banners/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM banners WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Referrals ────────────────────────────────────────────────────────────────
admin.get('/referrals', async (c) => {
  const topRows = await db(c).prepare(`
    SELECT rc.user_id, u.name as referrer, u.email as referrer_email,
      COUNT(ru.id) as referred_count,
      COALESCE(SUM(ru.coins_given), 0) as coins_earned,
      SUM(CASE WHEN ru.created_at > unixepoch('now','-30 days') THEN 1 ELSE 0 END) as this_month
    FROM referral_codes rc
    JOIN users u ON u.id = rc.user_id
    LEFT JOIN referral_uses ru ON ru.referrer_id = rc.user_id
    GROUP BY rc.user_id
    ORDER BY referred_count DESC
    LIMIT 50
  `).all<any>();
  const recentRows = await db(c).prepare(`
    SELECT ru.id, ru.coins_given, ru.status,
      ref.name as referrer,
      rfd.name as new_user,
      datetime(ru.created_at,'unixepoch') as joined_at
    FROM referral_uses ru
    JOIN users ref ON ref.id = ru.referrer_id
    JOIN users rfd ON rfd.id = ru.referred_id
    ORDER BY ru.created_at DESC
    LIMIT 20
  `).all<any>();
  const stats = await db(c).prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN created_at > unixepoch('now','-30 days') THEN 1 ELSE 0 END) as this_month,
      COALESCE(SUM(coins_given), 0) as coins_distributed
    FROM referral_uses
  `).first<any>();
  return c.json({
    top: (topRows.results || []).map((r: any, i: number) => ({ ...r, id: String(i + 1), status: 'active' })),
    recent: (recentRows.results || []).map((r: any) => ({ ...r, joined_at: (r.joined_at || '').slice(0, 10) })),
    stats: { total: stats?.total || 0, this_month: stats?.this_month || 0, coins_distributed: stats?.coins_distributed || 0 },
  });
});
admin.get('/referral-config', async (c) => {
  const keys = ['referrer_reward', 'new_user_reward', 'min_calls_to_unlock', 'referral_active'];
  const result = await db(c).prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys).all<any>();
  const obj: any = { referrer_reward: 100, new_user_reward: 50, min_calls_to_unlock: 1, active: true };
  (result.results || []).forEach((r: any) => {
    if (r.key === 'referral_active') obj.active = r.value === '1';
    else if (['referrer_reward', 'new_user_reward', 'min_calls_to_unlock'].includes(r.key)) obj[r.key] = parseInt(r.value);
  });
  return c.json(obj);
});
admin.put('/referral-config', async (c) => {
  const body = await c.req.json() as any;
  const stmts = [
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('referrer_reward', ?, unixepoch())").bind(String(body.referrer_reward || 100)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('new_user_reward', ?, unixepoch())").bind(String(body.new_user_reward || 50)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('min_calls_to_unlock', ?, unixepoch())").bind(String(body.min_calls_to_unlock || 1)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('referral_active', ?, unixepoch())").bind(body.active ? '1' : '0'),
  ];
  await db(c).batch(stmts);
  return c.json({ success: true });
});

// ─── Live Calls ───────────────────────────────────────────────────────────────
admin.get('/calls/live', async (c) => {
  const STALE_HOURS = 4;
  const staleThreshold = Math.floor(Date.now() / 1000) - (STALE_HOURS * 3600);
  await db(c).prepare(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = unixepoch(),
        duration_seconds = unixepoch() - started_at
    WHERE status = 'active' AND started_at IS NOT NULL AND started_at < ?
  `).bind(staleThreshold).run();

  const result = await db(c).prepare(`
    SELECT cs.id, cs.type, cs.status, cs.started_at, cs.coins_charged,
      u.name as user, u.email as caller_email,
      h.display_name as host,
      COALESCE(h.audio_coins_per_minute, h.coins_per_minute, 5) as coins_per_min
    FROM call_sessions cs
    LEFT JOIN users u ON cs.caller_id = u.id
    LEFT JOIN hosts h ON cs.host_id = h.id
    WHERE cs.status = 'active'
    ORDER BY cs.started_at ASC
  `).all<any>();
  return c.json((result.results || []).map((r: any) => ({
    ...r,
    started_at: r.started_at ? r.started_at * 1000 : Date.now(),
  })));
});

admin.post('/calls/stale-cleanup', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  const maxHours = Math.max(1, Math.min(24, parseInt(body.max_hours) || 4));
  const staleThreshold = Math.floor(Date.now() / 1000) - (maxHours * 3600);
  const result = await db(c).prepare(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = unixepoch(),
        duration_seconds = unixepoch() - COALESCE(started_at, unixepoch())
    WHERE status = 'active'
      AND (started_at IS NULL OR started_at < ?)
  `).bind(staleThreshold).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'calls', 'Stale Cleanup', `Ended ${result.meta?.changes ?? 0} stale calls (>${maxHours}h)`);
  return c.json({ success: true, ended: result.meta?.changes ?? 0 });
});

admin.post('/calls/:id/force-end', async (c) => {
  const { id } = c.req.param();
  const session = await db(c).prepare('SELECT * FROM call_sessions WHERE id = ?').bind(id).first<any>();
  if (!session) return c.json({ error: 'Call not found' }, 404);
  if (session.status === 'ended') return c.json({ error: 'Call already ended' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const durationSec = session.started_at ? now - session.started_at : 0;
  const coinsCharged = Math.floor(durationSec / 60) * (session.coins_per_min ?? 0);
  await db(c).prepare(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = ?, duration_seconds = ?, coins_charged = ?
    WHERE id = ?
  `).bind(now, durationSec, coinsCharged, id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'calls', id, `Force-ended call (was ${session.status})`);
  return c.json({ success: true, id, duration_seconds: durationSec });
});

// ─── App Config (alias for settings) ─────────────────────────────────────────
admin.get('/app-config', async (c) => {
  const result = await db(c).prepare('SELECT key, value FROM app_settings').all<any>();
  const obj: any = {};
  (result.results || []).forEach((r: any) => { obj[r.key] = r.value; });
  return c.json(obj);
});
admin.put('/app-config', async (c) => {
  const body = await c.req.json() as any;
  const stmts = Object.entries(body).map(([k, v]) =>
    db(c).prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())').bind(k, String(v))
  );
  if (stmts.length) await db(c).batch(stmts);
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'settings', 'App Config', `${stmts.length} settings updated`);
  return c.json({ success: true });
});

// POST /api/admin/run-migrations — apply missing schema to production DB
admin.post('/run-migrations', async (c) => {
  const db = c.env.DB;
  const results: string[] = [];

  const statements = [
    // Promo Codes
    `CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      code TEXT UNIQUE NOT NULL,
      type TEXT DEFAULT 'percent' CHECK(type IN ('percent','bonus')),
      discount_pct INTEGER DEFAULT 0,
      bonus_coins INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      expires_at TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // Support Tickets
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      subject TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      messages TEXT DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // Content Reports
    `CREATE TABLE IF NOT EXISTS content_reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      reporter_id TEXT,
      reporter_name TEXT,
      reported_user_id TEXT,
      reported_user TEXT,
      reported_type TEXT DEFAULT 'user',
      reason TEXT NOT NULL,
      category TEXT DEFAULT 'harassment',
      evidence TEXT,
      status TEXT DEFAULT 'pending',
      action_taken TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // User Bans
    `CREATE TABLE IF NOT EXISTS user_bans (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      type TEXT DEFAULT 'user',
      reason TEXT NOT NULL,
      ban_type TEXT DEFAULT 'permanent',
      device_id TEXT,
      banned_by TEXT DEFAULT 'Admin',
      banned_at INTEGER DEFAULT (unixepoch()),
      expires_at TEXT
    )`,
    // Audit Logs
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      admin_id TEXT,
      admin_name TEXT,
      admin_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target TEXT,
      detail TEXT,
      ip TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    // Banners
    `CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      bg_color TEXT DEFAULT '#7C3AED',
      cta_text TEXT DEFAULT 'Learn More',
      cta_link TEXT DEFAULT '',
      position TEXT DEFAULT 'home_top',
      active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // Referral Codes
    `CREATE TABLE IF NOT EXISTS referral_codes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id TEXT UNIQUE NOT NULL,
      code TEXT UNIQUE NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    // Referral Uses
    `CREATE TABLE IF NOT EXISTS referral_uses (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      referrer_id TEXT NOT NULL,
      referred_id TEXT NOT NULL,
      coins_given INTEGER DEFAULT 100,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(referred_id)
    )`,
    // Talk Topics (if not exists)
    `CREATE TABLE IF NOT EXISTS talk_topics (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '💬',
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    // FAQs (if not exists)
    `CREATE TABLE IF NOT EXISTS faqs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      is_active INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    // App Settings (if not exists)
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // Coin Plans (if not exists)
    `CREATE TABLE IF NOT EXISTS coin_plans (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name TEXT NOT NULL,
      coins INTEGER NOT NULL,
      bonus_coins INTEGER DEFAULT 0,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      is_popular INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )`,
    // Payment Gateways
    `CREATE TABLE IF NOT EXISTS payment_gateways (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual',
      icon_emoji TEXT DEFAULT '💳',
      platforms TEXT DEFAULT '["all"]',
      instruction TEXT DEFAULT '',
      redirect_url TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      position INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    // Safe ALTER TABLE additions
    `ALTER TABLE users ADD COLUMN referral_code TEXT`,
    `ALTER TABLE users ADD COLUMN google_id TEXT`,
    `ALTER TABLE users ADD COLUMN device_id TEXT`,
    `ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE content_reports ADD COLUMN reported_type TEXT DEFAULT 'user'`,
    `ALTER TABLE call_sessions ADD COLUMN cf_host_session_id TEXT`,
    // Index for device_id
    `CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id) WHERE device_id IS NOT NULL`,
    // Seed promo codes
    `INSERT OR IGNORE INTO promo_codes (id, code, type, discount_pct, bonus_coins, max_uses, used_count, expires_at, active) VALUES
      ('pc1', 'WELCOME50', 'percent', 50, 0, 100, 34, '2026-06-30', 1),
      ('pc2', 'VOXLINK20', 'percent', 20, 0, 500, 210, '2026-05-15', 1),
      ('pc3', 'COINS100', 'bonus', 0, 100, 200, 55, '2026-07-31', 1)`,
    // Seed banners
    `INSERT OR IGNORE INTO banners (id, title, subtitle, bg_color, cta_text, cta_link, position, active) VALUES
      ('bn1', 'Weekend Offer — 30% Off Coins!', 'Limited time only. Use code WEEKEND30', '#7C3AED', 'Grab Deal', '/coins', 'home_top', 1),
      ('bn2', 'New Hosts Available!', 'Explore 20+ new hosts added this week', '#0EA5E9', 'Browse Hosts', '/hosts', 'home_middle', 1)`,
    // Seed talk topics
    `INSERT OR IGNORE INTO talk_topics (id, name, icon, is_active, sort_order) VALUES
      ('t1','Life Coaching','🌱',1,1),
      ('t2','Relationships','❤️',1,2),
      ('t3','Career','💼',1,3),
      ('t4','Wellness','🧘',1,4),
      ('t5','Mental Health','🧠',1,5),
      ('t6','Music','🎵',1,6),
      ('t7','Travel','✈️',1,7),
      ('t8','Casual Talk','☕',1,8)`,
    // Coin Purchases (deposit tracking)
    `CREATE TABLE IF NOT EXISTS coin_purchases (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id TEXT NOT NULL,
      plan_id TEXT,
      plan_name TEXT,
      coins INTEGER NOT NULL DEFAULT 0,
      bonus_coins INTEGER DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      payment_method TEXT DEFAULT 'unknown',
      gateway_id TEXT,
      gateway_name TEXT,
      payment_ref TEXT,
      utr_id TEXT,
      promo_code TEXT,
      status TEXT DEFAULT 'success' CHECK(status IN ('pending','success','failed','refunded')),
      admin_note TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS idx_coin_purchases_user ON coin_purchases(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_coin_purchases_status ON coin_purchases(status)`,
    // Seed coin plans
    `INSERT OR IGNORE INTO coin_plans (id, name, coins, bonus_coins, price, currency, is_popular, is_active) VALUES
      ('cp1', 'Starter', 50, 0, 0.99, 'USD', 0, 1),
      ('cp2', 'Basic', 100, 10, 1.99, 'USD', 0, 1),
      ('cp3', 'Popular', 300, 50, 4.99, 'USD', 1, 1),
      ('cp4', 'Pro', 500, 100, 7.99, 'USD', 0, 1),
      ('cp5', 'Premium', 1000, 250, 14.99, 'USD', 0, 1),
      ('cp6', 'Elite', 2000, 600, 24.99, 'USD', 0, 1)`,
    // Seed FAQs
    `INSERT OR IGNORE INTO faqs (id, question, answer, category, is_active, order_index) VALUES
      ('f1','How do coins work?','Coins are used to connect with hosts. Each host charges a per-minute rate.','billing',1,1),
      ('f2','How do I buy coins?','Tap the coin balance in the app to open the Buy Coins page.','billing',1,2),
      ('f3','Are calls private?','Yes, all calls are private and end-to-end encrypted.','privacy',1,3)`
  ];

  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
      results.push(`OK: ${sql.trim().slice(0, 60)}...`);
    } catch (e: any) {
      // Ignore "already exists" / "duplicate column" errors
      if (e?.message?.includes('already exists') || e?.message?.includes('duplicate column')) {
        results.push(`SKIP (already exists): ${sql.trim().slice(0, 60)}...`);
      } else {
        results.push(`ERR: ${e?.message} | SQL: ${sql.trim().slice(0, 60)}...`);
      }
    }
  }

  const u = c.get('user');
  try {
    await db.prepare(`INSERT INTO audit_logs (id, admin_id, admin_name, action, detail, created_at)
      VALUES (lower(hex(randomblob(8))), ?, ?, 'run_migrations', ?, unixepoch())`)
      .bind(u.sub, u.email || 'Admin', `Applied ${results.length} migration steps`).run();
  } catch {}

  return c.json({ success: true, results, total: results.length });
});

export default admin;
