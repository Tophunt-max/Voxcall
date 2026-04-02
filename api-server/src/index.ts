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
import uploadRouter from './routes/upload';
import publicRouter from './routes/public';
import matchRouter from './routes/match';
import hostappRouter from './routes/hostapp';
import errorsRouter from './routes/errors';
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
  /^https:\/\/connectme/i,
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

// Health check
app.get('/api/healthz', (c) => c.json({ status: 'ok', ts: Date.now(), service: 'voxlink-api' }));

// Routes
app.route('/api/auth', authRouter);
app.route('/api/user', userRouter);
app.route('/api/hosts', hostsRouter);
app.route('/api/host', hostRouter);
app.route('/api/coins', coinRouter);
app.route('/api/chat', chatRouter);
app.route('/api/calls', callRouter);
app.route('/api/admin', adminRouter);
app.route('/api/match', matchRouter);
app.route('/api/host-app', hostappRouter);
app.route('/api/upload', uploadRouter);
app.route('/api/errors', errorsRouter);
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

// WebSocket: call signaling per session — BUG 3 FIX: require JWT auth
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
  if (!session || (session.caller_id !== verifiedUserId && session.host_user_id !== verifiedUserId)) {
    return c.json({ error: 'Access denied to this call session' }, 403);
  }
  const id = c.env.CALL_SIGNALING.idFromName(sessionId);
  const stub = c.env.CALL_SIGNALING.get(id);
  return stub.fetch(c.req.raw);
});

// 404 handler
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

export default app;
