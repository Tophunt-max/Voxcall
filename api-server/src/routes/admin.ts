import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sendFCMPush, getFCMTokens } from '../lib/fcm';
import { getLevelConfig, normalizeLevelConfig, getDefaultCallRates, MIN_LEVELS, MAX_LEVELS } from '../lib/levels';
import { recalcAllHostLevels } from '../lib/levelService';
import { approveDeposit, validatePromoInput } from './payment';
import { ensureAllMigrations, listMigrationStatus } from '../lib/autoMigrate';
import type { Env, JWTPayload } from '../types';

const admin = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
admin.use('*', authMiddleware, adminMiddleware);

// ─── Database migration diagnostics ───────────────────────────────────────
// The worker auto-applies any pending D1 migrations on cold start (see
// lib/autoMigrate.ts). These two endpoints let an operator confirm what's
// applied without shelling into Wrangler.

// GET /api/admin/db/migrations — read-only view of applied vs pending.
// Does NOT trigger application — that happens automatically on every /api/*
// request via middleware.
admin.get('/db/migrations', async (c) => {
  try {
    const status = await listMigrationStatus(c.env.DB);
    return c.json({
      total: status.total,
      applied_count: status.applied.length,
      pending_count: status.pending.length,
      applied: status.applied,
      pending: status.pending,
    });
  } catch (err) {
    console.error('[admin/db/migrations] read failed:', err);
    return c.json({ error: 'Failed to read migration state', detail: String((err as Error)?.message ?? err) }, 500);
  }
});

// POST /api/admin/db/migrations/apply — force a re-run of the auto-migrator
// against the LIVE D1 instance. Useful right after a deploy when the operator
// wants to confirm convergence without waiting for cold-start traffic. The
// runner is idempotent — already-applied migrations are skipped.
admin.post('/db/migrations/apply', async (c) => {
  try {
    const report = await ensureAllMigrations(c.env.DB);
    return c.json(report);
  } catch (err) {
    console.error('[admin/db/migrations/apply] failed:', err);
    return c.json({ error: 'Auto-migrate run failed', detail: String((err as Error)?.message ?? err) }, 500);
  }
});

// GET /api/admin/dashboard
admin.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const [users, hosts, calls, revenue] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM users WHERE role = "user"').first<any>(),
    db.prepare('SELECT COUNT(*) as count FROM hosts').first<any>(),
    db.prepare('SELECT COUNT(*) as count FROM call_sessions WHERE DATE(created_at, "unixepoch") = DATE("now")').first<any>(),
    db.prepare('SELECT SUM(coins_charged) as total FROM call_sessions WHERE status = "ended"').first<any>(),
  ]);
  return c.json({ total_users: users?.count, total_hosts: hosts?.count, calls_today: calls?.count, total_revenue_coins: revenue?.total });
});

// GET /api/admin/analytics — daily chart data (supports ?days=7 or ?days=30)
admin.get('/analytics', async (c) => {
  const dbA = c.env.DB;
  const daysParam = parseInt(c.req.query('days') || '7');
  const days = [7, 30].includes(daysParam) ? daysParam : 7;
  // Daily revenue + calls for requested range
  const callRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day,
           COUNT(*) as calls,
           COALESCE(SUM(coins_charged),0) as revenue
    FROM call_sessions
    WHERE created_at > unixepoch('now','-${days} days')
    GROUP BY day ORDER BY day ASC
  `).all<any>();
  // New users per day for requested range
  const userRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day, COUNT(*) as users
    FROM users
    WHERE created_at > unixepoch('now','-${days} days')
    GROUP BY day ORDER BY day ASC
  `).all<any>();
  // Role distribution
  const roles = await dbA.prepare(`
    SELECT role, COUNT(*) as cnt FROM users GROUP BY role
  `).all<any>();
  // Avg call duration
  const avg = await dbA.prepare(`
    SELECT COALESCE(AVG(duration_seconds),0) as avg_duration FROM call_sessions WHERE status='ended'
  `).first<any>();

  // Build a date range map (7 or 30 days)
  const dateRange: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    dateRange.push(dt.toISOString().slice(0, 10));
  }
  const callMap: Record<string, { calls: number; revenue: number }> = {};
  (callRows.results || []).forEach((r: any) => { callMap[r.day] = { calls: r.calls, revenue: r.revenue }; });
  const userMap: Record<string, number> = {};
  (userRows.results || []).forEach((r: any) => { userMap[r.day] = r.users; });

  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const weekly = dateRange.map(day => {
    const d = new Date(day);
    const label = days <= 7
      ? DAY_LABELS[d.getDay()]
      : `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
    return { day: label, date: day, revenue: callMap[day]?.revenue ?? 0, calls: callMap[day]?.calls ?? 0, users: userMap[day] ?? 0 };
  });

  const roleMap: Record<string, number> = {};
  (roles.results || []).forEach((r: any) => { roleMap[r.role] = r.cnt; });

  return c.json({
    weekly,
    role_distribution: [
      { name: 'Users', value: roleMap['user'] ?? 0 },
      { name: 'Hosts', value: roleMap['host'] ?? 0 },
      { name: 'Admins', value: roleMap['admin'] ?? 0 },
    ],
    avg_call_duration: Math.round(avg?.avg_duration ?? 0),
  });
});

// GET /api/admin/users
admin.get('/users', async (c) => {
  const { page = '1', limit = '20', search } = c.req.query();
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let q = 'SELECT id, name, email, phone, gender, avatar_url, role, coins, is_verified, status, referral_code, created_at FROM users';
  const params: any[] = [];
  if (search) { q += ' WHERE name LIKE ? OR email LIKE ?'; params.push(`%${search}%`, `%${search}%`); }
  q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  const result = await db(c).prepare(q).bind(...params).all();
  return c.json(result.results);
});

function db(c: any) { return c.env.DB as D1Database; }

// PATCH /api/admin/users/:id
admin.patch('/users/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { coins, role, is_verified, status } = body;
  const sets: string[] = []; const vals: any[] = [];
  // SECURITY FIX: Validate all fields against allowlists to prevent arbitrary values
  if (coins !== undefined) {
    const coinVal = parseInt(coins);
    if (isNaN(coinVal) || coinVal < 0) return c.json({ error: 'coins must be a non-negative integer' }, 400);
    sets.push('coins = ?'); vals.push(coinVal);
  }
  if (role !== undefined) {
    if (!['user', 'host', 'admin'].includes(role)) return c.json({ error: 'role must be user, host, or admin' }, 400);
    sets.push('role = ?'); vals.push(role);
  }
  if (is_verified !== undefined) { sets.push('is_verified = ?'); vals.push(is_verified ? 1 : 0); }
  if (status !== undefined) {
    if (!['active', 'banned', 'deleted'].includes(status)) return c.json({ error: 'status must be active, banned, or deleted' }, 400);
    sets.push('status = ?'); vals.push(status);
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  await db(c).prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  // Audit the semantic change (coins/role/ban) — the middleware only records the
  // request envelope; this captures the actual values for forensics/compliance.
  const changes: Record<string, any> = {};
  if (coins !== undefined) changes.coins = parseInt(coins);
  if (role !== undefined) changes.role = role;
  if (is_verified !== undefined) changes.is_verified = is_verified ? 1 : 0;
  if (status !== undefined) changes.status = status;
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'user', id, `User ${id} updated: ${JSON.stringify(changes)}`, c.req.header('CF-Connecting-IP') ?? '');
  return c.json({ success: true });
});

// GET /api/admin/hosts
admin.get('/hosts', async (c) => {
  const result = await db(c).prepare(
    `SELECT h.*, u.name, u.email, u.avatar_url,
      (SELECT COUNT(*) FROM call_sessions cs WHERE cs.host_id = h.id AND cs.status = 'ended') AS total_calls
    FROM hosts h JOIN users u ON u.id = h.user_id ORDER BY h.created_at DESC LIMIT 500`
  ).all();
  return c.json(result.results.map((h: any) => ({ ...h, specialties: JSON.parse(h.specialties || '[]'), languages: JSON.parse(h.languages || '[]') })));
});

// PATCH /api/admin/hosts/:id
admin.patch('/hosts/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const { is_active, is_top_rated, identity_verified, level, audio_coins_per_minute, video_coins_per_minute, coins_per_minute } = body;
  const sets: string[] = []; const vals: any[] = [];
  if (is_active !== undefined) { sets.push('is_active = ?'); vals.push(is_active); }
  if (is_top_rated !== undefined) { sets.push('is_top_rated = ?'); vals.push(is_top_rated); }
  if (identity_verified !== undefined) { sets.push('identity_verified = ?'); vals.push(identity_verified); }
  if (level !== undefined) {
    // Clamp the requested level against the configured ladder length so it
    // is always a valid rung. Falls back to MAX_LEVELS as the upper bound
    // if the config can't be loaded — that still keeps level <= 20 (the
    // schema-level cap) and avoids storing a level the host could never
    // legitimately reach.
    const cfg = await getLevelConfig(c.env.DB).catch(() => null);
    const upper = Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, cfg?.length ?? MAX_LEVELS));
    sets.push('level = ?');
    vals.push(Math.min(upper, Math.max(MIN_LEVELS, parseInt(level))));
  }
  if (audio_coins_per_minute !== undefined) { sets.push('audio_coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(audio_coins_per_minute)))); }
  if (video_coins_per_minute !== undefined) { sets.push('video_coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(video_coins_per_minute)))); }
  if (coins_per_minute !== undefined) { sets.push('coins_per_minute = ?'); vals.push(Math.min(500, Math.max(1, parseInt(coins_per_minute)))); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  await db(c).prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  // Audit the semantic change (rates / verification / active status are
  // trust- and money-sensitive) with the actual values.
  const hChanges: Record<string, any> = {};
  for (const [k, v] of Object.entries({ is_active, is_top_rated, identity_verified, level, audio_coins_per_minute, video_coins_per_minute, coins_per_minute })) {
    if (v !== undefined) hChanges[k] = v;
  }
  const hu = c.get('user');
  await auditLog(db(c), hu.sub, hu.email || 'Admin', hu.email || '', 'update', 'host', id, `Host ${id} updated: ${JSON.stringify(hChanges)}`, c.req.header('CF-Connecting-IP') ?? '');
  return c.json({ success: true });
});

// POST /api/admin/hosts/:id/level — manually set host level
admin.post('/hosts/:id/level', async (c) => {
  const { id } = c.req.param();
  const { level } = await c.req.json<{ level: number }>();
  // Clamp against the live ladder length — admins shouldn't be able to set a
  // level higher than any rung that actually exists. Best-effort: if the
  // config can't be loaded we fall back to the schema-level MAX_LEVELS cap.
  const cfg = await getLevelConfig(db(c)).catch(() => null);
  const upper = Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, cfg?.length ?? MAX_LEVELS));
  const lvl = Math.min(upper, Math.max(MIN_LEVELS, parseInt(String(level))));
  await db(c).prepare('UPDATE hosts SET level = ?, updated_at = unixepoch() WHERE id = ?').bind(lvl, id).run();
  const lu = c.get('user');
  await auditLog(db(c), lu.sub, lu.email || 'Admin', lu.email || '', 'update', 'host', id, `Host ${id} level set to ${lvl}`, c.req.header('CF-Connecting-IP') ?? '');
  return c.json({ success: true, level: lvl });
});

// DEFAULT level config + getLevelConfig live in ../lib/levels (single source of
// truth, shared with the host-facing /api/host/level endpoint).

// GET /api/admin/level-config
admin.get('/level-config', async (c) => {
  const config = await getLevelConfig(db(c));
  return c.json(config);
});

// PUT /api/admin/level-config
admin.put('/level-config', async (c) => {
  const body = await c.req.json<unknown>();
  // Accept any ladder of MIN_LEVELS..MAX_LEVELS rungs. Any other shape is
  // either a client bug (e.g. empty array, or > MAX_LEVELS) or the legacy
  // "missing" case that should fall back to defaults — both are explicit
  // 400s so the admin panel can surface a real error instead of silently
  // overwriting their config with the seed.
  if (!Array.isArray(body) || body.length < MIN_LEVELS || body.length > MAX_LEVELS) {
    return c.json(
      { error: `Invalid config: must be an array of ${MIN_LEVELS}–${MAX_LEVELS} levels` },
      400,
    );
  }
  const normalized = normalizeLevelConfig(body);
  await db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('level_config', ?, unixepoch())")
    .bind(JSON.stringify(normalized)).run();
  return c.json({ success: true, config: normalized });
});

// POST /api/admin/hosts/recalculate-levels — recalculate all host levels using
// the configured ladder. Uses the SAME engine as the live path so promotions
// also grant the one-time coin reward, write the audit history, and notify the
// host (in-app + push + real-time). Promotion-only (never demotes).
admin.post('/hosts/recalculate-levels', async (c) => {
  const config = await getLevelConfig(db(c));
  const result = await recalcAllHostLevels(c.env, 'admin');
  return c.json({ success: true, config, ...result });
});

// GET /api/admin/withdrawals
admin.get('/withdrawals', async (c) => {
  const result = await db(c).prepare(
    `SELECT wr.*, h.display_name, u.name, u.email FROM withdrawal_requests wr
     JOIN hosts h ON h.id = wr.host_id JOIN users u ON u.id = h.user_id
     ORDER BY wr.created_at DESC LIMIT 500`
  ).all();
  return c.json(result.results);
});

// PATCH /api/admin/withdrawals/:id
admin.patch('/withdrawals/:id', async (c) => {
  const { id } = c.req.param();
  const { status, admin_note } = await c.req.json();
  const d = db(c);

  // Bug fix: when rejecting a withdrawal, refund the coins to the host's balance
  if (status === 'rejected') {
    const wr = await d.prepare('SELECT wr.coins, wr.status, h.user_id FROM withdrawal_requests wr JOIN hosts h ON h.id = wr.host_id WHERE wr.id = ?').bind(id).first<any>();
    if (!wr) return c.json({ error: 'Withdrawal request not found' }, 404);
    if (wr.status !== 'pending' && wr.status !== 'approved') {
      return c.json({ error: `Cannot reject a ${wr.status} withdrawal` }, 400);
    }
    // RACE CONDITION FIX: Use atomic guard to prevent double-refund on concurrent rejection
    const guardResult = await d.prepare(
      "UPDATE withdrawal_requests SET status = ?, admin_note = ?, updated_at = unixepoch() WHERE id = ? AND status IN ('pending', 'approved')"
    ).bind(status, admin_note ?? null, id).run();
    if (!guardResult.meta?.changes) return c.json({ error: 'Already processed' }, 409);

    await d.batch([
      d.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(wr.coins, wr.user_id),
      d.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID(), wr.user_id, 'refund', wr.coins, `Withdrawal rejected by admin — ${wr.coins} coins refunded`, id
      ),
    ]);
    const ru = c.get('user');
    await auditLog(d, ru.sub, ru.email || 'Admin', ru.email || '', 'update', 'withdrawal', id, `Withdrawal ${id} rejected — ${wr.coins} coins refunded${admin_note ? ` (note: ${admin_note})` : ''}`, c.req.header('CF-Connecting-IP') ?? '');
    return c.json({ success: true, refunded_coins: wr.coins });
  }

  // FIX: Validate status for non-rejection updates
  if (!['approved', 'completed', 'paid'].includes(status)) {
    return c.json({ error: 'Invalid status. Must be approved, completed, paid, or rejected' }, 400);
  }
  // FIX #12: Marking a withdrawal as paid/completed without any reference is a
  // workflow gap — admins could "pay" without proof. Require admin_note (e.g. a
  // bank/UPI transaction reference). Also tighten the WHERE clause so we never
  // overwrite a withdrawal that is already in a terminal state.
  if ((status === 'paid' || status === 'completed') && (!admin_note || !String(admin_note).trim())) {
    return c.json({ error: 'admin_note (e.g. transaction reference) is required when marking withdrawal as paid/completed' }, 400);
  }
  await d.prepare(
    "UPDATE withdrawal_requests SET status = ?, admin_note = ?, updated_at = unixepoch() WHERE id = ? AND status NOT IN ('paid', 'completed', 'rejected')"
  ).bind(status, admin_note ?? null, id).run();
  const pu = c.get('user');
  await auditLog(d, pu.sub, pu.email || 'Admin', pu.email || '', 'update', 'withdrawal', id, `Withdrawal ${id} marked ${status}${admin_note ? ` (ref: ${admin_note})` : ''}`, c.req.header('CF-Connecting-IP') ?? '');
  return c.json({ success: true });
});

// GET/POST/PATCH /api/admin/coin-plans
admin.get('/coin-plans', async (c) => {
  const result = await db(c).prepare('SELECT * FROM coin_plans ORDER BY coins ASC').all();
  return c.json(result.results);
});
admin.post('/coin-plans', async (c) => {
  const { name, coins, price, bonus_coins, is_popular, currency } = await c.req.json();
  const id = crypto.randomUUID();
  // Coin plan prices are authored in the admin panel in INR (the field is
  // labelled "Price (INR ₹)"). Persist the currency so /api/coins/plans
  // converts from the RIGHT base — defaulting to 'INR' for new plans created
  // here (legacy seeded plans keep their own 'USD'/'INR' value).
  await db(c).prepare('INSERT INTO coin_plans (id, name, coins, price, currency, bonus_coins, is_popular) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, name, coins, price, (currency || 'INR').toUpperCase(), bonus_coins ?? 0, is_popular ?? 0).run();
  return c.json({ id, success: true }, 201);
});
admin.patch('/coin-plans/:id', async (c) => {
  const { id } = c.req.param();
  const { name, coins, price, bonus_coins, is_popular, is_active, currency } = await c.req.json();
  const sets: string[] = []; const vals: any[] = [];
  const normalizedCurrency = currency !== undefined ? String(currency).toUpperCase() : undefined;
  const fields = { name, coins, price, currency: normalizedCurrency, bonus_coins, is_popular, is_active };
  for (const [k, v] of Object.entries(fields)) { if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); } }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);
  await db(c).prepare(`UPDATE coin_plans SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/coin-plans/:id', async (c) => {
  const { id } = c.req.param();
  const existing = await db(c).prepare('SELECT id, is_active FROM coin_plans WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Plan not found' }, 404);
  if (existing.is_active) {
    const activeCount = await db(c).prepare('SELECT COUNT(*) as cnt FROM coin_plans WHERE is_active = 1').first<{cnt: number}>();
    if (activeCount && activeCount.cnt <= 1) return c.json({ error: 'Cannot delete the last active plan' }, 409);
  }
  await db(c).prepare('DELETE FROM coin_plans WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET/PATCH app settings
admin.get('/settings', async (c) => {
  const result = await db(c).prepare('SELECT * FROM app_settings').all();
  const obj: any = {};
  result.results.forEach((r: any) => { obj[r.key] = r.value; });
  
  // MULTI-CURRENCY: Add coin_value_inr for admin panel
  // Convert stored coin_to_usd_rate to INR for display using LIVE rates
  if (obj.coin_to_usd_rate) {
    const usdRate = parseFloat(obj.coin_to_usd_rate);
    // Get live INR rate from cron-refreshed fx_rates_usd
    let inrRate = 83; // fallback
    if (obj.fx_rates_usd) {
      try {
        const rates = JSON.parse(obj.fx_rates_usd);
        inrRate = rates.INR || 83;
      } catch {}
    }
    obj.coin_value_inr = (usdRate * inrRate).toFixed(6);
    obj.inr_to_usd_rate = inrRate;
    obj.fx_rates_last_updated = obj.fx_rates_updated || null;
  }
  
  return c.json(obj);
});
admin.patch('/settings', async (c) => {
  const body = await c.req.json();
  
  // MULTI-CURRENCY SUPPORT: Admin sets coin value in INR, we convert to USD
  // This makes it natural for Indian admins: 1 coin = ₹0.05
  // Backend stores coin_to_usd_rate for consistency
  let processedBody = { ...body };
  
  // If admin sends coin_value_inr, convert to coin_to_usd_rate
  if (body.coin_value_inr !== undefined) {
    const inrValue = parseFloat(body.coin_value_inr);
    if (!isNaN(inrValue) && inrValue > 0) {
      // Get live INR to USD rate from fx_rates_usd or use default
      const fxRow = await db(c).prepare(
        "SELECT value FROM app_settings WHERE key = 'fx_rates_usd'"
      ).first<{ value: string }>();
      
      let inrRate = 83; // Default INR per USD
      if (fxRow?.value) {
        try {
          const rates = JSON.parse(fxRow.value);
          inrRate = rates.INR || 83;
        } catch {}
      }
      
      // Convert: INR value → USD value
      // If 1 coin = ₹0.05 and $1 = ₹83, then 1 coin = $0.0006
      const usdValue = inrValue / inrRate;
      processedBody.coin_to_usd_rate = usdValue;
      delete processedBody.coin_value_inr;
    }
  }
  
  // SECURITY FIX: Only allow known setting keys to prevent arbitrary key injection
  const ALLOWED_SETTINGS = [
    'min_coins_for_call', 'coin_to_usd_rate', 'host_revenue_share',
    'min_withdrawal_coins', 'auto_approve_manual', 'auto_approve_manual_max_amount',
    'maintenance_mode', 'maintenance_message', 'app_name', 'support_email',
    'terms_url', 'privacy_url', 'razorpay_webhook_secret', 'stripe_webhook_secret',
    'generic_webhook_secret', 'referrer_reward', 'new_user_reward',
    'min_calls_to_unlock', 'referral_active', 'free_chat_messages',
    'app_min_version_user', 'app_min_version_host',
    'app_latest_version_user', 'app_latest_version_host',
    'app_download_url_user', 'app_download_url_host',
    'app_update_block_message', 'app_update_recommend_message',
    'app_version',
    'random_call_audio_rate', 'random_call_video_rate',
    'random_calls_per_day_limit',
    'random_decline_cooldown_count', 'random_decline_cooldown_min',
    'random_match_repeat_block_min',
    'daily_streak_enabled', 'daily_streak_schedule', 'daily_streak_milestones',
    'first_call_free_minutes',
    'default_audio_rate', 'default_video_rate',
    'billing_granularity_sec', 'low_balance_warn_seconds',
    'reco_enabled', 'reco_weights',
    'reengagement_enabled', 'reengagement_idle_days', 'reengagement_winback_days',
    'reengagement_cooldown_days', 'reengagement_max_per_run',
    'reengagement_max_idle_days', 'reengagement_interval_hours',
    'match_weighting_enabled', 'match_weights',
    'daily_streak_variable_enabled', 'daily_streak_variable_table',
  ];
  const stmts = Object.entries(processedBody)
    .filter(([k]) => ALLOWED_SETTINGS.includes(k))
    .map(([k, v]) =>
      db(c).prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())').bind(k, String(v))
    );
  if (!stmts.length) return c.json({ error: 'No valid settings to update' }, 400);
  await db(c).batch(stmts);
  
  // REAL-TIME UPDATE: Broadcast settings change to ALL connected users via WebSocket
  // This enables live updates in ALL apps (user app, host app, admin panel) without page refresh
  // When coin_to_usd_rate changes, every user sees the new coin value immediately
  const changedKeys = Object.keys(body).filter(k => ALLOWED_SETTINGS.includes(k));
  
  // Check if coin value changed - this is critical for real-time updates
  const coinValueChanged = changedKeys.includes('coin_to_usd_rate');
  const callRatesChanged = changedKeys.includes('default_audio_rate') || 
                           changedKeys.includes('default_video_rate') ||
                           changedKeys.includes('random_call_audio_rate') ||
                           changedKeys.includes('random_call_video_rate');
  
  // Get the updated settings values for broadcast
  const updatedSettings: Record<string, string> = {};
  for (const key of changedKeys) {
    if (body[key] !== undefined) {
      updatedSettings[key] = String(body[key]);
    }
  }
  
  // Broadcast to ALL users (not just admins) for coin value and rate changes
  // This ensures real-time updates in user/host apps
  if (coinValueChanged || callRatesChanged) {
    const allUsers = await db(c).prepare(
      "SELECT id FROM users WHERE status != 'deleted' LIMIT 10000"
    ).all<{ id: string }>();
    
    if (allUsers.results && allUsers.results.length > 0) {
      const settingsUpdateMsg = JSON.stringify({
        type: 'app_settings_update',
        settings: updatedSettings,
        critical: coinValueChanged, // Flag for apps to show notification
        timestamp: Date.now(),
        updated_by: c.get('user')?.email || 'Admin'
      });
      
      // Batch broadcast in chunks of 50 to avoid overwhelming the system
      const CHUNK_SIZE = 50;
      for (let i = 0; i < allUsers.results.length; i += CHUNK_SIZE) {
        const chunk = allUsers.results.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(
          chunk.map(async (user) => {
            try {
              const notifStub = c.env.NOTIFICATION_HUB.get(
                c.env.NOTIFICATION_HUB.idFromName(user.id)
              );
              await notifStub.fetch('https://dummy/notify', {
                method: 'POST',
                body: settingsUpdateMsg
              });
            } catch {}
          })
        );
      }
    }
  } else {
    // For non-critical settings, only notify admins
    const adminUsers = await db(c).prepare(
      "SELECT id FROM users WHERE role = 'admin'"
    ).all<{ id: string }>();
    
    if (adminUsers.results && adminUsers.results.length > 0) {
      const settingsUpdateMsg = JSON.stringify({
        type: 'settings_update',
        settings: updatedSettings,
        keys: changedKeys,
        timestamp: Date.now(),
        updated_by: c.get('user')?.email || 'Admin'
      });
      
      await Promise.allSettled(
        adminUsers.results.map(async (admin) => {
          try {
            const notifStub = c.env.NOTIFICATION_HUB.get(
              c.env.NOTIFICATION_HUB.idFromName(admin.id)
            );
            await notifStub.fetch('https://dummy/notify', {
              method: 'POST',
              body: settingsUpdateMsg
            });
          } catch {}
        })
      );
    }
  }
  
  return c.json({ success: true, updated_keys: changedKeys, realtime_broadcast: coinValueChanged || callRatesChanged });
});

// Talk Topics CRUD
admin.get('/talk-topics', async (c) => {
  const result = await db(c).prepare('SELECT * FROM talk_topics ORDER BY name ASC').all();
  return c.json(result.results);
});
admin.post('/talk-topics', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare('INSERT INTO talk_topics (id, name, icon, is_active) VALUES (?, ?, ?, 1)')
    .bind(id, body.name, body.icon || '💬').run();
  return c.json({ id, ...body });
});
admin.patch('/talk-topics/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const ALLOWED_KEYS = new Set(['name', 'icon', 'is_active']);
  const safe = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k)));
  if (Object.keys(safe).length === 0) return c.json({ error: 'No valid fields to update' }, 400);
  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  await db(c).prepare(`UPDATE talk_topics SET ${fields} WHERE id = ?`).bind(...Object.values(safe), id).run();
  return c.json({ success: true });
});
admin.delete('/talk-topics/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM talk_topics WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// Coin transactions
admin.get('/coin-transactions', async (c) => {
  const result = await db(c).prepare(`
    SELECT ct.*, u.name as user_name, u.email as user_email
    FROM coin_transactions ct
    LEFT JOIN users u ON ct.user_id = u.id
    ORDER BY ct.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

// Ratings
admin.get('/ratings', async (c) => {
  const result = await db(c).prepare(`
    SELECT r.*, u.name as user_name, h.display_name as host_display_name
    FROM ratings r
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN hosts h ON r.host_id = h.id
    ORDER BY r.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

// Notifications: list + send
admin.get('/notifications', async (c) => {
  const result = await db(c).prepare(`
    SELECT n.*, u.name as user_name, u.email as user_email
    FROM notifications n
    LEFT JOIN users u ON n.user_id = u.id
    ORDER BY n.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});
admin.post('/notifications/send', async (c) => {
  const body = await c.req.json() as any;
  const { title, body: msgBody, type = 'system', target, userId } = body;
  // FIX #30: Validate title/body length to prevent DB bloat and broken push payloads.
  if (typeof title !== 'string' || title.length === 0 || title.length > 100) {
    return c.json({ error: 'title must be 1-100 chars' }, 400);
  }
  if (typeof msgBody !== 'string' || msgBody.length === 0 || msgBody.length > 500) {
    return c.json({ error: 'body must be 1-500 chars' }, 400);
  }
  const now = Math.floor(Date.now() / 1000);
  let targetUsers: any[] = [];
  if (target === 'all') {
    const r = await db(c).prepare('SELECT id FROM users').all();
    targetUsers = r.results;
  } else if (target === 'hosts') {
    const r = await db(c).prepare('SELECT u.id FROM users u INNER JOIN hosts h ON h.user_id = u.id').all();
    targetUsers = r.results;
  } else if (target === 'user' && userId) {
    targetUsers = [{ id: userId }];
  }
  if (targetUsers.length === 0) return c.json({ sent: 0 });

  // Save to D1 notifications table in chunks of 90 (D1 batch limit is 100)
  const DB_BATCH_SIZE = 90;
  for (let i = 0; i < targetUsers.length; i += DB_BATCH_SIZE) {
    const chunk = targetUsers.slice(i, i + DB_BATCH_SIZE);
    const stmts = chunk.map((u: any) => {
      const id = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      return db(c).prepare('INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, u.id, type, title, msgBody, now);
    });
    await db(c).batch(stmts);
  }

  // Send actual Expo Push Notifications in batches of 100
  try {
    const userIds = targetUsers.map((u: any) => u.id);
    const batchSize = 100;
    let totalPushed = 0;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const tokens = await getFCMTokens(db(c), batch);
      if (tokens.length > 0) {
        const result = await sendFCMPush(c.env.FIREBASE_SERVICE_ACCOUNT, tokens, title, msgBody, { type, notif_type: type });
        totalPushed += result.sent;
      }
    }
    return c.json({ sent: targetUsers.length, pushed: totalPushed });
  } catch (err) {
    console.error('[Push] admin send error:', err);
    return c.json({ sent: targetUsers.length, pushed: 0 });
  }
});

// Call sessions
admin.get('/calls', async (c) => {
  const result = await db(c).prepare(`
    SELECT cs.*, 
      u.name as caller_name, u.email as caller_email,
      h.display_name as host_display_name
    FROM call_sessions cs
    LEFT JOIN users u ON cs.caller_id = u.id
    LEFT JOIN hosts h ON cs.host_id = h.id
    ORDER BY cs.created_at DESC LIMIT 200
  `).all();
  return c.json(result.results);
});

// FAQs CRUD
admin.get('/faqs', async (c) => {
  const result = await db(c).prepare('SELECT * FROM faqs ORDER BY order_index ASC, created_at ASC').all();
  return c.json(result.results);
});
admin.post('/faqs', async (c) => {
  const body = await c.req.json() as any;
  const id = 'faq-' + Date.now();
  await db(c).prepare(
    'INSERT INTO faqs (id, question, answer, order_index, is_active) VALUES (?, ?, ?, ?, 1)'
  ).bind(id, body.question, body.answer, body.order_index || 0).run();
  return c.json({ id, ...body });
});
admin.patch('/faqs/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const ALLOWED_KEYS = new Set(['question', 'answer', 'order_index', 'is_active']);
  const safe = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k)));
  if (Object.keys(safe).length === 0) return c.json({ error: 'No valid fields to update' }, 400);
  const fields = Object.keys(safe).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(safe), id];
  await db(c).prepare(`UPDATE faqs SET ${fields}, updated_at = unixepoch() WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/faqs/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM faqs WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Host KYC Applications ───────────────────────────────────────────────────

// GET /api/admin/host-applications — list all applications
admin.get('/host-applications', async (c) => {
  const { status } = c.req.query();
  let q = `SELECT ha.*, u.email, u.avatar_url FROM host_applications ha
            JOIN users u ON u.id = ha.user_id`;
  const params: any[] = [];
  if (status) { q += ' WHERE ha.status = ?'; params.push(status); }
  q += ' ORDER BY ha.submitted_at DESC';
  const result = await db(c).prepare(q).bind(...params).all<any>();
  return c.json(result.results.map(r => ({
    ...r,
    specialties: JSON.parse(r.specialties || '[]'),
    languages: JSON.parse(r.languages || '[]'),
  })));
});

// GET /api/admin/host-applications/:id — single application detail
admin.get('/host-applications/:id', async (c) => {
  const { id } = c.req.param();
  const app = await db(c)
    .prepare(`SELECT ha.*, u.email, u.name as user_name, u.avatar_url
              FROM host_applications ha JOIN users u ON u.id = ha.user_id
              WHERE ha.id = ?`)
    .bind(id).first<any>();
  if (!app) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ...app,
    specialties: JSON.parse(app.specialties || '[]'),
    languages: JSON.parse(app.languages || '[]'),
  });
});

// PATCH /api/admin/host-applications/:id/review — approve or reject
admin.patch('/host-applications/:id/review', async (c) => {
  const { id } = c.req.param();
  const { action, rejection_reason } = await c.req.json<{ action: 'approve' | 'reject'; rejection_reason?: string }>();
  const { sub } = c.get('user');
  const d = db(c);

  if (!['approve', 'reject'].includes(action)) {
    return c.json({ error: 'action must be approve or reject' }, 400);
  }

  const app = await d.prepare('SELECT * FROM host_applications WHERE id = ?').bind(id).first<any>();
  if (!app) return c.json({ error: 'Application not found' }, 404);

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await d.prepare(
    `UPDATE host_applications SET status=?, rejection_reason=?, reviewed_by=?, reviewed_at=unixepoch(), updated_at=unixepoch() WHERE id=?`
  ).bind(newStatus, rejection_reason ?? null, sub, id).run();

  if (action === 'approve') {
    // Create host record + update user role
    const hostId = `host_${app.user_id}`;
    const existing = await d.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(app.user_id).first();
    if (!existing) {
      // Fall back to the admin-controlled default call rates (App Config →
      // Calling System) when the application itself didn't specify a rate.
      const defaultRates = await getDefaultCallRates(d);
      await d.batch([
        d.prepare(
          `INSERT INTO hosts (id, user_id, display_name, specialties, languages, audio_coins_per_minute, video_coins_per_minute, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        ).bind(hostId, app.user_id, app.display_name, app.specialties, app.languages, app.audio_rate ?? defaultRates.audio, app.video_rate ?? defaultRates.video),
        d.prepare(`UPDATE users SET role='host', phone=COALESCE(phone,?), updated_at=unixepoch() WHERE id=?`)
          .bind(app.phone ?? null, app.user_id),
      ]);
    } else {
      await d.prepare(`UPDATE hosts SET display_name=?, specialties=?, is_active=1 WHERE user_id=?`)
        .bind(app.display_name, app.specialties, app.user_id).run();
      await d.prepare(`UPDATE users SET role='host', updated_at=unixepoch() WHERE id=?`).bind(app.user_id).run();
    }
  }

  return c.json({ success: true, status: newStatus });
});


// ─── Helper: log admin action ─────────────────────────────────────────────────
async function auditLog(d: D1Database, adminId: string, adminName: string, adminEmail: string, action: string, targetType: string, target: string, detail: string, ip = '') {
  const id = crypto.randomUUID();
  await d.prepare(
    'INSERT INTO audit_logs (id, admin_id, admin_name, admin_email, action, target_type, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, adminId, adminName, adminEmail, action, targetType, target, detail, ip).run().catch((err: any) => {
    console.error('[AuditLog] Failed to write audit log:', err?.message ?? err);
  });
}

// ─── Payouts (alias for withdrawals with enriched field names) ────────────────
admin.get('/payouts', async (c) => {
  const result = await db(c).prepare(`
    SELECT wr.id, wr.coins as coins_earned, wr.amount as inr_amount, wr.status,
      wr.payment_method as bank, wr.admin_note, wr.created_at as requested_at,
      strftime('%B %Y', datetime(wr.created_at, 'unixepoch')) as period,
      h.display_name as host_name, u.name, u.email as host_email
    FROM withdrawal_requests wr
    JOIN hosts h ON h.id = wr.host_id JOIN users u ON u.id = h.user_id
    ORDER BY wr.created_at DESC
  `).all();
  return c.json(result.results);
});

// ─── Deposits (Coin Purchases) ────────────────────────────────────────────────
admin.get('/deposits', async (c) => {
  const result = await db(c).prepare(`
    SELECT cp.*, u.name as user_name, u.email as user_email, u.phone as user_phone
    FROM coin_purchases cp
    LEFT JOIN users u ON u.id = cp.user_id
    ORDER BY cp.created_at DESC LIMIT 500
  `).all();
  return c.json(result.results);
});

admin.patch('/deposits/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  if (body.status === 'success') {
    // FIX #2: delegate to the shared approveDeposit chokepoint so manual admin
    // approvals get the SAME idempotent CAS + promo max_uses enforcement as the
    // gateway webhooks (previously this path credited coins inline and ignored
    // promo usage limits entirely).
    const exists = await db(c).prepare('SELECT id FROM coin_purchases WHERE id = ?').bind(id).first<any>();
    if (!exists) return c.json({ error: 'Deposit not found' }, 404);
    const result = await approveDeposit(db(c), id, 'manual-admin', 'Deposit approved by admin');
    if (result.already) return c.json({ error: 'Deposit already marked as success' }, 400);
    // Persist the admin note if one was supplied (approveDeposit doesn't touch it).
    if (body.admin_note !== undefined) {
      await db(c).prepare('UPDATE coin_purchases SET admin_note = ?, updated_at = unixepoch() WHERE id = ?').bind(body.admin_note ?? null, id).run();
    }
    const u = c.get('user');
    await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'deposit', id, `Deposit ${id} approved`);
    return c.json({ success: true, coins: result.coins });
  }

  const sets: string[] = [];
  const vals: any[] = [];
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status); }
  if (body.admin_note !== undefined) { sets.push('admin_note = ?'); vals.push(body.admin_note); }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  if (body.status === 'refunded') {
    const purchase = await db(c).prepare('SELECT user_id, coins, bonus_coins, status FROM coin_purchases WHERE id = ?').bind(id).first<any>();
    if (!purchase) return c.json({ error: 'Deposit not found' }, 404);
    if (purchase.status === 'refunded') return c.json({ error: 'Deposit already refunded' }, 400);
    if (purchase.status !== 'success') return c.json({ error: 'Only successful deposits can be refunded' }, 400);
    const totalRefund = (purchase.coins || 0) + (purchase.bonus_coins || 0);
    // FIX #11: Clamp the refund deduction at 0 so a user who already spent
    // the credited coins doesn't end up with a negative balance. Record the
    // ledger entry as a `refund` (not `spend`) with a negative amount, matching
    // the convention used by withdrawal refunds elsewhere in this file.
    await db(c).batch([
      db(c).prepare(`UPDATE coin_purchases SET ${sets.join(', ')} WHERE id = ?`).bind(...vals),
      db(c).prepare('UPDATE users SET coins = MAX(0, coins - ?), updated_at = unixepoch() WHERE id = ?').bind(totalRefund, purchase.user_id),
      db(c).prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID(), purchase.user_id, 'refund', -totalRefund, `Deposit refunded by admin (coins reversed)`, id
      ),
    ]);
  } else {
    await db(c).prepare(`UPDATE coin_purchases SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  }
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'deposit', id, `Deposit ${id} updated: ${JSON.stringify(body)}`);
  return c.json({ success: true });
});

// ─── Promo Codes CRUD ─────────────────────────────────────────────────────────
admin.get('/promo-codes', async (c) => {
  const result = await db(c).prepare('SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT 500').all();
  return c.json(result.results);
});
admin.post('/promo-codes', async (c) => {
  const body = await c.req.json() as any;
  // FIX: validate before persisting — an unvalidated promo (e.g. discount_pct:500
  // or bonus_coins:-100) flows straight into the coin-credit money path.
  const v = validatePromoInput(body, { create: true });
  if (!v.ok) return c.json({ error: v.error }, 400);
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO promo_codes (id, code, type, discount_pct, bonus_coins, max_uses, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, String(body.code).toUpperCase(), body.type || 'percent', body.discount_pct || 0, body.bonus_coins || 0, body.max_uses || 100, body.expires_at || null, body.active !== false ? 1 : 0).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'create', 'promo_code', body.code, `Promo code created: ${body.code}`);
  return c.json({ id, success: true }, 201);
});
admin.patch('/promo-codes/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  // FIX: range-check any provided fields so an edit can't introduce invalid
  // values (negative bonus, >100% discount, non-positive max_uses, etc.).
  const v = validatePromoInput(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const fields = ['code', 'type', 'discount_pct', 'bonus_coins', 'max_uses', 'expires_at', 'active'];
  const sets: string[] = []; const vals: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(f === 'code' ? String(body[f]).toUpperCase() : body[f]); }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE promo_codes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/promo-codes/:id', async (c) => {
  const { id } = c.req.param();
  const row = await db(c).prepare('SELECT code FROM promo_codes WHERE id = ?').bind(id).first<any>();
  await db(c).prepare('DELETE FROM promo_codes WHERE id = ?').bind(id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'delete', 'promo_code', row?.code || id, `Promo code deleted`);
  return c.json({ success: true });
});

// ─── Support Tickets ──────────────────────────────────────────────────────────
admin.get('/support-tickets', async (c) => {
  const result = await db(c).prepare(
    `SELECT st.*,
       u.name as user_display_name, u.email as user_display_email, u.avatar_url as user_avatar
     FROM support_tickets st
     LEFT JOIN users u ON u.id = st.user_id
     ORDER BY st.created_at DESC`
  ).all();
  return c.json((result.results || []).map((t: any) => ({
    ...t,
    user_name: t.user_display_name || t.user_name || 'Unknown',
    user_email: t.user_display_email || t.user_email || '',
    messages: JSON.parse(t.messages || '[]'),
  })));
});
admin.patch('/support-tickets/:id', async (c) => {
  const { id } = c.req.param();
  const { status, priority } = await c.req.json() as any;
  const sets: string[] = []; const vals: any[] = [];
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (priority !== undefined) { sets.push('priority = ?'); vals.push(priority); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.post('/support-tickets/:id/reply', async (c) => {
  const { id } = c.req.param();
  const { text } = await c.req.json() as any;
  const ticket = await db(c).prepare('SELECT messages FROM support_tickets WHERE id = ?').bind(id).first<any>();
  if (!ticket) return c.json({ error: 'Not found' }, 404);
  const messages = JSON.parse(ticket.messages || '[]');
  messages.push({ from: 'admin', text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  await db(c).prepare('UPDATE support_tickets SET messages = ?, status = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(JSON.stringify(messages), 'in_progress', id).run();
  return c.json({ success: true, messages });
});

// ─── Content Reports ──────────────────────────────────────────────────────────
admin.get('/content-reports', async (c) => {
  const result = await db(c).prepare(
    `SELECT cr.*, 
      ru.name as reported_user_name, ru.phone as reported_user_phone, ru.email as reported_user_email, ru.avatar_url as reported_user_avatar,
      rp.name as reporter_display_name, rp.phone as reporter_phone, rp.email as reporter_email
     FROM content_reports cr
     LEFT JOIN users ru ON cr.reported_user_id = ru.id
     LEFT JOIN users rp ON cr.reporter_id = rp.id
     ORDER BY cr.created_at DESC`
  ).all();
  return c.json(result.results);
});
admin.get('/content-reports/stats', async (c) => {
  const stats = await db(c).prepare(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN status = 'actioned' THEN 1 ELSE 0 END) as actioned,
      SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
      SUM(CASE WHEN created_at > unixepoch() - 86400 THEN 1 ELSE 0 END) as last_24h
     FROM content_reports`
  ).first<any>();
  return c.json(stats);
});
admin.patch('/content-reports/:id', async (c) => {
  const { id } = c.req.param();
  const { status, action_taken } = await c.req.json() as any;
  const d = db(c);
  const report = await d.prepare('SELECT * FROM content_reports WHERE id = ?').bind(id).first<any>();
  if (!report) return c.json({ error: 'Report not found' }, 404);
  await d.prepare('UPDATE content_reports SET status = ?, action_taken = ?, updated_at = unixepoch() WHERE id = ?')
    .bind(status, action_taken ?? null, id).run();
  const u = c.get('user');
  if (report.reported_user_id && action_taken && action_taken !== 'dismiss') {
    const target = await d.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(report.reported_user_id).first<any>();
    if (target) {
      if (action_taken === 'banned') {
        const banId = crypto.randomUUID();
        await d.prepare(
          'INSERT OR IGNORE INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, banned_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(banId, target.id, target.name || '', target.email || '', report.reported_type || 'user', `Report: ${report.reason}`, 'permanent', u.email || 'Admin').run();
        await d.prepare('UPDATE users SET status = ? WHERE id = ?').bind('banned', target.id).run();
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'ban', 'user', target.name || target.id, `Banned via report: ${report.reason}`);
      } else if (action_taken === 'suspended_7d') {
        const banId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
        await d.prepare(
          'INSERT OR IGNORE INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, banned_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(banId, target.id, target.name || '', target.email || '', report.reported_type || 'user', `Report: ${report.reason}`, 'temporary', u.email || 'Admin', expiresAt).run();
        await d.prepare('UPDATE users SET status = ? WHERE id = ?').bind('suspended', target.id).run();
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'suspend', 'user', target.name || target.id, `Suspended 7 days via report: ${report.reason}`);
      } else if (action_taken === 'warned') {
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'warn', 'user', target.name || target.id, `Warning via report: ${report.reason}`);
      } else if (action_taken === 'content_removed') {
        if (report.reported_type === 'host') {
          await d.prepare('UPDATE hosts SET is_active = 0 WHERE user_id = ?').bind(target.id).run();
        }
        await auditLog(d, u.sub, u.email || 'Admin', u.email || '', 'content_removed', 'user', target.name || target.id, `Content removed via report: ${report.reason}`);
      }
    }
  }
  await auditLog(d, u.sub, u.email || 'Admin', u.email || '', action_taken || status, 'content_report', id, `Report ${status}: ${action_taken || ''}`);
  return c.json({ success: true });
});

// ─── User Bans ────────────────────────────────────────────────────────────────
admin.get('/bans', async (c) => {
  const result = await db(c).prepare('SELECT * FROM user_bans ORDER BY banned_at DESC LIMIT 500').all();
  return c.json(result.results);
});
admin.post('/bans', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  let userId = body.user_id ?? null;
  let userName = body.user_name || body.email?.split('@')[0] || 'Unknown';
  if (!userId && body.email) {
    const u2 = await db(c).prepare('SELECT id, name FROM users WHERE email = ?').bind(body.email).first<any>();
    if (u2) { userId = u2.id; userName = u2.name; }
  }
  await db(c).prepare(
    'INSERT INTO user_bans (id, user_id, user_name, user_email, type, reason, ban_type, device_id, banned_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, userName, body.email ?? '', body.type || 'user', body.reason, body.ban_type || 'permanent', body.device_id ?? null, 'Admin', body.expires_at || null).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'ban', 'user', userName, `${body.ban_type || 'permanent'} ban: ${body.reason}`);
  return c.json({ id, success: true }, 201);
});
admin.delete('/bans/:id', async (c) => {
  const { id } = c.req.param();
  const ban = await db(c).prepare('SELECT user_name, user_id FROM user_bans WHERE id = ?').bind(id).first<any>();
  await db(c).prepare('DELETE FROM user_bans WHERE id = ?').bind(id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'unban', 'user', ban?.user_name || id, 'Ban removed');
  return c.json({ success: true });
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
admin.get('/audit-logs', async (c) => {
  const result = await db(c).prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all();
  return c.json((result.results || []).map((l: any) => ({
    ...l,
    admin: l.admin_name || 'Admin',
    admin_email: l.admin_email || '',
    ts: new Date(l.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19),
  })));
});

// ─── Payment Gateways CRUD ───────────────────────────────────────────────────
admin.get('/payment-gateways', async (c) => {
  const result = await db(c).prepare('SELECT * FROM payment_gateways ORDER BY position ASC, created_at DESC').all();
  return c.json(result.results);
});
admin.post('/payment-gateways', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO payment_gateways (id, name, type, icon_emoji, platforms, instruction, redirect_url, is_active, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
  ).bind(id, body.name, body.type || 'manual', body.icon_emoji || '💳', JSON.stringify(body.platforms || ['all']), body.instruction || '', body.redirect_url || '', body.is_active !== false ? 1 : 0, body.position || 0).run();
  return c.json({ id, success: true });
});
admin.patch('/payment-gateways/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const sets: string[] = [], vals: any[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.type !== undefined) { sets.push('type = ?'); vals.push(body.type); }
  if (body.icon_emoji !== undefined) { sets.push('icon_emoji = ?'); vals.push(body.icon_emoji); }
  if (body.platforms !== undefined) { sets.push('platforms = ?'); vals.push(JSON.stringify(body.platforms)); }
  if (body.instruction !== undefined) { sets.push('instruction = ?'); vals.push(body.instruction); }
  if (body.redirect_url !== undefined) { sets.push('redirect_url = ?'); vals.push(body.redirect_url); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (body.position !== undefined) { sets.push('position = ?'); vals.push(body.position); }
  if (!sets.length) return c.json({ success: true });
  sets.push('updated_at = unixepoch()');
  await db(c).prepare(`UPDATE payment_gateways SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ success: true });
});
admin.delete('/payment-gateways/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM payment_gateways WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Manual QR Codes CRUD ─────────────────────────────────────────────────────
admin.get('/manual-qr-codes', async (c) => {
  const result = await db(c).prepare('SELECT * FROM manual_qr_codes ORDER BY position ASC, created_at DESC').all();
  return c.json(result.results);
});
admin.post('/manual-qr-codes', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO manual_qr_codes (id, name, upi_id, qr_image_url, instructions, is_active, position, rotate_interval_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
  ).bind(id, body.name || '', body.upi_id || '', body.qr_image_url || '', body.instructions || '', body.is_active !== false ? 1 : 0, body.position ?? 0, body.rotate_interval_min ?? 30).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'create', 'manual_qr_code', id, `Manual QR created: ${body.name}`);
  return c.json({ id, success: true }, 201);
});
admin.patch('/manual-qr-codes/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const sets: string[] = [], vals: any[] = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.upi_id !== undefined) { sets.push('upi_id = ?'); vals.push(body.upi_id); }
  if (body.qr_image_url !== undefined) { sets.push('qr_image_url = ?'); vals.push(body.qr_image_url); }
  if (body.instructions !== undefined) { sets.push('instructions = ?'); vals.push(body.instructions); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
  if (body.position !== undefined) { sets.push('position = ?'); vals.push(body.position); }
  if (body.rotate_interval_min !== undefined) { sets.push('rotate_interval_min = ?'); vals.push(body.rotate_interval_min); }
  if (!sets.length) return c.json({ success: true });
  sets.push('updated_at = unixepoch()');
  await db(c).prepare(`UPDATE manual_qr_codes SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'manual_qr_code', id, `Manual QR updated`);
  return c.json({ success: true });
});
admin.delete('/manual-qr-codes/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM manual_qr_codes WHERE id = ?').bind(id).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'delete', 'manual_qr_code', id, `Manual QR deleted`);
  return c.json({ success: true });
});

// ─── Banners CRUD ─────────────────────────────────────────────────────────────
admin.get('/banners', async (c) => {
  const result = await db(c).prepare('SELECT * FROM banners ORDER BY created_at DESC').all();
  return c.json(result.results);
});
admin.post('/banners', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  await db(c).prepare(
    'INSERT INTO banners (id, title, subtitle, image_url, bg_color, cta_text, cta_link, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.title, body.subtitle || '', body.image_url || '', body.bg_color || '#7C3AED', body.cta_text || 'Learn More', body.cta_link || '', body.position || 'home_top', body.active !== false ? 1 : 0).run();
  return c.json({ id, success: true }, 201);
});
admin.patch('/banners/:id', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const fields = ['title', 'subtitle', 'image_url', 'bg_color', 'cta_text', 'cta_link', 'position', 'active'];
  const sets: string[] = []; const vals: any[] = [];
  for (const f of fields) { if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); } }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()'); vals.push(id);
  await db(c).prepare(`UPDATE banners SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});
admin.delete('/banners/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM banners WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Referrals ────────────────────────────────────────────────────────────────
admin.get('/referrals', async (c) => {
  const topRows = await db(c).prepare(`
    SELECT rc.user_id, u.name as referrer, u.email as referrer_email,
      COUNT(ru.id) as referred_count,
      COALESCE(SUM(ru.coins_given), 0) as coins_earned,
      SUM(CASE WHEN ru.created_at > unixepoch('now','-30 days') THEN 1 ELSE 0 END) as this_month
    FROM referral_codes rc
    JOIN users u ON u.id = rc.user_id
    LEFT JOIN referral_uses ru ON ru.referrer_id = rc.user_id
    GROUP BY rc.user_id
    ORDER BY referred_count DESC
    LIMIT 50
  `).all<any>();
  const recentRows = await db(c).prepare(`
    SELECT ru.id, ru.coins_given, ru.status,
      ref.name as referrer,
      rfd.name as new_user,
      datetime(ru.created_at,'unixepoch') as joined_at
    FROM referral_uses ru
    JOIN users ref ON ref.id = ru.referrer_id
    JOIN users rfd ON rfd.id = ru.referred_id
    ORDER BY ru.created_at DESC
    LIMIT 20
  `).all<any>();
  const stats = await db(c).prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN created_at > unixepoch('now','-30 days') THEN 1 ELSE 0 END) as this_month,
      COALESCE(SUM(coins_given), 0) as coins_distributed
    FROM referral_uses
  `).first<any>();
  return c.json({
    top: (topRows.results || []).map((r: any, i: number) => ({ ...r, id: String(i + 1), status: 'active' })),
    recent: (recentRows.results || []).map((r: any) => ({ ...r, joined_at: (r.joined_at || '').slice(0, 10) })),
    stats: { total: stats?.total || 0, this_month: stats?.this_month || 0, coins_distributed: stats?.coins_distributed || 0 },
  });
});
admin.get('/referral-config', async (c) => {
  const keys = ['referrer_reward', 'new_user_reward', 'min_calls_to_unlock', 'referral_active'];
  const result = await db(c).prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys).all<any>();
  const obj: any = { referrer_reward: 100, new_user_reward: 50, min_calls_to_unlock: 1, active: true };
  (result.results || []).forEach((r: any) => {
    if (r.key === 'referral_active') obj.active = r.value === '1';
    else if (['referrer_reward', 'new_user_reward', 'min_calls_to_unlock'].includes(r.key)) obj[r.key] = parseInt(r.value);
  });
  return c.json(obj);
});
admin.put('/referral-config', async (c) => {
  const body = await c.req.json() as any;
  const stmts = [
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('referrer_reward', ?, unixepoch())").bind(String(body.referrer_reward || 100)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('new_user_reward', ?, unixepoch())").bind(String(body.new_user_reward || 50)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('min_calls_to_unlock', ?, unixepoch())").bind(String(body.min_calls_to_unlock || 1)),
    db(c).prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('referral_active', ?, unixepoch())").bind(body.active ? '1' : '0'),
  ];
  await db(c).batch(stmts);
  return c.json({ success: true });
});

// ─── Live Calls ───────────────────────────────────────────────────────────────
admin.get('/calls/live', async (c) => {
  const STALE_HOURS = 4;
  const staleThreshold = Math.floor(Date.now() / 1000) - (STALE_HOURS * 3600);
  await db(c).prepare(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = unixepoch(),
        duration_seconds = unixepoch() - started_at
    WHERE status = 'active' AND started_at IS NOT NULL AND started_at < ?
  `).bind(staleThreshold).run();

  const result = await db(c).prepare(`
    SELECT cs.id, cs.type, cs.status, cs.started_at, cs.coins_charged,
      u.name as user, u.email as caller_email,
      h.display_name as host,
      COALESCE(h.audio_coins_per_minute, h.coins_per_minute, 5) as coins_per_min
    FROM call_sessions cs
    LEFT JOIN users u ON cs.caller_id = u.id
    LEFT JOIN hosts h ON cs.host_id = h.id
    WHERE cs.status = 'active'
    ORDER BY cs.started_at ASC
  `).all<any>();
  return c.json((result.results || []).map((r: any) => ({
    ...r,
    started_at: r.started_at ? r.started_at * 1000 : Date.now(),
  })));
});

admin.post('/calls/stale-cleanup', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  // FIX #16: Require an explicit `confirm: true` body so this destructive
  // janitor action can't fire from a stray click. Returns 400 if missing.
  if (body?.confirm !== true) {
    return c.json({ error: 'Refusing to run stale cleanup without explicit { confirm: true }' }, 400);
  }
  const maxHours = Math.max(1, Math.min(24, parseInt(body.max_hours) || 4));
  const staleThreshold = Math.floor(Date.now() / 1000) - (maxHours * 3600);
  // NOTE: Stale cleanup intentionally does NOT bill coins or pay hosts.
  // Use this only for cleaning up zombie sessions. For proper billing,
  // the cron-based reaper in src/index.ts handles legitimate stale calls
  // with full atomic coin transfer.
  const result = await db(c).prepare(`
    UPDATE call_sessions
    SET status = 'ended', ended_at = unixepoch(),
        duration_seconds = unixepoch() - COALESCE(started_at, unixepoch())
    WHERE status = 'active'
      AND (started_at IS NULL OR started_at < ?)
  `).bind(staleThreshold).run();
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'calls', 'Stale Cleanup', `Ended ${result.meta?.changes ?? 0} stale calls (>${maxHours}h)`);
  return c.json({
    success: true,
    ended: result.meta?.changes ?? 0,
    warning: 'No coins were billed and no host earnings were paid. The cron reaper handles legitimate stale calls; use this only for zombie sessions.',
  });
});

admin.post('/calls/:id/force-end', async (c) => {
  const { id } = c.req.param();
  const dbA = db(c);
  // Pull host_user_id alongside the session so we can credit the host atomically
  // and notify both parties without a second query round-trip.
  const session = await dbA.prepare(
    `SELECT cs.*, h.user_id as host_user_id
     FROM call_sessions cs
     LEFT JOIN hosts h ON h.id = cs.host_id
     WHERE cs.id = ?`
  ).bind(id).first<any>();
  if (!session) return c.json({ error: 'Call not found' }, 404);
  if (session.status === 'ended' || session.status === 'declined') {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // ──────────────────────────────────────────────────────────────────────────────
  // CRITICAL FIX: previously this endpoint computed `coins_charged` and wrote
  // it on the session row but never actually moved any coins — caller wasn't
  // debited, host wasn't credited, no coin_transactions, host stats stale.
  // Result: an admin force-ending a stuck call left the caller with free
  // talk time and the host with no earnings.
  //
  // We now mirror the atomic transfer pattern used by /api/calls/end and the
  // cron reaper (src/index.ts):
  //   1. Atomic ended_at guard so two concurrent admin force-ends (or a
  //      force-end racing the cron reaper / a genuine /end call) cannot
  //      double-charge.
  //   2. Single UPDATE with CASE + EXISTS to move both rows or neither.
  //   3. Bookkeeping batch (host stats + coin_transactions) only if money
  //      actually moved.
  //   4. Notify both parties (WS + FCM fallback) so their call screens
  //      unblock and the local billing timer halts.
  //   5. Close the CF Calls SFU sessions so we don't leak edge resources.
  // ──────────────────────────────────────────────────────────────────────────────

  // Atomic guard — use ended_at IS NULL (matches the rest of the codebase).
  // Setting status='processing' would violate the CHECK constraint silently.
  const guard = await dbA.prepare(
    "UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status IN ('active', 'pending') AND ended_at IS NULL"
  ).bind(now, id).run();
  if (!guard.meta?.changes) {
    return c.json({ error: 'Call already ended' }, 400);
  }

  const durationSec = session.started_at ? now - session.started_at : 0;
  // Round UP minutes (matches /api/calls/end). Floor would under-bill on
  // 1m30s calls — host gets 0 earnings even though they spoke for 90s.
  const durationMin = durationSec > 0 ? Math.max(1, Math.ceil(durationSec / 60)) : 0;
  const effectiveRate = session.rate_per_minute ?? 0;
  // Only charge if the call was actually `active` and had any duration.
  // A force-end on a still-`pending` call (caller cancelled, host never
  // accepted) must not bill anything.
  const coinsCharged = (session.status === 'active' && durationSec > 0)
    ? durationMin * effectiveRate
    : 0;
  const hostShare = Math.floor(coinsCharged * 0.7);

  let actualCoinsCharged = 0;
  let actualHostShare = 0;

  if (coinsCharged > 0 && session.host_user_id) {
    const transfer = await dbA.prepare(
      `UPDATE users
         SET coins = coins + CASE id
           WHEN ?1 THEN -?2
           WHEN ?3 THEN ?4
           ELSE 0
         END
         WHERE id IN (?1, ?3)
           AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND coins >= ?2)`
    ).bind(session.caller_id, coinsCharged, session.host_user_id, hostShare).run();

    if (transfer.meta?.changes === 2) {
      actualCoinsCharged = coinsCharged;
      actualHostShare = hostShare;
    } else {
      // Caller had insufficient coins — call was running past balance.
      // Force-end still succeeds (session marked ended) but no money moves.
      console.warn('[admin/force-end] Atomic transfer failed (insufficient coins). call:', id, 'wanted:', coinsCharged);
    }
  }

  const batchOps: any[] = [
    dbA.prepare('UPDATE call_sessions SET status = ?, duration_seconds = ?, coins_charged = ? WHERE id = ?')
      .bind('ended', durationSec, actualCoinsCharged, id),
  ];
  if (actualCoinsCharged > 0) {
    batchOps.push(
      dbA.prepare('UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?')
        .bind(durationMin, actualHostShare, session.host_id),
      dbA.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), session.caller_id, 'spend', -actualCoinsCharged, `${session.type || 'audio'} call — admin force-end (${durationMin} min)`, id),
      dbA.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), session.host_user_id, 'bonus', actualHostShare, `${session.type || 'audio'} call — admin force-end (${durationMin} min)`, id),
    );
  }
  await dbA.batch(batchOps);

  // Notify both parties so neither stays stuck on the call screen.
  // We deliberately fan out independently — one party's failure must not
  // block notifying the other.
  const notify = async (userId: string | null | undefined) => {
    if (!userId) return;
    try {
      const notifId = c.env.NOTIFICATION_HUB.idFromName(userId);
      const notifStub = c.env.NOTIFICATION_HUB.get(notifId);
      await notifStub.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'call_ended', session_id: id, reason: 'admin_force_end' }),
      });
    } catch (e) {
      console.warn('[admin/force-end] WS notify failed for', userId, e);
    }
  };
  await Promise.all([notify(session.caller_id), notify(session.host_user_id)]);

  // Coin balance updates so wallets refresh immediately on both sides.
  if (actualCoinsCharged > 0 && session.host_user_id) {
    try {
      const updatedHost = await dbA.prepare('SELECT coins FROM users WHERE id = ?').bind(session.host_user_id).first<{ coins: number }>();
      const hostNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.host_user_id));
      await hostNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: actualHostShare, new_balance: updatedHost?.coins ?? 0 }),
      });
    } catch (e) {
      console.warn('[admin/force-end] coin_update host notify failed:', e);
    }
    try {
      const updatedUser = await dbA.prepare('SELECT coins FROM users WHERE id = ?').bind(session.caller_id).first<{ coins: number }>();
      const userNotif = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(session.caller_id));
      await userNotif.fetch('https://dummy/notify', {
        method: 'POST',
        body: JSON.stringify({ type: 'coin_update', amount: -actualCoinsCharged, new_balance: updatedUser?.coins ?? 0 }),
      });
    } catch (e) {
      console.warn('[admin/force-end] coin_update caller notify failed:', e);
    }
  }

  // Best-effort CF Calls cleanup. Lazy-import so admin module load doesn't
  // pay the cost on every request.
  try {
    const { createCFCalls } = await import('../lib/cf-calls');
    const cfCalls = createCFCalls(c.env);
    if (cfCalls) {
      if (session.cf_session_id) {
        try { await cfCalls.closeSession(session.cf_session_id); }
        catch (e) { console.warn('[admin/force-end] close CF caller session failed:', e); }
      }
      if (session.cf_host_session_id) {
        try { await cfCalls.closeSession(session.cf_host_session_id); }
        catch (e) { console.warn('[admin/force-end] close CF host session failed:', e); }
      }
    }
  } catch (e) {
    console.warn('[admin/force-end] CF Calls cleanup skipped:', e);
  }

  const u = c.get('user');
  await auditLog(
    dbA,
    u.sub,
    u.email || 'Admin',
    u.email || '',
    'update',
    'calls',
    id,
    `Force-ended call (was ${session.status}) — ${durationSec}s, charged ${actualCoinsCharged} coins, host earned ${actualHostShare}`
  );

  return c.json({
    success: true,
    id,
    duration_seconds: durationSec,
    coins_charged: actualCoinsCharged,
    host_earnings: actualHostShare,
    insufficient_coins: coinsCharged > 0 && actualCoinsCharged === 0,
  });
});

// ─── App Config (alias for settings) ─────────────────────────────────────────
admin.get('/app-config', async (c) => {
  const result = await db(c).prepare('SELECT key, value FROM app_settings').all<any>();
  const obj: any = {};
  (result.results || []).forEach((r: any) => { obj[r.key] = r.value; });
  return c.json(obj);
});
admin.put('/app-config', async (c) => {
  const body = await c.req.json() as any;
  // Phase 3 Fix: Allowlist prevents arbitrary key injection into app_settings.
  // Add new keys here when intentionally extending the config schema.
  const ALLOWED_APP_CONFIG_KEYS = new Set([
    'min_coins_for_call', 'coin_to_usd_rate', 'host_revenue_share',
    'min_withdrawal_coins', 'registration_bonus_coins', 'auto_approve_manual',
    'auto_approve_manual_max_amount', 'maintenance_mode', 'maintenance_message',
    'app_name', 'support_email', 'terms_url', 'privacy_url',
    'razorpay_webhook_secret', 'stripe_webhook_secret', 'phonepe_webhook_secret',
    'paytm_merchant_key', 'generic_webhook_secret',
    'referrer_reward', 'new_user_reward', 'min_calls_to_unlock',
    'referral_active', 'free_chat_messages', 'level_config',
    // Random-call settings (mirror the /admin/settings allowlist).
    'random_call_audio_rate', 'random_call_video_rate',
    'random_calls_per_day_limit',
    'random_decline_cooldown_count', 'random_decline_cooldown_min',
    'random_match_repeat_block_min',
    // Daily-streak engagement layer.
    'daily_streak_enabled', 'daily_streak_schedule', 'daily_streak_milestones',
    // First-call-free + calling-system observability.
    'first_call_free_minutes',
    'billing_granularity_sec', 'low_balance_warn_seconds',
    // Calling system — admin-controlled default per-minute call rates (coins).
    'default_audio_rate', 'default_video_rate',
    // Engagement — recommendation rail + re-engagement/churn cron.
    'reco_enabled', 'reco_weights',
    'reengagement_enabled', 'reengagement_idle_days', 'reengagement_winback_days',
    'reengagement_cooldown_days', 'reengagement_max_per_run',
    'reengagement_max_idle_days', 'reengagement_interval_hours',
    // Priority 3 — quality-weighted matchmaking. Priority 4 — variable reward.
    'match_weighting_enabled', 'match_weights',
    'daily_streak_variable_enabled', 'daily_streak_variable_table',
  ]);
  const stmts = Object.entries(body)
    .filter(([k]) => ALLOWED_APP_CONFIG_KEYS.has(k))
    .map(([k, v]) =>
      db(c).prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())').bind(k, String(v))
    );
  if (!stmts.length) return c.json({ error: 'No valid config keys to update' }, 400);
  await db(c).batch(stmts);
  const u = c.get('user');
  await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'settings', 'App Config', `${stmts.length} settings updated`);
  return c.json({ success: true });
});

// POST /api/admin/run-migrations — admin "Run Migrations" button entrypoint.
//
// Thin shim around the runtime auto-migrator (lib/autoMigrate.ts) preserved
// for backwards compatibility with the admin panel's SettingsPage > Database
// Maintenance card, which calls this endpoint via api.runMigrations().
//
// History:
//   - v1: hardcoded ~30 inline DDL statements duplicating /migrations/*.sql,
//         gated behind a separate MIGRATION_SECRET worker secret. The secret
//         was rarely set in production, so the button returned 403 and admins
//         saw "Migration secret required" — exactly the bug this commit fixes.
//   - v2 (this version): delegates to ensureAllMigrations(), which reads
//         every migration from the bundled /migrations/*.sql, tracks state
//         in d1_migrations, and applies only what's pending. Admin auth +
//         adminMiddleware already gate this route — no extra secret needed.
//
// Response shape preserved for the UI:
//   { success: boolean, total: number, results: string[] }
// where each entry is one of:
//   "OK: <name>"   — newly applied this run
//   "SKIP (already applied): <name>"  — d1_migrations row already existed
//   "ERR: <name> — <message>"  — apply attempt failed
admin.post('/run-migrations', async (c) => {
  const report = await ensureAllMigrations(c.env.DB);
  const results: string[] = [
    ...report.applied.map((n) => `OK: ${n}`),
    ...Array.from({ length: report.alreadyApplied }, (_, i) => `SKIP (already applied): #${i + 1}`),
    ...report.failed.map((n) => `ERR: ${n} — see worker logs for detail`),
  ];

  const u = c.get('user');
  try {
    await db(c).prepare(
      `INSERT INTO audit_logs (id, admin_id, admin_name, action, detail, created_at)
       VALUES (lower(hex(randomblob(8))), ?, ?, 'run_migrations', ?, unixepoch())`,
    ).bind(
      u.sub,
      u.email || 'Admin',
      `Auto-migrate: ${report.applied.length} applied, ${report.alreadyApplied} already applied, ${report.failed.length} failed`,
    ).run();
  } catch (err) {
    console.error('[run-migrations] Failed to write audit log:', err);
  }

  return c.json({ success: report.failed.length === 0, results, total: results.length });
});

// ─── India Coin-Economy Seed ────────────────────────────────────────────────
//
// One-shot admin action to apply the India-tuned defaults discussed in the
// economy review:
//   - 8 INR coin plans (₹19 → ₹6999 with progressive volume discount)
//   - coin_value_inr = 0.10 (stored as coin_to_usd_rate = 0.001204819; 1 coin = ₹0.10 host payout)
//   - min_withdrawal_coins = 500   (= ₹50)
//   - host_revenue_share fallback = 0.60 (level 1 hosts; per-level overrides)
//   - level_config retuned for INR economy: 60/65/70/75/80% earning share,
//     India-scaled max audio/video caps + per-level random call rates
//
// Destructive: it WIPES existing coin_plans before re-seeding so admins
// don't end up with a mixed USD + INR plan list. Existing app_settings
// values are upserted (keep history of older keys, just point to new
// values). Existing level_config is replaced.
//
// Required:
//   - confirm=true query param (typo-prevention; admin must opt in)
//   - X-Confirm-Seed header set to 'india-coin-economy' (extra friction
//     so a misclicked URL doesn't blow away production plans)
//
// Idempotent: re-running yields the same end state. Audit-logged.
admin.post('/seed/india-defaults', async (c) => {
  const confirm = c.req.query('confirm');
  const confirmHeader = c.req.header('X-Confirm-Seed');
  if (confirm !== 'true' || confirmHeader !== 'india-coin-economy') {
    return c.json(
      {
        error:
          'Confirmation required. Pass ?confirm=true AND header X-Confirm-Seed: india-coin-economy. This action wipes coin_plans + replaces level_config.',
      },
      400,
    );
  }

  const database = db(c);
  const u = c.get('user');
  const ip = c.req.header('CF-Connecting-IP') ?? '';

  // ─── 1. Coin plans (INR-priced, 8-tier curve) ───────────────────────────
  // Curve hits psychological price points (₹19, ₹49, ₹99, ₹299, ₹599,
  // ₹1299, ₹2999, ₹6999) with the bonus % climbing 0% → 25%, replicating
  // the discount slope of FRND/RealU's India catalogue. The is_popular
  // marker is on the ₹299 plan (most-bought tier in benchmark data).
  const indiaPlans: Array<{
    id: string;
    name: string;
    coins: number;
    price: number;
    bonus: number;
    popular: 0 | 1;
  }> = [
    { id: 'india-trial',    name: 'Trial',     coins: 25,    price: 19,    bonus: 0,    popular: 0 },
    { id: 'india-mini',     name: 'Mini',      coins: 75,    price: 49,    bonus: 0,    popular: 0 },
    { id: 'india-basic',    name: 'Basic',     coins: 175,   price: 99,    bonus: 25,   popular: 0 },
    { id: 'india-popular',  name: 'Popular',   coins: 600,   price: 299,   bonus: 100,  popular: 1 },
    { id: 'india-value',    name: 'Value',     coins: 1300,  price: 599,   bonus: 200,  popular: 0 },
    { id: 'india-pro',      name: 'Pro',       coins: 3000,  price: 1299,  bonus: 500,  popular: 0 },
    { id: 'india-vip',      name: 'VIP',       coins: 7500,  price: 2999,  bonus: 1500, popular: 0 },
    { id: 'india-mega',     name: 'Mega',      coins: 20000, price: 6999,  bonus: 5000, popular: 0 },
  ];

  // ─── 2. App settings — economy + currency ──────────────────────────────
  // We deliberately upsert via INSERT OR REPLACE on a settled key list. This
  // does NOT touch other admin-configured keys (random call rates etc.) so a
  // half-customised deployment isn't reverted to factory defaults.
  const settingUpserts: Array<[string, string]> = [
    ['coin_to_usd_rate', '0.001204819'],
    ['host_revenue_share', '0.60'],
    ['min_withdrawal_coins', '500'],
  ];

  // ─── 3. Level config — India-tuned 5-tier ladder ───────────────────────
  // Earning share dropped 10pp at L1 (70 → 60) to absorb the higher payout
  // rate (₹0.10 vs ₹0.01). Top tiers keep their existing high share so
  // power-host retention isn't punished. Random call rates climb steeply
  // by level so the user sees a meaningful difference between Newcomer
  // (10/min audio) and Elite (60/min audio).
  const indiaLevelConfig = [
    { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform',  perks: { max_rate: 30,  max_audio_rate: 30,  max_video_rate: 50,  random_audio_rate: 10, random_video_rate: 18, earning_share: 0.60, rank_boost: 0 } },
    { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established',   perks: { max_rate: 60,  max_audio_rate: 60,  max_video_rate: 100, random_audio_rate: 15, random_video_rate: 25, earning_share: 0.65, rank_boost: 1 } },
    { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise',      perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 180, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 2 } },
    { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier',     perks: { max_rate: 180, max_audio_rate: 180, max_video_rate: 300, random_audio_rate: 40, random_video_rate: 65, earning_share: 0.75, rank_boost: 3 } },
    { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer',         perks: { max_rate: 300, max_audio_rate: 300, max_video_rate: 500, random_audio_rate: 60, random_video_rate: 100, earning_share: 0.80, rank_boost: 5 } },
  ];

  // ─── Execute as a single batch (atomic at D1 batch level) ──────────────
  // If any step fails, none of the changes commit and the admin sees a
  // 500 with the error. Avoids the half-applied state where coin_plans
  // is wiped but app_settings hasn't been updated.
  const ops: D1PreparedStatement[] = [];

  // 1. wipe + reseed coin_plans
  ops.push(database.prepare('DELETE FROM coin_plans'));
  for (const p of indiaPlans) {
    ops.push(
      database
        .prepare(
          `INSERT INTO coin_plans (id, name, coins, price, currency, bonus_coins, is_popular, is_active)
           VALUES (?, ?, ?, ?, 'INR', ?, ?, 1)`,
        )
        .bind(p.id, p.name, p.coins, p.price, p.bonus, p.popular),
    );
  }

  // 2. upsert app_settings
  for (const [key, value] of settingUpserts) {
    ops.push(
      database
        .prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())")
        .bind(key, value),
    );
  }

  // 3. replace level_config (single JSON blob — same shape /admin/level-config writes)
  ops.push(
    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('level_config', ?, unixepoch())")
      .bind(JSON.stringify(indiaLevelConfig)),
  );

  try {
    await database.batch(ops);
  } catch (err) {
    console.error('[seed/india-defaults] batch failed:', err);
    return c.json({ error: 'Seed failed — partial state likely. Check logs.', details: String(err) }, 500);
  }

  await auditLog(
    database,
    u.sub,
    u.email || 'Admin',
    u.email || '',
    'update',
    'settings',
    'india-coin-economy',
    `Seeded India coin economy: ${indiaPlans.length} INR plans, level_config retuned, coin_value_inr=0.10 (coin_to_usd_rate=0.001204819), min_withdrawal_coins=500`,
    ip,
  );

  return c.json({
    success: true,
    plans_seeded: indiaPlans.length,
    level_count: indiaLevelConfig.length,
    settings_updated: settingUpserts.map(([k]) => k).concat(['level_config']),
  });
});

// ─── Seed Optimized Coin Economy ─────────────────────────────────────────────
// Re-applies the production INR coin-economy migrations (0030–0032) via the
// runtime auto-migrator. Idempotent: each migration is only re-run if its
// `d1_migrations` row is missing, otherwise this is a no-op.
//
// Replaces an earlier dynamic-import-based version that referenced a
// `scripts/seed-coin-economy` module which never existed in the repo and
// blocked `wrangler deploy` (the build step couldn't resolve the import).
admin.post('/seed-coin-economy', async (c) => {
  try {
    const report = await ensureAllMigrations(c.env.DB);
    const u = c.get('user');
    await auditLog(
      db(c),
      u.sub,
      u.email || 'Admin',
      u.email || '',
      'update',
      'settings',
      'coin_economy',
      `Re-ran auto-migrator: ${report.applied.length} applied, ${report.alreadyApplied} already applied, ${report.failed.length} failed`,
    );
    return c.json({ success: report.failed.length === 0, ...report });
  } catch (err) {
    console.error('[admin/seed-coin-economy] failed:', err);
    return c.json({ success: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

// ─── Stuck Calls Cleanup ───────────────────────────────────────────────────────
// Marks stale pending (>10 min) and active (>6 hr) calls as ended with 0 coins
admin.post('/calls/cleanup-stuck', async (c) => {
  const database = db(c);
  const now = Math.floor(Date.now() / 1000);
  const PENDING_TIMEOUT_SEC = 10 * 60;      // 10 minutes
  const ACTIVE_TIMEOUT_SEC  = 6 * 60 * 60;  // 6 hours

  const stuckPending = await database.prepare(
    `UPDATE call_sessions SET status = 'ended', ended_at = ?, duration_seconds = 0, coins_charged = 0
     WHERE status = 'pending' AND created_at < ?`
  ).bind(now, now - PENDING_TIMEOUT_SEC).run();

  const stuckActive = await database.prepare(
    `UPDATE call_sessions SET status = 'ended', ended_at = ?, duration_seconds = (? - COALESCE(started_at, created_at)), coins_charged = 0
     WHERE status = 'active' AND created_at < ?`
  ).bind(now, now, now - ACTIVE_TIMEOUT_SEC).run();

  const u = c.get('user');
  await auditLog(database, u.sub, u.email || 'Admin', u.email || '', 'update', 'call_sessions', 'bulk',
    `Cleaned up ${stuckPending.meta?.changes ?? 0} stuck-pending + ${stuckActive.meta?.changes ?? 0} stuck-active calls`);

  return c.json({
    success: true,
    pending_ended: stuckPending.meta?.changes ?? 0,
    active_ended: stuckActive.meta?.changes ?? 0,
  });
});

export default admin;
