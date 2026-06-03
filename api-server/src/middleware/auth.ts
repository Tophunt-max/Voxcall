import { createMiddleware } from 'hono/factory';
import { verifyToken, extractBearer } from '../lib/jwt';
import { detectCountryFromRequest, currencyForCountry } from '../lib/currency';
import { registerHit } from '../lib/rateLimit';
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
      // If Cloudflare cannot provide a real country (local dev, tests,
      // privacy placeholders), keep country NULL but use INR as the display
      // fallback. When a real country appears later, overwrite the fallback so
      // users are not permanently pinned to India after a header-less login.
      if (!dbUser.country || !dbUser.currency) {
        const country = detectCountryFromRequest(c.req.raw);
        const currency = currencyForCountry(country);
        if (country) {
          c.env.DB.prepare('UPDATE users SET country = ?, currency = ? WHERE id = ?')
            .bind(country, currency, payload.sub).run().catch((e) => {
              console.warn('[auth] country backfill failed for', payload.sub, e);
            });
          (dbUser as any).country = country;
          (dbUser as any).currency = currency;
        } else if (!dbUser.currency) {
          c.env.DB.prepare('UPDATE users SET currency = COALESCE(currency, ?) WHERE id = ?')
            .bind(currency, payload.sub).run().catch((e) => {
              console.warn('[auth] currency fallback failed for', payload.sub, e);
            });
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

    // Rate limiting (TODO #29 follow-up): cap admin endpoints per-admin so a
    // leaked admin JWT can't be used to mass-mutate via /api/admin/* (mass
    // user delete, app-settings rewrite, force-end loop, bulk withdrawal
    // approval). We deliberately key on the admin user ID instead of IP —
    // an office full of admins typically shares one egress IP, and the
    // attacker also controls IPs cheaply, so per-user is both more
    // permissive for legit ops and tighter for theft scenarios.
    //
    // 600 req / 60s ≈ 10 req/s sustained, which is well above any human
    // admin UI flow but blocks a token-replay loop within ~6 seconds.
    const ADMIN_MAX_ATTEMPTS = 600;
    const ADMIN_WINDOW_SECS = 60;
    const adminId = user.sub || 'unknown';
    const now = Math.floor(Date.now() / 1000);
    const windowSlot = Math.floor(now / ADMIN_WINDOW_SECS);
    const key = `rl:admin:${adminId}:${windowSlot}`;

    try {
      // FIX #7: atomic check-and-increment (no read-then-write TOCTOU).
      const { limited, retryAfterSec } = await registerHit(c.env.DB, key, ADMIN_MAX_ATTEMPTS, ADMIN_WINDOW_SECS);
      if (limited) {
        console.warn('[admin-rate-limit] admin', adminId, 'hit cap');
        return c.json(
          { error: `Admin rate limit exceeded. Please retry in ${retryAfterSec}s.` },
          429
        );
      }
    } catch (e) {
      // Same fail-open semantics as the auth-route limiter: don't 500 if the
      // rate_limits table isn't yet migrated or D1 is briefly unavailable,
      // but log loudly so ops sees the silent fail-open in production.
      console.warn('[admin-rate-limit] table check failed, failing open:', e);
    }

    await next();
  }
);
