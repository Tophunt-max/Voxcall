import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { signToken, verifyToken } from '../lib/jwt';
import { hashPassword, verifyPassword, generateOTP, generateId } from '../lib/hash';
import type { Env } from '../types';

const auth = new Hono<{ Bindings: Env }>();

// ─── Rate Limiting ───────────────────────────────────────────────────────────
// Limits: 10 attempts / 60s per IP per route — uses D1 for persistence
async function rateLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  const routeKey = c.req.path.split('/').slice(-1)[0]; // e.g. "login"
  const windowSecs = 60;
  const maxAttempts = 10;
  const now = Math.floor(Date.now() / 1000);
  const windowSlot = Math.floor(now / windowSecs);
  const key = `rl:${routeKey}:${ip}:${windowSlot}`;

  try {
    const row = await c.env.DB.prepare(
      'SELECT attempts, window_reset FROM rate_limits WHERE id = ?'
    ).bind(key).first<{ attempts: number; window_reset: number }>();

    if (row && row.window_reset > now) {
      if (row.attempts >= maxAttempts) {
        return c.json({ error: 'Too many requests. Please try again in a minute.' }, 429);
      }
      await c.env.DB.prepare(
        'UPDATE rate_limits SET attempts = attempts + 1 WHERE id = ?'
      ).bind(key).run();
    } else {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO rate_limits (id, attempts, window_reset) VALUES (?, 1, ?)'
      ).bind(key, now + windowSecs).run();
    }
  } catch {
    // Rate limit table may not exist yet — don't block legitimate requests
  }

  return next();
}

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().optional(),
  referral_code: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
auth.post('/register', rateLimit, zValidator('json', registerSchema), async (c) => {
  const { name, email, password, gender, phone, referral_code } = c.req.valid('json');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);
  const id = generateId();
  const hash = await hashPassword(password);
  const otp = generateOTP();
  const otpExp = Math.floor(Date.now() / 1000) + 600;
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, gender, phone, otp, otp_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, name, email, hash, gender ?? null, phone ?? null, otp, otpExp).run();
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
  const token = await signToken({ sub: id, role: 'user', name }, c.env.JWT_SECRET);
  // Fix NEW-3: coins start at 0; 100 bonus coins are added after OTP verification
  return c.json({ token, user: { id, name, email, role: 'user', coins: 0 } }, 201);
});

// POST /api/auth/login
auth.post('/login', rateLimit, zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const db = c.env.DB;
  const user = await db.prepare(
    'SELECT id, name, email, password_hash, role, coins, avatar_url, gender, bio FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user) return c.json({ error: 'Invalid email or password' }, 401);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401);
  const token = await signToken({ sub: user.id, role: user.role, name: user.name }, c.env.JWT_SECRET);
  const { password_hash, ...safeUser } = user;
  // If host, fetch host data
  let hostData = null;
  if (user.role === 'host') {
    hostData = await db.prepare('SELECT * FROM hosts WHERE user_id = ?').bind(user.id).first();
  }
  return c.json({ token, user: safeUser, host: hostData });
});

// POST /api/auth/verify-otp
auth.post('/verify-otp', async (c) => {
  const { email, otp } = await c.req.json();
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const user = await db.prepare(
    'SELECT id, otp, otp_expires_at FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user || user.otp !== otp || user.otp_expires_at < now) {
    return c.json({ error: 'Invalid or expired OTP' }, 400);
  }
  // Bug 3 Fix: Process pending referral only after OTP verified — prevents Sybil attacks
  const pendingReferral = await db.prepare(
    'SELECT * FROM referral_uses WHERE referred_id = ? AND coins_given = 0'
  ).bind(user.id).first<any>();

  if (pendingReferral) {
    const bonus = 25;
    await db.batch([
      db.prepare('UPDATE users SET is_verified = 1, otp = NULL, coins = coins + 110 WHERE id = ?').bind(user.id),
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(bonus, pendingReferral.referrer_id),
      db.prepare('UPDATE referral_uses SET coins_given = ? WHERE id = ?').bind(bonus, pendingReferral.id),
    ]);
    return c.json({ success: true, bonus_coins: 110 });
  } else {
    await db.prepare('UPDATE users SET is_verified = 1, otp = NULL, coins = coins + 100 WHERE id = ?').bind(user.id).run();
    return c.json({ success: true, bonus_coins: 100 });
  }
});

// POST /api/auth/forgot-password
auth.post('/forgot-password', rateLimit, async (c) => {
  const { email } = await c.req.json();
  const db = c.env.DB;
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<any>();
  if (!user) return c.json({ error: 'Email not found' }, 404);
  const otp = generateOTP();
  const otpExp = Math.floor(Date.now() / 1000) + 600;
  await db.prepare('UPDATE users SET otp = ?, otp_expires_at = ? WHERE id = ?').bind(otp, otpExp, user.id).run();
  return c.json({ success: true });
});

// POST /api/auth/reset-password
auth.post('/reset-password', rateLimit, async (c) => {
  const { email, otp, new_password } = await c.req.json();
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const user = await db.prepare(
    'SELECT id, otp, otp_expires_at FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user || user.otp !== otp || user.otp_expires_at < now) {
    return c.json({ error: 'Invalid or expired OTP' }, 400);
  }
  const hash = await hashPassword(new_password);
  await db.prepare('UPDATE users SET password_hash = ?, otp = NULL WHERE id = ?').bind(hash, user.id).run();
  return c.json({ success: true });
});

// POST /api/auth/refresh — issue new token from old (within grace period)
auth.post('/refresh', async (c) => {
  const { token } = await c.req.json();
  if (!token) return c.json({ error: 'Token required' }, 400);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const user = await c.env.DB.prepare(
      'SELECT id, name, role FROM users WHERE id = ?'
    ).bind(payload.sub).first<any>();
    if (!user) return c.json({ error: 'User not found' }, 404);
    const newToken = await signToken({ sub: user.id, role: user.role, name: user.name }, c.env.JWT_SECRET);
    return c.json({ token: newToken });
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});

// POST /api/auth/logout — client-side logout (stateless JWT — just acknowledge)
auth.post('/logout', async (c) => {
  return c.json({ success: true });
});

// POST /api/auth/google-login — sign in or register via Google OAuth
auth.post('/google-login', async (c) => {
  const body = await c.req.json();
  const { email, name, google_id, avatar_url, device_id } = body as {
    email: string; name: string; google_id: string; avatar_url?: string | null; device_id?: string | null;
  };
  if (!email || !google_id) return c.json({ error: 'Missing required fields' }, 400);
  const db = c.env.DB;

  let user = await db.prepare(
    'SELECT id, name, email, role, coins, avatar_url, gender, bio FROM users WHERE email = ?'
  ).bind(email).first<any>();

  if (!user) {
    const id = 'g_' + generateId().slice(0, 12);
    const av = avatar_url || null;
    // Google login: start with 0 coins — no OTP verification so no registration bonus
    // This prevents Sybil attacks where many Google accounts farm signup coins
    // Also save device_id so Quick Login on same device returns this account (no duplicate accounts)
    await db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, coins, is_verified, avatar_url, google_id, device_id)
       VALUES (?, ?, ?, '', 'user', 0, 1, ?, ?, ?)`
    ).bind(id, name, email, av, google_id, device_id ?? null).run();
    user = { id, name, email, role: 'user', coins: 0, avatar_url: av };
  } else {
    // Update avatar, google_id and device_id if not already set
    const updates: string[] = [];
    const bindings: any[] = [];
    if (avatar_url && !user.avatar_url) {
      updates.push('avatar_url = ?');
      bindings.push(avatar_url);
      user.avatar_url = avatar_url;
    }
    updates.push('google_id = ?');
    bindings.push(google_id);
    // Link device_id to this Google account so Quick Login on same device returns this account
    if (device_id) {
      updates.push('device_id = ?');
      bindings.push(device_id);
    }
    if (updates.length > 0) {
      bindings.push(user.id);
      await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...bindings).run();
    }
  }

  const token = await signToken({ sub: user.id, role: user.role, name: user.name }, c.env.JWT_SECRET);
  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      coins: user.coins,
      avatar_url: user.avatar_url,
      bio: user.bio,
    }
  });
});

// POST /api/auth/guest-login — legacy alias for quick-login
auth.post('/guest-login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return quickLoginHandler(c, (body as any).device_id ?? null);
});

// POST /api/auth/quick-login — persistent device-based login (same device = same account)
auth.post('/quick-login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return quickLoginHandler(c, (body as any).device_id ?? null);
});

async function quickLoginHandler(c: any, deviceId: string | null) {
  const db = c.env.DB;

  if (deviceId) {
    const existing = await db.prepare(
      'SELECT id, name, email, role, coins, avatar_url FROM users WHERE device_id = ? LIMIT 1'
    ).bind(deviceId).first<any>();

    if (existing) {
      const token = await signToken({ sub: existing.id, role: existing.role, name: existing.name }, c.env.JWT_SECRET);
      return c.json({
        token,
        user: { id: existing.id, name: existing.name, email: existing.email, role: existing.role, coins: existing.coins, avatar_url: existing.avatar_url, is_guest: true },
        is_returning: true,
      });
    }
  }

  const quickId = 'q_' + generateId().slice(0, 12);
  const quickEmail = `${quickId}@quick.voxlink.app`;
  const _adj = ['Happy','Bright','Cool','Swift','Bold','Brave','Calm','Witty','Smart','Lucky'];
  const _ani = ['Fox','Bear','Wolf','Lion','Tiger','Eagle','Panda','Koala','Hawk','Lynx'];
  const quickName = `${_adj[Math.floor(Math.random()*_adj.length)]}${_ani[Math.floor(Math.random()*_ani.length)]}${String(Math.floor(Math.random()*900)+100)}`;

  // Bug fix: 0 coins for guest accounts (was 50) — prevents Sybil attack of creating
  // unlimited guest accounts to farm free coins.
  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, coins, is_verified, role, device_id) VALUES (?, ?, ?, '', 0, 0, 'user', ?)`
  ).bind(quickId, quickName, quickEmail, deviceId ?? null).run();

  const token = await signToken({ sub: quickId, role: 'user', name: quickName }, c.env.JWT_SECRET);
  return c.json({
    token,
    user: { id: quickId, name: quickName, email: quickEmail, coins: 0, role: 'user', is_guest: true },
    is_returning: false,
  });
}

export default auth;
