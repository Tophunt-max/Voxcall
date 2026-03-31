import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const user = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
user.use('*', authMiddleware);

// GET /api/user/me
user.get('/me', async (c) => {
  const { sub } = c.get('user');
  const me = await c.env.DB.prepare(
    'SELECT id, name, email, phone, avatar_url, gender, bio, coins, role, is_verified, created_at FROM users WHERE id = ?'
  ).bind(sub).first();
  if (!me) return c.json({ error: 'User not found' }, 404);
  return c.json(me);
});

// PATCH /api/user/me
user.patch('/me', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json();
  const allowed = ['name', 'phone', 'bio', 'gender', 'avatar_url', 'fcm_token'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]); }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(sub);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// GET /api/user/notifications
user.get('/notifications', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(sub).all();
  return c.json(result.results);
});

// PATCH /api/user/notifications/read
user.patch('/notifications/read', async (c) => {
  const { sub } = c.get('user');
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(sub).run();
  return c.json({ success: true });
});

// GET /api/user/coin-history
user.get('/coin-history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(sub).all();
  return c.json(result.results);
});

// POST /api/user/become-host
user.post('/become-host', async (c) => {
  const { sub, name } = c.get('user');
  const { specialties, languages, bio } = await c.req.json();
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first();
  if (existing) return c.json({ error: 'Already a host' }, 409);
  const hostId = `host_${sub}`;
  await db.batch([
    db.prepare('INSERT INTO hosts (id, user_id, display_name, specialties, languages) VALUES (?, ?, ?, ?, ?)')
      .bind(hostId, sub, name, JSON.stringify(specialties ?? []), JSON.stringify(languages ?? ['English'])),
    db.prepare('UPDATE users SET role = ?, bio = ?, updated_at = unixepoch() WHERE id = ?')
      .bind('host', bio ?? '', sub),
  ]);
  return c.json({ success: true, host_id: hostId }, 201);
});

export default user;
