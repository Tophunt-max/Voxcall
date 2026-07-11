import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { pushToUser, notifyUser } from '../lib/realtime';
import { verifyPassword } from '../lib/hash';
import { getStreakStatus, claimDailyStreak, repairStreak } from '../lib/streak';
import { getDefaultCallRates } from '../lib/levels';
import { checkRateLimit } from '../lib/rateLimit';
import { getVipStatus } from '../lib/vip';
import type { Env, JWTPayload } from '../types';

const user = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
user.use('*', authMiddleware);

// GET /api/user/me
user.get('/me', async (c) => {
  const { sub } = c.get('user');
  const me = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.avatar_url, u.gender, u.bio,
       u.coins, u.role, u.is_verified, u.created_at,
       u.country, u.currency,
       (SELECT COUNT(*) FROM call_sessions WHERE caller_id = u.id AND status = 'ended') as total_calls
     FROM users u WHERE u.id = ?`
  ).bind(sub).first();
  if (!me) return c.json({ error: 'User not found' }, 404);
  // Best-effort: surface the user's remaining first-call-free trial minutes
  // (migration 0028 — users.free_call_minutes). Done as a separate guarded
  // query so a legacy DB WITHOUT the column never breaks the critical /me
  // endpoint — the app treats a missing value as 0 (feature simply hidden).
  let free_call_minutes = 0;
  try {
    const row = await c.env.DB.prepare('SELECT free_call_minutes FROM users WHERE id = ?')
      .bind(sub).first<{ free_call_minutes: number }>();
    free_call_minutes = Number(row?.free_call_minutes ?? 0) || 0;
  } catch { /* column absent on legacy DB — treat as 0 */ }
  // VIP membership (best-effort; getVipStatus is safe on un-migrated DBs).
  const vip = await getVipStatus(c.env.DB, sub);
  return c.json({
    ...me,
    free_call_minutes,
    is_vip: vip.isVip,
    vip_tier: vip.tier,
    vip_expires_at: vip.expiresAt,
  });
});

// PATCH /api/user/me
user.patch('/me', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json();
  const LIMITS: Record<string, number> = { name: 100, phone: 20, bio: 500, gender: 10, avatar_url: 2000, fcm_token: 500 };
  const allowed = ['name', 'phone', 'bio', 'gender', 'avatar_url', 'fcm_token', 'currency'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      // Allow null for fcm_token (logout clears it); validate string length for all others
      if (body[key] !== null) {
        const str = String(body[key]);
        if (str.length > (LIMITS[key] ?? 1000)) {
          return c.json({ error: `${key} exceeds maximum length of ${LIMITS[key]} characters` }, 400);
        }
      }
      sets.push(`${key} = ?`);
      vals.push(body[key]);
    }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(sub);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// GET /api/user/streak — read-only daily streak snapshot for the UI.
//
// Used by the wallet / home screen to render the "Daily Reward" card. Exposes
// the reward schedule, milestone bonuses, current streak, whether the Claim
// button should be enabled, and (when on cooldown) the IST midnight at which
// the next claim window opens.
user.get('/streak', async (c) => {
  const { sub } = c.get('user');
  const status = await getStreakStatus(c.env.DB, sub);
  if (!status) return c.json({ error: 'User not found' }, 404);
  return c.json(status);
});

// POST /api/user/streak/claim — atomic claim of today's streak reward.
//
// Idempotent within an IST calendar day: a second call before the next IST
// midnight returns `claimed=false, code=ALREADY_CLAIMED` (HTTP 200) instead
// of an error. Real failures (feature disabled / user missing) are also 200
// with their own code; the client switches on `code` rather than HTTP status
// to render the right toast.
user.post('/streak/claim', async (c) => {
  const { sub } = c.get('user');
  const result = await claimDailyStreak(c.env.DB, sub);
  return c.json(result);
});

// POST /api/user/streak/repair — restore a streak after missing exactly one
// IST day. Spends a free freeze token if available, otherwise charges
// `daily_streak_repair_cost_coins`. Like /claim, real failures are returned as
// HTTP 200 with a `code` the client switches on (FEATURE_DISABLED,
// NOTHING_TO_REPAIR, INSUFFICIENT_FUNDS). Only INSUFFICIENT_FUNDS maps to 402
// so the client can surface a top-up prompt.
user.post('/streak/repair', async (c) => {
  const { sub } = c.get('user');
  const result = await repairStreak(c.env.DB, sub);
  const httpStatus = result.code === 'INSUFFICIENT_FUNDS' ? 402 : 200;
  return c.json(result, httpStatus);
});

// GET /api/user/notifications
user.get('/notifications', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(sub).all();
  return c.json(result.results);
});

// PATCH /api/user/notifications/read
user.patch('/notifications/read', async (c) => {
  const { sub } = c.get('user');
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(sub).run();
  return c.json({ success: true });
});

// GET /api/user/coin-history
user.get('/coin-history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(sub).all();
  return c.json(result.results);
});

// Max hosts a single user may favorite. Prevents unbounded table growth /
// abuse while being far above any realistic real-world usage.
const MAX_FAVORITES = 500;

// GET /api/user/favorites — get favorite hosts (paginated, online-first)
user.get('/favorites', async (c) => {
  const { sub } = c.get('user');
  // Bounded response so the list stays cheap as favorites grow.
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 200);
  const result = await c.env.DB.prepare(
    `SELECT uf.id, uf.created_at, h.id as host_id, h.display_name, h.rating, h.review_count,
            h.coins_per_minute, h.audio_coins_per_minute, h.video_coins_per_minute,
            h.is_online, h.specialties, h.languages,
            u.name, u.avatar_url, u.gender
     FROM user_favorites uf
     JOIN hosts h ON h.id = uf.host_id
     JOIN users u ON u.id = h.user_id
     WHERE uf.user_id = ?
       AND COALESCE(u.status, 'active') NOT IN ('banned', 'deleted')
     ORDER BY h.is_online DESC, uf.created_at DESC
     LIMIT ?`
  ).bind(sub, limit).all();
  return c.json(result.results.map((r: any) => ({
    ...r,
    specialties: JSON.parse(r.specialties || '[]'),
    languages: JSON.parse(r.languages || '[]'),
  })));
});

// GET /api/user/favorites/ids — lightweight: just the favorited host_ids.
// Lets the app mark hearts across any list/grid without downloading full
// host objects. Cheap enough to poll / cache client-side.
user.get('/favorites/ids', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT host_id FROM user_favorites WHERE user_id = ?'
  ).bind(sub).all<{ host_id: string }>();
  return c.json({ ids: (result.results ?? []).map((r) => r.host_id) });
});

// GET /api/user/favorites/status/:hostId — is THIS host favorited?
// Single-row check so the host profile no longer downloads the whole list
// just to toggle one heart.
user.get('/favorites/status/:hostId', async (c) => {
  const { sub } = c.get('user');
  const { hostId } = c.req.param();
  const row = await c.env.DB.prepare(
    'SELECT 1 as ok FROM user_favorites WHERE user_id = ? AND host_id = ? LIMIT 1'
  ).bind(sub, hostId).first<{ ok: number }>();
  return c.json({ favorite: !!row });
});

// POST /api/user/favorites/:hostId — add favorite (guarded + idempotent)
user.post('/favorites/:hostId', async (c) => {
  const { sub } = c.get('user');
  const { hostId } = c.req.param();
  const db = c.env.DB;

  // Throttle rapid toggling (fail-open if the rate_limits table is missing).
  const rl = await checkRateLimit(db, `fav-toggle:${sub}`, 30, 60);
  if (rl.limited) {
    return c.json({ error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }, 429);
  }

  // Only active hosts can be favorited; also surfaces the host's own user_id
  // so we can block self-favoriting.
  const host = await db.prepare('SELECT id, user_id FROM hosts WHERE id = ? AND is_active = 1')
    .bind(hostId).first<{ id: string; user_id: string }>();
  if (!host) return c.json({ error: 'Host not found or unavailable' }, 404);
  if (host.user_id === sub) return c.json({ error: 'You cannot favorite yourself' }, 400);

  const already = await db.prepare(
    'SELECT 1 as ok FROM user_favorites WHERE user_id = ? AND host_id = ? LIMIT 1'
  ).bind(sub, hostId).first<{ ok: number }>();

  if (!already) {
    const cntRow = await db.prepare('SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?')
      .bind(sub).first<{ cnt: number }>();
    if ((Number(cntRow?.cnt) || 0) >= MAX_FAVORITES) {
      return c.json({ error: `You can favorite up to ${MAX_FAVORITES} hosts`, code: 'FAVORITES_LIMIT' }, 409);
    }
    await db.prepare('INSERT OR IGNORE INTO user_favorites (id, user_id, host_id) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), sub, hostId).run();
    // Real-time: tell the host someone favorited them (live toast).
    try {
      const me = await db.prepare('SELECT name FROM users WHERE id = ?').bind(sub).first<{ name: string }>();
      c.executionCtx?.waitUntil?.(pushToUser(c.env, host.user_id, {
        type: 'favorited', by_name: me?.name ?? 'Someone', timestamp: Date.now(),
      }));
      // Persist + offline push (realtime:false — favorited socket event already
      // shows the live toast).
      c.executionCtx?.waitUntil?.(notifyUser(
        c.env, host.user_id, 'New favorite ❤️',
        `${me?.name ?? 'Someone'} added you to favorites`,
        'favorite', { realtime: false },
      ));
    } catch { /* best-effort */ }
  }

  const total = await db.prepare('SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?')
    .bind(sub).first<{ cnt: number }>();
  return c.json({ success: true, added: !already, favorite: true, count: Number(total?.cnt) || 0 });
});

// DELETE /api/user/favorites/:hostId — remove favorite
user.delete('/favorites/:hostId', async (c) => {
  const { sub } = c.get('user');
  const { hostId } = c.req.param();
  const db = c.env.DB;

  // Same throttle as add — prevents rapid favorite/unfavorite flapping.
  const rl = await checkRateLimit(db, `fav-toggle:${sub}`, 30, 60);
  if (rl.limited) {
    return c.json({ error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }, 429);
  }

  const res = await db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND host_id = ?')
    .bind(sub, hostId).run();
  const removed = (res.meta?.changes ?? 0) > 0;
  const total = await db.prepare('SELECT COUNT(*) as cnt FROM user_favorites WHERE user_id = ?')
    .bind(sub).first<{ cnt: number }>();
  return c.json({ success: true, removed, favorite: false, count: Number(total?.cnt) || 0 });
});

// PATCH /api/user/notifications/:id/read — mark single notification read
user.patch('/notifications/:id/read', async (c) => {
  const { sub } = c.get('user');
  const { id } = c.req.param();
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(id, sub).run();
  return c.json({ success: true });
});

// GET /api/user/referral — get (or auto-generate) user's referral code + stats
user.get('/referral', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  let ref = await db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').bind(sub).first<any>();
  if (!ref) {
    const code = sub.slice(0, 4).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    const id = crypto.randomUUID();
    try {
      await db.prepare('INSERT INTO referral_codes (id, user_id, code) VALUES (?, ?, ?)').bind(id, sub, code).run();
      ref = { id, user_id: sub, code, created_at: Date.now() };
    } catch {
      // Race condition: another request created the code concurrently — re-read it
      ref = await db.prepare('SELECT * FROM referral_codes WHERE user_id = ?').bind(sub).first<any>();
      if (!ref) return c.json({ error: 'Failed to generate referral code' }, 500);
    }
  }
  const stats = await db.prepare(
    'SELECT COUNT(*) as referred, COALESCE(SUM(coins_given),0) as coins_earned FROM referral_uses WHERE referrer_id = ?'
  ).bind(sub).first<any>();

  // Surface the admin-managed referral reward config so the app shows the
  // ACTUAL reward amounts ("you get X, your friend gets Y") instead of
  // hardcoded copy. Defaults mirror the admin endpoint (/admin/referral-config)
  // so an unconfigured deployment still shows sensible numbers.
  const cfg = { referrer_reward: 100, new_user_reward: 50, min_calls_to_unlock: 1, active: true };
  try {
    const keys = ['referrer_reward', 'new_user_reward', 'min_calls_to_unlock', 'referral_active'];
    const rows = await db.prepare(
      `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`
    ).bind(...keys).all<any>();
    for (const r of (rows.results || [])) {
      if (r.key === 'referral_active') cfg.active = r.value === '1';
      else if (r.key === 'referrer_reward') cfg.referrer_reward = parseInt(r.value) || cfg.referrer_reward;
      else if (r.key === 'new_user_reward') cfg.new_user_reward = parseInt(r.value) || cfg.new_user_reward;
      else if (r.key === 'min_calls_to_unlock') cfg.min_calls_to_unlock = parseInt(r.value) || cfg.min_calls_to_unlock;
    }
  } catch { /* app_settings unavailable — fall back to defaults */ }

  return c.json({
    code: ref.code,
    referred: Number(stats?.referred ?? 0),
    coins_earned: Number(stats?.coins_earned ?? 0),
    config: cfg,
  });
});

// POST /api/user/report — submit a content/user report
user.post('/report', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const { reported_user_id, reported_user, reason, category, reported_type } = await c.req.json();
  if (!reason) return c.json({ error: 'reason is required' }, 400);
  if (String(reason).length > 2000) return c.json({ error: 'reason must be under 2000 characters' }, 400);
  if (!reported_user_id) return c.json({ error: 'reported_user_id is required' }, 400);
  const reporter = await db.prepare('SELECT name, phone, email FROM users WHERE id = ?').bind(sub).first<any>();
  const existing = await db.prepare(
    'SELECT id FROM content_reports WHERE reporter_id = ? AND reported_user_id = ? AND status = ? AND created_at > unixepoch() - 86400'
  ).bind(sub, reported_user_id, 'pending').first<any>();
  if (existing) return c.json({ error: 'You have already reported this user. Please wait for review.' }, 429);
  // FIX #19: Per-reporter daily cap — prevents one user from spamming the
  // moderation queue across many targets. Per-pair check above stays.
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const dailyCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM content_reports WHERE reporter_id = ? AND created_at > ?'
  ).bind(sub, dayAgo).first<{ cnt: number }>();
  if (dailyCount && dailyCount.cnt >= 10) {
    return c.json({ error: 'Too many reports submitted today. Please try again tomorrow.' }, 429);
  }
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO content_reports (id, reporter_id, reporter_name, reported_user_id, reported_user, reported_type, reason, category, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).bind(id, sub, reporter?.name ?? '', reported_user_id, reported_user ?? '', reported_type ?? 'user', reason, category ?? 'other').run();
  } catch (e: any) {
    if (e?.message?.includes('reported_type')) {
      await db.prepare(
        `INSERT INTO content_reports (id, reporter_id, reporter_name, reported_user_id, reported_user, reason, category, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(id, sub, reporter?.name ?? '', reported_user_id, reported_user ?? '', reason, category ?? 'other').run();
    } else throw e;
  }
  // Confirm to the reporter that we received it (in-app + FCM).
  c.executionCtx?.waitUntil?.(notifyUser(
    c.env, sub, 'Report received 🛡️',
    'Thanks for the report. Our moderation team will review it shortly.',
    'report',
  ));
  return c.json({ success: true, id });
});

// DELETE /api/user/me — soft-delete the caller's account
user.delete('/me', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  // FIX #13: Require the user's password before destroying their account.
  // A password-less account-delete endpoint means a stolen/leaked token can
  // permanently anonymise a user's profile. Google-only accounts (no
  // password_hash) keep the no-password behaviour because they have no
  // password to verify; a Google ID token re-auth flow can be added later.
  // FIX: type the catch fallback so TS doesn't widen body to `{...} | {}` and
  // reject the body.password access. Empty fallback still yields password=undefined.
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const userRow = await db.prepare('SELECT password_hash, google_id FROM users WHERE id = ?').bind(sub).first<any>();
  if (!userRow) return c.json({ error: 'User not found' }, 404);
  if (userRow.password_hash) {
    if (!body.password) return c.json({ error: 'Password required to delete account' }, 400);
    const ok = await verifyPassword(body.password, userRow.password_hash);
    if (!ok) return c.json({ error: 'Incorrect password' }, 401);
  }
  // Anonymize personal data and mark as deleted so referential integrity is preserved.
  // We also bump `token_invalidated_at` to NOW so any existing tokens (this
  // request itself, plus any other devices the user is logged in on) are
  // rejected by authMiddleware on the very next call. Relying on the
  // status='deleted' check alone leaves a small window where a stolen token
  // could be replayed before the next auth check; bumping the invalidation
  // timestamp closes that window.
  const deletedEmail = `deleted_${sub}@deleted.voxlink`;
  await db.prepare(`
    UPDATE users SET
      name        = 'Deleted User',
      email       = ?,
      password_hash = '',
      phone       = NULL,
      bio         = NULL,
      avatar_url  = NULL,
      google_id   = NULL,
      device_id   = NULL,
      fcm_token   = NULL,
      status      = 'deleted',
      token_invalidated_at = unixepoch(),
      updated_at  = unixepoch()
    WHERE id = ?
  `).bind(deletedEmail, sub).run();
  return c.json({ success: true, message: 'Account deleted successfully' });
});

// POST /api/user/become-host
user.post('/become-host', async (c) => {
  const { sub, name } = c.get('user');
  const { specialties, languages, bio } = await c.req.json();
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first();
  if (existing) return c.json({ error: 'Already a host' }, 409);
  // Only the most recent application counts — prevents using an old approval after a new rejection
  const latestApp = await db.prepare(
    "SELECT id, status FROM host_applications WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1"
  ).bind(sub).first<any>();
  if (!latestApp || latestApp.status !== 'approved') {
    return c.json({ error: 'Please complete KYC verification and wait for admin approval before becoming a host.' }, 403);
  }
  const hostId = `host_${sub}`;
  // Seed the new host with the admin-controlled default call rates (App Config
  // → Calling System) instead of a hardcoded value, so newly-onboarded hosts
  // start at whatever standard rate the operator has configured.
  const defaultRates = await getDefaultCallRates(db);
  // Race fix: two concurrent become-host requests would both pass the
  // existing-host SELECT above and the second would crash on the PRIMARY
  // KEY collision (host_${sub} is unique on hosts.id). Catch the conflict
  // and return a clean 409 instead of bubbling a 500 to the client.
  try {
    await db.batch([
      db.prepare('INSERT INTO hosts (id, user_id, display_name, specialties, languages, audio_coins_per_minute, video_coins_per_minute, coins_per_minute) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(hostId, sub, name, JSON.stringify(specialties ?? []), JSON.stringify(languages ?? ['English']), defaultRates.audio, defaultRates.video, defaultRates.audio),
      db.prepare('UPDATE users SET role = ?, bio = ?, updated_at = unixepoch() WHERE id = ?')
        .bind('host', bio ?? '', sub),
    ]);
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint') || msg.includes('primary key')) {
      return c.json({ error: 'Already a host' }, 409);
    }
    console.error('[/become-host] insert failed:', e);
    return c.json({ error: 'Failed to create host profile' }, 500);
  }
  return c.json({ success: true, host_id: hostId }, 201);
});

// ─── User Blocking System ────────────────────────────────────────────────────
// Allows users to block other users. Blocked users cannot:
// - Call the blocker
// - Send chat messages to the blocker
// - Appear in the blocker's random match pool
// The block is one-directional: A blocks B means B cannot reach A, but A can
// still reach B (unless B also blocks A).

// GET /api/user/blocks — list all users blocked by the caller
user.get('/blocks', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  try {
    const result = await db.prepare(
      `SELECT ub.id, ub.blocked_id, ub.reason, ub.created_at,
              u.name, u.avatar_url
       FROM user_blocks ub
       JOIN users u ON u.id = ub.blocked_id
       WHERE ub.blocker_id = ?
       ORDER BY ub.created_at DESC`
    ).bind(sub).all();
    return c.json(result.results ?? []);
  } catch (e: any) {
    // Table may not exist yet (migration 0036 not applied)
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json([]);
    }
    throw e;
  }
});

// POST /api/user/blocks/:userId — block a user
user.post('/blocks/:userId', async (c) => {
  const { sub } = c.get('user');
  const { userId } = c.req.param();
  const db = c.env.DB;

  if (userId === sub) return c.json({ error: 'Cannot block yourself' }, 400);

  // Verify target user exists
  const target = await db.prepare('SELECT id, name FROM users WHERE id = ?').bind(userId).first<any>();
  if (!target) return c.json({ error: 'User not found' }, 404);

  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

  try {
    await db.prepare(
      'INSERT OR IGNORE INTO user_blocks (id, blocker_id, blocked_id, reason) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), sub, userId, reason).run();
  } catch (e: any) {
    // Table may not exist yet
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ error: 'Blocking feature not yet available. Please update the app.' }, 503);
    }
    // Already blocked (UNIQUE constraint) — idempotent success
    if (/unique|constraint/i.test(String(e?.message || ''))) {
      return c.json({ success: true, already_blocked: true });
    }
    throw e;
  }

  return c.json({ success: true, blocked_user: { id: target.id, name: target.name } });
});

// DELETE /api/user/blocks/:userId — unblock a user
user.delete('/blocks/:userId', async (c) => {
  const { sub } = c.get('user');
  const { userId } = c.req.param();
  const db = c.env.DB;

  try {
    await db.prepare(
      'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?'
    ).bind(sub, userId).run();
  } catch (e: any) {
    // Table may not exist yet
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ success: true });
    }
    throw e;
  }

  return c.json({ success: true });
});

// GET /api/user/blocks/check/:userId — check if a user is blocked (for UI)
user.get('/blocks/check/:userId', async (c) => {
  const { sub } = c.get('user');
  const { userId } = c.req.param();
  const db = c.env.DB;

  try {
    const row = await db.prepare(
      'SELECT 1 as ok FROM user_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1'
    ).bind(sub, userId).first<{ ok: number }>();
    return c.json({ blocked: !!row });
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ blocked: false });
    }
    throw e;
  }
});

// ─── Notification Preferences ────────────────────────────────────────────────
// Categories: 'calls', 'chat', 'marketing', 'streak', 'reengagement', 'system'
// Default is all enabled. Users can opt out of specific categories.
const NOTIFICATION_CATEGORIES = ['calls', 'chat', 'marketing', 'streak', 'reengagement', 'system'];

// GET /api/user/notification-preferences
user.get('/notification-preferences', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  // Build default preferences (all enabled)
  const prefs: Record<string, boolean> = {};
  for (const cat of NOTIFICATION_CATEGORIES) prefs[cat] = true;

  try {
    const result = await db.prepare(
      'SELECT category, enabled FROM notification_preferences WHERE user_id = ?'
    ).bind(sub).all<{ category: string; enabled: number }>();
    for (const row of (result.results ?? [])) {
      if (NOTIFICATION_CATEGORIES.includes(row.category)) {
        prefs[row.category] = row.enabled === 1;
      }
    }
  } catch (e: any) {
    // Table may not exist yet (migration 0037)
    if (!/no such table/i.test(String(e?.message || ''))) {
      console.warn('[notification-preferences] query failed:', e);
    }
  }

  return c.json({ preferences: prefs, categories: NOTIFICATION_CATEGORIES });
});

// PATCH /api/user/notification-preferences — update preferences
user.patch('/notification-preferences', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<Record<string, boolean>>().catch(() => ({}));

  const updates: { category: string; enabled: boolean }[] = [];
  for (const [cat, val] of Object.entries(body)) {
    if (NOTIFICATION_CATEGORIES.includes(cat) && typeof val === 'boolean') {
      updates.push({ category: cat, enabled: val });
    }
  }

  if (updates.length === 0) return c.json({ error: 'No valid preferences to update' }, 400);

  try {
    await db.batch(
      updates.map((u) =>
        db.prepare(
          `INSERT INTO notification_preferences (id, user_id, category, enabled, updated_at)
           VALUES (?, ?, ?, ?, unixepoch())
           ON CONFLICT(user_id, category)
           DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
        ).bind(crypto.randomUUID(), sub, u.category, u.enabled ? 1 : 0)
      )
    );
  } catch (e: any) {
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ error: 'Notification preferences not yet available. Please update.' }, 503);
    }
    throw e;
  }

  return c.json({ success: true });
});

export default user;
