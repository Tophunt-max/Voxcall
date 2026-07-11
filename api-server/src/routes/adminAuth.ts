// ============================================================================
// Admin Cookie-Based Auth Endpoints
// ============================================================================
//
// SECURITY FIX: The admin panel previously stored the JWT in localStorage,
// which is accessible to any JavaScript running on the page (XSS, malicious
// browser extensions). These endpoints issue/validate/clear an httpOnly +
// Secure + SameSite=Strict session cookie instead, removing the token from
// JS-accessible storage entirely.
//
// Flow:
//   1. POST /api/admin-auth/login   → validates creds, sets httpOnly cookie
//   2. GET  /api/admin-auth/session → reads cookie, returns user info
//   3. POST /api/admin-auth/refresh → reads cookie, re-issues with fresh expiry
//   4. POST /api/admin-auth/logout  → clears cookie + invalidates server-side
//
// The cookie name is `__Host-admin_session` (Host prefix enforces Secure +
// path=/ + no Domain, preventing subdomain cookie theft).
//
// Backward-compat: The existing Bearer token flow (localStorage) still works
// via the standard authMiddleware. The admin panel should migrate to cookies
// first, then the Bearer fallback can be removed in a future release.
// ============================================================================

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { signToken, verifyToken } from '../lib/jwt';
import { verifyPassword } from '../lib/hash';
import { registerHit } from '../lib/rateLimit';
import { findActiveBan, bannedBody } from '../lib/bans';
import type { Env } from '../types';

const COOKIE_NAME = '__Host-admin_session';

// 7 days in seconds (matches JWT TTL)
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

function setSessionCookie(c: any, token: string, env: Env): void {
  const isProduction = env.ENVIRONMENT === 'production';
  // __Host- prefix requires Secure=true, Path=/, no Domain attribute.
  // In local dev (HTTP), we fall back to a non-prefixed name without Secure
  // so wrangler dev still works (localhost over HTTP can't set Secure cookies).
  const name = isProduction ? COOKIE_NAME : 'admin_session';
  const secure = isProduction ? '; Secure' : '';
  const cookie = `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`;
  c.header('Set-Cookie', cookie);
}

function clearSessionCookie(c: any, env: Env): void {
  const isProduction = env.ENVIRONMENT === 'production';
  const name = isProduction ? COOKIE_NAME : 'admin_session';
  const secure = isProduction ? '; Secure' : '';
  const cookie = `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
  c.header('Set-Cookie', cookie);
}

function extractSessionCookie(c: any, env: Env): string | null {
  const cookieHeader = c.req.header('Cookie') || '';
  const isProduction = env.ENVIRONMENT === 'production';
  const name = isProduction ? COOKIE_NAME : 'admin_session';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

const adminAuth = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Rate limit: 10 attempts / 60s per IP (same as regular login)
async function rateLimit(c: any, next: any) {
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  const now = Math.floor(Date.now() / 1000);
  const windowSlot = Math.floor(now / 60);
  const key = `rl:admin-login:${ip}:${windowSlot}`;
  try {
    const { limited, retryAfterSec } = await registerHit(c.env.DB, key, 10, 60);
    if (limited) {
      return c.json({ error: `Too many attempts. Retry in ${Math.ceil(retryAfterSec / 60)} min.` }, 429);
    }
  } catch (e) {
    console.warn('[admin-auth] rate limit check failed, failing open:', e);
  }
  return next();
}

// POST /api/admin-auth/login — validate credentials, set httpOnly session cookie
adminAuth.post('/login', rateLimit, zValidator('json', loginSchema), async (c) => {
  const { password } = c.req.valid('json');
  const email = c.req.valid('json').email.trim().toLowerCase();
  const db = c.env.DB;

  const user = await db.prepare(
    'SELECT id, name, email, password_hash, role, coins, avatar_url FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (!user) return c.json({ error: 'Invalid email or password' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401);

  // Only admins can use this endpoint
  if (user.role !== 'admin') return c.json({ error: 'Invalid email or password' }, 401);

  // Check bans
  const loginBan = await findActiveBan(db, { userId: user.id, email });
  if (loginBan) return c.json(bannedBody(loginBan), 403);

  const token = await signToken(
    { sub: user.id, role: user.role, name: user.name, email: user.email },
    c.env.JWT_SECRET
  );

  setSessionCookie(c, token, c.env);

  const { password_hash, ...safeUser } = user;
  return c.json({ user: safeUser });
});

// GET /api/admin-auth/session — validate cookie, return current user info
adminAuth.get('/session', async (c) => {
  const token = extractSessionCookie(c, c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // Check user is still active and admin
    const user = await c.env.DB.prepare(
      'SELECT id, name, email, role, status, token_invalidated_at, avatar_url FROM users WHERE id = ?'
    ).bind(payload.sub).first<any>();
    if (!user) return c.json({ error: 'User not found' }, 401);
    if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    if (user.status === 'banned' || user.status === 'deleted') {
      return c.json({ error: 'Account suspended' }, 403);
    }

    // Check token revocation
    const issuedAt = payload.iat ?? 0;
    const invalidatedAt = user.token_invalidated_at ?? 0;
    if (issuedAt < invalidatedAt) {
      clearSessionCookie(c, c.env);
      return c.json({ error: 'Session expired' }, 401);
    }

    return c.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar_url: user.avatar_url },
    });
  } catch {
    clearSessionCookie(c, c.env);
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
});

// POST /api/admin-auth/refresh — issue a fresh cookie with extended expiry
adminAuth.post('/refresh', async (c) => {
  const token = extractSessionCookie(c, c.env);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);

  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);

    // Cap total session lifetime at 30 days (same as Bearer refresh)
    if (typeof payload.iat !== 'number') {
      return c.json({ error: 'Malformed session' }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const MAX_AGE = 30 * 24 * 60 * 60;
    if (now - payload.iat > MAX_AGE) {
      clearSessionCookie(c, c.env);
      return c.json({ error: 'Session too old, please log in again' }, 401);
    }

    // Re-check user status
    const user = await c.env.DB.prepare(
      'SELECT id, name, email, role, status, token_invalidated_at FROM users WHERE id = ?'
    ).bind(payload.sub).first<any>();
    if (!user || user.role !== 'admin' || user.status === 'banned' || user.status === 'deleted') {
      clearSessionCookie(c, c.env);
      return c.json({ error: 'Session invalidated' }, 401);
    }
    const invalidatedAt = user.token_invalidated_at ?? 0;
    if ((payload.iat ?? 0) < invalidatedAt) {
      clearSessionCookie(c, c.env);
      return c.json({ error: 'Session revoked' }, 401);
    }

    // Issue fresh token
    const newToken = await signToken(
      { sub: user.id, role: user.role, name: user.name, email: user.email },
      c.env.JWT_SECRET
    );
    setSessionCookie(c, newToken, c.env);
    return c.json({ success: true });
  } catch {
    clearSessionCookie(c, c.env);
    return c.json({ error: 'Invalid or expired session' }, 401);
  }
});

// POST /api/admin-auth/logout — clear cookie + invalidate server-side
adminAuth.post('/logout', async (c) => {
  const token = extractSessionCookie(c, c.env);
  clearSessionCookie(c, c.env);

  if (token) {
    try {
      const payload = await verifyToken(token, c.env.JWT_SECRET);
      // Invalidate all tokens for this admin (same as Bearer /auth/logout)
      await c.env.DB.prepare(
        'UPDATE users SET token_invalidated_at = ? WHERE id = ?'
      ).bind(Math.floor(Date.now() / 1000), payload.sub).run();
    } catch {
      // Token already expired or invalid — cookie still cleared above
    }
  }

  return c.json({ success: true });
});

export default adminAuth;
