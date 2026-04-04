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
      // Fetch latest user status + role + token_invalidated_at from DB on every request:
      // - Detects banned/deleted accounts immediately (no 7-day token grace period)
      // - Uses current role from DB so KYC approvals take effect without re-login
      // FIX #12: token_invalidated_at allows server-side token revocation (logout, password change)
      const dbUser = await c.env.DB.prepare(
        'SELECT role, status, token_invalidated_at FROM users WHERE id = ?'
      ).bind(payload.sub).first<{ role: 'user' | 'host' | 'admin'; status: string | null; token_invalidated_at: number | null }>();
      if (!dbUser) return c.json({ error: 'User not found' }, 401);
      if (dbUser.status === 'banned' || dbUser.status === 'deleted') {
        return c.json({ error: 'Account suspended. Contact support if you believe this is an error.' }, 403);
      }
      // FIX #12: Reject tokens issued before the invalidation timestamp (e.g. after logout or password change)
      const issuedAt = payload.iat ?? 0;
      const invalidatedAt = dbUser.token_invalidated_at ?? 0;
      if (issuedAt < invalidatedAt) {
        return c.json({ error: 'Token has been revoked. Please log in again.' }, 401);
      }
      c.set('user', { ...payload, role: dbUser.role });
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
