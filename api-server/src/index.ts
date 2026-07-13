import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { jwtVerify } from 'jose';
import type { Env } from './types';
import authRouter from './routes/auth';
import userRouter from './routes/user';
import { hostsRouter, hostRouter } from './routes/host';
import coinRouter from './routes/coin';
import chatRouter from './routes/chat';
import callRouter from './routes/call';
import adminRouter from './routes/admin';
import { auditLogMiddleware } from './middleware/auditLog';
import { dataChangeBroadcastMiddleware } from './middleware/dataChangeBroadcast';
import uploadRouter from './routes/upload';
import publicRouter from './routes/public';
import matchRouter from './routes/match';
import hostappRouter from './routes/hostapp';
import errorsRouter from './routes/errors';
import paymentRouter from './routes/payment';
import adminAuthRouter from './routes/adminAuth';
import engagementRouter from './routes/engagement';
import rewardsRouter from './routes/rewards';
import tipRouter from './routes/tip';
import vipRouter from './routes/vip';
import supportRouter from './routes/support';
import giftsRouter from './routes/gifts';
import smartRouter from './routes/smart';
import { ChatRoom } from './durable-objects/ChatRoom';
import { NotificationHub } from './durable-objects/NotificationHub';
import { ensureUsersSchema, ensureRandomCallSchema, ensureStreakSchema, ensureHostStreakSchema, ensureFirstCallFreeSchema, ensureCallObservabilitySchema, ensureEngagementSchema, ensureWithdrawalSchema, ensureSmartV2Schema, ensureReferralIntegritySchema, ensureVipSignupBonusSchema } from './lib/schemaGuard';
import { releaseExpiredReferralHolds } from './lib/referral';
import { ensureAllMigrations } from './lib/autoMigrate';
import { getLevelConfig, getEarningShare, DEFAULT_AUDIO_RATE, computeLevelProgress } from './lib/levels';
import { recalcAllHostLevels } from './lib/levelService';
import { billedMinutes, coinsForCall, chargeCallerWithFreePool, releaseCallHold } from './lib/billing';
import { runReengagement } from './lib/reengagement';
import { recomputeActiveHours } from './lib/bestTime';
import { recomputeChurnRisk } from './lib/churn';
import { runHealthProbes, storeHealthCheck, pruneHealthChecks } from './lib/healthCheck';
import { istContext } from './lib/streak';
import { getFCMTokens, sendFCMPush } from './lib/fcm';
import { notifyUser } from './lib/realtime';
import { notifyEngagement, isQuietHoursIST, engagementFeatureEnabled } from './lib/engagementNotify';
import { USD_TO_FOREIGN } from './lib/currency';

// Re-export Durable Objects (required by wrangler)
export { ChatRoom, NotificationHub };

// DEV-ONLY fallback origins. In production, set CORS_ALLOWED_ORIGINS to an
// explicit allowlist (see buildExactAllowlist below). These broad patterns
// exist only so local/staging development works without extra config.
const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https:\/\/(.*\.)?voxlink\.[a-z.]+$/i,
  /^https:\/\/(.*\.)?voxcall\.[a-z.]+$/i,
  /^https:\/\/(.*\.)?connectme\.[a-z.]+$/i,
  // Cloudflare Pages — exact production domains
  /^https:\/\/voxcalladmin\.pages\.dev$/,
  /^https:\/\/voxcall\.pages\.dev$/,
  /^https:\/\/voxcallhost\.pages\.dev$/,
  // Cloudflare Pages — preview deployment subdomains
  /^https:\/\/[a-z0-9-]+\.voxcalladmin\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.voxcall\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.voxcallhost\.pages\.dev$/,
  // Replit hosting — dev previews and published .replit.app domains
  /^https:\/\/[a-z0-9-]+\.replit\.dev$/,
  /^https:\/\/[a-z0-9-]+\.replit\.app$/,
  /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.replit\.dev$/,
  /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.replit\.app$/,
];

// FIX #6: In production set CORS_ALLOWED_ORIGINS to a comma-separated list of
// exact origins. When present it takes precedence over the broad dev patterns
// above (which allow ANY *.pages.dev / *.replit.dev — fine for dev, too loose
// for prod since anyone can deploy to those shared platforms).
function buildExactAllowlist(env: Env): Set<string> | null {
  const raw = env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  const list = raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.length ? new Set(list) : null;
}

function isOriginAllowed(origin: string, env: Env): boolean {
  const exact = buildExactAllowlist(env);
  if (exact) return exact.has(origin.replace(/\/$/, ''));
  return ALLOWED_ORIGINS.some(p => p.test(origin));
}

const app = new Hono<{ Bindings: Env }>();

// Redacting request logger — logs method + PATHNAME only (never the query
// string), so sensitive query params (e.g. a legacy WebSocket `?token=<JWT>`
// from clients not yet migrated to the Sec-WebSocket-Protocol header) can't
// leak into Workers Logs / `wrangler tail` / downstream log sinks. Replaces
// hono's built-in `logger()`, which logs the full request target.
app.use('*', async (c, next) => {
  const start = Date.now();
  let path = c.req.path;
  try { path = new URL(c.req.url).pathname; } catch { /* keep c.req.path */ }
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${path} ${c.res.status} ${ms}ms`);
});

// Global middleware
app.use('*', cors({
  origin: (origin, c) => {
    // Mobile apps (React Native) don't send Origin — allow all no-origin requests
    if (!origin) return '*';
    // SECURITY (fail-closed): In production, if CORS_ALLOWED_ORIGINS is not set,
    // REJECT all browser-origin requests instead of falling through to the broad
    // dev patterns. This prevents a misconfigured deploy from silently accepting
    // requests from any *.pages.dev / *.replit.dev attacker site. The operator
    // MUST set the env var to an explicit comma-separated allowlist before going
    // live. In non-production (local dev / staging), the broad patterns still
    // apply so development works without extra config.
    if (c.env.ENVIRONMENT === 'production' && !c.env.CORS_ALLOWED_ORIGINS) {
      console.error('[CORS] BLOCKED: CORS_ALLOWED_ORIGINS is not set in production. All browser-origin requests are rejected. Set CORS_ALLOWED_ORIGINS to your frontend domain(s).');
      return null;
    }
    return isOriginAllowed(origin, c.env) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 86400,
}));

// Security response headers — applied to every response (JSON + file serving).
// Set in the "after" phase so they ride on top of whatever the handler returns,
// including raw `new Response()` objects (e.g. /api/files) and error responses.
//   - X-Content-Type-Options: nosniff  → stop MIME-sniffing of API/file bodies
//   - X-Frame-Options / frame-ancestors → clickjacking defence (API is not a page)
//   - Referrer-Policy                   → never leak full URLs to third parties
//   - Strict-Transport-Security         → force HTTPS for 1 year (incl. subdomains)
//   - Content-Security-Policy           → JSON API renders nothing; lock it down.
// CSP here only governs documents rendered FROM these responses; it does not
// block the mobile/web apps from embedding /api/files images loaded elsewhere.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
});
// Schema auto-migration: bring the live D1 instance in sync with the code
// before any /api/* DB query runs. Two layers, both cached per worker isolate
// so subsequent requests pay only a microtask cost:
//
//   1. ensureAllMigrations — primary path. Tracks state in `d1_migrations`
//      (the same table Wrangler uses) and self-applies any migration that
//      isn't recorded there. This is the safety net for the case where
//      `wrangler d1 migrations apply --remote` in CI was skipped (push
//      didn't touch api-server/), failed, or never ran. New migrations only
//      need to be added to the manifest in lib/autoMigrate.ts — no code
//      changes elsewhere.
//
//   2. ensure*Schema (legacy schemaGuards) — fallback path for prod DBs that
//      were migrated by hand long before `d1_migrations` existed (or before
//      this auto-migrator was deployed). They check PRAGMA table_info /
//      sqlite_master and ALTER/CREATE only what's missing, so once the
//      primary path has caught the DB up they become fast no-ops.
//
// Errors here never throw to callers — if D1 is genuinely unavailable, the
// downstream query surfaces the real schema/connection error and the cached
// Promise clears so the next request retries.
app.use('/api/*', async (c, next) => {
  // Primary: apply any pending SQL migrations against the live D1 instance.
  // Catches its own errors internally and returns a structured report;
  // never throws.
  await ensureAllMigrations(c.env.DB);

  // Fallback: legacy per-feature schema healers. Idempotent and fast once
  // the primary path has applied the underlying migrations.
  await Promise.all([
    ensureUsersSchema(c.env.DB),
    ensureRandomCallSchema(c.env.DB),
    ensureStreakSchema(c.env.DB),
    ensureHostStreakSchema(c.env.DB),
    ensureFirstCallFreeSchema(c.env.DB),
    ensureCallObservabilitySchema(c.env.DB),
    ensureEngagementSchema(c.env.DB),
    ensureWithdrawalSchema(c.env.DB),
    ensureSmartV2Schema(c.env.DB),
    ensureReferralIntegritySchema(c.env.DB),
    ensureVipSignupBonusSchema(c.env.DB),
  ]);
  return next();
});

// Health check — intentionally minimal to avoid leaking internal configuration
app.get('/api/healthz', (c) => c.json({
  status: 'ok',
  ts: Date.now(),
}));

// Readiness probe — unlike /healthz (liveness only), this verifies the Worker
// can actually reach its primary datastore. Uptime monitors / deploy gates can
// poll this to catch a broken D1 binding before it serves real traffic.
app.get('/api/readyz', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ready', db: 'ok', ts: Date.now() });
  } catch (err) {
    console.error('[readyz] D1 ping failed:', err);
    return c.json({ status: 'not_ready', db: 'error', ts: Date.now() }, 503);
  }
});

// Routes
app.route('/api/auth', authRouter);
app.route('/api/user', userRouter);
app.route('/api/hosts', hostsRouter);
app.route('/api/host', hostRouter);
app.route('/api/coins', coinRouter);
app.route('/api/chat', chatRouter);
app.route('/api/calls', callRouter);
// FIX #14: Audit log middleware intercepts all mutating admin requests (POST/PUT/PATCH/DELETE)
app.use('/api/admin/*', auditLogMiddleware);
// Real-time: after a successful admin catalog mutation, push a lightweight
// `data_changed` signal so user/host apps refetch instantly (no screen re-open).
app.use('/api/admin/*', dataChangeBroadcastMiddleware);
app.route('/api/admin', adminRouter);
app.route('/api/match', matchRouter);
app.route('/api/host-app', hostappRouter);
app.route('/api/upload', uploadRouter);
app.route('/api/errors', errorsRouter);
app.route('/api/payment', paymentRouter);
app.route('/api/admin-auth', adminAuthRouter);
app.route('/api/engagement', engagementRouter);
app.route('/api/user/rewards', rewardsRouter);
app.route('/api/tips', tipRouter);
app.route('/api/vip', vipRouter);
app.route('/api/support', supportRouter);
app.route('/api/gifts', giftsRouter);
app.route('/api/smart', smartRouter);
app.route('/api', publicRouter);

// ─── WebSocket Auth Helper ─────────────────────────────────────────────────
async function verifyWsToken(token: string | null, secret: string): Promise<string | null> {
  if (!token) return null;
  if (typeof secret !== 'string' || secret.length < 32) {
    console.warn('[verifyWsToken] JWT_SECRET missing or too short — rejecting WS auth');
    return null;
  }
  try {
    const key = new TextEncoder().encode(secret);
    // Pin HS256 to match how we sign (see lib/jwt.ts) and block alg confusion.
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return (payload as any).sub as string;
  } catch (e: any) {
    // Expected: expired/invalid tokens are routine (client reconnects with stale token).
    // Unexpected: key import errors, malformed secret — log so operators notice.
    const msg = String(e?.code || e?.message || '');
    if (!msg.includes('ERR_JWT') && !msg.includes('expired') && !msg.includes('invalid')) {
      console.warn('[verifyWsToken] Unexpected verification error:', e);
    }
    return null;
  }
}

// FIX #5: Prefer the token from the `Sec-WebSocket-Protocol` header (sent by the
// client as a subprotocol, e.g. ["bearer", "<jwt>"]) over the URL `?token=`
// query param. Query-string tokens leak into Workers request logs / proxies /
// browser history; the subprotocol header does not. The query param is still
// accepted for backward compatibility with older clients — migrate clients to
// the header form, then drop query support.
function extractWsToken(c: any): string | null {
  const proto = c.req.header('Sec-WebSocket-Protocol');
  if (proto) {
    const parts = proto.split(',').map((s: string) => s.trim()).filter(Boolean);
    // Accept ["bearer", "<jwt>"] / ["jwt", "<jwt>"] or a single JWT-looking value.
    if (parts.length >= 2 && /^(bearer|jwt|access_token)$/i.test(parts[0])) return parts[1];
    const jwtLike = parts.find((p: string) => p.split('.').length === 3);
    if (jwtLike) return jwtLike;
  }
  return c.req.query('token') || c.req.header('Authorization')?.replace('Bearer ', '') || null;
}

// WebSocket: notification hub per user — BUG 3 FIX: require JWT auth
app.get('/api/ws/notifications', async (c) => {
  const token = extractWsToken(c);
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);
  const verifiedUserId = await verifyWsToken(token, c.env.JWT_SECRET);
  if (!verifiedUserId || verifiedUserId !== userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const id = c.env.NOTIFICATION_HUB.idFromName(userId);
  const stub = c.env.NOTIFICATION_HUB.get(id);
  return stub.fetch(c.req.raw);
});

// NOTE: The legacy per-session WebRTC signaling WebSocket (/api/ws/call/:id +
// the CallSignaling Durable Object) was removed with the Agora migration. Agora
// performs all call signaling over its own global network, so the app no longer
// needs a self-hosted signaling channel. In-call mic/camera state is relayed
// over the NotificationHub socket (peer_media_state) instead.

// 404 handler — path is intentionally omitted to prevent internal route enumeration
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// FIX #2: Stale call reaper — scheduled via Cloudflare Cron (every 1 min)
// Ends calls stuck in 'pending' for >2 min or 'active' for >30 min (crash/
// disconnect scenario). 1-min cadence keeps worst-case stale window small
// (max ~3 min from creation to reap for pending) so the admin dashboard and
// the host UI don't show phantom in-progress calls long after the user has
// actually given up. Cron interval lives in wrangler.toml.
async function reapStaleCalls(env: Env): Promise<void> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  // Loaded once per run — used for level-based earning share below.
  const levelCfg = await getLevelConfig(db);

  // Pending calls: 2 min ke baad expire (ring timeout 45s hai — 2min is generous)
  const pendingCutoff = now - 120;
  // Active calls: reap by HEARTBEAT FRESHNESS, not total duration. The caller's
  // client posts a heartbeat every ~25s (updating last_heartbeat_at); a call
  // whose last heartbeat is older than this window has a dead/disconnected
  // client and is safe to force-end. This replaces the old "active > 30 min"
  // rule, which wrongly killed healthy long calls. 5 min tolerates brief
  // mobile backgrounding / network blips (≈12 missed heartbeats) before reaping.
  const HEARTBEAT_STALE_SEC = 5 * 60;
  const activeCutoff = now - HEARTBEAT_STALE_SEC;

  try {
    const staleCalls = await db
      .prepare(
        `SELECT cs.id, cs.caller_id, cs.host_id, cs.started_at, cs.created_at, cs.rate_per_minute, cs.type,
                h.user_id as host_user_id, h.level as host_level,
                cs.status
         FROM call_sessions cs
         JOIN hosts h ON h.id = cs.host_id
         WHERE (cs.status = 'pending' AND cs.created_at < ?)
            OR (cs.status = 'active'  AND COALESCE(cs.last_heartbeat_at, cs.started_at) < ?)
         LIMIT 50`
      )
      .bind(pendingCutoff, activeCutoff)
      .all<any>();

    if (!staleCalls.results.length) return;

    for (const call of staleCalls.results) {
      // Atomic guard — use ended_at IS NULL instead of setting status to 'processing'
      // because 'processing' is NOT a valid CHECK constraint value and causes silent failures.
      const guard = await db
        .prepare(`UPDATE call_sessions SET ended_at = ? WHERE id = ? AND status IN ('active', 'pending') AND ended_at IS NULL`)
        .bind(now, call.id)
        .run();
      if (!guard.meta.changes) continue; // already processed by another worker or /end call

      const durationSec = call.started_at ? now - call.started_at : 0;
      const durationMin = billedMinutes(durationSec);
      const effectiveRate = call.rate_per_minute ?? DEFAULT_AUDIO_RATE;
      const coinsCharged = coinsForCall({ status: call.status, durationSec, ratePerMinute: effectiveRate });

      // Track actual coins transferred (0 until confirmed)
      let actualCoinsCharged = 0;
      let actualHostEarnings = 0;
      let freeMinutesUsed = 0;

      if (coinsCharged > 0) {
        // FIX #1: best-effort (partial) billing — pay the host for the talk-time
        // even if the caller overran their balance. See lib/billing.ts.
        // Layer 4: also consumes from the user's free-call-minutes pool first.
        const { charged, hostEarned, free_minutes_used } = await chargeCallerWithFreePool(db, {
          callerId: call.caller_id,
          hostUserId: call.host_user_id,
          durationSec,
          ratePerMinute: effectiveRate,
          earningShare: getEarningShare(call.host_level ?? 1, levelCfg),
        });
        actualCoinsCharged = charged;
        actualHostEarnings = hostEarned;
        freeMinutesUsed = free_minutes_used;
        if (charged === 0 && hostEarned === 0) {
          console.warn('[Cron] Caller had no coins to charge for call', call.id);
        }
      }

      // Batch: end the call session + record bookkeeping only if money moved.
      // Note: a free-trial-only call lands actualCoinsCharged === 0 BUT
      // actualHostEarnings > 0 (platform absorbed the cost) — host stats and
      // their bonus row still update.
      const batchOps: any[] = [
        db.prepare(
          `UPDATE call_sessions SET status = 'ended', duration_seconds = ?, coins_charged = ?, free_minutes_used = ?, end_reason = 'cron_reaped' WHERE id = ?`
        ).bind(durationSec, actualCoinsCharged, freeMinutesUsed, call.id),
      ];

      if (actualCoinsCharged > 0 || actualHostEarnings > 0) {
        batchOps.push(
          db.prepare(`UPDATE hosts SET total_minutes = total_minutes + ?, total_earnings = total_earnings + ? WHERE id = ?`)
            .bind(durationMin, actualHostEarnings, call.host_id),
        );
        if (actualCoinsCharged > 0) {
          batchOps.push(
            db.prepare(`INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?,?,?,?,?,?)`)
              .bind(crypto.randomUUID(), call.caller_id, 'spend', -actualCoinsCharged, `${call.type || 'audio'} call (auto-reaped)`, call.id),
          );
        }
        if (actualHostEarnings > 0) {
          batchOps.push(
            db.prepare(`INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?,?,?,?,?,?)`)
              .bind(crypto.randomUUID(), call.host_user_id, 'bonus', actualHostEarnings, `${call.type || 'audio'} call earnings (auto-reaped${freeMinutesUsed > 0 ? `, ${freeMinutesUsed} free` : ''})`, call.id),
          );
        }
      }

      await db.batch(batchOps);

      // Item 2 — release any prepaid coin hold the reaped call was holding.
      await releaseCallHold(db, { callerId: call.caller_id, sessionId: call.id });
    }

    console.log(`[Cron] Reaped ${staleCalls.results.length} stale call(s)`);
  } catch (err) {
    console.error('[Cron] Stale call reaper error:', err);
  }
}

// FIX #9: Reconcile calls that were claimed (ended_at set) but never finalized
// (status still 'active'/'pending'). This happens if the worker isolate dies
// between atomicCallTransfer and the bookkeeping batch in /end or the reaper:
// coins may have moved but the session stays stuck and the 30-min active cutoff
// won't re-select a freshly-started call for a long time. We finalize such rows
// WITHOUT re-charging (never double-charge): if a 'spend' ledger row already
// exists for the session the money moved, so we trust that amount; otherwise we
// close it as 0 and log for manual review.
// Ban-expiry auto-lift — reactivate users whose TEMPORARY ban has elapsed.
//
// Temporary bans (7-day suspensions, admin temp bans) store an expiry on the
// user_bans row but flip users.status='banned' for enforcement. The auth
// middleware blocks purely on status, so without this sweep a "7-day" ban was
// effectively permanent. This restores status='active' only for users who:
//   • have a user_bans row that is now EXPIRED, AND
//   • have NO currently-active ban (permanent or not-yet-expired).
// Manual status-only bans (no user_bans row) and permanent bans are untouched.
async function liftExpiredBans(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE users SET status = 'active', updated_at = unixepoch()
       WHERE status = 'banned'
         AND EXISTS (
           SELECT 1 FROM user_bans ub
           WHERE ub.user_id = users.id
             AND ub.expires_at IS NOT NULL AND ub.expires_at != ''
             AND date(ub.expires_at) < date('now')
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_bans ub2
           WHERE ub2.user_id = users.id
             AND (ub2.expires_at IS NULL OR ub2.expires_at = '' OR date(ub2.expires_at) >= date('now'))
         )`
    ).run();
  } catch (e) {
    console.warn('[cron] liftExpiredBans failed (schema may lag):', e);
  }
}

async function reconcileStuckEndedCalls(env: Env): Promise<void> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  // 120s grace so we never race a legitimately in-flight /end request.
  const cutoff = now - 120;
  try {
    const stuck = await db
      .prepare(
        `SELECT id, ended_at, started_at FROM call_sessions
         WHERE ended_at IS NOT NULL AND status IN ('active','pending') AND ended_at < ?
         LIMIT 50`,
      )
      .bind(cutoff)
      .all<any>();
    for (const row of stuck.results) {
      const ledger = await db
        .prepare("SELECT amount FROM coin_transactions WHERE ref_id = ? AND type = 'spend' LIMIT 1")
        .bind(row.id)
        .first<{ amount: number }>();
      const charged = ledger ? Math.abs(ledger.amount) : 0;
      const durationSec = row.started_at ? Math.max(0, (row.ended_at as number) - row.started_at) : 0;
      await db
        .prepare("UPDATE call_sessions SET status = 'ended', duration_seconds = ?, coins_charged = ? WHERE id = ? AND status IN ('active','pending')")
        .bind(durationSec, charged, row.id)
        .run();
      if (!ledger) {
        console.warn('[Cron] Reconciled stuck call with no ledger row (closed as 0):', row.id);
      }
    }
    if (stuck.results.length) console.log(`[Cron] Reconciled ${stuck.results.length} stuck-ended call(s)`);
  } catch (err) {
    console.error('[Cron] Stuck-call reconciliation error:', err);
  }
}

// Level-up safety net — runs at most once per 24h even though the cron fires
// every minute. The auto level-up engine handles promotions in real time on
// each rating; this backfill catches anything missed (e.g. a rating write that
// raced a config change, or hosts promoted via a freshly-edited ladder).
// Gated via the `last_level_recalc` timestamp in app_settings; the slot is
// claimed BEFORE running so overlapping cron ticks don't double-run it.
async function maybeRecalcLevelsDaily(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_level_recalc'").first<{ value: string }>();
    const last = row?.value ? parseInt(row.value, 10) || 0 : 0;
    if (now - last < 24 * 3600) return; // already ran within the last day
    // Claim the slot first so a second cron tick in the same window is a no-op.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_level_recalc', ?, unixepoch())"
    ).bind(String(now)).run();
    const res = await recalcAllHostLevels(env, 'recalc');
    console.log('[Cron] Daily level recalc:', JSON.stringify(res));
  } catch (e) {
    console.error('[Cron] Daily level recalc error:', e);
  }
}

// FIX #12: Refresh FX rates at most once every 12h from a free, no-key API and
// cache them in app_settings (`fx_rates_usd` JSON + `fx_rates_updated` ts). The
// static USD_TO_FOREIGN table in lib/currency stays as the fallback, so a failed
// fetch or unconfigured network never breaks pricing. Only currencies we already
// support are stored, keeping the blob small.
async function maybeRefreshFxRates(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const REFRESH_INTERVAL = 12 * 3600;
    const RETRY_INTERVAL = 3600; // on failure, retry in ~1h instead of waiting 12h
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'fx_rates_updated'").first<{ value: string }>();
    const last = row?.value ? parseInt(row.value, 10) || 0 : 0;
    if (now - last < REFRESH_INTERVAL) return;
    // Claim the slot first so overlapping cron ticks don't double-fetch.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('fx_rates_updated', ?, unixepoch())"
    ).bind(String(now)).run();

    // On any failure, roll the timestamp back so the next tick retries in
    // ~RETRY_INTERVAL rather than holding the stale claim for the full 12h.
    const scheduleRetry = async () => {
      await env.DB.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('fx_rates_updated', ?, unixepoch())"
      ).bind(String(now - REFRESH_INTERVAL + RETRY_INTERVAL)).run().catch((e) => {
        console.warn('[Cron] FX scheduleRetry DB write failed:', e);
      });
    };

    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) { console.warn('[Cron] FX refresh HTTP', res.status); await scheduleRetry(); return; }
    const data = await res.json<any>();
    const rates = data?.rates;
    if (!rates || typeof rates !== 'object') { console.warn('[Cron] FX refresh: malformed payload'); await scheduleRetry(); return; }

    const filtered: Record<string, number> = {};
    for (const code of Object.keys(USD_TO_FOREIGN)) {
      const v = Number(rates[code]);
      if (Number.isFinite(v) && v > 0) filtered[code] = v;
    }
    if (Object.keys(filtered).length < 5) { console.warn('[Cron] FX refresh: too few rates, skipping store'); await scheduleRetry(); return; }
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('fx_rates_usd', ?, unixepoch())"
    ).bind(JSON.stringify(filtered)).run();
    console.log(`[Cron] FX rates refreshed (${Object.keys(filtered).length} currencies)`);

    // Keep coin_to_usd_rate pinned to the admin's canonical INR coin value as
    // FX moves. coin_value_inr is the source of truth (set from the admin
    // Settings page); recomputing the USD rate from it + the fresh INR rate
    // stops the stored USD value — and every non-INR price derived from it —
    // from drifting out of sync after a refresh. No-op for legacy DBs that
    // never stored coin_value_inr.
    try {
      const inrRate = Number(filtered.INR);
      if (Number.isFinite(inrRate) && inrRate > 0) {
        const cvRow = await env.DB
          .prepare("SELECT value FROM app_settings WHERE key = 'coin_value_inr'")
          .first<{ value: string }>();
        const cv = parseFloat(cvRow?.value ?? '');
        if (Number.isFinite(cv) && cv > 0) {
          await env.DB.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('coin_to_usd_rate', ?, unixepoch())"
          ).bind(String(cv / inrRate)).run();
        }
      }
    } catch (e) {
      console.warn('[Cron] coin_to_usd_rate re-pin failed:', e);
    }
  } catch (e) {
    console.error('[Cron] FX refresh error:', e);
  }
}

// Re-engagement / churn-prevention — runs at most once every
// `reengagement_interval_hours` (default 6h) even though the cron fires every
// minute. Finds idle users and nudges them back with a push + in-app
// notification (see lib/reengagement.ts). Gated via a `last_reengagement_run`
// timestamp in app_settings; the slot is claimed BEFORE running so overlapping
// cron ticks don't double-send. Entirely best-effort — a failure here must
// never affect the billing-critical reaper jobs above.
async function maybeRunReengagement(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const intervalRow = await env.DB
      .prepare("SELECT value FROM app_settings WHERE key = 'reengagement_interval_hours'")
      .first<{ value: string }>();
    const parsedInterval = parseInt(intervalRow?.value ?? '', 10);
    // Clamp to a sane 1–24h band; default 6h.
    const intervalHours = Number.isFinite(parsedInterval) && parsedInterval >= 1 && parsedInterval <= 24 ? parsedInterval : 6;

    const lastRow = await env.DB
      .prepare("SELECT value FROM app_settings WHERE key = 'last_reengagement_run'")
      .first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < intervalHours * 3600) return; // already ran within the window

    // Engagement #5: never send re-engagement pushes during quiet hours (IST).
    if (await isQuietHoursIST(env)) return;

    // Claim the slot first so a second cron tick in the same window is a no-op.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_reengagement_run', ?, unixepoch())"
    ).bind(String(now)).run();

    const res = await runReengagement(env);
    console.log('[Cron] Re-engagement:', JSON.stringify(res));
  } catch (e) {
    console.error('[Cron] Re-engagement error:', e);
  }
}

// Engagement rollup — once per UTC day, aggregate the previous day's raw
// engagement_events into the per-host host_engagement_stats table (cheap reads
// for ranking + admin CTR/conversion dashboards), then prune raw events beyond
// the retention window so the table stays bounded on D1. Gated via a
// `last_engagement_rollup_day` (UTC day number) slot claimed BEFORE running so
// overlapping cron ticks don't double-run. Entirely best-effort — a failure
// here must never affect the billing-critical reaper jobs above.
async function maybeRollupEngagement(env: Env): Promise<void> {
  try {
    const enabledRow = await env.DB
      .prepare("SELECT value FROM app_settings WHERE key = 'engagement_events_enabled'")
      .first<{ value: string }>()
      .catch(() => null);
    if (enabledRow?.value === '0') return;

    const now = Math.floor(Date.now() / 1000);
    const dayIndex = Math.floor(now / 86400); // UTC day number

    const lastRow = await env.DB
      .prepare("SELECT value FROM app_settings WHERE key = 'last_engagement_rollup_day'")
      .first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (last === dayIndex) return; // already rolled up today

    // Claim the slot first so a second cron tick in the same window is a no-op.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_engagement_rollup_day', ?, unixepoch())"
    ).bind(String(dayIndex)).run();

    // Roll up the PREVIOUS (fully-closed) UTC day.
    const prevDayStart = (dayIndex - 1) * 86400;
    const prevDayEnd = dayIndex * 86400;
    const day = new Date(prevDayStart * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

    const agg = await env.DB.prepare(
      `SELECT host_id,
              SUM(CASE WHEN event_type IN ('reco_impression','host_impression') THEN 1 ELSE 0 END) AS impressions,
              SUM(CASE WHEN event_type IN ('reco_click','host_click')           THEN 1 ELSE 0 END) AS clicks,
              SUM(CASE WHEN event_type IN ('call_start','call_complete')         THEN 1 ELSE 0 END) AS conversions
         FROM engagement_events
        WHERE host_id IS NOT NULL AND created_at >= ? AND created_at < ?
        GROUP BY host_id
        LIMIT 5000`
    ).bind(prevDayStart, prevDayEnd).all<{ host_id: string; impressions: number; clicks: number; conversions: number }>();

    const rows = agg.results ?? [];
    // Upsert in D1 batches (limit is 100; use 90 for headroom).
    for (let i = 0; i < rows.length; i += 90) {
      const chunk = rows.slice(i, i + 90);
      try {
        await env.DB.batch(
          chunk.map((r) =>
            env.DB.prepare(
              `INSERT INTO host_engagement_stats (host_id, day, impressions, clicks, conversions, updated_at)
               VALUES (?, ?, ?, ?, ?, unixepoch())
               ON CONFLICT(host_id, day) DO UPDATE SET
                 impressions = excluded.impressions,
                 clicks       = excluded.clicks,
                 conversions  = excluded.conversions,
                 updated_at   = unixepoch()`
            ).bind(r.host_id, day, Number(r.impressions) || 0, Number(r.clicks) || 0, Number(r.conversions) || 0)
          ),
        );
      } catch (err) {
        console.warn('[Cron] Engagement rollup upsert batch failed (non-fatal):', err);
      }
    }

    // Prune raw events beyond the retention window (clamped 7..180 days).
    const retRow = await env.DB
      .prepare("SELECT value FROM app_settings WHERE key = 'engagement_events_retention_days'")
      .first<{ value: string }>()
      .catch(() => null);
    const retDays = Math.min(180, Math.max(7, parseInt(retRow?.value ?? '30', 10) || 30));
    const cutoff = now - retDays * 86400;
    try {
      await env.DB.prepare('DELETE FROM engagement_events WHERE created_at < ?').bind(cutoff).run();
    } catch (err) {
      console.warn('[Cron] Engagement prune failed (non-fatal):', err);
    }

    console.log(`[Cron] Engagement rollup: day ${day}, ${rows.length} host(s), retention ${retDays}d`);
  } catch (e) {
    console.error('[Cron] Engagement rollup error:', e);
  }
}

// Daily streak reminder — nudges users with an ACTIVE streak who haven't
// claimed yet today to come back and claim before the IST midnight reset.
// Gated three ways so it fires at most once per IST day:
//   1. admin kill-switches (daily_streak_enabled / daily_streak_reminder_enabled)
//   2. only during the configured IST hour (daily_streak_reminder_hour_ist)
//   3. a `last_streak_reminder_day` slot claimed before sending
// Entirely best-effort — a failure here must never affect billing-critical jobs.
async function maybeSendStreakReminders(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = await env.DB.prepare(
      "SELECT key, value FROM app_settings WHERE key IN ('daily_streak_enabled','daily_streak_reminder_enabled','daily_streak_reminder_hour_ist','last_streak_reminder_day')",
    ).all<{ key: string; value: string }>();
    const cfg: Record<string, string> = {};
    for (const r of rows.results ?? []) cfg[r.key] = r.value;

    if (cfg['daily_streak_enabled'] === '0') return;
    if (cfg['daily_streak_reminder_enabled'] === '0') return;

    const parsedHour = parseInt(cfg['daily_streak_reminder_hour_ist'] ?? '', 10);
    const reminderHour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 20;

    const { hour: istHour, dayIndex, dayStart } = istContext(now);
    if (istHour !== reminderHour) return;

    const lastDay = parseInt(cfg['last_streak_reminder_day'] ?? '', 10) || 0;
    if (lastDay === dayIndex) return; // already sent today

    // Claim the daily slot BEFORE sending so overlapping cron ticks don't double-send.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_streak_reminder_day', ?, unixepoch())",
    ).bind(String(dayIndex)).run();

    // Candidates: an active streak that hasn't been claimed yet today (IST).
    const cand = await env.DB.prepare(
      `SELECT id FROM users
         WHERE COALESCE(streak_days, 0) > 0
           AND COALESCE(last_streak_claim_at, 0) < ?
           AND COALESCE(status, 'active') = 'active'
         LIMIT 5000`,
    ).bind(dayStart).all<{ id: string }>();
    const ids = (cand.results ?? []).map((r) => r.id);
    if (ids.length === 0) return;

    const title = '🔥 Don\'t Break Your Streak!';
    const body = "Your daily reward is waiting! 🎁 Claim it before midnight to keep that fire burning. You've got this! 💪";

    // 1. In-app notifications, D1 batches of 90 (batch limit is 100).
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      try {
        await env.DB.batch(
          chunk.map((id) =>
            env.DB
              .prepare('INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?,?,?,?,?,?)')
              .bind(crypto.randomUUID(), id, 'streak_reminder', title, body, JSON.stringify({ kind: 'streak_reminder' })),
          ),
        );
      } catch (err) {
        console.warn('[streak-reminder] notification batch insert failed (non-fatal):', err);
      }
    }

    // 2. FCM push, batches of 100 (same copy for everyone → cheap to batch).
    let pushed = 0;
    if (env.FIREBASE_SERVICE_ACCOUNT) {
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const tokens = await getFCMTokens(env.DB, batch);
          if (tokens.length) {
            const r = await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, { type: 'streak_reminder' });
            pushed += r.sent;
          }
        } catch (err) {
          console.warn('[streak-reminder] push batch failed (non-fatal):', err);
        }
      }
    }
    console.log(`[Cron] Streak reminders: ${ids.length} candidates, ${pushed} pushed`);
  } catch (e) {
    console.error('[Cron] streak reminder error:', e);
  }
}

// VIP expiry reminders — push a "renew" nudge to members whose VIP ends within
// 48h. Hourly gate (so the per-minute cron doesn't re-scan constantly) + a
// per-user 24h dedupe via users.vip_reminder_at. Entirely best-effort.
async function maybeSendVipReminders(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_vip_reminder_run'").first<{ value: string }>();
    const last = row?.value ? parseInt(row.value, 10) || 0 : 0;
    if (now - last < 3600) return; // at most once/hour
    if (!(await engagementFeatureEnabled(env, 'vip_reminder_enabled', true))) return;
    if (await isQuietHoursIST(env)) return; // Engagement #5: no VIP pings at night
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_vip_reminder_run', ?, unixepoch())"
    ).bind(String(now)).run();

    const soon = now + 48 * 3600;
    const dedupeBefore = now - 24 * 3600;
    const users = await env.DB.prepare(
      `SELECT u.id, u.fcm_token, u.vip_expires_at, p.name as plan_name
       FROM users u LEFT JOIN vip_plans p ON p.tier = u.vip_tier
       WHERE u.vip_expires_at IS NOT NULL AND u.vip_expires_at > ? AND u.vip_expires_at <= ?
         AND (u.vip_reminder_at IS NULL OR u.vip_reminder_at < ?)
       LIMIT 200`
    ).bind(now, soon, dedupeBefore).all<any>();

    for (const u of (users.results ?? [])) {
      const hrsLeft = Math.max(1, Math.ceil((Number(u.vip_expires_at) - now) / 3600));
      const label = hrsLeft <= 24
        ? `${hrsLeft} hour${hrsLeft === 1 ? '' : 's'}`
        : `${Math.ceil(hrsLeft / 24)} day${Math.ceil(hrsLeft / 24) === 1 ? '' : 's'}`;
      // notifyUser => in-app notification row + real-time notification_new +
      // FCM (previously FCM-only, so it never appeared in the notifications list).
      await notifyUser(
        env, u.id,
        `👑 Your ${u.plan_name ?? 'VIP'} Ends in ${label}!`,
        `Don't lose your VIP perks! ⏳ Renew now to keep enjoying exclusive benefits, bonus coins, and priority access. 🌟`,
        'vip_expiring',
      ).catch(() => {});
      await env.DB.prepare('UPDATE users SET vip_reminder_at = ? WHERE id = ?').bind(now, u.id).run().catch(() => {});
    }
    if (users.results?.length) console.log(`[Cron] Sent ${users.results.length} VIP expiry reminder(s)`);
  } catch (err) {
    console.warn('[Cron] VIP reminder task error:', err);
  }
}

// Near-level nudge — once/day (at a configured IST hour), push hosts who are
// close to their next level ("You're 85% to Expert!") so they come back and
// finish the climb. Mirrors the streak-reminder gating (per-IST-day slot claim
// before sending). Entirely best-effort.
async function maybeSendNearLevelNudges(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = await env.DB.prepare(
      "SELECT key, value FROM app_settings WHERE key IN ('near_level_nudge_enabled','near_level_nudge_hour_ist','near_level_nudge_threshold','last_near_level_nudge_day')",
    ).all<{ key: string; value: string }>();
    const cfg: Record<string, string> = {};
    for (const r of rows.results ?? []) cfg[r.key] = r.value;

    if (cfg['near_level_nudge_enabled'] === '0') return;

    const parsedHour = parseInt(cfg['near_level_nudge_hour_ist'] ?? '', 10);
    const nudgeHour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 19;
    const parsedThreshold = parseInt(cfg['near_level_nudge_threshold'] ?? '', 10);
    const threshold = Number.isFinite(parsedThreshold) ? Math.min(99, Math.max(50, parsedThreshold)) : 80;

    const { hour: istHour, dayIndex } = istContext(now);
    if (istHour !== nudgeHour) return;

    const lastDay = parseInt(cfg['last_near_level_nudge_day'] ?? '', 10) || 0;
    if (lastDay === dayIndex) return; // already sent today

    // Claim the daily slot BEFORE sending so overlapping ticks don't double-send.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_near_level_nudge_day', ?, unixepoch())",
    ).bind(String(dayIndex)).run();

    const levelCfg = await getLevelConfig(env.DB);
    const hosts = await env.DB.prepare(
      `SELECT h.id, h.user_id, h.level, h.rating, h.review_count, h.total_minutes, h.total_earnings, u.fcm_token
       FROM hosts h JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND u.status = 'active' AND u.fcm_token IS NOT NULL
       LIMIT 5000`,
    ).all<any>();

    const targets: { userId: string; token: string; pct: number; nextName: string }[] = [];
    for (const h of hosts.results ?? []) {
      const prog = computeLevelProgress(
        {
          review_count: Number(h.review_count) || 0,
          rating: Number(h.rating) || 0,
          total_minutes: Number(h.total_minutes) || 0,
          total_earnings: Number(h.total_earnings) || 0,
        },
        levelCfg,
        Number(h.level) || 1,
      );
      if (!prog.is_max_level && prog.next && prog.progress_pct >= threshold && prog.progress_pct < 100) {
        targets.push({ userId: h.user_id, token: h.fcm_token, pct: prog.progress_pct, nextName: prog.next.name });
      }
    }
    if (targets.length === 0) return;

    let pushed = 0;
    const cap = targets.slice(0, 1000); // safety cap on per-host pushes
    for (const t of cap) {
      const title = '🚀 You\u2019re SO Close to Levelling Up!';
      const body = `Just ${t.pct}% away from ${t.nextName}! 🌟 Go online now and unlock your next level + bigger rewards. 🏆`;
      await env.DB
        .prepare('INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), t.userId, 'near_level', title, body, JSON.stringify({ kind: 'near_level', pct: t.pct }))
        .run()
        .catch(() => {});
      if (env.FIREBASE_SERVICE_ACCOUNT && t.token) {
        try {
          const r = await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, t.token, title, body, { type: 'near_level' });
          pushed += r.sent;
        } catch { /* non-fatal */ }
      }
    }
    console.log(`[Cron] Near-level nudges: ${cap.length} candidates, ${pushed} pushed`);
  } catch (e) {
    console.error('[Cron] near-level nudge error:', e);
  }
}

// ─── Engagement #2: New-user onboarding drip ─────────────────────────────────
// Day 0 / 1 / 3 nudges for users who signed up but haven't made their FIRST
// call yet. Distinct type per stage = natural per-stage dedup. Hourly gate.
async function maybeRunOnboardingDrip(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'onboarding_drip_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_onboarding_drip_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 3600) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_onboarding_drip_run', ?, unixepoch())").bind(String(now)).run();

    const stages = [
      { type: 'onboarding_d0', minAge: 2 * 3600, maxAge: 6 * 3600, title: '🎉 Welcome to VoxCall!', body: 'Aapke FREE minutes ready hain! 🎁 Abhi kisi host se baat karein aur apna pehla connection banayein. 💛' },
      { type: 'onboarding_d1', minAge: 24 * 3600, maxAge: 30 * 3600, title: '📞 Aapki pehli call wait kar rahi hai!', body: 'Hundreds of friendly hosts online hain aur aapse baat karne ke liye ready hain. Abhi try karein! ✨' },
      { type: 'onboarding_d3', minAge: 72 * 3600, maxAge: 80 * 3600, title: '🎁 Ek special reward aapka intezaar kar raha hai!', body: 'Wapas aaiye aur apni pehli call shuru karein — ek naya dost sirf ek tap door hai! 🌟' },
    ];
    let sent = 0;
    for (const s of stages) {
      const rows = await env.DB.prepare(
        `SELECT id FROM users u
          WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
            AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
            AND u.created_at <= ? AND u.created_at > ?
            AND NOT EXISTS (SELECT 1 FROM call_sessions cs WHERE cs.caller_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = ?)
          LIMIT 300`,
      ).bind(now - s.minAge, now - s.maxAge, s.type).all<{ id: string }>();
      for (const r of rows.results ?? []) {
        if (await notifyEngagement(env, r.id, s.title, s.body, s.type, { data: { type: s.type } })) sent++;
      }
    }
    if (sent) console.log(`[Cron] Onboarding drip: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] onboarding drip error:', e);
  }
}

// ─── Engagement #3: Abandoned recharge nudge ─────────────────────────────────
// Users with a coin_purchase stuck at 'pending' for 1–24h who never finished.
// Per-user 24h cooldown via the notifications dedup. Hourly gate.
async function maybeNudgeAbandonedRecharge(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'abandoned_recharge_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_abandoned_recharge_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 3600) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_abandoned_recharge_run', ?, unixepoch())").bind(String(now)).run();

    const rows = await env.DB.prepare(
      `SELECT cp.user_id AS user_id, MAX(cp.coins + COALESCE(cp.bonus_coins, 0)) AS coins
         FROM coin_purchases cp
         JOIN users u ON u.id = cp.user_id
        WHERE cp.status = 'pending'
          AND cp.created_at <= ? AND cp.created_at > ?
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = cp.user_id AND n.type = 'abandoned_recharge' AND n.created_at >= ?)
        GROUP BY cp.user_id
        LIMIT 300`,
    ).bind(now - 3600, now - 24 * 3600, now - 24 * 3600).all<{ user_id: string; coins: number }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      const coins = Number(r.coins) || 0;
      if (await notifyEngagement(
        env, r.user_id, '🛒 Aapka recharge adhoora hai!',
        `${coins > 0 ? `${coins} coins` : 'Aapke coins'} bilkul ready hain! 💛 Bas ek tap aur — recharge poora karke apni calls jaari rakhein. ✨`,
        'abandoned_recharge', { data: { type: 'abandoned_recharge' } },
      )) sent++;
    }
    if (sent) console.log(`[Cron] Abandoned recharge: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] abandoned recharge error:', e);
  }
}

// ─── Engagement #6: Weekly recap ─────────────────────────────────────────────
// Once a week (midday IST), send active callers a recap of the last 7 days.
async function maybeSendWeeklyRecap(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'weekly_recap_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const istHour = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).getUTCHours();
    if (istHour < 11 || istHour >= 13) return; // send around midday IST
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_weekly_recap_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 6 * 86400) return; // ~weekly
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_weekly_recap_run', ?, unixepoch())").bind(String(now)).run();

    const weekAgo = now - 7 * 86400;
    const rows = await env.DB.prepare(
      `SELECT cs.caller_id AS user_id,
              SUM(COALESCE(cs.duration_seconds, 0)) AS secs,
              COUNT(*) AS calls
         FROM call_sessions cs
         JOIN users u ON u.id = cs.caller_id
        WHERE cs.status = 'ended' AND cs.ended_at >= ?
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
        GROUP BY cs.caller_id
        HAVING calls > 0
        LIMIT 500`,
    ).bind(weekAgo).all<{ user_id: string; secs: number; calls: number }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      const mins = Math.max(1, Math.round((Number(r.secs) || 0) / 60));
      if (await notifyEngagement(
        env, r.user_id, '📊 Aapka Weekly Recap!',
        `Kya hafta tha! 🎉 Aapne ${mins} min baat ki across ${r.calls} call${Number(r.calls) === 1 ? '' : 's'}. Is hafte kaun sa naya dost banayenge? 💛`,
        'weekly_recap', { data: { type: 'weekly_recap' } },
      )) sent++;
    }
    if (sent) console.log(`[Cron] Weekly recap: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] weekly recap error:', e);
  }
}

// ─── Engagement: Free Lucky Spin reminder ───────────────────────────────────
// Daily-return driver — nudge recently-active users who haven't used today's
// free spin yet (only while the Lucky Spin is enabled with free spins).
async function maybeRemindFreeSpin(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'free_spin_reminder_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_free_spin_reminder_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 3600) return;
    const cfg = await env.DB.prepare("SELECT enabled, daily_free_spins FROM reward_spin_config WHERE id = 'default'").first<{ enabled: number; daily_free_spins: number }>().catch(() => null);
    if (!cfg || !cfg.enabled || (Number(cfg.daily_free_spins) || 0) <= 0) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_free_spin_reminder_run', ?, unixepoch())").bind(String(now)).run();

    const istOffset = (5 * 60 + 30) * 60;
    const startOfIstDay = Math.floor((now + istOffset) / 86400) * 86400 - istOffset;
    const rows = await env.DB.prepare(
      `SELECT u.id FROM users u
         LEFT JOIN user_spin_state s ON s.user_id = u.id
        WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND COALESCE(u.updated_at, 0) >= ?
          AND (s.last_spun_at IS NULL OR s.last_spun_at < ?)
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = 'free_spin' AND n.created_at >= ?)
        LIMIT 300`,
    ).bind(now - 14 * 86400, startOfIstDay, now - 20 * 3600).all<{ id: string }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      if (await notifyEngagement(env, r.id, '🎰 Aapka FREE Spin Ready Hai!', 'Aaj ka Lucky Spin abhi baaki hai! 🍀 Spin karein aur FREE coins jeetein — kaun jaanta hai jackpot aapka ho! 🎉', 'free_spin', { data: { type: 'free_spin' } })) sent++;
    }
    if (sent) console.log(`[Cron] Free-spin reminder: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] free-spin reminder error:', e);
  }
}

// ─── Engagement: Profile-completion nudge ────────────────────────────────────
// Users who signed up 1–14d ago but never added a profile photo. A completed
// profile = more investment + better host matching.
async function maybeNudgeProfileCompletion(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'profile_completion_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_profile_nudge_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 6 * 3600) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_profile_nudge_run', ?, unixepoch())").bind(String(now)).run();

    const rows = await env.DB.prepare(
      `SELECT id FROM users u
        WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND u.created_at <= ? AND u.created_at > ?
          AND (u.avatar_url IS NULL OR u.avatar_url = '')
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = 'profile_completion')
        LIMIT 300`,
    ).bind(now - 24 * 3600, now - 14 * 86400).all<{ id: string }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      if (await notifyEngagement(env, r.id, '📸 Apni Profile Complete Karein!', 'Ek pyaari si photo add karein aur dekhein magic! ✨ Behtar hosts se connect karein aur 3x zyada replies paayein. 💛', 'profile_completion', { data: { type: 'profile_completion' } })) sent++;
    }
    if (sent) console.log(`[Cron] Profile-completion nudge: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] profile completion error:', e);
  }
}

// ─── Engagement: Online / trending hosts discovery push ─────────────────────
// When a healthy number of hosts are online, nudge moderately-idle users (2-14d)
// to come explore. Opt-in (default OFF) to avoid over-messaging.
async function maybeNudgeOnlineHosts(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'online_hosts_push_enabled', false))) return;
    if (await isQuietHoursIST(env)) return;
    const now = Math.floor(Date.now() / 1000);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_online_hosts_push_run'").first<{ value: string }>();
    const last = lastRow?.value ? parseInt(lastRow.value, 10) || 0 : 0;
    if (now - last < 12 * 3600) return;
    const onlineRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM hosts WHERE is_active = 1 AND is_online = 1").first<{ n: number }>();
    const online = Number(onlineRow?.n) || 0;
    if (online < 3) return; // only nudge when there's a real selection
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_online_hosts_push_run', ?, unixepoch())").bind(String(now)).run();

    const rows = await env.DB.prepare(
      `SELECT id FROM users u
        WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND COALESCE(u.updated_at, 0) <= ? AND COALESCE(u.updated_at, 0) > ?
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = 'online_hosts' AND n.created_at >= ?)
        LIMIT 300`,
    ).bind(now - 2 * 86400, now - 14 * 86400, now - 3 * 86400).all<{ id: string }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      if (await notifyEngagement(env, r.id, `✨ ${online} Hosts Online Right Now!`, 'Naye aur trending hosts abhi live hain aur aapse baat karne ke liye ready! 💛 Kisi se connect karein aur maze karein. 🎉', 'online_hosts', { data: { type: 'online_hosts' } })) sent++;
    }
    if (sent) console.log(`[Cron] Online-hosts push: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] online-hosts push error:', e);
  }
}

// ─── Growth: Happy Hour announcement ────────────────────────────────────────
// Once a day, when the Happy Hour window is live, broadcast a "recharge now for
// bonus coins" push to recently-active users so they know to buy during it.
async function maybeAnnounceHappyHour(env: Env): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'happy_hour_enabled', false))) return;
    if (await isQuietHoursIST(env)) return;
    const readI = async (k: string, fb: number) => {
      const r = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(k).first<{ value: string }>();
      const n = parseInt(r?.value ?? '', 10);
      return Number.isFinite(n) ? n : fb;
    };
    const pct = await readI('happy_hour_bonus_pct', 0);
    if (pct <= 0) return;
    const startH = await readI('happy_hour_start_ist', 20);
    const endH = await readI('happy_hour_end_ist', 23);
    const now = Math.floor(Date.now() / 1000);
    const istOffset = (5 * 60 + 30) * 60;
    const h = new Date((now + istOffset) * 1000).getUTCHours();
    const inWindow = startH === endH ? false : (startH < endH ? (h >= startH && h < endH) : (h >= startH || h < endH));
    if (!inWindow) return;
    // Once per IST day.
    const istDay = Math.floor((now + istOffset) / 86400);
    const lastRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_happy_hour_announce_day'").first<{ value: string }>();
    if (parseInt(lastRow?.value ?? '', 10) === istDay) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_happy_hour_announce_day', ?, unixepoch())").bind(String(istDay)).run();

    const rows = await env.DB.prepare(
      `SELECT id FROM users u
        WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND COALESCE(u.updated_at, 0) > ?
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.type = 'happy_hour' AND n.created_at >= ?)
        LIMIT 500`,
    ).bind(now - 30 * 86400, now - 12 * 3600).all<{ id: string }>();
    let sent = 0;
    for (const r of rows.results ?? []) {
      if (await notifyEngagement(env, r.id, '⚡ Happy Hour is LIVE!', `🔥 Get ${pct}% EXTRA coins on every recharge right now! This deal won't last long — grab your bonus before the clock runs out! ⏳`, 'happy_hour', { data: { type: 'happy_hour' } })) sent++;
    }
    if (sent) console.log(`[Cron] Happy Hour announce: ${sent} sent`);
  } catch (e) {
    console.error('[Cron] happy hour announce error:', e);
  }
}

// ── Smart engines: daily learning jobs ──────────────────────────────────────
// Best-Time-To-Notify: once/UTC-day, recompute each user's modal active IST
// hour from recent activity so engagement nudges can be delivered near it.
// Gated by a slot-claim so overlapping ticks don't double-run. Best-effort.
async function maybeRecomputeActiveHours(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const dayIndex = Math.floor(now / 86400);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_active_hours_recompute_day'").first<{ value: string }>();
    if ((parseInt(row?.value ?? '', 10) || 0) === dayIndex) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_active_hours_recompute_day', ?, unixepoch())").bind(String(dayIndex)).run();
    const n = await recomputeActiveHours(env.DB);
    if (n) console.log(`[Cron] Best-time recompute: ${n} users`);
  } catch (e) {
    console.error('[Cron] active-hours recompute error:', e);
  }
}

// Churn Prediction: once/UTC-day, recompute per-user churn risk + tier.
async function maybeRecomputeChurn(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const dayIndex = Math.floor(now / 86400);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_churn_compute_day'").first<{ value: string }>();
    if ((parseInt(row?.value ?? '', 10) || 0) === dayIndex) return;
    await env.DB.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_churn_compute_day', ?, unixepoch())").bind(String(dayIndex)).run();
    const res = await recomputeChurnRisk(env.DB);
    if (!res.skipped) console.log('[Cron] Churn prediction:', JSON.stringify(res));
  } catch (e) {
    console.error('[Cron] churn recompute error:', e);
  }
}

// ─── Coin reconciliation watchdog (money-integrity alarm) ───────────────────
// Runs at most once/hour even though the cron fires every minute. Recomputes
// the same invariant the admin dashboard shows live — total coins held across
// all wallets vs the signed net of every coin_transactions row — and RAISES AN
// ALERT when they diverge beyond tolerance.
//
// Why a cron and not just the dashboard: the dashboard only surfaces drift when
// an operator happens to be looking. A money bug that silently mints or burns
// coins at 3am needs to page someone. This watchdog persists a snapshot every
// run (app_settings 'coin_recon_last') and writes an app_errors row on a bad
// imbalance, which shows up in the admin error feed AND bumps the health
// monitor's hourly error count.
//
// Invariant: every balance change writes a signed ledger row (grants +, spends
// −), so SUM(users.coins) should equal SUM(coin_transactions.amount). Legacy
// accounts whose welcome bonus predates the ledger fix carry a small expected
// baseline drift, so we alert on a PERCENTAGE breach gated by an absolute-coin
// floor — never on any non-zero drift. Both thresholds are admin-tunable via
// app_settings ('coin_recon_alert_pct' default 2%, 'coin_recon_alert_min_abs'
// default 1000 coins; interval via 'coin_recon_interval_sec' default 3600s).
async function maybeReconcileCoins(env: Env): Promise<void> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const readSetting = async (key: string): Promise<string | null> =>
      (await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>().catch(() => null))?.value ?? null;

    const interval = Math.max(300, parseInt((await readSetting('coin_recon_interval_sec')) ?? '', 10) || 3600); // default 1h, floor 5m
    const last = parseInt((await readSetting('coin_recon_last_run')) ?? '', 10) || 0;
    if (now - last < interval) return;
    // Claim the slot first so overlapping cron ticks don't double-run the scan.
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('coin_recon_last_run', ?, unixepoch())"
    ).bind(String(now)).run();

    // Same canonical figures as GET /admin/coin-reconciliation.
    const [walletRow, ledgerRow] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(coins),0) AS n FROM users WHERE COALESCE(status,'active') != 'deleted'").first<{ n: number }>().catch(() => ({ n: 0 })),
      env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM coin_transactions').first<{ n: number }>().catch(() => ({ n: 0 })),
    ]);
    const inWallets = Number(walletRow?.n ?? 0);
    const ledgerNet = Number(ledgerRow?.n ?? 0);
    const drift = inWallets - ledgerNet;
    const denom = Math.max(Math.abs(ledgerNet), Math.abs(inWallets), 1);
    const driftPct = (Math.abs(drift) / denom) * 100;

    const badPct = parseFloat((await readSetting('coin_recon_alert_pct')) ?? '') || 2;
    const minAbs = parseInt((await readSetting('coin_recon_alert_min_abs')) ?? '', 10) || 1000;
    const tone: 'ok' | 'warn' | 'bad' =
      (driftPct > badPct && Math.abs(drift) >= minAbs) ? 'bad'
      : driftPct > badPct / 4 ? 'warn'
      : 'ok';

    const snapshot = { ts: now, in_wallets: inWallets, ledger_net: ledgerNet, drift, drift_pct: Math.round(driftPct * 1000) / 1000, tone };
    await env.DB.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('coin_recon_last', ?, unixepoch())"
    ).bind(JSON.stringify(snapshot)).run().catch((e) => console.warn('[Cron] coin recon snapshot write failed:', e));

    if (tone === 'bad') {
      console.error(`[Cron] COIN RECONCILIATION ALERT — drift ${drift} (${driftPct.toFixed(2)}%) wallets=${inWallets} ledger=${ledgerNet}`);
      // Persist an alert row so it surfaces in the admin error feed + bumps the
      // health-monitor hourly error count even with no dashboard open.
      await env.DB.prepare(
        `INSERT INTO app_errors (user_id, message, context, platform, app_version)
         VALUES (NULL, ?, 'coin_reconciliation', 'cron', 'watchdog')`
      ).bind(
        `Coin reconciliation imbalance: wallets=${inWallets} ledger_net=${ledgerNet} drift=${drift} (${driftPct.toFixed(2)}%). Investigate for a mint/burn bug.`
      ).run().catch((e) => console.warn('[Cron] coin recon alert write failed:', e));
    } else {
      console.log(`[Cron] coin reconciliation ok — drift ${drift} (${driftPct.toFixed(2)}%)`);
    }
  } catch (e) {
    console.error('[Cron] coin reconciliation error:', e);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reapStaleCalls(env));
    ctx.waitUntil(reconcileStuckEndedCalls(env));
    // Release referral payout holds whose window has elapsed (held → released,
    // making the referrer reward withdrawable). Best-effort; idempotent.
    ctx.waitUntil(releaseExpiredReferralHolds(env).catch((e) => console.warn('[cron] releaseExpiredReferralHolds failed:', e)));
    // Auto-lift temporary bans whose expiry has passed (so "7-day" bans are
    // actually temporary). Best-effort; only touches expired temp bans.
    ctx.waitUntil(liftExpiredBans(env));
    ctx.waitUntil(maybeRecalcLevelsDaily(env));
    ctx.waitUntil(maybeRefreshFxRates(env));
    // Money-integrity watchdog — hourly self-gated; alerts on coin drift.
    ctx.waitUntil(maybeReconcileCoins(env).catch((e) => console.warn('[cron] maybeReconcileCoins failed:', e)));
    ctx.waitUntil(maybeRunReengagement(env));
    ctx.waitUntil(maybeSendStreakReminders(env));
    ctx.waitUntil(maybeSendVipReminders(env));
    ctx.waitUntil(maybeSendNearLevelNudges(env));
    ctx.waitUntil(maybeRollupEngagement(env));
    // Engagement suite (#2/#3/#6) — each self-gates (hourly/weekly + quiet hours).
    ctx.waitUntil(maybeRunOnboardingDrip(env));
    ctx.waitUntil(maybeNudgeAbandonedRecharge(env));
    ctx.waitUntil(maybeSendWeeklyRecap(env));
    ctx.waitUntil(maybeRemindFreeSpin(env));
    ctx.waitUntil(maybeNudgeProfileCompletion(env));
    ctx.waitUntil(maybeNudgeOnlineHosts(env));
    ctx.waitUntil(maybeAnnounceHappyHour(env));
    // Smart engines — daily learning jobs (each self-gates to once/UTC-day).
    ctx.waitUntil(maybeRecomputeActiveHours(env));
    ctx.waitUntil(maybeRecomputeChurn(env));
    // Health monitoring — probe all dependencies every minute and store results
    // for the admin dashboard uptime/latency charts. Also stamps last_cron_run
    // so the probe itself can detect cron staleness on the NEXT tick.
    ctx.waitUntil((async () => {
      try {
        const result = await runHealthProbes(env);
        await storeHealthCheck(env.DB, result);
        // Stamp last_cron_run so the next probe can detect cron staleness
        await env.DB.prepare(
          "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_cron_run', ?, unixepoch())"
        ).bind(String(Math.floor(Date.now() / 1000))).run();
        // Prune old health records (7-day retention, once per hour max)
        if (Math.random() < 0.017) await pruneHealthChecks(env.DB, 7);
      } catch (e) {
        console.warn('[Cron] health probe error:', e);
      }
    })());
  },
};
