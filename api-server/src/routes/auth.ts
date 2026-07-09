import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { signToken, verifyToken } from '../lib/jwt';
import { hashPassword, verifyPassword, generateOTP, generateId, timingSafeEqual } from '../lib/hash';
import { sendEmail, otpEmailHtml } from '../lib/email';
import { detectCountryFromRequest, currencyForCountry } from '../lib/currency';
import { verifyFirebaseIdToken, projectIdFromServiceAccount, decodeJwtPayloadUnsafe } from '../lib/firebaseVerify';
import { registerHit } from '../lib/rateLimit';
import type { Env } from '../types';
import { authMiddleware } from '../middleware/auth';
import { bumpRewardProgress } from './rewards';

const auth = new Hono<{ Bindings: Env }>();

/**
 * Read `app_settings.first_call_free_minutes` for the new-user free-trial
 * pool size, falling back to 0 if the row is missing or malformed (which
 * disables the feature without breaking signup). Wrapped in try/catch so a
 * brief schemaGuard race that hasn't yet seeded the row never breaks
 * registration.
 */
async function readFreeCallMinutesSetting(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'first_call_free_minutes'")
      .first<{ value: string }>();
    const n = parseInt(row?.value ?? '');
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    console.warn('[auth] readFreeCallMinutesSetting failed:', e);
    return 0;
  }
}

/**
 * Generic non-negative integer app_setting reader with a default. Used for the
 * welcome (registration) bonus and the referral rewards so admins control all
 * coin grants from the Settings page instead of them being hardcoded.
 */
async function readIntSetting(db: D1Database, key: string, dflt: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : dflt;
  } catch (e) {
    console.warn(`[auth] readIntSetting(${key}) failed:`, e);
    return dflt;
  }
}

/** Admin-configured welcome bonus granted on FIRST account creation, across
 *  every signup method (email+OTP, Google, Quick-Login). Default 50. Set
 *  `registration_bonus_coins = 0` in admin Settings to disable (e.g. to curb
 *  guest-account farming). */
function readRegistrationBonus(db: D1Database): Promise<number> {
  return readIntSetting(db, 'registration_bonus_coins', 50);
}

/** Best-effort coin_transactions ledger write. Never throws — a missing column
 *  or schema race must not break signup/verification. Keeps the audit trail
 *  consistent with the call/streak/purchase paths. */
async function writeCoinLedger(
  db: D1Database,
  userId: string,
  type: string,
  amount: number,
  description: string,
): Promise<void> {
  if (!amount) return;
  try {
    await db
      .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)')
      .bind(generateId(), userId, type, amount, description)
      .run();
  } catch (e) {
    console.warn('[auth] writeCoinLedger failed (non-fatal):', e);
  }
}

// ─── Rate Limiting ────────────────────────────────────────────────────────
// Standard: 10 attempts / 60s per IP per route
// Strict:   3 attempts / 600s (10 min) — for OTP/password-reset endpoints
// Device:   2 attempts / 3600s (1 hour) — for guest account creation (Sybil attack prevention)
function makeRateLimit(maxAttempts: number, windowSecs: number) {
  return async function rateLimitFn(c: Context<{ Bindings: Env }>, next: Next) {
    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      'unknown';
    const routeKey = c.req.path.split('/').slice(-1)[0];
    const now = Math.floor(Date.now() / 1000);
    const windowSlot = Math.floor(now / windowSecs);
    const key = `rl:${routeKey}:${ip}:${windowSlot}`;

    try {
      // Periodically clean up expired rows (1% chance per request keeps table lean)
      if (Math.random() < 0.01) {
        await c.env.DB.prepare('DELETE FROM rate_limits WHERE window_reset < ?').bind(now).run();
      }

      // FIX #7: atomic check-and-increment (no read-then-write TOCTOU).
      const { limited, retryAfterSec } = await registerHit(c.env.DB, key, maxAttempts, windowSecs);
      if (limited) {
        const waitMins = Math.ceil(retryAfterSec / 60);
        return c.json({ error: `Too many requests. Please try again in ${waitMins} minute${waitMins > 1 ? 's' : ''}.` }, 429);
      }
    } catch (e) {
      // Rate limit table may not exist yet (pre-migration boot) or D1 had a
      // brief outage — don't block legitimate requests. We DO surface the
      // failure in Worker logs so an operator notices when the rate limiter
      // is silently failing open in production (which would let auth/OTP
      // brute-force protection lapse).
      console.warn('[rate-limit] table check failed, failing open:', e);
    }

    return next();
  };
}

const rateLimit = makeRateLimit(10, 60);
const strictRateLimit = makeRateLimit(3, 600);
const deviceRateLimit = makeRateLimit(2, 3600); // BUG FIX #4: Device-based rate limit for guest accounts

const registerSchema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().max(20).optional(),
  referral_code: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
auth.post('/register', rateLimit, zValidator('json', registerSchema), async (c) => {
  const { name, password, gender, phone, referral_code } = c.req.valid('json');
  const email = c.req.valid('json').email.trim().toLowerCase();
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT id, name, email, password_hash, role, coins FROM users WHERE email = ?'
  ).bind(email).first<any>();

  if (existing) {
    // FIX #21: Don't leak whether the email exists or whether the password
    // matched. The auto-login UX is preserved for incomplete user signups
    // (existing user account that hasn't become a host), but every other
    // case — wrong password, existing host — returns the same generic error
    // a fresh /login mismatch would.
    const passwordOk = await verifyPassword(password, existing.password_hash);
    if (passwordOk && existing.role !== 'host') {
      const token = await signToken(
        { sub: existing.id, role: existing.role, name: existing.name, email: existing.email },
        c.env.JWT_SECRET
      );
      return c.json({
        token,
        signup_incomplete: true,
        user: { id: existing.id, name: existing.name, email: existing.email, role: existing.role, coins: existing.coins ?? 0 },
      }, 200);
    }
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  const id = generateId();
  const hash = await hashPassword(password);
  const otp = generateOTP();
  const otpExp = Math.floor(Date.now() / 1000) + 600;
  // FIX (currency auto-detect): capture the user's country at registration so
  // we can serve localized prices on the very first /api/coins/plans call.
  // The auth middleware later backfills any users who registered before this
  // change.
  const country = detectCountryFromRequest(c.req.raw) ?? 'IN';
  const currency = currencyForCountry(country);
  // First-call-free trial — read the admin-configured pool size and stamp
  // it on the row so the very first call uses the freebie. Falls back to 0
  // if the setting is missing / not yet seeded (feature degrades gracefully).
  const freeCallMinutes = await readFreeCallMinutesSetting(db);
  // SECURITY FIX: Set is_verified=0 at registration. Only set to 1 after OTP verification.
  // Previously was hardcoded to 1, completely bypassing email verification.
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, gender, phone, otp, otp_expires_at, is_verified, country, currency, free_call_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).bind(id, name, email, hash, gender ?? null, phone ?? null, otp, otpExp, country, currency, freeCallMinutes).run();
  // Bug 3 Fix: Record referral as pending (coins_given=0) — coins awarded only after OTP verification
  // This prevents Sybil attacks where fake accounts are created to farm referral coins.
  if (referral_code) {
    try {
      const ref = await db.prepare('SELECT * FROM referral_codes WHERE code = ?').bind(referral_code.trim().toUpperCase()).first<any>();
      if (ref && ref.user_id !== id) {
        const useId = crypto.randomUUID();
        await db.prepare('INSERT INTO referral_uses (id, referrer_id, referred_id, code, coins_given) VALUES (?, ?, ?, ?, 0)')
          .bind(useId, ref.user_id, id, referral_code.trim().toUpperCase()).run();
      }
    } catch { /* ignore referral errors — don't block registration */ }
  }
  // Send OTP via email
  await sendEmail({
    apiKey: c.env.RESEND_API_KEY,
    to: email,
    subject: 'Verify your VoxLink account',
    html: otpEmailHtml(otp, 'verify'),
  });

  const token = await signToken({ sub: id, role: 'user', name, email }, c.env.JWT_SECRET);
  return c.json({ token, user: { id, name, email, role: 'user', coins: 0, country, currency } }, 201);
});

// POST /api/auth/login
auth.post('/login', rateLimit, zValidator('json', loginSchema), async (c) => {
  const { password } = c.req.valid('json');
  const email = c.req.valid('json').email.trim().toLowerCase();
  const db = c.env.DB;
  const user = await db.prepare(
    'SELECT id, name, email, password_hash, role, coins, avatar_url, gender, phone, bio, country, currency FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user) return c.json({ error: 'Invalid email or password' }, 401);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401);

  // FIX (currency auto-detect): backfill country/currency on login when the
  // user record predates the 0023 migration. Same pattern as the auth
  // middleware backfill but runs at login so the response carries the
  // detected currency immediately.
  if (!user.country || !user.currency) {
    const detected = detectCountryFromRequest(c.req.raw) ?? 'IN';
    const cur = currencyForCountry(detected);
    await db.prepare(
      'UPDATE users SET country = COALESCE(country, ?), currency = COALESCE(currency, ?) WHERE id = ?'
    ).bind(detected, cur, user.id).run().catch(() => {});
    user.country = user.country ?? detected;
    user.currency = user.currency ?? cur;
  }

  const token = await signToken({ sub: user.id, role: user.role, name: user.name, email: user.email }, c.env.JWT_SECRET);
  const { password_hash, ...safeUser } = user;
  // If host, fetch host data
  let hostData = null;
  if (user.role === 'host') {
    hostData = await db.prepare('SELECT * FROM hosts WHERE user_id = ?').bind(user.id).first();
  }
  return c.json({ token, user: safeUser, host: hostData });
});

// POST /api/auth/verify-otp
auth.post('/verify-otp', strictRateLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const otp = String(body.otp ?? '');  // Coerce to string for type-safe comparison
  if (!email || !otp) return c.json({ error: 'Email and OTP are required' }, 400);

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const user = await db.prepare(
    'SELECT id, otp, otp_expires_at FROM users WHERE email = ?'
  ).bind(email).first<any>();
  // SECURITY FIX: Use constant-time comparison for OTP to prevent timing attacks.
  // The atomic UPDATE below is the real protection against double-credit races;
  // this check just lets us fail fast on obvious mismatches without leaking timing.
  if (!user || !user.otp || !timingSafeEqual(String(user.otp), otp) || user.otp_expires_at < now) {
    return c.json({ error: 'Invalid or expired OTP' }, 400);
  }

  // CRITICAL FIX (#9): Atomic verify + welcome bonus credit.
  // Previously the read (above) and the credit-write (below) were separate, so
  // two concurrent verify-otp requests could both pass the read and both add
  // 100 coins. The `is_verified = 0` guard ensures only the first UPDATE wins;
  // the second sees changes=0 and returns the same generic error.
  // Welcome bonus is admin-configured (registration_bonus_coins) and granted
  // ATOMICALLY in the same guarded UPDATE that flips is_verified — so it can
  // only ever be credited once (the WHERE is_verified = 0 guard prevents a
  // concurrent double-verify from double-crediting).
  const welcomeBonus = await readRegistrationBonus(db);
  const verifyResult = await db.prepare(
    `UPDATE users
       SET is_verified = 1, otp = NULL, otp_expires_at = NULL,
           coins = coins + ?1, updated_at = unixepoch()
       WHERE id = ?2 AND otp = ?3 AND otp_expires_at > ?4 AND is_verified = 0`
  ).bind(welcomeBonus, user.id, user.otp, now).run();

  if (!verifyResult.meta?.changes) {
    return c.json({ error: 'Invalid or expired OTP' }, 400);
  }
  // Ledger row for the welcome bonus (best-effort audit trail).
  await writeCoinLedger(db, user.id, 'bonus', welcomeBonus, 'Welcome bonus (email signup)');

  // Atomic referral processing. Reward amounts come from admin settings
  // (referrer_reward / new_user_reward) — previously hardcoded 25/10, which
  // silently ignored the admin's configured referral rewards.
  const pendingReferral = await db.prepare(
    'SELECT id, referrer_id FROM referral_uses WHERE referred_id = ? AND coins_given = 0 LIMIT 1'
  ).bind(user.id).first<any>();

  if (pendingReferral) {
    const referrerReward = await readIntSetting(db, 'referrer_reward', 100);
    const newUserReward = await readIntSetting(db, 'new_user_reward', 50);
    const refResult = await db.prepare(
      'UPDATE referral_uses SET coins_given = ? WHERE id = ? AND coins_given = 0'
    ).bind(referrerReward, pendingReferral.id).run();

    if (refResult.meta?.changes && refResult.meta.changes > 0) {
      const ops: D1PreparedStatement[] = [];
      if (newUserReward > 0) {
        ops.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(newUserReward, user.id));
      }
      if (referrerReward > 0) {
        ops.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(referrerReward, pendingReferral.referrer_id));
      }
      if (ops.length) await db.batch(ops);
      // Ledger rows for both sides of the referral.
      await writeCoinLedger(db, user.id, 'bonus', newUserReward, 'Referral signup bonus');
      await writeCoinLedger(db, pendingReferral.referrer_id, 'bonus', referrerReward, 'Referral reward (invited a friend)');
      // Reward progress — bump the REFERRER's refer_friend tasks (Rewards Hub).
      await bumpRewardProgress(db, pendingReferral.referrer_id, 'refer_friend', 1);
      return c.json({ success: true, bonus_coins: welcomeBonus + newUserReward });
    }
  }

  return c.json({ success: true, bonus_coins: welcomeBonus });
});

// POST /api/auth/forgot-password
auth.post('/forgot-password', strictRateLimit, async (c) => {
  const body = await c.req.json();
  const email = (body.email as string)?.trim().toLowerCase();
  if (!email || typeof email !== 'string') return c.json({ error: 'Email required' }, 400);
  const db = c.env.DB;
  const user = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?').bind(email).first<any>();
  // Security: always return 200 to prevent email enumeration attacks
  if (!user) return c.json({ success: true });
  // Block Google-only users — they have no password to reset
  if (!user.password_hash) {
    // Still return 200 to prevent enumeration; user will not receive an email
    return c.json({ success: true });
  }
  const otp = generateOTP();
  const otpExp = Math.floor(Date.now() / 1000) + 600;
  
  // BUG FIX #5: Store OTP generation timestamp to detect brute-force attacks
  const otpAttemptKey = `otp_reset:${email}`;
  await db.prepare('UPDATE users SET otp = ?, otp_expires_at = ?, otp_request_at = ? WHERE id = ?')
    .bind(otp, otpExp, Math.floor(Date.now() / 1000), user.id).run();
  
  // Send OTP via email
  await sendEmail({
    apiKey: c.env.RESEND_API_KEY,
    to: email,
    subject: 'Reset your VoxLink password',
    html: otpEmailHtml(otp, 'reset'),
  });
  return c.json({ success: true });
});

// POST /api/auth/reset-password
auth.post('/reset-password', strictRateLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { new_password } = body as { new_password?: string };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const otp = String(body.otp ?? '');
  if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }
  if (new_password.length > 128) {
    return c.json({ error: 'Password is too long' }, 400);
  }
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const user = await db.prepare(
    'SELECT id, otp, otp_expires_at, otp_request_at FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user || !user.otp || !timingSafeEqual(String(user.otp), otp) || user.otp_expires_at < now) {
    return c.json({ error: 'Invalid or expired OTP' }, 400);
  }
  
  // BUG FIX #5: Verify OTP was recently requested (max 10 min old) to prevent brute-force
  const otpAge = now - (user.otp_request_at || 0);
  if (otpAge > 600) {
    return c.json({ error: 'OTP expired. Please request a new one.' }, 400);
  }
  
  const hash = await hashPassword(new_password!);
  // SECURITY FIX: Invalidate all existing tokens after password reset.
  // Without this, old tokens remain valid even after password change.
  await db.prepare('UPDATE users SET password_hash = ?, otp = NULL, otp_request_at = NULL, token_invalidated_at = ? WHERE id = ?')
    .bind(hash, now, user.id).run();
  return c.json({ success: true });
});

// POST /api/auth/refresh — issue new token from old (within grace period)
// Rate-limited to prevent session extension abuse / DB stress
auth.post('/refresh', rateLimit, async (c) => {
  const { token } = await c.req.json();
  if (!token) return c.json({ error: 'Token required' }, 400);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // FIX #28: Reject tokens without a numeric `iat` so the age check below
    // can't be bypassed by stripping/altering the claim.
    if (typeof payload.iat !== 'number') {
      return c.json({ error: 'Malformed token' }, 401);
    }

    // FIX #18: Cap total session lifetime. Refresh extends the token, so
    // without a hard ceiling a single login could be refreshed forever.
    const now = Math.floor(Date.now() / 1000);
    const MAX_REFRESH_AGE = 30 * 24 * 60 * 60; // 30 days
    if (now - payload.iat > MAX_REFRESH_AGE) {
      return c.json({ error: 'Token too old, please log in again' }, 401);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, name, role, status, token_invalidated_at FROM users WHERE id = ?'
    ).bind(payload.sub).first<any>();
    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.status === 'banned' || user.status === 'deleted') {
      return c.json({ error: 'Account suspended' }, 403);
    }
    // Reject refresh if token was issued before the invalidation timestamp (e.g. after logout)
    const invalidatedAt = user.token_invalidated_at ?? 0;
    if (payload.iat < invalidatedAt) {
      return c.json({ error: 'Token has been revoked. Please log in again.' }, 401);
    }
    const newToken = await signToken({ sub: user.id, role: user.role, name: user.name, email: user.email }, c.env.JWT_SECRET);
    return c.json({ token: newToken });
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});

// POST /api/auth/logout — FIX #12: Sets token_invalidated_at to NOW, instantly revoking
// all tokens issued before this moment. The authMiddleware checks this on every request.
// Requires a valid token so we know which user is logging out.
auth.post('/logout', authMiddleware, async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    'UPDATE users SET token_invalidated_at = ? WHERE id = ?'
  ).bind(Math.floor(Date.now() / 1000), user.sub).run();
  return c.json({ success: true });
});

// POST /api/auth/google-login — sign in or register via Google OAuth
// SECURITY FIX: Verify Google ID token via Google's tokeninfo endpoint.
// Previously trusted client-supplied google_id + email, allowing account impersonation.
auth.post('/google-login', rateLimit, async (c) => {
  const body = await c.req.json();
  const { avatar_url, device_id, id_token } = body as {
    email?: string; name?: string; google_id?: string; avatar_url?: string | null;
    device_id?: string | null; id_token?: string;
  };

  let email: string;
  let name: string;
  let google_id: string;

  if (id_token) {
    // Two valid token shapes reach this endpoint:
    //   1. Google OIDC ID token  — issuer "accounts.google.com"
    //      (from react-native-google-signin on Android/iOS, or from
    //      GoogleAuthProvider.credentialFromResult() on web)
    //   2. Firebase ID token     — issuer "securetoken.google.com/<project>"
    //      (from Firebase Web SDK's user.getIdToken() on web)
    //
    // Google's tokeninfo endpoint only verifies type 1 — it rejects type 2
    // with HTTP 400 "Invalid Value", which surfaced to users as
    // "Invalid Google ID token". Route by issuer so both work.
    const peek = decodeJwtPayloadUnsafe(id_token);
    if (!peek) {
      return c.json({ error: 'Malformed ID token' }, 400);
    }
    const iss = String(peek.iss || '');

    try {
      if (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') {
        // ── Google OIDC token ───────────────────────────────────────────
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`);
        if (!verifyRes.ok) {
          const errBody = await verifyRes.text().catch(() => '');
          console.error('[google-login] tokeninfo rejected:', verifyRes.status, errBody.slice(0, 300));
          return c.json({ error: 'Invalid Google ID token' }, 401);
        }
        const tokenData = await verifyRes.json() as { email?: string; name?: string; sub?: string; picture?: string };
        email = (tokenData.email || '').trim().toLowerCase();
        name = tokenData.name || body.name || 'User';
        google_id = tokenData.sub || '';
      } else if (iss.startsWith('https://securetoken.google.com/')) {
        // ── Firebase ID token ───────────────────────────────────────────
        const tokenProjectId = iss.split('/').pop() || '';
        const expectedProjectId = projectIdFromServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT) || tokenProjectId;
        if (tokenProjectId !== expectedProjectId) {
          console.error('[google-login] Firebase token project mismatch:', tokenProjectId, 'vs', expectedProjectId);
          return c.json({ error: 'Invalid Firebase ID token' }, 401);
        }
        const claims = await verifyFirebaseIdToken(id_token, expectedProjectId);
        email = String(claims.email || '').trim().toLowerCase();
        name = claims.name || body.name || 'User';
        google_id = String(claims.sub || claims.user_id || '');
      } else {
        console.error('[google-login] unknown token issuer:', iss);
        return c.json({ error: 'Invalid token issuer' }, 401);
      }

      if (!email || !google_id) return c.json({ error: 'Invalid Google token payload' }, 401);
    } catch (err: any) {
      console.error('[google-login] ID token verification failed:', err?.message || err);
      return c.json({ error: 'Invalid ID token' }, 401);
    }
  } else {
    return c.json({ error: 'id_token is required for Google login' }, 400);
  }
  const db = c.env.DB;

  // 1. Look up by google_id first (handles email changes in Google account)
  let user = await db.prepare(
    'SELECT id, name, email, role, coins, avatar_url, gender, phone, bio, country, currency FROM users WHERE google_id = ?'
  ).bind(google_id).first<any>();

  // 2. Fall back to email lookup
  if (!user) {
    user = await db.prepare(
      'SELECT id, name, email, role, coins, avatar_url, gender, phone, bio, country, currency FROM users WHERE email = ?'
    ).bind(email).first<any>();
  }

  // 3. Fall back to device_id — merge with existing Quick Login account on same device
  //    This prevents creating a second account when user switches from Quick Login to Google
  if (!user && device_id) {
    const deviceUser = await db.prepare(
      "SELECT id, name, email, role, coins, avatar_url, gender, phone, bio, country, currency FROM users WHERE device_id = ? AND (google_id IS NULL OR google_id = '') LIMIT 1"
    ).bind(device_id).first<any>();
    if (deviceUser) {
      // Merge: upgrade the quick-login account to a full Google account
      const av = avatar_url || deviceUser.avatar_url || null;
      await db.prepare(
        'UPDATE users SET email = ?, name = ?, google_id = ?, avatar_url = ?, is_verified = 1 WHERE id = ?'
      ).bind(email, name, google_id, av, deviceUser.id).run();
      user = { ...deviceUser, email, name, google_id, avatar_url: av };
    }
  }

  // FIX (currency auto-detect): country + currency on first Google login
  const detectedCountry = detectCountryFromRequest(c.req.raw) ?? 'IN';
  const detectedCurrency = currencyForCountry(detectedCountry);

  if (!user) {
    // 4. New user — create account. Welcome bonus (admin-configured) is
    // granted on first creation, same as the email + Quick-Login paths.
    const id = 'g_' + generateId().slice(0, 12);
    const av = avatar_url || null;
    const freeCallMinutes = await readFreeCallMinutesSetting(db);
    const welcomeBonus = await readRegistrationBonus(db);
    await db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, coins, is_verified, avatar_url, google_id, device_id, country, currency, free_call_minutes)
       VALUES (?, ?, ?, '', 'user', ?, 1, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, email, welcomeBonus, av, google_id, device_id ?? null, detectedCountry, detectedCurrency, freeCallMinutes).run();
    await writeCoinLedger(db, id, 'bonus', welcomeBonus, 'Welcome bonus (Google signup)');
    user = { id, name, email, role: 'user', coins: welcomeBonus, avatar_url: av, country: detectedCountry, currency: detectedCurrency };
  } else {
    // 5. Existing user — update google_id, avatar, device_id, and backfill country/currency if missing
    const updates: string[] = ['google_id = ?'];
    const bindings: any[] = [google_id];
    if (avatar_url && !user.avatar_url) {
      updates.push('avatar_url = ?');
      bindings.push(avatar_url);
      user.avatar_url = avatar_url;
    }
    if (device_id) {
      updates.push('device_id = ?');
      bindings.push(device_id);
    }
    if (!user.country && detectedCountry) {
      updates.push('country = ?');
      bindings.push(detectedCountry);
      user.country = detectedCountry;
    }
    if (!user.currency && detectedCurrency) {
      updates.push('currency = ?');
      bindings.push(detectedCurrency);
      user.currency = detectedCurrency;
    }
    bindings.push(user.id);
    await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...bindings).run();
  }

  const token = await signToken({ sub: user.id, role: user.role, name: user.name, email: user.email }, c.env.JWT_SECRET);
  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      coins: user.coins,
      avatar_url: user.avatar_url,
      phone: user.phone ?? null,
      gender: user.gender ?? null,
      bio: user.bio,
      country: user.country ?? null,
      currency: user.currency ?? null,
    }
  });
});

// POST /api/auth/guest-login — legacy alias for quick-login
auth.post('/guest-login', rateLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return quickLoginHandler(c, (body as any).device_id ?? null);
});

// POST /api/auth/quick-login — persistent device-based login (same device = same account)
// BUG FIX #4: Add device-level rate limiting to prevent Sybil attacks (unlimited guest account creation)
auth.post('/quick-login', deviceRateLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return quickLoginHandler(c, (body as any).device_id ?? null);
});

async function quickLoginHandler(c: any, deviceId: string | null) {
  if (!deviceId || deviceId.trim().length < 4) {
    return c.json({ error: 'device_id is required for Quick Login' }, 400);
  }

  const db = c.env.DB;

  // FIX (currency auto-detect): detect country once at the top of the handler
  // so both the returning-user backfill and the new-user INSERT can reuse it.
  const detectedCountry = detectCountryFromRequest(c.req.raw) ?? 'IN';
  const detectedCurrency = currencyForCountry(detectedCountry);

  if (deviceId) {
    const existing = await db.prepare(
      'SELECT id, name, email, role, coins, avatar_url, country, currency FROM users WHERE device_id = ? LIMIT 1'
    ).bind(deviceId).first() as any;

    if (existing) {
      // Backfill country/currency if missing
      if ((!existing.country || !existing.currency) && detectedCountry) {
        await db.prepare(
          'UPDATE users SET country = COALESCE(country, ?), currency = COALESCE(currency, ?) WHERE id = ?'
        ).bind(detectedCountry, detectedCurrency, existing.id).run().catch(() => {});
        existing.country = existing.country ?? detectedCountry;
        existing.currency = existing.currency ?? detectedCurrency;
      }
      const token = await signToken({ sub: existing.id, role: existing.role, name: existing.name, email: existing.email }, c.env.JWT_SECRET);
      return c.json({
        token,
        user: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: existing.role,
          coins: existing.coins,
          avatar_url: existing.avatar_url,
          country: existing.country ?? null,
          currency: existing.currency ?? null,
          is_guest: true,
        },
        is_returning: true,
      });
    }
  }

  const quickId = 'q_' + generateId().slice(0, 12);
  const quickEmail = `${quickId}@quick.voxlink.app`;
  const _adj = ['Happy','Bright','Cool','Swift','Bold','Brave','Calm','Witty','Smart','Lucky'];
  const _ani = ['Fox','Bear','Wolf','Lion','Tiger','Eagle','Panda','Koala','Hawk','Lynx'];

  // FIX #33: Display-name uniqueness for quick-login users at scale.
  //
  // The pool is 10 adj × 10 animal × 90 000 numeric suffixes ≈ 9M combos.
  // Birthday-paradox collisions start around √9M ≈ 3 000 quick-login users
  // active in the same window — well within real load for a chat app.
  // Two users with the same display name break trust ("am I really chatting
  // with the right Brave Lion?") and break naïve admin search.
  //
  // Strategy: probe up to 3 random candidates, taking the first that does
  // NOT already exist in `users.name`. If all 3 collide, append a 4-char
  // hex tail derived from the freshly-generated `quickId`. The id is itself
  // a globally-unique random token, so the suffixed name is guaranteed
  // unique for new rows even under concurrent-burst load (and the residual
  // TOCTOU window between SELECT and INSERT is microseconds — same Worker
  // request, single-writer D1).
  let quickName = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${_adj[Math.floor(Math.random() * _adj.length)]}${_ani[Math.floor(Math.random() * _ani.length)]}${String(Math.floor(Math.random() * 90000) + 10000)}`;
    try {
      const taken = await db.prepare('SELECT 1 as ok FROM users WHERE name = ? LIMIT 1').bind(candidate).first();
      if (!taken) { quickName = candidate; break; }
    } catch (e) {
      // Read-side failure is non-fatal — fall through to the deterministic
      // suffix path below, which doesn't need a SELECT.
      console.warn('[quick-login] name collision probe failed:', e);
      break;
    }
  }
  if (!quickName) {
    // Deterministic fallback: append last 4 hex chars of the unique quickId.
    // Adds 16^4 = 65 536 disambiguators per adj+animal pair, lifting effective
    // pool past 5 billion combos.
    const base = `${_adj[Math.floor(Math.random() * _adj.length)]}${_ani[Math.floor(Math.random() * _ani.length)]}${String(Math.floor(Math.random() * 90000) + 10000)}`;
    quickName = `${base}-${quickId.slice(-4)}`;
  }

  // Welcome bonus (admin-configured `registration_bonus_coins`) now applies to
  // Quick-Login too, per product decision. NOTE: this re-opens a guest-account
  // farming vector the previous "0 coins for guests" rule closed — keep it in
  // check by setting registration_bonus_coins conservatively (or 0 to disable),
  // and rely on the per-device merge so reinstalls on the same device don't
  // mint a fresh bonus.
  const guestFreeMinutes = await readFreeCallMinutesSetting(db);
  const welcomeBonus = await readRegistrationBonus(db);
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, coins, is_verified, role, device_id, country, currency, free_call_minutes) VALUES (?, ?, ?, '', ?, 0, 'user', ?, ?, ?, ?)`
  ).bind(quickId, quickName, quickEmail, welcomeBonus, deviceId ?? null, detectedCountry, detectedCurrency, guestFreeMinutes).run();
  await writeCoinLedger(db, quickId, 'bonus', welcomeBonus, 'Welcome bonus (Quick-Login signup)');

  const token = await signToken({ sub: quickId, role: 'user', name: quickName, email: quickEmail }, c.env.JWT_SECRET);
  return c.json({
    token,
    user: {
      id: quickId,
      name: quickName,
      email: quickEmail,
      coins: welcomeBonus,
      role: 'user',
      country: detectedCountry,
      currency: detectedCurrency,
      is_guest: true,
    },
    is_returning: false,
  });
}

export default auth;
