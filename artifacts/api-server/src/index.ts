import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
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
import { ChatRoom } from './durable-objects/ChatRoom';
import { CallSignaling } from './durable-objects/CallSignaling';
import { NotificationHub } from './durable-objects/NotificationHub';

// Re-export Durable Objects (required by wrangler)
export { ChatRoom, CallSignaling, NotificationHub };

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
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
app.route('/api/upload', uploadRouter);
app.route('/api', publicRouter); // public: talk-topics, faqs, search, app-config (no auth — mount FIRST)
app.route('/api', uploadRouter); // for /api/files/:key (auth required)

// WebSocket: notification hub per user
app.get('/api/ws/notifications', async (c) => {
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);
  const id = c.env.NOTIFICATION_HUB.idFromName(userId);
  const stub = c.env.NOTIFICATION_HUB.get(id);
  return stub.fetch(c.req.raw);
});

// WebSocket: call signaling per session
app.get('/api/ws/call/:sessionId', async (c) => {
  const { sessionId } = c.req.param();
  const id = c.env.CALL_SIGNALING.idFromName(sessionId);
  const stub = c.env.CALL_SIGNALING.get(id);
  return stub.fetch(c.req.raw);
});

// 404 handler
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

export default app;
