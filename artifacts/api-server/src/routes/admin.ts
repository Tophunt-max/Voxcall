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
  const { is_active, is_top_rated, identity_verified } = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active); }
  if (is_top_rated !== undefined) { sets.push('is_top_rated = ?'); vals.push(is_top_rated); }
  if (identity_verified !== undefined) { sets.push('identity_verified = ?'); vals.push(identity_verified); }
  vals.push(id);
  await db(c).prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
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

export default admin;

