import { Hono } from 'hono';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { sendFCMPush, getFCMTokens } from '../lib/fcm';
import { buildAgoraRtcToken, isAgoraConfigured } from '../lib/agoraToken';
import { getCallEconomicsConfig, agoraCostPerMinInr } from '../lib/callEconomics';
import {
  readAllEmergencyFlags,
  setEmergencyFlag,
  type EmergencyFlagKey,
} from '../lib/emergencyFlags';
import { listMigrationStatus as listMigrationStatusForHealth } from '../lib/autoMigrate';
import { getLevelConfig, normalizeLevelConfig, getDefaultCallRates, getEarningShare, MIN_LEVELS, MAX_LEVELS } from '../lib/levels';
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
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const callRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day,
           COUNT(*) as calls,
           COALESCE(SUM(coins_charged),0) as revenue
    FROM call_sessions
    WHERE created_at > ?
    GROUP BY day ORDER BY day ASC
  `).bind(cutoff).all<any>();
  // New users per day for requested range
  const userRows = await dbA.prepare(`
    SELECT DATE(created_at,'unixepoch') as day, COUNT(*) as users
    FROM users
    WHERE created_at > ?
    GROUP BY day ORDER BY day ASC
  `).bind(cutoff).all<any>();
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

// GET /api/admin/analytics/margins?days=30 — Agora-aware P&L + volume-discount
// tracking (items 1 + 5). Everything is computed ON-THE-FLY from call_sessions
// + coin_transactions + the live economics config, so it's accurate for ALL
// historical calls regardless of whether agora_cost_est was stamped.
//
//   Revenue      = billed coins × coin_purchase_inr
//   Host payout  = actual host 'bonus' coins for these calls × coin_payout_inr
//   Agora cost   = per-minute Agora cost × billed minutes (audio/video split)
//   Gateway fee  = revenue × gateway%
//   Platform net = revenue − gateway − host payout − Agora cost
//
// Billed minutes use the SAME per-minute round-up as billing: (sec+59)/60
// integer division (any 1–60s call = 1 minute).
admin.get('/analytics/margins', async (c) => {
  const dbA = c.env.DB;
  const daysParam = parseInt(c.req.query('days') || '30');
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const cfg = await getCallEconomicsConfig(dbA);

  // Period aggregates. Billed minutes split by media type (round-up per minute).
  const agg = await dbA.prepare(`
    SELECT
      COUNT(*) as calls,
      COALESCE(SUM(coins_charged),0) as coins,
      COALESCE(SUM(CASE WHEN type='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) as video_min,
      COALESCE(SUM(CASE WHEN type!='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) as audio_min
    FROM call_sessions
    WHERE status='ended' AND created_at > ? AND duration_seconds > 0
  `).bind(cutoff).first<any>();

  // Actual host payout coins for these calls (accurate — from the ledger).
  const hostRow = await dbA.prepare(`
    SELECT COALESCE(SUM(ct.amount),0) as host_coins
    FROM coin_transactions ct
    JOIN call_sessions cs ON cs.id = ct.ref_id
    WHERE ct.type='bonus' AND cs.created_at > ? AND cs.status='ended'
  `).bind(cutoff).first<any>().catch(() => ({ host_coins: 0 }));

  const audioMin = Number(agg?.audio_min) || 0;
  const videoMin = Number(agg?.video_min) || 0;
  const coins = Number(agg?.coins) || 0;
  const hostCoins = Number(hostRow?.host_coins) || 0;

  const revenueInr = coins * cfg.coinPurchaseInr;
  const gatewayFeeInr = revenueInr * (cfg.gatewayFeePct / 100);
  const hostPayoutInr = hostCoins * cfg.coinPayoutInr;
  const agoraCostInr =
    audioMin * agoraCostPerMinInr('audio', cfg) + videoMin * agoraCostPerMinInr('video', cfg);
  const platformNetInr = revenueInr - gatewayFeeInr - hostPayoutInr - agoraCostInr;
  const marginPct = revenueInr > 0 ? (platformNetInr / revenueInr) * 100 : 0;

  // ── Item 5: current calendar-month Agora usage + volume discount ──────────
  // Agora bills per participant-minute; free tier = first 10,000 min/month;
  // volume discounts kick in at 100k / 500k / 1M monthly minutes.
  const monthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
  const monthAgg = await dbA.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) as video_min,
      COALESCE(SUM(CASE WHEN type!='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) as audio_min
    FROM call_sessions
    WHERE status='ended' AND created_at > ? AND duration_seconds > 0
  `).bind(monthStart).first<any>();

  const mAudioMin = Number(monthAgg?.audio_min) || 0;
  const mVideoMin = Number(monthAgg?.video_min) || 0;
  const participantMin = (mAudioMin + mVideoMin) * cfg.participantsPerCall;
  const FREE_MIN = 10000;
  const discountPct = participantMin >= 1_000_000 ? 10 : participantMin >= 500_000 ? 7 : participantMin >= 100_000 ? 5 : 0;
  // Raw USD cost this month (before free tier + discount).
  const rawUsd =
    mAudioMin * cfg.participantsPerCall * (cfg.agoraAudioUsdPer1000 / 1000) +
    mVideoMin * cfg.participantsPerCall *
      ((cfg.videoMaxResolution === '1080p' ? cfg.agoraVideoFhdUsdPer1000 : cfg.agoraVideoHdUsdPer1000) / 1000);
  // Free tier reduces cost proportionally; discount applies to the remainder.
  const billableFraction = participantMin > FREE_MIN ? (participantMin - FREE_MIN) / participantMin : 0;
  const estBillUsd = rawUsd * billableFraction * (1 - discountPct / 100);

  return c.json({
    period_days: days,
    calls: Number(agg?.calls) || 0,
    billed_minutes: { audio: audioMin, video: videoMin, total: audioMin + videoMin },
    revenue_inr: Math.round(revenueInr * 100) / 100,
    gateway_fee_inr: Math.round(gatewayFeeInr * 100) / 100,
    host_payout_inr: Math.round(hostPayoutInr * 100) / 100,
    agora_cost_inr: Math.round(agoraCostInr * 100) / 100,
    platform_net_inr: Math.round(platformNetInr * 100) / 100,
    margin_pct: Math.round(marginPct * 10) / 10,
    agora_usage_month: {
      call_minutes: mAudioMin + mVideoMin,
      participant_minutes: participantMin,
      free_minutes: FREE_MIN,
      billable_minutes: Math.max(0, participantMin - FREE_MIN),
      discount_pct: discountPct,
      tier_label:
        discountPct === 0 ? (participantMin <= FREE_MIN ? 'Free tier' : 'Standard (no discount)') : `${discountPct}% volume discount`,
      est_bill_usd: Math.round(estBillUsd * 100) / 100,
      est_bill_inr: Math.round(estBillUsd * cfg.fxInrPerUsd * 100) / 100,
    },
    config: {
      coin_purchase_inr: cfg.coinPurchaseInr,
      coin_payout_inr: cfg.coinPayoutInr,
      gateway_fee_pct: cfg.gatewayFeePct,
      fx_inr_per_usd: cfg.fxInrPerUsd,
      video_max_resolution: cfg.videoMaxResolution,
    },
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

// ─── Pending action-queue counts ───────────────────────────────────────────
// GET /api/admin/pending-counts
// One lightweight endpoint the admin panel polls (every ~15s) to render the
// sidebar badges and drive ring alerts. It aggregates every actionable queue
// in a SINGLE DB round-trip (scalar sub-queries) so the client makes ONE
// request instead of five.
admin.get('/pending-counts', async (c) => {
  const d = db(c);
  try {
    const row = await d.prepare(
      `SELECT
        (SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'pending') AS withdrawals,
        (SELECT COUNT(*) FROM coin_purchases WHERE status = 'pending') AS deposits,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS support_tickets,
        (SELECT COUNT(*) FROM host_applications WHERE status IN ('pending','under_review')) AS kyc_applications,
        (SELECT COUNT(*) FROM content_reports WHERE status = 'pending') AS content_reports`
    ).first<any>();
    const counts = {
      withdrawals: Number(row?.withdrawals) || 0,
      deposits: Number(row?.deposits) || 0,
      support_tickets: Number(row?.support_tickets) || 0,
      kyc_applications: Number(row?.kyc_applications) || 0,
      content_reports: Number(row?.content_reports) || 0,
    };
    return c.json({
      ...counts,
      total:
        counts.withdrawals + counts.deposits + counts.support_tickets +
        counts.kyc_applications + counts.content_reports,
    });
  } catch {
    // Fall back to independent counts so a single missing/locked table doesn't
    // zero out every badge.
    const safe = async (sql: string) => {
      try { const r = await d.prepare(sql).first<any>(); return Number(r?.n) || 0; } catch { return 0; }
    };
    const [withdrawals, deposits, support_tickets, kyc_applications, content_reports] = await Promise.all([
      safe(`SELECT COUNT(*) AS n FROM withdrawal_requests WHERE status = 'pending'`),
      safe(`SELECT COUNT(*) AS n FROM coin_purchases WHERE status = 'pending'`),
      safe(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'`),
      safe(`SELECT COUNT(*) AS n FROM host_applications WHERE status IN ('pending','under_review')`),
      safe(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'pending'`),
    ]);
    return c.json({
      withdrawals, deposits, support_tickets, kyc_applications, content_reports,
      total: withdrawals + deposits + support_tickets + kyc_applications + content_reports,
    });
  }
});

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

  // Live INR-per-USD rate from the cron-refreshed fx_rates_usd blob (fallback 83).
  let inrRate = 83;
  if (obj.fx_rates_usd) {
    try {
      const rates = JSON.parse(obj.fx_rates_usd);
      if (rates.INR && rates.INR > 0) inrRate = rates.INR;
    } catch {}
  }
  obj.inr_to_usd_rate = inrRate;
  obj.fx_rates_last_updated = obj.fx_rates_updated || null;

  // MULTI-CURRENCY: surface the coin value in INR for the admin panel.
  // `coin_value_inr` is the admin-set SOURCE OF TRUTH (persisted on save and
  // re-pinned by the FX cron), so we return it verbatim — the displayed ₹
  // never drifts as the exchange rate moves. Only legacy rows that predate
  // this (no stored coin_value_inr) fall back to RECONSTRUCTING it from
  // coin_to_usd_rate × live FX, which is what produced bogus values like
  // ₹99/coin when an old/garbage coin_to_usd_rate was lying around.
  const storedInr = parseFloat(obj.coin_value_inr);
  if (Number.isFinite(storedInr) && storedInr > 0) {
    obj.coin_value_inr = String(obj.coin_value_inr);
  } else if (obj.coin_to_usd_rate) {
    const usdRate = parseFloat(obj.coin_to_usd_rate);
    obj.coin_value_inr = (usdRate * inrRate).toFixed(6);
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
    // Validate: a coin value must be a positive, finite number. We also cap it
    // at a generous sanity ceiling (₹1000/coin) so a fat-fingered entry can't
    // poison billing — the product is designed around ₹0.05/coin.
    if (!Number.isFinite(inrValue) || inrValue <= 0) {
      return c.json({ error: 'coin_value_inr must be a positive number (₹ per coin), e.g. 0.05' }, 400);
    }
    if (inrValue > 1000) {
      return c.json({ error: 'coin_value_inr looks too large (max ₹1000/coin). Did you mean a value like 0.05?' }, 400);
    }
    // Get live INR to USD rate from fx_rates_usd or use default
    const fxRow = await db(c).prepare(
      "SELECT value FROM app_settings WHERE key = 'fx_rates_usd'"
    ).first<{ value: string }>();

    let inrRate = 83; // Default INR per USD
    if (fxRow?.value) {
      try {
        const rates = JSON.parse(fxRow.value);
        if (rates.INR && rates.INR > 0) inrRate = rates.INR;
      } catch {}
    }

    // Convert: INR value → USD value (for billing / non-INR users)
    // If 1 coin = ₹0.05 and $1 = ₹83, then 1 coin = $0.0006
    const usdValue = inrValue / inrRate;
    processedBody.coin_to_usd_rate = usdValue;
    // Persist the admin's INR value as the canonical source of truth so the
    // displayed ₹ never drifts and the FX cron can re-pin coin_to_usd_rate.
    processedBody.coin_value_inr = String(inrValue);
  }
  
  // SECURITY FIX: Only allow known setting keys to prevent arbitrary key injection
  const ALLOWED_SETTINGS = [
    'min_coins_for_call', 'coin_to_usd_rate', 'coin_value_inr', 'host_revenue_share',
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
    'default_audio_rate', 'default_video_rate', 'default_video_fhd_rate',
    'billing_granularity_sec', 'low_balance_warn_seconds',
    // Agora-aware call economics (lib/callEconomics.ts). Cost inputs + margins.
    'coin_purchase_inr', 'coin_payout_inr', 'payment_gateway_fee_pct',
    'agora_audio_usd_per_1000', 'agora_video_hd_usd_per_1000', 'agora_video_fhd_usd_per_1000',
    'call_participants', 'floor_max_host_share', 'call_floor_safety_multiplier',
    'video_max_resolution', 'regional_price_multiplier', 'call_prepaid_hold_enabled',
    'reco_enabled', 'reco_weights',
    'reengagement_enabled', 'reengagement_idle_days', 'reengagement_winback_days',
    'reengagement_cooldown_days', 'reengagement_max_per_run',
    'reengagement_max_idle_days', 'reengagement_interval_hours',
    'match_weighting_enabled', 'match_weights',
    'daily_streak_variable_enabled', 'daily_streak_variable_table',
    // Daily streak engagement v2 — freeze/repair, anti-farming, chest, reminders.
    'daily_streak_comeback_bonus', 'daily_streak_guest_multiplier',
    'daily_streak_minute_rewards',
    'daily_streak_freeze_enabled', 'daily_streak_freeze_monthly',
    'daily_streak_repair_cost_coins',
    'daily_streak_chest_enabled', 'daily_streak_chest_threshold',
    'daily_streak_chest_reward',
    'daily_streak_reminder_enabled', 'daily_streak_reminder_hour_ist',
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
  // When coin_to_usd_rate changes, every user sees the new coin value immediately.
  //
  // We derive the broadcast from processedBody (the values actually persisted),
  // NOT the raw body. The admin panel edits coin value in INR (coin_value_inr),
  // which is converted to coin_to_usd_rate above and stripped from the request.
  // Reading the raw body here would broadcast the admin's STALE coin_to_usd_rate
  // (or nothing at all), so apps would never receive the new coin value.
  const changedKeys = Object.keys(processedBody).filter(k => ALLOWED_SETTINGS.includes(k));
  
  // Check if coin value changed - this is critical for real-time updates
  const coinValueChanged = changedKeys.includes('coin_to_usd_rate');
  const callRatesChanged = changedKeys.includes('default_audio_rate') || 
                           changedKeys.includes('default_video_rate') ||
                           changedKeys.includes('default_video_fhd_rate') ||
                           changedKeys.includes('min_coins_for_call') ||
                           changedKeys.includes('random_call_audio_rate') ||
                           changedKeys.includes('random_call_video_rate');
  
  // Get the updated settings values for broadcast
  const updatedSettings: Record<string, string> = {};
  for (const key of changedKeys) {
    if (processedBody[key] !== undefined) {
      updatedSettings[key] = String(processedBody[key]);
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
  const { action, rejection_reason } = await c.req.json<{ action: 'approve' | 'reject' | 'under_review'; rejection_reason?: string }>();
  const { sub } = c.get('user');
  const d = db(c);

  if (!['approve', 'reject', 'under_review'].includes(action)) {
    return c.json({ error: 'action must be approve, reject or under_review' }, 400);
  }

  const app = await d.prepare('SELECT * FROM host_applications WHERE id = ?').bind(id).first<any>();
  if (!app) return c.json({ error: 'Application not found' }, 404);

  const newStatus =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'under_review';
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
      COALESCE(wr.currency, 'INR') as currency,
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
  try {
    const result = await db(c).prepare('SELECT * FROM payment_gateways ORDER BY position ASC, created_at DESC').all();
    return c.json(result.results);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/no such table/i.test(msg)) {
      try {
        await db(c).prepare(`CREATE TABLE IF NOT EXISTS payment_gateways (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT 'manual',
          icon_emoji TEXT DEFAULT '💳',
          platforms TEXT DEFAULT '["all"]',
          instruction TEXT DEFAULT '',
          redirect_url TEXT DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )`).run();
      } catch { /* best effort */ }
      return c.json([]);
    }
    console.error('[admin/payment-gateways] GET error:', e);
    return c.json({ error: 'Failed to load gateways' }, 500);
  }
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
  try {
    const result = await db(c).prepare('SELECT * FROM manual_qr_codes ORDER BY position ASC, created_at DESC').all();
    return c.json(result.results);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/no such table/i.test(msg)) {
      // Table doesn't exist yet — create it on the fly and return empty
      try {
        await db(c).prepare(`CREATE TABLE IF NOT EXISTS manual_qr_codes (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          upi_id TEXT NOT NULL DEFAULT '',
          qr_image_url TEXT NOT NULL DEFAULT '',
          instructions TEXT DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL DEFAULT 0,
          rotate_interval_min INTEGER NOT NULL DEFAULT 30,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        )`).run();
      } catch { /* best effort */ }
      return c.json([]);
    }
    if (/no.*column/i.test(msg)) {
      // Table exists but missing columns — add them and retry
      const cols = [
        "ALTER TABLE manual_qr_codes ADD COLUMN instructions TEXT DEFAULT ''",
        "ALTER TABLE manual_qr_codes ADD COLUMN rotate_interval_min INTEGER NOT NULL DEFAULT 30",
        "ALTER TABLE manual_qr_codes ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE manual_qr_codes ADD COLUMN qr_image_url TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE manual_qr_codes ADD COLUMN updated_at INTEGER DEFAULT (unixepoch())",
      ];
      for (const sql of cols) { try { await db(c).prepare(sql).run(); } catch {} }
      try {
        const result = await db(c).prepare('SELECT * FROM manual_qr_codes ORDER BY position ASC, created_at DESC').all();
        return c.json(result.results);
      } catch { return c.json([]); }
    }
    console.error('[admin/manual-qr-codes] GET error:', e);
    return c.json({ error: 'Failed to load QR codes' }, 500);
  }
});
admin.post('/manual-qr-codes', async (c) => {
  const body = await c.req.json() as any;
  const id = crypto.randomUUID();
  try {
    await db(c).prepare(
      'INSERT INTO manual_qr_codes (id, name, upi_id, qr_image_url, instructions, is_active, position, rotate_interval_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
    ).bind(id, body.name || '', body.upi_id || '', body.qr_image_url || '', body.instructions || '', body.is_active !== false ? 1 : 0, body.position ?? 0, body.rotate_interval_min ?? 30).run();
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (/no such table/i.test(msg)) {
      // Auto-create table and retry
      await db(c).prepare(`CREATE TABLE IF NOT EXISTS manual_qr_codes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        upi_id TEXT NOT NULL DEFAULT '',
        qr_image_url TEXT NOT NULL DEFAULT '',
        instructions TEXT DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        rotate_interval_min INTEGER NOT NULL DEFAULT 30,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      )`).run();
      await db(c).prepare(
        'INSERT INTO manual_qr_codes (id, name, upi_id, qr_image_url, instructions, is_active, position, rotate_interval_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
      ).bind(id, body.name || '', body.upi_id || '', body.qr_image_url || '', body.instructions || '', body.is_active !== false ? 1 : 0, body.position ?? 0, body.rotate_interval_min ?? 30).run();
    } else if (/no column named/i.test(msg)) {
      // Table exists but is missing columns (old migration created it without all columns).
      // Add missing columns and retry.
      const missingCols = [
        { name: 'instructions', def: "ALTER TABLE manual_qr_codes ADD COLUMN instructions TEXT DEFAULT ''" },
        { name: 'rotate_interval_min', def: "ALTER TABLE manual_qr_codes ADD COLUMN rotate_interval_min INTEGER NOT NULL DEFAULT 30" },
        { name: 'position', def: "ALTER TABLE manual_qr_codes ADD COLUMN position INTEGER NOT NULL DEFAULT 0" },
        { name: 'qr_image_url', def: "ALTER TABLE manual_qr_codes ADD COLUMN qr_image_url TEXT NOT NULL DEFAULT ''" },
        { name: 'updated_at', def: "ALTER TABLE manual_qr_codes ADD COLUMN updated_at INTEGER DEFAULT (unixepoch())" },
      ];
      for (const col of missingCols) {
        try { await db(c).prepare(col.def).run(); } catch { /* column may already exist */ }
      }
      // Retry insert
      await db(c).prepare(
        'INSERT INTO manual_qr_codes (id, name, upi_id, qr_image_url, instructions, is_active, position, rotate_interval_min, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())'
      ).bind(id, body.name || '', body.upi_id || '', body.qr_image_url || '', body.instructions || '', body.is_active !== false ? 1 : 0, body.position ?? 0, body.rotate_interval_min ?? 30).run();
    } else {
      console.error('[admin/manual-qr-codes] POST insert error:', e);
      return c.json({ error: 'Failed to create QR code: ' + (msg || 'Unknown error') }, 500);
    }
  }
  const u = c.get('user');
  try {
    await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'create', 'manual_qr_code', id, `Manual QR created: ${body.name}`);
  } catch { /* audit log failure must never block the operation */ }
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
  try { await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'update', 'manual_qr_code', id, `Manual QR updated`); } catch {}
  return c.json({ success: true });
});
admin.delete('/manual-qr-codes/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM manual_qr_codes WHERE id = ?').bind(id).run();
  const u = c.get('user');
  try { await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'delete', 'manual_qr_code', id, `Manual QR deleted`); } catch {}
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

// ─── Reward Tasks CRUD ────────────────────────────────────────────────────────
// Admin-managed catalog of tasks users can complete inside the Rewards page.
// See migration 0043_reward_tasks.sql for the schema + task_type semantics.
const REWARD_TASK_FIELDS = [
  'code', 'title', 'description', 'icon', 'category', 'task_type',
  'target_count', 'coins_reward', 'cooldown_hours', 'cta_link', 'active', 'sort_order',
];

admin.get('/reward-tasks', async (c) => {
  const result = await db(c)
    .prepare('SELECT * FROM reward_tasks ORDER BY sort_order ASC, created_at ASC')
    .all();
  // Enrich each row with lifetime aggregate stats so admins can see engagement.
  const stats = await db(c).prepare(
    `SELECT task_id, COUNT(*) AS user_count, SUM(claim_count) AS claim_count,
            SUM(total_earned) AS coins_paid
       FROM user_reward_progress
      GROUP BY task_id`,
  ).all<{ task_id: string; user_count: number; claim_count: number; coins_paid: number }>();
  const statsByTask = new Map((stats.results ?? []).map((r) => [r.task_id, r]));
  const enriched = (result.results as Record<string, unknown>[] | undefined ?? []).map((row) => {
    const s = statsByTask.get(String(row.id));
    return {
      ...row,
      user_count: Number(s?.user_count ?? 0),
      claim_count: Number(s?.claim_count ?? 0),
      coins_paid: Number(s?.coins_paid ?? 0),
    };
  });
  return c.json(enriched);
});

admin.post('/reward-tasks', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!body.code || !body.title || !body.task_type || body.coins_reward == null) {
    return c.json({ error: 'code, title, task_type, coins_reward are required' }, 400);
  }
  const id = `rt_${crypto.randomUUID().slice(0, 12)}`;
  try {
    await db(c).prepare(
      `INSERT INTO reward_tasks
         (id, code, title, description, icon, category, task_type,
          target_count, coins_reward, cooldown_hours, cta_link, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      String(body.code),
      String(body.title),
      String(body.description ?? ''),
      String(body.icon ?? 'gift'),
      String(body.category ?? 'ongoing'),
      String(body.task_type),
      Math.max(1, Number(body.target_count ?? 1)),
      Math.max(0, Number(body.coins_reward)),
      Math.max(0, Number(body.cooldown_hours ?? 0)),
      String(body.cta_link ?? ''),
      body.active === false ? 0 : 1,
      Number(body.sort_order ?? 100),
    ).run();
    return c.json({ id, success: true }, 201);
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? '';
    if (msg.includes('UNIQUE') && msg.includes('code')) {
      return c.json({ error: 'A task with this code already exists' }, 409);
    }
    console.warn('[admin] reward-tasks create failed:', e);
    return c.json({ error: 'Could not create reward task' }, 500);
  }
});

admin.patch('/reward-tasks/:id', async (c) => {
  const { id } = c.req.param();
  const body = (await c.req.json()) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of REWARD_TASK_FIELDS) {
    if (body[f] === undefined) continue;
    // Coerce numeric fields to numbers so bad client input can't corrupt the row.
    if (['target_count', 'coins_reward', 'cooldown_hours', 'sort_order', 'active'].includes(f)) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) return c.json({ error: `${f} must be a number` }, 400);
      // CLAMP: money-affecting numeric fields must never go negative (would
      // debit users instead of crediting them). target_count/cooldown_hours
      // must be >= 0. `sort_order` and `active` are unbounded / boolean.
      const clamped =
        f === 'active'
          ? (n ? 1 : 0)
          : ['coins_reward', 'target_count', 'cooldown_hours'].includes(f)
          ? Math.max(0, Math.floor(n))
          : n;
      sets.push(`${f} = ?`);
      vals.push(clamped);
    } else {
      sets.push(`${f} = ?`);
      vals.push(String(body[f] ?? ''));
    }
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push(id);
  await db(c)
    .prepare(`UPDATE reward_tasks SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();
  return c.json({ success: true });
});

admin.delete('/reward-tasks/:id', async (c) => {
  const { id } = c.req.param();
  // Physical delete: the progress rows for this task become orphaned (their
  // task_id no longer resolves) but are harmless — the /rewards endpoint only
  // returns joined rows. If you want to preserve history, set `active = 0`
  // instead of deleting.
  await db(c).batch([
    db(c).prepare('DELETE FROM user_reward_progress WHERE task_id = ?').bind(id),
    db(c).prepare('DELETE FROM reward_tasks WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});

// ─── Reward Spin Wheel (single-row config) ────────────────────────────────────
// GET returns the current wheel config PLUS aggregate stats so admins can
// see total spins, coins paid, and the win distribution across segments.
admin.get('/reward-spin', async (c) => {
  const d = db(c);
  const config = await d.prepare('SELECT * FROM reward_spin_config WHERE id = ?').bind('default').first<any>();
  const stats = await d.prepare(
    `SELECT COUNT(*) AS total_spins,
            COUNT(DISTINCT user_id) AS unique_spinners,
            COALESCE(SUM(coins_won), 0) AS coins_paid,
            COALESCE(AVG(coins_won), 0) AS avg_win
       FROM reward_spin_history`,
  ).first<any>();
  const dist = await d.prepare(
    `SELECT segment_label, COUNT(*) AS count, SUM(coins_won) AS coins
       FROM reward_spin_history
      GROUP BY segment_label
      ORDER BY count DESC`,
  ).all<any>();
  return c.json({ config, stats, distribution: dist.results ?? [] });
});

admin.patch('/reward-spin', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.enabled !== undefined) {
    sets.push('enabled = ?');
    vals.push(body.enabled ? 1 : 0);
  }
  if (body.daily_free_spins !== undefined) {
    const n = Math.max(0, Number(body.daily_free_spins));
    sets.push('daily_free_spins = ?');
    vals.push(n);
  }
  if (body.segments !== undefined) {
    // Validate: must be a non-empty array of { label, coins, weight, color?, emoji? }
    let segs: unknown = body.segments;
    if (typeof segs === 'string') {
      try { segs = JSON.parse(segs); } catch { return c.json({ error: 'segments must be valid JSON' }, 400); }
    }
    if (!Array.isArray(segs) || segs.length === 0) {
      return c.json({ error: 'segments must be a non-empty array' }, 400);
    }
    for (const s of segs) {
      if (!s || typeof s !== 'object') return c.json({ error: 'each segment must be an object' }, 400);
      const seg = s as Record<string, unknown>;
      if (typeof seg.label !== 'string' || !seg.label.trim()) return c.json({ error: 'each segment needs a non-empty label' }, 400);
      if (!Number.isFinite(Number(seg.coins)) || Number(seg.coins) < 0) return c.json({ error: 'coins must be >= 0' }, 400);
      if (!Number.isFinite(Number(seg.weight)) || Number(seg.weight) <= 0) return c.json({ error: 'weight must be > 0' }, 400);
    }
    sets.push('segments = ?');
    vals.push(JSON.stringify(segs));
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  sets.push('updated_at = unixepoch()');
  vals.push('default');
  await db(c).prepare(`UPDATE reward_spin_config SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

// ─── Reward Campaigns CRUD ────────────────────────────────────────────────────
admin.get('/reward-campaigns', async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const res = await db(c)
    .prepare('SELECT * FROM reward_campaigns ORDER BY starts_at DESC')
    .all<any>();
  const rows = (res.results ?? []).map((r) => ({
    ...r,
    active_now: r.active === 1 && Number(r.starts_at) <= now && Number(r.ends_at) >= now,
  }));
  return c.json(rows);
});

admin.post('/reward-campaigns', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!body.code || !body.title || body.starts_at == null || body.ends_at == null || body.multiplier == null) {
    return c.json({ error: 'code, title, starts_at, ends_at, multiplier are required' }, 400);
  }
  const startsAt = Number(body.starts_at);
  const endsAt = Number(body.ends_at);
  const mult = Number(body.multiplier);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
    return c.json({ error: 'ends_at must be after starts_at' }, 400);
  }
  if (!Number.isFinite(mult) || mult < 1 || mult > 20) {
    return c.json({ error: 'multiplier must be between 1 and 20' }, 400);
  }
  const id = `rc_${crypto.randomUUID().slice(0, 12)}`;
  try {
    await db(c).prepare(
      `INSERT INTO reward_campaigns
         (id, code, title, description, banner_image_url, starts_at, ends_at, multiplier, applies_to_task_types, applies_to_spin, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      String(body.code).slice(0, 40),
      String(body.title).slice(0, 100),
      String(body.description ?? '').slice(0, 500),
      String(body.banner_image_url ?? ''),
      startsAt,
      endsAt,
      mult,
      String(body.applies_to_task_types ?? ''),
      body.applies_to_spin === false ? 0 : 1,
      body.active === false ? 0 : 1,
    ).run();
    return c.json({ id, success: true }, 201);
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? '';
    if (msg.includes('UNIQUE')) return c.json({ error: 'A campaign with this code already exists' }, 409);
    console.warn('[admin] campaign create failed:', e);
    return c.json({ error: 'Could not create campaign' }, 500);
  }
});

admin.patch('/reward-campaigns/:id', async (c) => {
  const { id } = c.req.param();
  const body = (await c.req.json()) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const stringFields = ['code', 'title', 'description', 'banner_image_url', 'applies_to_task_types'];
  const numberFields = ['starts_at', 'ends_at', 'multiplier'];
  for (const f of stringFields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(String(body[f])); }
  }
  for (const f of numberFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) return c.json({ error: `${f} must be a number` }, 400);
      // CLAMP: multiplier must stay in the same [1, 20] window POST enforces,
      // otherwise a stealth PATCH can turn a normal task into an infinite
      // coin printer (multiplier=999) or debit users (multiplier=-1).
      // Timestamps stay unclamped (they're free-form epoch seconds).
      const clamped = f === 'multiplier' ? Math.min(20, Math.max(1, n)) : n;
      sets.push(`${f} = ?`); vals.push(clamped);
    }
  }
  // Cross-field sanity: if BOTH starts_at and ends_at were supplied, they
  // must obey starts_at < ends_at (same rule POST enforces).
  if (body.starts_at !== undefined && body.ends_at !== undefined) {
    const s = Number(body.starts_at), e = Number(body.ends_at);
    if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
      return c.json({ error: 'ends_at must be after starts_at' }, 400);
    }
  }
  if (body.applies_to_spin !== undefined) { sets.push('applies_to_spin = ?'); vals.push(body.applies_to_spin ? 1 : 0); }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);
  await db(c).prepare(`UPDATE reward_campaigns SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

admin.delete('/reward-campaigns/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).prepare('DELETE FROM reward_campaigns WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─── Reward Coupons CRUD (single + bulk generation) ───────────────────────────
admin.get('/reward-coupons', async (c) => {
  const res = await db(c).prepare('SELECT * FROM reward_coupons ORDER BY created_at DESC').all<any>();
  return c.json(res.results ?? []);
});

admin.post('/reward-coupons', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!body.coins_reward) return c.json({ error: 'coins_reward is required' }, 400);
  const coins = Math.max(0, Number(body.coins_reward));
  const maxUses = body.max_uses == null || body.max_uses === '' ? null : Math.max(1, Number(body.max_uses));
  const perUserLimit = Math.max(1, Number(body.per_user_limit ?? 1));
  const expiresAt = body.expires_at == null || body.expires_at === '' ? null : Number(body.expires_at);

  // Bulk generation: if `count` and `prefix` are supplied, generate N unique
  // codes. Otherwise take the provided `code` field verbatim.
  const bulk = Number(body.count ?? 0);
  const prefix = String(body.prefix ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const created: string[] = [];

  if (bulk > 1) {
    if (bulk > 500) return c.json({ error: 'count must be <= 500' }, 400);
    for (let i = 0; i < bulk; i++) {
      // 8-char random suffix — 32 chars in [A-Z0-9] → ~10^12 combos.
      const suffix = Array.from({ length: 8 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
      const code = (prefix ? `${prefix}-${suffix}` : suffix).slice(0, 40);
      try {
        await db(c).prepare(
          `INSERT INTO reward_coupons (id, code, coins_reward, max_uses, per_user_limit, expires_at, active, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(`co_${crypto.randomUUID().slice(0, 12)}`, code, coins, maxUses, perUserLimit, expiresAt, body.active === false ? 0 : 1, String(body.note ?? '')).run();
        created.push(code);
      } catch {
        // duplicate — skip
      }
    }
    return c.json({ success: true, created, count: created.length }, 201);
  }

  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code || code.length < 3) return c.json({ error: 'code must be at least 3 chars (A-Z0-9_-)' }, 400);
  try {
    const id = `co_${crypto.randomUUID().slice(0, 12)}`;
    await db(c).prepare(
      `INSERT INTO reward_coupons (id, code, coins_reward, max_uses, per_user_limit, expires_at, active, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, code, coins, maxUses, perUserLimit, expiresAt, body.active === false ? 0 : 1, String(body.note ?? '')).run();
    return c.json({ id, code, success: true }, 201);
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? '';
    if (msg.includes('UNIQUE')) return c.json({ error: 'Code already exists' }, 409);
    console.warn('[admin] coupon create failed:', e);
    return c.json({ error: 'Could not create coupon' }, 500);
  }
});

admin.patch('/reward-coupons/:id', async (c) => {
  const { id } = c.req.param();
  const body = (await c.req.json()) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.coins_reward !== undefined) { sets.push('coins_reward = ?'); vals.push(Math.max(0, Number(body.coins_reward))); }
  if (body.max_uses !== undefined) { sets.push('max_uses = ?'); vals.push(body.max_uses == null || body.max_uses === '' ? null : Math.max(1, Number(body.max_uses))); }
  if (body.per_user_limit !== undefined) { sets.push('per_user_limit = ?'); vals.push(Math.max(1, Number(body.per_user_limit))); }
  if (body.expires_at !== undefined) { sets.push('expires_at = ?'); vals.push(body.expires_at == null || body.expires_at === '' ? null : Number(body.expires_at)); }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0); }
  if (body.note !== undefined) { sets.push('note = ?'); vals.push(String(body.note)); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);
  await db(c).prepare(`UPDATE reward_coupons SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

admin.delete('/reward-coupons/:id', async (c) => {
  const { id } = c.req.param();
  await db(c).batch([
    db(c).prepare('DELETE FROM user_coupon_redemptions WHERE coupon_id = ?').bind(id),
    db(c).prepare('DELETE FROM reward_coupons WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});

// ─── Reward Achievements CRUD ─────────────────────────────────────────────────
admin.get('/reward-achievements', async (c) => {
  const res = await db(c).prepare('SELECT * FROM reward_achievements ORDER BY sort_order ASC').all<any>();
  const stats = await db(c).prepare(
    `SELECT achievement_id, COUNT(*) AS unlocked_count, COALESCE(SUM(coins_awarded), 0) AS coins_paid
       FROM user_achievements GROUP BY achievement_id`,
  ).all<{ achievement_id: string; unlocked_count: number; coins_paid: number }>();
  const byId = new Map((stats.results ?? []).map((r) => [r.achievement_id, r]));
  return c.json((res.results ?? []).map((r: any) => ({
    ...r,
    unlocked_count: Number(byId.get(r.id)?.unlocked_count ?? 0),
    coins_paid: Number(byId.get(r.id)?.coins_paid ?? 0),
  })));
});

admin.post('/reward-achievements', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!body.code || !body.title || !body.trigger_type || body.trigger_threshold == null) {
    return c.json({ error: 'code, title, trigger_type, trigger_threshold required' }, 400);
  }
  const id = `ach_${crypto.randomUUID().slice(0, 12)}`;
  try {
    await db(c).prepare(
      `INSERT INTO reward_achievements
         (id, code, title, description, icon, tier, trigger_type, trigger_threshold, coins_reward, active, sort_order, duration_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      String(body.code).slice(0, 40),
      String(body.title).slice(0, 100),
      String(body.description ?? '').slice(0, 300),
      String(body.icon ?? 'trophy'),
      String(body.tier ?? 'bronze'),
      String(body.trigger_type),
      Math.max(1, Number(body.trigger_threshold)),
      Math.max(0, Number(body.coins_reward ?? 0)),
      body.active === false ? 0 : 1,
      Number(body.sort_order ?? 100),
      Math.max(0, Number(body.duration_days ?? 7)),
    ).run();
    return c.json({ id, success: true }, 201);
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? '';
    if (msg.includes('UNIQUE')) return c.json({ error: 'Code already exists' }, 409);
    return c.json({ error: 'Could not create achievement' }, 500);
  }
});

admin.patch('/reward-achievements/:id', async (c) => {
  const { id } = c.req.param();
  const body = (await c.req.json()) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const stringFields = ['code', 'title', 'description', 'icon', 'tier', 'trigger_type'];
  const numberFields = ['trigger_threshold', 'coins_reward', 'sort_order', 'duration_days'];
  for (const f of stringFields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(String(body[f])); }
  }
  for (const f of numberFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n)) return c.json({ error: `${f} must be a number` }, 400);
      // CLAMP: match the POST endpoint's guarantees exactly so a stealth
      // PATCH can't create pathological achievement configs (negative
      // coins → debit; threshold=0 → unlock on first bump; duration=-1).
      const clamped =
        f === 'trigger_threshold' ? Math.max(1, Math.floor(n)) :
        f === 'coins_reward'      ? Math.max(0, Math.floor(n)) :
        f === 'duration_days'     ? Math.max(0, Math.floor(n)) :
        Math.floor(n); // sort_order — unbounded but must be integer
      sets.push(`${f} = ?`); vals.push(clamped);
    }
  }
  if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0); }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(id);

  // If the admin changed the trigger_type OR raised the trigger_threshold,
  // any per-user progress row we already have was counted against a
  // DIFFERENT set of events and carries the wrong semantics. Reset the
  // rolling-window counters so users start fresh under the new rule. We
  // deliberately leave user_achievements (the unlock ledger) untouched
  // — badges already granted stay granted, we don't want to claw them
  // back on an admin edit.
  const resetProgress =
    body.trigger_type !== undefined ||
    (body.trigger_threshold !== undefined && Number(body.trigger_threshold) > 0);

  const stmts = [db(c).prepare(`UPDATE reward_achievements SET ${sets.join(', ')} WHERE id = ?`).bind(...vals)];
  if (resetProgress) {
    stmts.push(
      db(c).prepare(
        `UPDATE user_achievement_progress
            SET current_count = 0,
                started_at    = NULL,
                updated_at    = unixepoch()
          WHERE achievement_id = ?`,
      ).bind(id),
    );
  }
  await db(c).batch(stmts);
  return c.json({ success: true, progress_reset: resetProgress });
});

admin.delete('/reward-achievements/:id', async (c) => {
  const { id } = c.req.param();
  // Full orphan cleanup: three tables reference an achievement by id and
  // ALL of them must be purged. Missing any one leaves stale rows that
  // the /rewards endpoint will happily join against zombie achievement
  // rows if a new achievement is later inserted with the same id.
  //
  //   user_achievements          — unlock ledger (badge + coins credited)
  //   user_achievement_progress  — per-user rolling-window counters (0046)
  //   reward_achievements        — the achievement definition itself
  await db(c).batch([
    db(c).prepare('DELETE FROM user_achievement_progress WHERE achievement_id = ?').bind(id),
    db(c).prepare('DELETE FROM user_achievements WHERE achievement_id = ?').bind(id),
    db(c).prepare('DELETE FROM reward_achievements WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});

// ─── Rewards analytics (dashboard summary) ────────────────────────────────────
admin.get('/reward-analytics', async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;
  const week = now - 7 * 86400;
  // Today's coin payout — read from reward_budget_daily, which is the
  // authoritative per-UTC-day counter the reward payout batch UPDATEs on
  // every credit. Uses the same utcDayKey format the reward code writes.
  const utcDay = (() => {
    const d = new Date(now * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  })();
  const [today, weekPaid, taskTop, campActive, couponActive] = await Promise.all([
    db(c).prepare(
      `SELECT COALESCE(coins_paid, 0) AS paid, 0 AS n
         FROM reward_budget_daily
        WHERE day_key = ?`,
    ).bind(utcDay).first<any>(),
    db(c).prepare(
      `SELECT day_key, coins_paid FROM reward_budget_daily ORDER BY day_key DESC LIMIT 14`,
    ).all<any>(),
    db(c).prepare(
      `SELECT t.title, t.code, SUM(p.total_earned) AS coins_paid, SUM(p.claim_count) AS claims
         FROM user_reward_progress p INNER JOIN reward_tasks t ON t.id = p.task_id
        GROUP BY t.id
        ORDER BY coins_paid DESC LIMIT 10`,
    ).all<any>(),
    db(c).prepare(
      `SELECT id, code, title, multiplier, starts_at, ends_at
         FROM reward_campaigns
        WHERE active = 1 AND starts_at <= ? AND ends_at >= ?
        ORDER BY created_at DESC`,
    ).bind(now, now).all<any>(),
    db(c).prepare(
      `SELECT COUNT(*) AS n FROM reward_coupons WHERE active = 1`,
    ).first<any>(),
  ]);
  return c.json({
    today,
    daily_series: weekPaid.results ?? [],
    top_tasks: taskTop.results ?? [],
    active_campaigns: campActive.results ?? [],
    active_coupons: Number(couponActive?.n ?? 0),
    server_time: now,
    since_day: day,
    since_week: week,
  });
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

// ─── Admin live-call listen-in (Agora) ─────────────────────────────────────
// Mints an Agora RTC token so an admin can silently JOIN an active call's
// channel and listen in for moderation. The channel is the call session id
// (the same channel both participants joined). The admin client subscribes to
// remote audio only and never publishes a mic/camera track, so the two parties
// are not disturbed and don't hear/see the admin. Admin-only (adminMiddleware).
// Every join is written to the audit log for accountability.
admin.get('/calls/:id/agora-token', async (c) => {
  const { id } = c.req.param();
  if (!isAgoraConfigured(c.env)) {
    return c.json({ error: 'Agora not configured — set AGORA_APP_ID / AGORA_APP_CERTIFICATE' }, 500);
  }
  const session = await db(c).prepare(
    'SELECT id, type, status FROM call_sessions WHERE id = ?'
  ).bind(id).first<{ id: string; type: string; status: string }>();
  if (!session) return c.json({ error: 'Call not found' }, 404);
  if (session.status !== 'active') return c.json({ error: 'Call is not active' }, 409);

  const channel = id;
  const uid = 0; // auto-assign; a uid-0 token is valid for any uid on the channel
  const EXPIRE_SECONDS = 2 * 60 * 60;
  try {
    const token = await buildAgoraRtcToken(
      c.env.AGORA_APP_ID!,
      c.env.AGORA_APP_CERTIFICATE!,
      channel,
      uid,
      EXPIRE_SECONDS,
    );
    const u = c.get('user');
    await auditLog(db(c), u.sub, u.email || 'Admin', u.email || '', 'view', 'calls', id, `Listened in on live call ${id.slice(0, 8)}`);
    return c.json({
      provider: 'agora' as const,
      app_id: c.env.AGORA_APP_ID,
      channel,
      uid,
      token,
      call_type: session.type,
    });
  } catch (e: any) {
    console.error('[admin/agora-token] token build failed:', e);
    return c.json({ error: 'Failed to build Agora token' }, 500);
  }
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
    `SELECT cs.*, h.user_id as host_user_id, h.level as host_level
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
  // (Agora media sessions need no server-side teardown — Agora releases the
  //  channel automatically once both participants leave.)
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
  // Use the host's LEVEL-BASED earning share (same as POST /api/calls/end),
  // not a hardcoded 0.7 — otherwise force-ending a high-level host's call
  // under-pays them (their configured share can be up to ~0.80).
  const levelCfg = await getLevelConfig(dbA);
  const earningShare = getEarningShare(session.host_level ?? 1, levelCfg);
  const hostShare = Math.floor(coinsCharged * earningShare);

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
//   - coin_value_inr = 0.05 (stored as coin_to_usd_rate = 0.0006; 1 coin = ₹0.05 host payout)
//   - min_withdrawal_coins = 1000  (= ₹50)
//   - host_revenue_share = 0.70 (level 1 hosts; per-level overrides up to 0.80)
//   - default + random call rates = 25 audio / 40 video (canonical)
//   - level_config: 70/70/72/75/80% earning share, 25/40 random rates
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
    ['coin_value_inr', '0.05'],          // canonical INR source of truth
    ['coin_to_usd_rate', '0.0006'],      // ≈ ₹0.05 ÷ 83 (FX cron re-pins it)
    ['host_revenue_share', '0.70'],
    ['min_withdrawal_coins', '1000'],
    ['default_audio_rate', '25'],
    ['default_video_rate', '40'],
    ['random_call_audio_rate', '25'],
    ['random_call_video_rate', '40'],
  ];

  // ─── 3. Level config — 5-tier ladder (canonical earning shares + rates) ─
  // Earning share matches DEFAULT_LEVEL_CONFIG (0.70 → 0.80) and per-level
  // random rates default to the canonical 25/40 so this seed stays consistent
  // with the rest of the economy. Admins can still tune per-level rates later.
  const indiaLevelConfig = [
    { level: 1, name: 'Newcomer', badge: '🌱', color: '#6B7280', min_calls: 0,    min_rating: 0.0, coin_reward: 0,    description: 'New to the platform',  perks: { max_rate: 100, max_audio_rate: 100, max_video_rate: 100, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 0 } },
    { level: 2, name: 'Rising',   badge: '⭐', color: '#F59E0B', min_calls: 50,   min_rating: 4.0, coin_reward: 100,  description: 'Getting established',   perks: { max_rate: 150, max_audio_rate: 150, max_video_rate: 150, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.70, rank_boost: 1 } },
    { level: 3, name: 'Expert',   badge: '🔥', color: '#EF4444', min_calls: 200,  min_rating: 4.3, coin_reward: 300,  description: 'Proven expertise',      perks: { max_rate: 250, max_audio_rate: 250, max_video_rate: 250, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.72, rank_boost: 2 } },
    { level: 4, name: 'Pro',      badge: '💎', color: '#8B5CF6', min_calls: 500,  min_rating: 4.6, coin_reward: 500,  description: 'Professional tier',     perks: { max_rate: 400, max_audio_rate: 400, max_video_rate: 400, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.75, rank_boost: 3 } },
    { level: 5, name: 'Elite',    badge: '👑', color: '#D97706', min_calls: 1000, min_rating: 4.8, coin_reward: 1000, description: 'Top performer',         perks: { max_rate: 500, max_audio_rate: 500, max_video_rate: 500, random_audio_rate: 25, random_video_rate: 40, earning_share: 0.80, rank_boost: 5 } },
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
    `Seeded India coin economy: ${indiaPlans.length} INR plans, level_config retuned, coin_value_inr=0.05 (coin_to_usd_rate=0.0006), min_withdrawal_coins=1000, rates 25/40`,
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
// One-click production setup behind the admin "Apply Optimized Coin Economy"
// card. Applies the EXACT economy the card advertises, in INR:
//   • Coin value         ₹0.05/coin (stored as coin_to_usd_rate via live FX)
//   • Host revenue share  70%
//   • Min withdrawal      1000 coins (₹50)
//   • Call rates          ₹1.25/min audio (25 coins), ₹2.00/min video (40 coins)
//   • Plans               8 INR tiers, ₹49 → ₹4999, with climbing bonuses
//   • Referral rewards + daily streak enabled
//
// First runs the auto-migrator to guarantee the schema exists, then writes the
// economy in a single atomic D1 batch and broadcasts a real-time
// `app_settings_update` over WebSocket so every connected app re-prices live.
// Idempotent: re-running converges to the same end state.
admin.post('/seed-coin-economy', async (c) => {
  try {
    const database = db(c);
    const u = c.get('user');
    const ip = c.req.header('CF-Connecting-IP') ?? '';

    // 0. Make sure all schema columns/tables exist before we write to them.
    //    Idempotent — already-applied migrations are skipped.
    await ensureAllMigrations(c.env.DB);

    // ─── The optimized INR coin economy (matches the admin card 1:1) ───────
    // Coin value is the single source of truth: 1 coin = ₹0.05. Everything
    // else (call rates in coins, plan coin counts, min-withdrawal) is derived
    // from it so the numbers the admin sees on the card are exactly what
    // production runs with.
    const COIN_VALUE_INR = 0.05;          // ₹ per coin
    const HOST_REVENUE_SHARE = 0.70;      // host keeps 70% of coins earned
    const MIN_WITHDRAWAL_COINS = 1000;    // ₹50 at ₹0.05/coin
    // Call rates expressed in coins/min — the canonical platform defaults.
    // 25 coins/min audio = ₹1.25/min, 40 coins/min video = ₹2.00/min at
    // ₹0.05/coin (host gets 70% → ₹0.875 / ₹1.40 per min). Kept identical to
    // DEFAULT_AUDIO_RATE / DEFAULT_VIDEO_RATE so the seed, the code defaults and
    // migration 0042 all agree.
    const AUDIO_RATE_COINS = 25;
    const VIDEO_RATE_COINS = 40;

    // Live INR→USD FX so the stored coin_to_usd_rate always represents ₹0.05,
    // regardless of the current exchange rate. Falls back to 83 if the
    // cron-refreshed fx_rates_usd blob is missing/corrupt.
    let inrRate = 83;
    const fxRow = await database
      .prepare("SELECT value FROM app_settings WHERE key = 'fx_rates_usd'")
      .first<{ value: string }>();
    if (fxRow?.value) {
      try {
        const rates = JSON.parse(fxRow.value);
        if (rates.INR && rates.INR > 0) inrRate = rates.INR;
      } catch {}
    }
    const coinToUsdRate = COIN_VALUE_INR / inrRate; // e.g. 0.05 / 83 = 0.000602…

    // ─── 8-tier INR plan ladder (₹49 → ₹4999) with climbing bonus ──────────
    // coins = base (price × 20 at ₹0.05/coin), bonus_coins = loyalty bonus.
    const plans: Array<{
      id: string; name: string; coins: number; price: number; bonus: number; popular: 0 | 1;
    }> = [
      { id: 'opt-in-049',  name: 'Starter', coins: 1000,   price: 49,   bonus: 0,     popular: 0 },
      { id: 'opt-in-099',  name: 'Mini',    coins: 2000,   price: 99,   bonus: 100,   popular: 0 },
      { id: 'opt-in-199',  name: 'Popular', coins: 4000,   price: 199,  bonus: 400,   popular: 1 },
      { id: 'opt-in-499',  name: 'Value',   coins: 10000,  price: 499,  bonus: 1500,  popular: 0 },
      { id: 'opt-in-999',  name: 'Super',   coins: 20000,  price: 999,  bonus: 4000,  popular: 0 },
      { id: 'opt-in-1999', name: 'Pro',     coins: 40000,  price: 1999, bonus: 10000, popular: 0 },
      { id: 'opt-in-2999', name: 'Elite',   coins: 60000,  price: 2999, bonus: 18000, popular: 0 },
      { id: 'opt-in-4999', name: 'Mega',    coins: 100000, price: 4999, bonus: 35000, popular: 0 },
    ];

    // ─── App settings (the economy knobs) ──────────────────────────────────
    const settingUpserts: Array<[string, string]> = [
      ['coin_value_inr',           String(COIN_VALUE_INR)], // canonical INR source of truth
      ['coin_to_usd_rate',         String(coinToUsdRate)],
      ['host_revenue_share',       String(HOST_REVENUE_SHARE)],
      ['min_withdrawal_coins',     String(MIN_WITHDRAWAL_COINS)],
      ['default_audio_rate',       String(AUDIO_RATE_COINS)],
      ['default_video_rate',       String(VIDEO_RATE_COINS)],
      ['random_call_audio_rate',   String(AUDIO_RATE_COINS)],
      ['random_call_video_rate',   String(VIDEO_RATE_COINS)],
      ['min_coins_for_call',       '20'],   // ≈ ₹1 floor to start a call
      ['registration_bonus_coins', '100'],  // ₹5 welcome coins
      // Referral rewards + daily streak (card mentions both).
      ['referrer_reward',          '100'],
      ['new_user_reward',          '50'],
      ['referral_active',          '1'],
      ['daily_streak_enabled',     '1'],
    ];

    // ─── Execute atomically (D1 batch) ─────────────────────────────────────
    const ops: D1PreparedStatement[] = [];

    // 1. wipe + reseed coin_plans (all INR-native, whole-rupee prices)
    ops.push(database.prepare('DELETE FROM coin_plans'));
    for (const p of plans) {
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

    await database.batch(ops);

    // ─── REAL-TIME: broadcast the new economy to every connected app ───────
    // Mirrors the PATCH /settings broadcast so user/host apps update the coin
    // value + call rates live, without a refresh.
    const broadcast = {
      coin_to_usd_rate: String(coinToUsdRate),
      host_revenue_share: String(HOST_REVENUE_SHARE),
      default_audio_rate: String(AUDIO_RATE_COINS),
      default_video_rate: String(VIDEO_RATE_COINS),
      random_call_audio_rate: String(AUDIO_RATE_COINS),
      random_call_video_rate: String(VIDEO_RATE_COINS),
      min_withdrawal_coins: String(MIN_WITHDRAWAL_COINS),
    };
    const settingsUpdateMsg = JSON.stringify({
      type: 'app_settings_update',
      settings: broadcast,
      critical: true, // coin value changed — apps should refresh pricing
      timestamp: Date.now(),
      updated_by: u.email || 'Admin',
    });
    const allUsers = await database
      .prepare("SELECT id FROM users WHERE status != 'deleted' LIMIT 10000")
      .all<{ id: string }>();
    if (allUsers.results && allUsers.results.length > 0) {
      const CHUNK_SIZE = 50;
      for (let i = 0; i < allUsers.results.length; i += CHUNK_SIZE) {
        const chunk = allUsers.results.slice(i, i + CHUNK_SIZE);
        await Promise.allSettled(
          chunk.map(async (user) => {
            try {
              const notifStub = c.env.NOTIFICATION_HUB.get(
                c.env.NOTIFICATION_HUB.idFromName(user.id),
              );
              await notifStub.fetch('https://dummy/notify', { method: 'POST', body: settingsUpdateMsg });
            } catch {}
          }),
        );
      }
    }

    await auditLog(
      database,
      u.sub,
      u.email || 'Admin',
      u.email || '',
      'update',
      'settings',
      'coin_economy',
      `Applied optimized INR economy: ${plans.length} plans (₹49→₹4999), coin_value=₹${COIN_VALUE_INR} (coin_to_usd_rate=${coinToUsdRate}), host_share=${HOST_REVENUE_SHARE}, min_withdrawal=${MIN_WITHDRAWAL_COINS} coins`,
      ip,
    );

    return c.json({
      success: true,
      details: {
        coin_value: {
          inr: COIN_VALUE_INR,
          usd: coinToUsdRate,
          display: `₹${COIN_VALUE_INR}`,
        },
        host_revenue_share: HOST_REVENUE_SHARE,
        min_withdrawal_coins: MIN_WITHDRAWAL_COINS,
        call_rates: { audio_coins: AUDIO_RATE_COINS, video_coins: VIDEO_RATE_COINS },
        plans: plans.map((p) => ({ name: p.name, price: p.price, coins: p.coins, bonus: p.bonus })),
        realtime_broadcast: true,
      },
      settings_updated: settingUpserts.map(([k]) => k),
    });
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

// ─── Daily Streak Analytics ─────────────────────────────────────────────────
// Read-only engagement dashboard data: how many users have active streaks,
// the streak-length distribution, claims today, and the all-time longest
// streak. Tolerates legacy schemas (missing columns) by defaulting to zeroes
// so the admin panel never errors on an un-migrated DB.
admin.get('/streak-analytics', async (c) => {
  const database = db(c);
  const now = Math.floor(Date.now() / 1000);
  const IST_OFFSET = 5 * 3600 + 30 * 60;
  const SECS_DAY = 86400;
  const todayStart = Math.floor((now + IST_OFFSET) / SECS_DAY) * SECS_DAY - IST_OFFSET;

  const safe = async <T>(fn: () => Promise<T | null>, dflt: T): Promise<T> => {
    try { return (await fn()) ?? dflt; } catch { return dflt; }
  };

  const totals = await safe(
    () =>
      database
        .prepare(
          `SELECT COUNT(*) AS users_with_streak,
                  COALESCE(MAX(streak_days), 0) AS max_streak,
                  COALESCE(AVG(streak_days), 0) AS avg_streak
           FROM users WHERE COALESCE(streak_days, 0) > 0`,
        )
        .first<{ users_with_streak: number; max_streak: number; avg_streak: number }>(),
    { users_with_streak: 0, max_streak: 0, avg_streak: 0 },
  );

  const claimedToday = await safe(
    () =>
      database
        .prepare('SELECT COUNT(*) AS n FROM users WHERE COALESCE(last_streak_claim_at, 0) >= ?')
        .bind(todayStart)
        .first<{ n: number }>(),
    { n: 0 },
  );

  const dist = await safe(
    () =>
      database
        .prepare(
          `SELECT
             SUM(CASE WHEN streak_days = 1 THEN 1 ELSE 0 END) AS d1,
             SUM(CASE WHEN streak_days BETWEEN 2 AND 6 THEN 1 ELSE 0 END) AS d2_6,
             SUM(CASE WHEN streak_days BETWEEN 7 AND 29 THEN 1 ELSE 0 END) AS d7_29,
             SUM(CASE WHEN streak_days BETWEEN 30 AND 99 THEN 1 ELSE 0 END) AS d30_99,
             SUM(CASE WHEN streak_days >= 100 THEN 1 ELSE 0 END) AS d100p
           FROM users WHERE COALESCE(streak_days, 0) > 0`,
        )
        .first<{ d1: number; d2_6: number; d7_29: number; d30_99: number; d100p: number }>(),
    { d1: 0, d2_6: 0, d7_29: 0, d30_99: 0, d100p: 0 },
  );

  return c.json({
    users_with_active_streak: totals.users_with_streak ?? 0,
    longest_streak: totals.max_streak ?? 0,
    average_streak: Math.round((totals.avg_streak ?? 0) * 10) / 10,
    claimed_today: claimedToday.n ?? 0,
    distribution: {
      day_1: dist.d1 ?? 0,
      day_2_6: dist.d2_6 ?? 0,
      day_7_29: dist.d7_29 ?? 0,
      day_30_99: dist.d30_99 ?? 0,
      day_100_plus: dist.d100p ?? 0,
    },
  });
});

// ─── Coin Reconciliation (money integrity dashboard) ────────────────────────
// Read-only. Surfaces the coin economy's health so an operator can spot money
// bugs early:
//   • circulation  — total coins held across all live users
//   • ledger_net   — net of all coin_transactions (should track circulation
//                    closely now that every grant/charge writes a ledger row)
//   • ledger_by_type — breakdown (purchase / spend / bonus / refund / …)
//   • top_drifters — users whose balance diverges most from their own ledger
//                    sum. Pre-fix accounts (welcome bonuses that predate the
//                    ledger fix) show expected drift, so this is an anomaly
//                    radar, not a hard invariant.
// Legacy-tolerant: any sub-query that hits a missing column defaults to zero
// so the endpoint never errors on an un-migrated DB.
admin.get('/coin-reconciliation', async (c) => {
  const database = db(c);
  const safe = async <T>(fn: () => Promise<T | null>, dflt: T): Promise<T> => {
    try { return (await fn()) ?? dflt; } catch { return dflt; }
  };

  const circ = await safe(
    () =>
      database
        .prepare("SELECT COUNT(*) AS users, COALESCE(SUM(coins), 0) AS total_coins FROM users WHERE COALESCE(status, 'active') != 'deleted'")
        .first<{ users: number; total_coins: number }>(),
    { users: 0, total_coins: 0 },
  );

  const net = await safe(
    () => database.prepare('SELECT COALESCE(SUM(amount), 0) AS net FROM coin_transactions').first<{ net: number }>(),
    { net: 0 },
  );

  const byType = await safe(
    async () =>
      (await database
        .prepare('SELECT type, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM coin_transactions GROUP BY type ORDER BY ABS(SUM(amount)) DESC')
        .all<{ type: string; count: number; total: number }>()).results,
    [] as Array<{ type: string; count: number; total: number }>,
  );

  const drifters = await safe(
    async () =>
      (await database
        .prepare(
          `SELECT u.id, u.name, u.coins AS balance, COALESCE(t.sum, 0) AS ledger_sum,
                  (u.coins - COALESCE(t.sum, 0)) AS drift
           FROM users u
           LEFT JOIN (SELECT user_id, SUM(amount) AS sum FROM coin_transactions GROUP BY user_id) t
             ON t.user_id = u.id
           WHERE COALESCE(u.status, 'active') != 'deleted'
           ORDER BY ABS(u.coins - COALESCE(t.sum, 0)) DESC
           LIMIT 20`,
        )
        .all<{ id: string; name: string; balance: number; ledger_sum: number; drift: number }>()).results,
    [] as Array<{ id: string; name: string; balance: number; ledger_sum: number; drift: number }>,
  );

  return c.json({
    circulation: { users: circ.users ?? 0, total_coins: circ.total_coins ?? 0 },
    ledger_net: net.net ?? 0,
    aggregate_drift: (circ.total_coins ?? 0) - (net.net ?? 0),
    ledger_by_type: byType ?? [],
    top_drifters: drifters ?? [],
    note: 'Drift is expected for accounts whose welcome/legacy bonuses predate the ledger fix. Large unexplained drift on recent activity is the signal to investigate.',
  });
});

// ============================================================================
//  PRODUCTION DASHBOARD ENDPOINTS
// ============================================================================
//
// Three endpoints power the redesigned admin dashboard:
//
//   GET /admin/dashboard/summary   Bundled: financial KPIs + pending
//                                  counters + live ops + recent activity +
//                                  leaderboards + call-type split +
//                                  admin action log + anomalies.
//                                  Called every 20 s from the dashboard.
//
//   GET /admin/monitoring/health   SLA & data-integrity signals: API
//                                  errors, FX freshness, coin
//                                  reconciliation, migration state,
//                                  reward-budget fill, security counters.
//                                  Called every 30 s.
//
//   GET/PATCH /admin/emergency-flags
//                                  Read/write the platform kill switches
//                                  (payouts_frozen / registrations_paused
//                                  / new_calls_paused). PATCH stamps an
//                                  audit_log entry for compliance.
//
// Bundling avoids ~10 parallel useQuery requests every 20 s.
// All queries are read-only + independent → parallelised with Promise.all
// so worker latency stays flat regardless of table cardinality.
// ============================================================================

// ─── GET /admin/emergency-flags ────────────────────────────────────────────
admin.get('/emergency-flags', async (c) => {
  const flags = await readAllEmergencyFlags(c.env.DB);
  return c.json(flags);
});

// ─── PATCH /admin/emergency-flags ──────────────────────────────────────────
// Body: { flag: 'payouts_frozen' | 'registrations_paused' | 'new_calls_paused',
//         on:   boolean }
// Audit-logs every change so we always know WHO paused WHAT and WHEN.
admin.patch('/emergency-flags', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const flag = body.flag as EmergencyFlagKey;
  const on = Boolean(body.on);
  const allowed: EmergencyFlagKey[] = ['payouts_frozen', 'registrations_paused', 'new_calls_paused'];
  if (!allowed.includes(flag)) {
    return c.json({ error: 'flag must be one of payouts_frozen / registrations_paused / new_calls_paused' }, 400);
  }
  await setEmergencyFlag(c.env.DB, flag, on);
  const u = c.get('user');
  await auditLog(
    c.env.DB,
    u.sub,
    u.email || 'Admin',
    u.email || '',
    on ? 'emergency_flag_on' : 'emergency_flag_off',
    'setting',
    flag,
    `Admin ${on ? 'ENABLED' : 'DISABLED'} emergency flag: ${flag}`,
    c.req.header('CF-Connecting-IP') ?? '',
  );
  return c.json({ success: true, flag, on });
});

// ─── GET /admin/dashboard/summary ──────────────────────────────────────────
admin.get('/dashboard/summary', async (c) => {
  const dbA = c.env.DB;
  const cfg = await getCallEconomicsConfig(dbA);
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  const startOfTodayUtc = Math.floor(now / day) * day;
  const startOfWeek = now - 7 * day;
  const startOfPrevWeek = now - 14 * day;
  const startOfMonth = Math.floor(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000,
  );

  // Fire every read in parallel — each is a small aggregate against an
  // indexed column, so this whole endpoint returns in a single-digit ms
  // once D1 is warm.
  const [
    // Financial aggregates
    revToday, revWeek, revPrevWeek, revMonth, hostPayoutMonth, hostPayoutToday,
    monthMinutes, pendingPayouts,
    // Pending counters
    pKyc, pWith, pDep, pTickets, pReports, errHour,
    // Live calls
    liveCallsCount, liveCalls,
    // Recent activity
    recentSignups, recentApps, recentBigTx,
    // Leaderboards
    topHosts, topUsers,
    // Call-type split (7d)
    callSplit,
    // Admin action log
    adminActions,
    // Anomaly baseline (7 day avg vs today)
    callsToday, avgDailyCalls,
  ] = await Promise.all([
    dbA.prepare('SELECT COALESCE(SUM(coins_charged),0) AS coins FROM call_sessions WHERE status = ? AND created_at >= ?').bind('ended', startOfTodayUtc).first<{ coins: number }>(),
    dbA.prepare('SELECT COALESCE(SUM(coins_charged),0) AS coins FROM call_sessions WHERE status = ? AND created_at >= ?').bind('ended', startOfWeek).first<{ coins: number }>(),
    dbA.prepare('SELECT COALESCE(SUM(coins_charged),0) AS coins FROM call_sessions WHERE status = ? AND created_at >= ? AND created_at < ?').bind('ended', startOfPrevWeek, startOfWeek).first<{ coins: number }>(),
    dbA.prepare('SELECT COALESCE(SUM(coins_charged),0) AS coins FROM call_sessions WHERE status = ? AND created_at >= ?').bind('ended', startOfMonth).first<{ coins: number }>(),
    dbA.prepare(
      `SELECT COALESCE(SUM(ct.amount),0) AS host_coins
         FROM coin_transactions ct
         JOIN call_sessions cs ON cs.id = ct.ref_id
        WHERE ct.type = ? AND cs.status = ? AND cs.created_at >= ?`,
    ).bind('bonus', 'ended', startOfMonth).first<{ host_coins: number }>().catch(() => ({ host_coins: 0 })),
    // Actual host bonus coins credited today (from the ledger). Multiplied
    // by coin_payout_inr for the real ₹ outflow. Falls back to 0 if the
    // JOIN fails on an old schema.
    dbA.prepare(
      `SELECT COALESCE(SUM(ct.amount),0) AS host_coins
         FROM coin_transactions ct
         JOIN call_sessions cs ON cs.id = ct.ref_id
        WHERE ct.type = ? AND cs.status = ? AND cs.created_at >= ?`,
    ).bind('bonus', 'ended', startOfTodayUtc).first<{ host_coins: number }>().catch(() => ({ host_coins: 0 })),
    dbA.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) AS video_min,
         COALESCE(SUM(CASE WHEN type!='video' THEN (duration_seconds + 59) / 60 ELSE 0 END),0) AS audio_min
       FROM call_sessions
      WHERE status = ? AND created_at >= ? AND duration_seconds > 0`,
    ).bind('ended', startOfMonth).first<{ video_min: number; audio_min: number }>(),
    dbA.prepare('SELECT COALESCE(SUM(amount),0) AS amt FROM withdrawal_requests WHERE status = ?').bind('pending').first<{ amt: number }>(),

    // Pending counters — one COUNT each, indexed by status
    dbA.prepare('SELECT COUNT(*) AS n FROM host_applications WHERE status = ?').bind('pending').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COUNT(*) AS n FROM withdrawal_requests WHERE status = ?').bind('pending').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COUNT(*) AS n FROM coin_purchases WHERE status = ?').bind('pending').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE status = ?').bind('open').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COUNT(*) AS n FROM content_reports WHERE status = ?').bind('pending').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE created_at > ?').bind(now - 3600).first<{ n: number }>().catch(() => ({ n: 0 })),

    // Live ops — active calls right now
    dbA.prepare('SELECT COUNT(*) AS n FROM call_sessions WHERE status = ?').bind('active').first<{ n: number }>(),
    dbA.prepare(
      `SELECT cs.id, cs.type, cs.created_at, cs.coins_per_minute,
              caller.name AS caller_name, host_u.name AS host_name
         FROM call_sessions cs
         LEFT JOIN users caller ON caller.id = cs.caller_id
         LEFT JOIN hosts h ON h.id = cs.host_id
         LEFT JOIN users host_u ON host_u.id = h.user_id
        WHERE cs.status = ?
        ORDER BY cs.created_at DESC LIMIT 5`,
    ).bind('active').all<{
      id: string; type: string; created_at: number; coins_per_minute: number;
      caller_name: string | null; host_name: string | null;
    }>(),

    // Recent signups (users only, exclude admins)
    dbA.prepare(
      `SELECT id, name, email, avatar_url, country, created_at
         FROM users
        WHERE role = ?
        ORDER BY created_at DESC LIMIT 5`,
    ).bind('user').all<{ id: string; name: string; email: string; avatar_url: string | null; country: string | null; created_at: number }>(),
    dbA.prepare(
      `SELECT ha.id, ha.status, ha.submitted_at, ha.display_name, u.name AS user_name, u.email
         FROM host_applications ha
         LEFT JOIN users u ON u.id = ha.user_id
        WHERE ha.status = ?
        ORDER BY ha.submitted_at DESC LIMIT 5`,
    ).bind('pending').all<{ id: string; status: string; submitted_at: number; display_name: string; user_name: string | null; email: string | null }>().catch(() => ({ results: [] })),
    dbA.prepare(
      `SELECT cp.id, cp.coins, cp.status, cp.created_at, u.name AS user_name
         FROM coin_purchases cp
         LEFT JOIN users u ON u.id = cp.user_id
        WHERE cp.status = ? AND cp.coins > ?
        ORDER BY cp.created_at DESC LIMIT 5`,
    ).bind('completed', 1000).all<{ id: string; coins: number; status: string; created_at: number; user_name: string | null }>().catch(() => ({ results: [] })),

    // Leaderboards (7 d) — top hosts by coins earned + top users by coins spent
    dbA.prepare(
      `SELECT h.id AS host_id, u.name AS host_name, COALESCE(SUM(cs.coins_charged),0) AS coins
         FROM call_sessions cs
         JOIN hosts h ON h.id = cs.host_id
         JOIN users u ON u.id = h.user_id
        WHERE cs.status = ? AND cs.created_at >= ?
        GROUP BY h.id
        ORDER BY coins DESC LIMIT 5`,
    ).bind('ended', startOfWeek).all<{ host_id: string; host_name: string; coins: number }>(),
    dbA.prepare(
      `SELECT caller_id, u.name AS user_name, COALESCE(SUM(cs.coins_charged),0) AS coins
         FROM call_sessions cs
         JOIN users u ON u.id = cs.caller_id
        WHERE cs.status = ? AND cs.created_at >= ?
        GROUP BY caller_id
        ORDER BY coins DESC LIMIT 5`,
    ).bind('ended', startOfWeek).all<{ caller_id: string; user_name: string; coins: number }>(),

    // Call-type split for the 7-day donut on the dashboard
    dbA.prepare(
      `SELECT type, COUNT(*) AS calls, COALESCE(SUM(coins_charged),0) AS coins
         FROM call_sessions
        WHERE status = ? AND created_at >= ?
        GROUP BY type`,
    ).bind('ended', startOfWeek).all<{ type: string; calls: number; coins: number }>(),

    // Admin action log — WHO did WHAT recently
    dbA.prepare(
      `SELECT id, admin_name, admin_email, action, target_type, target, detail, created_at
         FROM audit_logs
        ORDER BY created_at DESC LIMIT 10`,
    ).all<{ id: string; admin_name: string; admin_email: string; action: string; target_type: string; target: string; detail: string; created_at: number }>().catch(() => ({ results: [] })),

    // Anomaly detection — today's calls vs 30-day average
    dbA.prepare('SELECT COUNT(*) AS n FROM call_sessions WHERE created_at >= ?').bind(startOfTodayUtc).first<{ n: number }>(),
    dbA.prepare(
      `SELECT COALESCE(AVG(daily), 0) AS avg_daily FROM (
         SELECT COUNT(*) AS daily, DATE(created_at, 'unixepoch') AS day
           FROM call_sessions
          WHERE created_at >= ?
          GROUP BY day
       )`,
    ).bind(now - 30 * day).first<{ avg_daily: number }>(),
  ]);

  // ── Derive ₹ figures using live economics config ─────────────────────
  const revenueTodayInr = Number(revToday?.coins ?? 0) * cfg.coinPurchaseInr;
  const revenueMonthInr = Number(revMonth?.coins ?? 0) * cfg.coinPurchaseInr;
  const revenueWeekCoins = Number(revWeek?.coins ?? 0);
  const revenuePrevWeekCoins = Number(revPrevWeek?.coins ?? 0);
  const revenueWowPct = revenuePrevWeekCoins > 0
    ? ((revenueWeekCoins - revenuePrevWeekCoins) / revenuePrevWeekCoins) * 100
    : (revenueWeekCoins > 0 ? 100 : 0);

  // Platform net + margin — same math as /analytics/margins so numbers line up.
  const audioMin = Number(monthMinutes?.audio_min ?? 0);
  const videoMin = Number(monthMinutes?.video_min ?? 0);
  const agoraCostMonthInr =
    audioMin * agoraCostPerMinInr('audio', cfg) + videoMin * agoraCostPerMinInr('video', cfg);
  const agoraCostMonthUsd = cfg.fxInrPerUsd > 0 ? agoraCostMonthInr / cfg.fxInrPerUsd : 0;

  // Today's platform net — same shape as /analytics/margins:
  //   net = revenue − gateway_fee − actual_host_payout − daily_agora_share
  // Using ACTUAL host payout coins (from the ledger) instead of share ×
  // revenue keeps the number honest — it matches what the host wallet
  // sums to, and doesn't drift when per-level shares differ from the
  // default `host_revenue_share` config knob.
  const gatewayPct = cfg.gatewayFeePct;
  const hostPayoutTodayInr = Number(hostPayoutToday?.host_coins ?? 0) * cfg.coinPayoutInr;
  const gatewayFeeTodayInr = revenueTodayInr * (gatewayPct / 100);
  // Rough per-day Agora cost = full-month / days-elapsed; keeps the today
  // number meaningful without adding another SQL round-trip.
  const dayOfMonth = new Date().getUTCDate() || 1;
  const agoraCostTodayInr = agoraCostMonthInr / dayOfMonth;
  const platformNetTodayInr =
    revenueTodayInr - hostPayoutTodayInr - gatewayFeeTodayInr - agoraCostTodayInr;
  const marginTodayPct = revenueTodayInr > 0 ? (platformNetTodayInr / revenueTodayInr) * 100 : 0;

  const pendingPayoutsInr = Number(pendingPayouts?.amt ?? 0);

  // Live-call burn rate — sum of coins_per_minute across all active calls,
  // converted to ₹/min using the purchase rate.
  const liveList = (liveCalls.results ?? []);
  const burnRateInrPerMin = liveList.reduce((s, r) => s + (Number(r.coins_per_minute) || 0), 0) * cfg.coinPurchaseInr;

  // Anomaly signal — "calls today" vs "30-day daily avg". Emitted when
  // the deviation exceeds 30%.
  const todayCalls = Number(callsToday?.n ?? 0);
  const avgDaily = Number(avgDailyCalls?.avg_daily ?? 0);
  const anomalies: Array<{ tone: 'warn' | 'bad'; msg: string }> = [];
  if (avgDaily > 5) {
    const deviationPct = ((todayCalls - avgDaily) / avgDaily) * 100;
    if (deviationPct < -30) {
      anomalies.push({
        tone: 'bad',
        msg: `Calls today are ${Math.abs(deviationPct).toFixed(0)}% below the 30-day average (${todayCalls} vs ~${Math.round(avgDaily)}).`,
      });
    } else if (deviationPct > 100) {
      anomalies.push({
        tone: 'warn',
        msg: `Calls today are ${deviationPct.toFixed(0)}% above the 30-day average (${todayCalls} vs ~${Math.round(avgDaily)}). Confirm this is expected traffic, not abuse.`,
      });
    }
  }
  if (revenueWowPct < -25) {
    anomalies.push({
      tone: 'bad',
      msg: `Weekly revenue is down ${Math.abs(revenueWowPct).toFixed(0)}% vs last week.`,
    });
  }
  if (marginTodayPct < 10 && revenueTodayInr > 0) {
    anomalies.push({
      tone: 'warn',
      msg: `Today's margin is ${marginTodayPct.toFixed(0)}% — below the 10% healthy threshold.`,
    });
  }

  return c.json({
    financial: {
      revenue_today_inr: Math.round(revenueTodayInr * 100) / 100,
      revenue_month_inr: Math.round(revenueMonthInr * 100) / 100,
      revenue_wow_pct: Math.round(revenueWowPct * 10) / 10,
      platform_net_today_inr: Math.round(platformNetTodayInr * 100) / 100,
      margin_today_pct: Math.round(marginTodayPct * 10) / 10,
      agora_cost_month_inr: Math.round(agoraCostMonthInr * 100) / 100,
      agora_cost_month_usd: Math.round(agoraCostMonthUsd * 100) / 100,
      pending_payouts_inr: Math.round(pendingPayoutsInr * 100) / 100,
      revenue_today_coins: Number(revToday?.coins ?? 0),
      host_payout_today_inr: Math.round(hostPayoutTodayInr * 100) / 100,
    },
    pending: {
      kyc: Number(pKyc?.n ?? 0),
      withdrawals: Number(pWith?.n ?? 0),
      deposits: Number(pDep?.n ?? 0),
      support_tickets: Number(pTickets?.n ?? 0),
      content_reports: Number(pReports?.n ?? 0),
      server_errors_hour: Number(errHour?.n ?? 0),
    },
    live: {
      active_calls: Number(liveCallsCount?.n ?? 0),
      burn_rate_inr_per_min: Math.round(burnRateInrPerMin * 100) / 100,
      top_calls: liveList.map((c) => ({
        id: c.id,
        type: c.type,
        caller_name: c.caller_name ?? '—',
        host_name: c.host_name ?? '—',
        coins_per_minute: Number(c.coins_per_minute) || 0,
        started_ago_sec: Math.max(0, now - Number(c.created_at ?? now)),
      })),
    },
    recent: {
      signups: recentSignups.results ?? [],
      host_applications: recentApps.results ?? [],
      big_deposits: recentBigTx.results ?? [],
    },
    leaderboards: {
      top_hosts_7d: (topHosts.results ?? []).map((h) => ({
        host_id: h.host_id,
        name: h.host_name,
        coins: Number(h.coins),
        revenue_inr: Math.round(Number(h.coins) * cfg.coinPurchaseInr * 100) / 100,
      })),
      top_users_7d: (topUsers.results ?? []).map((u) => ({
        user_id: u.caller_id,
        name: u.user_name,
        coins: Number(u.coins),
        spent_inr: Math.round(Number(u.coins) * cfg.coinPurchaseInr * 100) / 100,
      })),
    },
    call_type_split_7d: (callSplit.results ?? []).map((r) => ({
      type: r.type,
      calls: Number(r.calls),
      coins: Number(r.coins),
    })),
    admin_actions_recent: adminActions.results ?? [],
    anomalies,
    server_time: now,
  });
});

// ─── GET /admin/monitoring/health ──────────────────────────────────────────
admin.get('/monitoring/health', async (c) => {
  const dbA = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;

  const [
    apiErrors, apiRequestsHint, fxRow,
    coinsIssued, coinsInWallets, coinsBurned,
    migrationState, budgetRow, budgetCapRow,
    failedLogins, rateLimitedHits, bannedTotal,
  ] = await Promise.all([
    dbA.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE created_at > ?').bind(now - hour).first<{ n: number }>().catch(() => ({ n: 0 })),
    // We don't have a canonical request-count metric — use call_sessions
    // as a proxy for activity in the past hour so the ratio at least tells
    // us "many requests + few errors" vs "no traffic".
    dbA.prepare('SELECT COUNT(*) AS n FROM call_sessions WHERE created_at > ?').bind(now - hour).first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare("SELECT value FROM app_settings WHERE key = 'fx_rates_last_updated'").first<{ value: string }>().catch(() => null),

    // Coin reconciliation — issued (bonus + purchase) − burned (call + withdrawal) = in_wallets ± tolerance
    dbA.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM coin_transactions WHERE type IN ('bonus','purchase','reward','refund')").first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COALESCE(SUM(coins),0) AS n FROM users').first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM coin_transactions WHERE type IN ('call','withdrawal','tip','gift')").first<{ n: number }>().catch(() => ({ n: 0 })),

    listMigrationStatusForHealth(dbA).catch(() => ({ total: 0, applied: [], pending: [] })),

    dbA.prepare("SELECT coins_paid FROM reward_budget_daily WHERE day_key = ?").bind(
      (() => { const d = new Date(now * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; })(),
    ).first<{ coins_paid: number }>().catch(() => null),
    dbA.prepare("SELECT value FROM app_settings WHERE key = 'reward_daily_budget_cap'").first<{ value: string }>().catch(() => null),

    // Security signals — best-effort, table may not exist on very old DBs.
    dbA.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE id LIKE 'rl:auth_login:%' AND updated_at > ?").bind(now - hour).first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare('SELECT COALESCE(SUM(attempts),0) AS n FROM rate_limits WHERE updated_at > ?').bind(now - hour).first<{ n: number }>().catch(() => ({ n: 0 })),
    dbA.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'").first<{ n: number }>().catch(() => ({ n: 0 })),
  ]);

  // ── API health ────────────────────────────────────────────────────────
  const errCount = Number(apiErrors?.n ?? 0);
  const reqCount = Number(apiRequestsHint?.n ?? 0);
  // We can't compute a real error rate without a request counter; the tone
  // is set by an absolute error count. Fine-tune later if we add a metrics
  // table.
  const apiTone: 'ok' | 'warn' | 'bad' =
    errCount > 100 ? 'bad' : errCount > 20 ? 'warn' : 'ok';

  // ── FX freshness ──────────────────────────────────────────────────────
  const fxUpdatedAt = fxRow?.value ? parseInt(fxRow.value) : 0;
  const fxAgeSec = fxUpdatedAt > 0 ? Math.max(0, now - fxUpdatedAt) : Number.MAX_SAFE_INTEGER;
  const fxTone: 'ok' | 'warn' | 'bad' =
    fxAgeSec > 24 * hour ? 'bad' : fxAgeSec > 6 * hour ? 'warn' : 'ok';

  // ── Coin reconciliation ───────────────────────────────────────────────
  // Perfect balance: issued − burned = in_wallets. Small drift is expected
  // (welcome bonuses that predate the ledger fix, active call holds).
  const issued = Number(coinsIssued?.n ?? 0);
  const inWallets = Number(coinsInWallets?.n ?? 0);
  const burned = Number(coinsBurned?.n ?? 0);
  const reconciliationDelta = issued - burned - inWallets;
  const reconTolerancePct = issued > 0 ? Math.abs(reconciliationDelta) / issued * 100 : 0;
  const reconTone: 'ok' | 'warn' | 'bad' =
    reconTolerancePct > 2 ? 'bad' : reconTolerancePct > 0.5 ? 'warn' : 'ok';

  // ── Migrations ────────────────────────────────────────────────────────
  const migTotal = migrationState.total;
  const migAppliedCount = migrationState.applied.length;
  const migPendingCount = migrationState.pending.length;
  const migTone: 'ok' | 'warn' | 'bad' =
    migPendingCount > 0 ? 'warn' : (migAppliedCount === 0 && migTotal > 0) ? 'bad' : 'ok';

  // ── Reward budget ─────────────────────────────────────────────────────
  const budgetPaid = Number(budgetRow?.coins_paid ?? 0);
  const budgetCap = parseInt(budgetCapRow?.value ?? '0') || 0;
  const budgetPct = budgetCap > 0 ? (budgetPaid / budgetCap) * 100 : 0;
  const budgetTone: 'ok' | 'warn' | 'bad' =
    budgetCap > 0 && budgetPct >= 100 ? 'bad' :
    budgetCap > 0 && budgetPct >= 80 ? 'warn' : 'ok';

  return c.json({
    api: {
      tone: apiTone,
      error_count_hour: errCount,
      calls_hour: reqCount,
    },
    fx: {
      tone: fxTone,
      last_updated_sec_ago: fxAgeSec === Number.MAX_SAFE_INTEGER ? null : fxAgeSec,
      last_updated_at: fxUpdatedAt || null,
    },
    coins: {
      tone: reconTone,
      issued,
      in_wallets: inWallets,
      burned,
      reconciliation_delta: reconciliationDelta,
      tolerance_pct: Math.round(reconTolerancePct * 100) / 100,
    },
    migrations: {
      tone: migTone,
      total: migTotal,
      applied: migAppliedCount,
      pending: migPendingCount,
      pending_names: migrationState.pending,
    },
    reward_budget: {
      tone: budgetTone,
      cap: budgetCap,
      paid_today: budgetPaid,
      pct_used: Math.round(budgetPct * 10) / 10,
    },
    security: {
      failed_logins_hour: Number(failedLogins?.n ?? 0),
      rate_limit_hits_hour: Number(rateLimitedHits?.n ?? 0),
      banned_users_total: Number(bannedTotal?.n ?? 0),
    },
    server_time: now,
  });
});

export default admin;
