// ============================================================================
// User-facing support tickets — POST/GET /api/support/tickets (+ reply).
// ============================================================================
//
// Delivers the VIP `priority_support` perk: a ticket opened by an active VIP
// whose plan has priority_support is created at priority='high', so it sorts to
// the top of the admin Support queue. Non-VIP tickets are 'medium'. Admins
// view/reply via /api/admin/support-tickets (existing). The message log shape
// ({ from, text, time }) matches the admin reply endpoint exactly.
// ============================================================================

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getVipStatus } from '../lib/vip';
import { checkRateLimit } from '../lib/rateLimit';
import type { Env, JWTPayload } from '../types';

const support = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
support.use('*', authMiddleware);

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// POST /api/support/tickets — open a ticket. VIP priority_support → 'high'.
support.post('/tickets', async (c) => {
  const { sub, name, email } = c.get('user');
  const db = c.env.DB;

  const rl = await checkRateLimit(db, `support-create:${sub}`, 5, 600);
  if (rl.limited) {
    return c.json({ error: 'Too many requests. Please wait a bit before opening another ticket.', code: 'RATE_LIMITED' }, 429);
  }

  const body = await c.req.json().catch(() => ({})) as { subject?: string; message?: string; category?: string };
  const subject = String(body.subject ?? '').trim().slice(0, 200);
  const message = String(body.message ?? '').trim().slice(0, 4000);
  const category = String(body.category ?? 'general').trim().slice(0, 40) || 'general';
  if (!subject) return c.json({ error: 'Subject is required' }, 400);
  if (!message) return c.json({ error: 'Message is required' }, 400);

  // VIP priority perk — the whole point of priority_support.
  let priority = 'medium';
  try {
    const vip = await getVipStatus(db, sub);
    if (vip.isVip && vip.prioritySupport) priority = 'high';
  } catch { /* default medium */ }

  // Fetch a stable name/email for the admin queue (token claims may be stale).
  let userName = name ?? null;
  let userEmail = email ?? null;
  try {
    const u = await db.prepare('SELECT name, email FROM users WHERE id = ?').bind(sub).first<{ name: string | null; email: string | null }>();
    if (u) { userName = u.name ?? userName; userEmail = u.email ?? userEmail; }
  } catch { /* best-effort */ }

  const id = crypto.randomUUID();
  const messages = JSON.stringify([{ from: 'user', text: message, time: nowTimeLabel() }]);
  try {
    await db.prepare(
      `INSERT INTO support_tickets (id, user_id, user_name, user_email, subject, category, priority, status, messages)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).bind(id, sub, userName, userEmail, subject, category, priority, messages).run();
  } catch (e) {
    console.error('[support/tickets] create failed:', e);
    return c.json({ error: 'Could not submit your request. Please try again.' }, 500);
  }

  return c.json({ success: true, id, priority, status: 'open' }, 201);
});

// GET /api/support/tickets — the caller's own tickets (newest first).
support.get('/tickets', async (c) => {
  const { sub } = c.get('user');
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, subject, category, priority, status, messages, created_at, updated_at
       FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    ).bind(sub).all<any>();
    return c.json((rows.results ?? []).map((t) => ({
      ...t,
      messages: (() => { try { return JSON.parse(t.messages || '[]'); } catch { return []; } })(),
    })));
  } catch (e) {
    console.warn('[support/tickets] list failed:', e);
    return c.json([]);
  }
});

// POST /api/support/tickets/:id/reply — user adds a message to their own ticket.
support.post('/tickets/:id/reply', async (c) => {
  const { sub } = c.get('user');
  const { id } = c.req.param();
  const db = c.env.DB;

  const rl = await checkRateLimit(db, `support-reply:${sub}`, 15, 600);
  if (rl.limited) return c.json({ error: 'Too many messages. Please slow down.', code: 'RATE_LIMITED' }, 429);

  const { text } = await c.req.json().catch(() => ({})) as { text?: string };
  const msg = String(text ?? '').trim().slice(0, 4000);
  if (!msg) return c.json({ error: 'Message is required' }, 400);

  // Ownership check — a user can only reply to their OWN ticket.
  const ticket = await db.prepare('SELECT messages FROM support_tickets WHERE id = ? AND user_id = ?').bind(id, sub).first<{ messages: string }>();
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  const messages = (() => { try { return JSON.parse(ticket.messages || '[]'); } catch { return []; } })();
  messages.push({ from: 'user', text: msg, time: nowTimeLabel() });
  // Reopen the ticket so a new user message resurfaces it for support.
  await db.prepare("UPDATE support_tickets SET messages = ?, status = 'open', updated_at = unixepoch() WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(messages), id, sub).run();
  return c.json({ success: true, messages });
});

export default support;
