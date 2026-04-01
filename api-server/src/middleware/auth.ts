import { createMiddleware } from 'hono/factory';
import { verifyToken, extractBearer } from '../lib/jwt';
import type { Env, JWTPayload } from '../types';

type Variables = { user: JWTPayload };

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const token = extractBearer(c.req.header('Authorization') ?? null);
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const payload = await verifyToken(token, c.env.JWT_SECRET);
      c.set('user', payload);
      await next();
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }
);

export const adminMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const user = c.get('user');
    if (user?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    await next();
  }
);
