import { Hono } from 'hono';
import type { Env } from '../types';

const errors = new Hono<{ Bindings: Env }>();

// POST /api/errors — receive client-side crash/error reports
// Auth optional: logged-in user's ID attached if token present
// SECURITY FIX: Rate limit to prevent DB flood attacks (unauthenticated endpoint)
errors.post('/', async (c) => {
  try {
    // Simple IP-based rate limit: max 10 error reports per IP per minute
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const rlKey = `rl:errors:${ip}:${Math.floor(Date.now() / 60000)}`;
    try {
      const rl = await c.env.DB.prepare('SELECT attempts FROM rate_limits WHERE id = ?').bind(rlKey).first<any>();
      if (rl && rl.attempts >= 10) return c.json({ error: 'Too many error reports' }, 429);
      await c.env.DB.prepare('INSERT OR REPLACE INTO rate_limits (id, attempts, window_reset) VALUES (?, COALESCE((SELECT attempts FROM rate_limits WHERE id = ?), 0) + 1, ?)')
        .bind(rlKey, rlKey, Math.floor(Date.now() / 1000) + 60).run();
    } catch {}

    const body = await c.req.json().catch(() => ({}));
    const { message, stack, context, platform, app_version, extra } = body as {
      message?: string;
      stack?: string;
      context?: string;
      platform?: string;
      app_version?: string;
      extra?: Record<string, unknown>;
    };

    if (!message) return c.json({ error: 'message required' }, 400);

    // Optionally extract user_id from JWT if Authorization header present
    let user_id: string | null = null;
    try {
      const authHeader = c.req.header('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const { verifyToken } = await import('../lib/jwt');
        const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET);
        user_id = payload.sub ?? null;
      }
    } catch { /* token verification optional for error reporting */ }

    await c.env.DB.prepare(
      `INSERT INTO app_errors (user_id, message, stack, context, platform, app_version, extra)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user_id,
      String(message).slice(0, 2000),
      stack ? String(stack).slice(0, 5000) : null,
      context ? String(context).slice(0, 200) : null,
      platform ? String(platform).slice(0, 20) : null,
      app_version ? String(app_version).slice(0, 50) : null,
      extra ? JSON.stringify(extra).slice(0, 2000) : null
    ).run();

    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 500);
  }
});

export default errors;
