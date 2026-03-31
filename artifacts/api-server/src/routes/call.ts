import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createCFCalls } from '../lib/cf-calls';
import type { Env, JWTPayload } from '../types';

const call = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
call.use('*', authMiddleware);

// POST /api/calls/initiate — start a call session
call.post('/initiate', async (c) => {
  const { sub } = c.get('user');
  const { host_id, type } = await c.req.json<{ host_id: string; type: 'audio' | 'video' }>();
  const db = c.env.DB;

  // Verify host exists and is online
  const host = await db.prepare('SELECT id, coins_per_minute, user_id FROM hosts WHERE id = ? AND is_online = 1 AND is_active = 1').bind(host_id).first<any>();
  if (!host) return c.json({ error: 'Host not available' }, 404);

  // Check caller has enough coins (min 1 minute)
  const caller = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  if (!caller || caller.coins < host.coins_per_minute) {
    return c.json({ error: 'Insufficient coins' }, 402);
  }

  // Create Cloudflare Calls session
  const cfCalls = createCFCalls(c.env);
  let cfSessionId = null;
  if (cfCalls) {
    try {
      const session = await cfCalls.createSession();
      cfSessionId = session.sessionId;
    } catch (e) {
      console.error('CF Calls error:', e);
    }
  }

  // Create call session in DB
  const sessionId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO call_sessions (id, caller_id, host_id, type, status, cf_session_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, sub, host_id, type, 'pending', cfSessionId).run();

  // Notify host via Durable Object
  try {
    const notifId = c.env.NOTIFICATION_HUB.idFromName(host.user_id);
    const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
    await notifStub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'incoming_call', session_id: sessionId, caller_id: sub, call_type: type }),
    });
  } catch {}

  return c.json({ session_id: sessionId, cf_session_id: cfSessionId, host_coins_per_minute: host.coins_per_minute });
});

// POST /api/calls/:id/answer
call.post('/:id/answer', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const { accepted } = await c.req.json<{ accepted: boolean }>();
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (!accepted) {
    await db.prepare('UPDATE call_sessions SET status = ?, ended_at = unixepoch() WHERE id = ?').bind('declined', sessionId).run();
    return c.json({ success: true, status: 'declined' });
  }

  const now = Math.floor(Date.now() / 1000);
  await db.prepare('UPDATE call_sessions SET status = ?, started_at = ? WHERE id = ?').bind('active', now, sessionId).run();
  return c.json({ success: true, status: 'active', cf_session_id: session.cf_session_id });
});

// POST /api/calls/:id/end
call.post('/:id/end', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const db = c.env.DB;

  const session = await db.prepare('SELECT * FROM call_sessions WHERE id = ? AND status = "active"').bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Active session not found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  const durationSec = now - (session.started_at || now);
  const durationMin = Math.ceil(durationSec / 60);

  // Get host coins_per_minute
  const hostRow = await db.prepare('SELECT coins_per_minute, user_id, total_minutes, total_earnings FROM hosts WHERE id = ?').bind(session.host_id).first<any>();
  const coinsCharged = durationMin * (hostRow?.coins_per_minute || 5);

  // Host share (70%)
  const hostShare = Math.floor(coinsCharged * 0.7);

  const txs = [
    db.prepare('UPDATE call_sessions SET status = ?, ended_at = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', now, durationSec, coinsCharged, sessionId),
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?').bind(coinsCharged, session.caller_id, coinsCharged),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), session.caller_id, 'spend', -coinsCharged, `${session.type} call — ${durationMin} min`, sessionId),
    db.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
      .bind(durationMin, hostShare, session.host_id),
  ];
  await db.batch(txs);

  // Close CF Calls session
  if (session.cf_session_id) {
    const cfCalls = createCFCalls(c.env);
    try { await cfCalls?.closeSession(session.cf_session_id); } catch {}
  }

  return c.json({ success: true, duration_seconds: durationSec, coins_charged: coinsCharged, host_earnings: hostShare });
});

// GET /api/calls/history
call.get('/history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    `SELECT cs.*, h.display_name as host_name, u.avatar_url as host_avatar
     FROM call_sessions cs JOIN hosts h ON h.id = cs.host_id JOIN users u ON u.id = h.user_id
     WHERE cs.caller_id = ? ORDER BY cs.created_at DESC LIMIT 50`
  ).bind(sub).all();
  return c.json(result.results);
});

// POST /api/calls/:id/rate
call.post('/:id/rate', async (c) => {
  const { sub } = c.get('user');
  const sessionId = c.req.param('id');
  const { stars, comment } = await c.req.json<{ stars: number; comment?: string }>();
  const db = c.env.DB;
  const session = await db.prepare('SELECT host_id FROM call_sessions WHERE id = ? AND caller_id = ?').bind(sessionId, sub).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);
  await db.prepare('INSERT OR IGNORE INTO ratings (id, host_id, user_id, call_session_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), session.host_id, sub, sessionId, stars, comment ?? null).run();
  // Recalculate host rating
  const avg = await db.prepare('SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE host_id = ?').bind(session.host_id).first<any>();
  await db.prepare('UPDATE hosts SET rating = ?, review_count = ? WHERE id = ?').bind(avg?.avg ?? stars, avg?.cnt ?? 1, session.host_id).run();
  return c.json({ success: true });
});

// GET /api/calls/:id/cf-token — Cloudflare Calls TURN credentials
call.get('/:id/cf-token', async (c) => {
  const sessionId = c.req.param('id');
  const session = await c.env.DB.prepare('SELECT cf_session_id FROM call_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session?.cf_session_id) return c.json({ error: 'No CF session' }, 404);
  return c.json({ cf_session_id: session.cf_session_id, app_id: c.env.CF_CALLS_APP_ID });
});

export default call;
