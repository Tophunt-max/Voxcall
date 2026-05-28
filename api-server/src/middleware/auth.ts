import { createMiddleware } from 'hono/factory';
import { verifyToken, extractBearer } from '../lib/jwt';
import { detectCountryFromRequest, currencyForCountry } from '../lib/currency';
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
      // FIX (currency auto-detect): also fetch country/currency so we can backfill
      //   it the first time the user hits an authenticated endpoint after the
      //   0023 migration. Cheaper than rewriting every login path.
      const dbUser = await c.env.DB.prepare(
        'SELECT role, status, token_invalidated_at, country, currency FROM users WHERE id = ?'
      ).bind(payload.sub).first<{
        role: 'user' | 'host' | 'admin';
        status: string | null;
        token_invalidated_at: number | null;
        country: string | null;
        currency: string | null;
      }>();
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

      // FIX (currency auto-detect): opportunistically populate country/currency
      // on the user row when they're missing. Uses Cloudflare's edge-detected
      // country (CF-IPCountry header / request.cf.country). The write only
      // happens once per user lifetime, then the columns are read from the
      // existing query above without an extra round-trip.
      // We do NOT block the request if detection fails — currency is decorative,
      // not a security primitive.
      if (!dbUser.country || !dbUser.currency) {
        const country = detectCountryFromRequest(c.req.raw);
        if (country) {
          const currency = currencyForCountry(country);
          // Fire-and-forget: don't await, don't fail the request if D1 errors.
          c.env.DB.prepare(
            'UPDATE users SET country = COALESCE(country, ?), currency = COALESCE(currency, ?) WHERE id = ?'
          ).bind(country, currency, payload.sub).run().catch((e) => {
            console.warn('[auth] country backfill failed for', payload.sub, e);
          });
          // Reflect in this request's payload so route handlers see the new value
          // without waiting for the next request.
          (dbUser as any).country = country;
          (dbUser as any).currency = currency;
        }
      }

      c.set('user', {
        ...payload,
        role: dbUser.role,
        country: dbUser.country ?? undefined,
        currency: dbUser.currency ?? undefined,
      });
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
    // TODO (#29): Add rate limiting on admin endpoints to prevent abuse from
    // compromised admin tokens. A single leaked admin JWT can currently issue
    // unlimited /api/admin/* calls (mass user delete, settings rewrite, etc.).
    // Likely shape: per-admin sliding-window counter in the rate_limits table.
    await next();
  }
);
