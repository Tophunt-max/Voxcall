import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { signToken, verifyToken } from '../lib/jwt';
import { hashPassword, verifyPassword, generateOTP, generateId } from '../lib/hash';
import type { Env } from '../types';

const auth = new Hono<{ Bindings: Env }>();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  gender: z.enum(['male', 'female', 'other']).optional(),
  phone: z.string().optional(),
  referral_code: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
auth.post('/register', zValidator('json', registerSchema), async (c) => {
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
  // Handle referral code if provided
  if (referral_code) {
    try {
      const ref = await db.prepare('SELECT * FROM referral_codes WHERE code = ?').bind(referral_code.trim().toUpperCase()).first<any>();
      if (ref && ref.user_id !== id) {
        const bonus = 25;
        const useId = crypto.randomUUID();
        await db.batch([
          db.prepare('INSERT INTO referral_uses (id, referrer_id, referred_id, code, coins_given) VALUES (?, ?, ?, ?, ?)')
            .bind(useId, ref.user_id, id, referral_code, bonus),
          db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(bonus, ref.user_id),
          db.prepare('UPDATE users SET coins = coins + 10 WHERE id = ?').bind(id),
        ]);
      }
    } catch { /* ignore referral errors — don't block registration */ }
  }
  // In production: send OTP via SMS/email
  console.log(`OTP for ${email}: ${otp}`);
  const token = await signToken({ sub: id, role: 'user', name }, c.env.JWT_SECRET);
  return c.json({ token, user: { id, name, email, role: 'user', coins: 100 }, otp }, 201);
});

// POST /api/auth/login
auth.post('/login', zValidator('json', loginSchema), async (c) => {
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
  await db.prepare('UPDATE users SET is_verified = 1, otp = NULL, coins = coins + 100 WHERE id = ?').bind(user.id).run();
  return c.json({ success: true, bonus_coins: 100 });
});

// POST /api/auth/forgot-password
auth.post('/forgot-password', async (c) => {
  const { email } = await c.req.json();
  const db = c.env.DB;
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<any>();
  if (!user) return c.json({ error: 'Email not found' }, 404);
  const otp = generateOTP();
  const otpExp = Math.floor(Date.now() / 1000) + 600;
  await db.prepare('UPDATE users SET otp = ?, otp_expires_at = ? WHERE id = ?').bind(otp, otpExp, user.id).run();
  console.log(`Reset OTP for ${email}: ${otp}`);
  return c.json({ success: true, otp }); // remove otp from response in production
});

// POST /api/auth/reset-password
auth.post('/reset-password', async (c) => {
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
  const { email, name, google_id, avatar_url } = body as {
    email: string; name: string; google_id: string; avatar_url?: string | null;
  };
  if (!email || !google_id) return c.json({ error: 'Missing required fields' }, 400);
  const db = c.env.DB;

  let user = await db.prepare(
    'SELECT id, name, email, role, coins, avatar_url, gender, bio FROM users WHERE email = ?'
  ).bind(email).first<any>();

  if (!user) {
    const id = 'g_' + generateId().slice(0, 12);
    const av = avatar_url || null;
    await db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, coins, is_verified, avatar_url, google_id)
       VALUES (?, ?, ?, '', 'user', 50, 1, ?, ?)`
    ).bind(id, name, email, av, google_id).run();
    user = { id, name, email, role: 'user', coins: 50, avatar_url: av };
  } else {
    if (avatar_url && !user.avatar_url) {
      await db.prepare('UPDATE users SET avatar_url = ?, google_id = ? WHERE id = ?')
        .bind(avatar_url, google_id, user.id).run();
      user.avatar_url = avatar_url;
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
  const quickName = 'VoxLink User';

  await db.prepare(
    `INSERT INTO users (id, name, email, password_hash, coins, is_verified, role, device_id) VALUES (?, ?, ?, '', 50, 0, 'user', ?)`
  ).bind(quickId, quickName, quickEmail, deviceId ?? null).run();

  const token = await signToken({ sub: quickId, role: 'user', name: quickName }, c.env.JWT_SECRET);
  return c.json({
    token,
    user: { id: quickId, name: quickName, email: quickEmail, coins: 50, role: 'user', is_guest: true },
    is_returning: false,
  });
}

export default auth;
