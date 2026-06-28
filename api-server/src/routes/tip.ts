import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const tip = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
tip.use('*', authMiddleware);

const sendTipSchema = z.object({
  host_id: z.string().min(1),
  amount: z.number().int().min(1).max(50000),
  message: z.string().max(200).optional(),
  call_session_id: z.string().optional(),
});

// POST /api/tips/send — send a tip (coins) to a host
tip.post('/send', zValidator('json', sendTipSchema), async (c) => {
  const { sub } = c.get('user');
  const body = c.req.valid('json');
  const db = c.env.DB;

  // Lookup host
  const host = await db.prepare('SELECT id, user_id, display_name FROM hosts WHERE id = ?')
    .bind(body.host_id).first<{ id: string; user_id: string; display_name: string }>();
  if (!host) return c.json({ error: 'Host not found' }, 404);

  // Cannot tip yourself
  if (host.user_id === sub) {
    return c.json({ error: 'Cannot send a tip to yourself' }, 400);
  }

  // Atomic coin transfer: deduct from sender, credit to host
  // Uses the same all-or-nothing pattern as call billing.
  const tipId = crypto.randomUUID();
  const transferResult = await db.prepare(
    `UPDATE users SET coins = coins + CASE id
       WHEN ? THEN -?
       WHEN ? THEN ?
       ELSE 0
     END, updated_at = unixepoch()
     WHERE id IN (?, ?)
       AND EXISTS (SELECT 1 FROM users WHERE id = ? AND coins >= ?)`
  ).bind(
    sub, body.amount,
    host.user_id, body.amount,
    sub, host.user_id,
    sub, body.amount
  ).run();

  if (!transferResult.meta?.changes || transferResult.meta.changes === 0) {
    return c.json({ error: 'Insufficient coins' }, 402);
  }

  // Record the tip + ledger entries
  try {
    await db.batch([
      db.prepare(
        'INSERT INTO tips (id, sender_id, recipient_id, host_id, call_session_id, amount, message) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(tipId, sub, host.user_id, host.id, body.call_session_id ?? null, body.amount, body.message ?? null),
      db.prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), sub, 'spend', -body.amount, `Tip to ${host.display_name || 'Host'}`, tipId),
      db.prepare(
        'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), host.user_id, 'bonus', body.amount, `Tip received`, tipId),
    ]);
  } catch (e) {
    console.warn('[tip/send] ledger write failed (coins already moved):', e);
  }

  // Notify host via WebSocket
  try {
    const sender = await db.prepare('SELECT name FROM users WHERE id = ?').bind(sub).first<{ name: string }>();
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({
        type: 'tip_received',
        amount: body.amount,
        sender_name: sender?.name ?? 'Someone',
        message: body.message ?? null,
        tip_id: tipId,
      }),
    });
  } catch (e) {
    console.warn('[tip/send] notification failed:', e);
  }

  const updatedBalance = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();

  return c.json({
    success: true,
    tip_id: tipId,
    amount: body.amount,
    new_balance: updatedBalance?.coins ?? 0,
  });
});

// GET /api/tips/sent — tips sent by the current user
tip.get('/sent', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  try {
    const result = await db.prepare(
      `SELECT t.*, h.display_name as host_name, u.avatar_url as host_avatar
       FROM tips t
       JOIN hosts h ON h.id = t.host_id
       JOIN users u ON u.id = t.recipient_id
       WHERE t.sender_id = ?
       ORDER BY t.created_at DESC LIMIT 50`
    ).bind(sub).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

// GET /api/tips/received — tips received by the current host user
tip.get('/received', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  try {
    const result = await db.prepare(
      `SELECT t.*, u.name as sender_name, u.avatar_url as sender_avatar
       FROM tips t
       JOIN users u ON u.id = t.sender_id
       WHERE t.recipient_id = ?
       ORDER BY t.created_at DESC LIMIT 50`
    ).bind(sub).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) return c.json([]);
    throw e;
  }
});

export default tip;
