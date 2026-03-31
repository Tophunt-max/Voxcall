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
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { name, email, password, gender, phone } = c.req.valid('json');
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

export default auth;
