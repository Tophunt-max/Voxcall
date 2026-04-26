import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { jwtVerify } from 'jose';
import type { Env } from './types';
import authRouter from './routes/auth';
import userRouter from './routes/user';
import { hostsRouter, hostRouter } from './routes/host';
import coinRouter from './routes/coin';
import chatRouter from './routes/chat';
import callRouter from './routes/call';
import adminRouter from './routes/admin';
import { auditLogMiddleware } from './middleware/auditLog';
import uploadRouter from './routes/upload';
import publicRouter from './routes/public';
import matchRouter from './routes/match';
import hostappRouter from './routes/hostapp';
import errorsRouter from './routes/errors';
import paymentRouter from './routes/payment';
import { ChatRoom } from './durable-objects/ChatRoom';
import { CallSignaling } from './durable-objects/CallSignaling';
import { NotificationHub } from './durable-objects/NotificationHub';

// Re-export Durable Objects (required by wrangler)
export { ChatRoom, CallSignaling, NotificationHub };

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /\.replit\.app$/,
  /\.replit\.dev$/,
  /^https:\/\/voxlink/i,
  /^https:\/\/voxcall/i,
  /^https:\/\/connectme/i,
  /\.pages\.dev$/,
];

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some(p => p.test(origin));
}

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', cors({
  origin: (origin) => {
    // Mobile apps (React Native) don't send Origin — allow all no-origin requests
    if (!origin) return '*';
    return isOriginAllowed(origin) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 86400,
}));
app.use('*', logger());
app.use('*', prettyJSON());

// Health check — also reports whether critical secrets are configured
app.get('/api/healthz', (c) => c.json({
  status: 'ok',
  ts: Date.now(),
  service: 'voxlink-api',
  cf_calls_configured: !!(c.env.CF_CALLS_APP_ID && c.env.CF_CALLS_APP_SECRET),
  fcm_configured: !!c.env.FIREBASE_SERVICE_ACCOUNT,
}));

// Routes
app.route('/api/auth', authRouter);
app.route('/api/user', userRouter);
app.route('/api/hosts', hostsRouter);
app.route('/api/host', hostRouter);
app.route('/api/coins', coinRouter);
app.route('/api/chat', chatRouter);
app.route('/api/calls', callRouter);
// FIX #14: Audit log middleware intercepts all mutating admin requests (POST/PUT/PATCH/DELETE)
app.use('/api/admin/*', auditLogMiddleware);
app.route('/api/admin', adminRouter);
app.route('/api/match', matchRouter);
app.route('/api/host-app', hostappRouter);
app.route('/api/upload', uploadRouter);
app.route('/api/errors', errorsRouter);
app.route('/api/payment', paymentRouter);
app.route('/api', publicRouter);

// ─── WebSocket Auth Helper ─────────────────────────────────────────────────
async function verifyWsToken(token: string | null, secret: string): Promise<string | null> {
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return (payload as any).sub as string;
  } catch {
    return null;
  }
}

// WebSocket: notification hub per user — BUG 3 FIX: require JWT auth
app.get('/api/ws/notifications', async (c) => {
  const token = c.req.query('token') || c.req.header('Authorization')?.replace('Bearer ', '') || null;
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);
  const verifiedUserId = await verifyWsToken(token, c.env.JWT_SECRET);
  if (!verifiedUserId || verifiedUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const id = c.env.NOTIFICATION_HUB.idFromName(userId);
  const stub = c.env.NOTIFICATION_HUB.get(id);
  return stub.fetch(c.req.raw);
});

// WebSocket: call signaling per session — JWT auth + identity binding.
// CRITICAL FIX: Forward the JWT-verified userId AND the derived role to the DO
// via trusted X-CF-* headers. Previously the DO read these from URL query
// params, which an authenticated user with access to the session could spoof
// to impersonate the OTHER party (caller posing as host or vice versa).
app.get('/api/ws/call/:sessionId', async (c) => {
  const { sessionId } = c.req.param();
  const token = c.req.query('token') || c.req.header('Authorization')?.replace('Bearer ', '') || null;
  const verifiedUserId = await verifyWsToken(token, c.env.JWT_SECRET);
  if (!verifiedUserId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const session = await c.env.DB.prepare(
    `SELECT cs.caller_id, h.user_id as host_user_id FROM call_sessions cs LEFT JOIN hosts h ON h.id = cs.host_id WHERE cs.id = ?`
  ).bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Derive role from the JWT-verified userId (server is the authority — never trust client claims)
  let role: 'caller' | 'host';
  if (session.caller_id === verifiedUserId) role = 'caller';
  else if (session.host_user_id === verifiedUserId) role = 'host';
  else return c.json({ error: 'Access denied to this call session' }, 403);

  // Build a trusted request: copy original headers (preserves WebSocket upgrade
  // headers like Sec-WebSocket-Key/Version/Extensions) and set our trusted ones.
  // The DO requires X-CF-User-Id + X-CF-Role and ignores URL query params.
  const trustedHeaders = new Headers(c.req.raw.headers);
  trustedHeaders.set('X-CF-User-Id', verifiedUserId);
  trustedHeaders.set('X-CF-Role', role);
  const trustedReq = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: trustedHeaders,
  });

  const id = c.env.CALL_SIGNALING.idFromName(sessionId);
  const stub = c.env.CALL_SIGNALING.get(id);
  return stub.fetch(trustedReq);
});

// 404 handler — path is intentionally omitted to prevent internal route enumeration
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// FIX #2: Stale call reaper — scheduled via Cloudflare Cron (every 5 min)
// Ends calls stuck in 'active' or 'pending' for >30 minutes (crash/disconnect scenario)
// This prevents coins from being permanently frozen when neither party calls /end
async function reapStaleCalls(env: Env): Promise<void> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  // Pending calls: 2 min ke baad expire (ring timeout 45s hai — 2min is generous)
  const pendingCutoff = now - 120;
  // Active calls: 30 min ke baad expire (crash/disconnect scenario)
  const activeCutoff = now - (30 * 60);

  try {
    const staleCalls = await db
      .prepare(
        `SELECT cs.id, cs.caller_id, cs.host_id, cs.started_at, cs.created_at, cs.rate_per_minute, cs.type,
                h.user_id as host_user_id,
                cs.status
         FROM call_sessions cs
         JOIN hosts h ON h.id = cs.host_id
         WHERE (cs.status = 'pending' AND cs.created_at < ?)
            OR (cs.status = 'active'  AND cs.started_at < ?)
         LIMIT 50`
      )
      .bind(pendingCutoff, activeCutoff)
      .all<any>();

    if (!staleCalls.results.length) return;

    const ops: any[] = [];

    for (const call of staleCalls.results) {
      // Atomic guard — use ended_at IS NULL instead of setting status to 'processing'
      // because 'processing' is NOT a valid CHECK constraint value and causes silent failures.
      const guard = await db
        .prepare(`UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status IN ('active', 'pending') AND ended_at IS NULL`)
        .bind(now, call.id)
        .run();
      if (!guard.meta.changes) continue; // already processed by another worker or /end call

      const durationSec = call.started_at ? now - call.started_at : 0;
      const durationMin = Math.max(0, Math.ceil(durationSec / 60));
      const effectiveRate = call.rate_per_minute ?? 5;
      const coinsCharged = call.status === 'active' ? durationMin * effectiveRate : 0;

      // Batch: end the call, deduct caller coins if active, add host earnings
      // ended_at already set by atomic guard above
      const batchOps = [
        db.prepare(
          `UPDATE call_sessions SET status = 'ended', duration_seconds = ?, coins_charged = ? WHERE id = ?`
        ).bind(durationSec, coinsCharged, call.id),
      ];

      if (coinsCharged > 0) {
        const hostEarnings = Math.floor(coinsCharged * 0.7);
        batchOps.push(
          db.prepare(`UPDATE users SET coins = MAX(0, coins - ?) WHERE id = ?`).bind(coinsCharged, call.caller_id),
          db.prepare(`UPDATE users SET coins = coins + ? WHERE id = ?`).bind(hostEarnings, call.host_user_id),
          db.prepare(`INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?,?,?,?,?,?)`)
            .bind(crypto.randomUUID(), call.caller_id, 'spend', -coinsCharged, `${call.type || 'audio'} call (auto-reaped)`, call.id),
          db.prepare(`INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?,?,?,?,?,?)`)
            .bind(crypto.randomUUID(), call.host_user_id, 'earn', hostEarnings, `${call.type || 'audio'} call earnings (auto-reaped)`, call.id),
        );
      }

      await db.batch(batchOps);
    }

    console.log(`[Cron] Reaped ${staleCalls.results.length} stale call(s)`);
  } catch (err) {
    console.error('[Cron] Stale call reaper error:', err);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reapStaleCalls(env));
  },
};
