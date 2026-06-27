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
import uploadRouter from './routes/upload';
import publicRouter from './routes/public';
import matchRouter from './routes/match';
import hostappRouter from './routes/hostapp';
import errorsRouter from './routes/errors';
import paymentRouter from './routes/payment';
import engagementRouter from './routes/engagement';
import { ChatRoom } from './durable-objects/ChatRoom';
import { CallSignaling } from './durable-objects/CallSignaling';
import { NotificationHub } from './durable-objects/NotificationHub';
import { ensureUsersSchema, ensureRandomCallSchema, ensureStreakSchema, ensureFirstCallFreeSchema, ensureCallObservabilitySchema, ensureEngagementSchema } from './lib/schemaGuard';
import { ensureAllMigrations } from './lib/autoMigrate';
import { getLevelConfig, getEarningShare, DEFAULT_AUDIO_RATE } from './lib/levels';
import { recalcAllHostLevels } from './lib/levelService';
import { billedMinutes, coinsForCall, chargeCallerWithFreePool } from './lib/billing';
import { runReengagement } from './lib/reengagement';
import { istContext } from './lib/streak';
import { getFCMTokens, sendFCMPush } from './lib/fcm';
import { createCFCalls } from './lib/cf-calls';
import { USD_TO_FOREIGN } from './lib/currency';

// Re-export Durable Objects (required by wrangler)
export { ChatRoom, CallSignaling, NotificationHub };

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
    return isOriginAllowed(origin, c.env) ? origin : null;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 86400,
}));
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
    ensureFirstCallFreeSchema(c.env.DB),
    ensureCallObservabilitySchema(c.env.DB),
    ensureEngagementSchema(c.env.DB),
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
app.route('/api/admin', adminRouter);
app.route('/api/match', matchRouter);
app.route('/api/host-app', hostappRouter);
app.route('/api/upload', uploadRouter);
app.route('/api/errors', errorsRouter);
app.route('/api/payment', paymentRouter);
app.route('/api/engagement', engagementRouter);
app.route('/api', publicRouter);

// ─── WebSocket Auth Helper ─────────────────────────────────────────────────
async function verifyWsToken(token: string | null, secret: string): Promise<string | null> {
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
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

// WebSocket: call signaling per session — JWT auth + identity binding.
// CRITICAL FIX: Forward the JWT-verified userId AND the derived role to the DO
// via trusted X-CF-* headers. Previously the DO read these from URL query
// params, which an authenticated user with access to the session could spoof
// to impersonate the OTHER party (caller posing as host or vice versa).
app.get('/api/ws/call/:sessionId', async (c) => {
  const { sessionId } = c.req.param();
  const token = extractWsToken(c);
  const verifiedUserId = await verifyWsToken(token, c.env.JWT_SECRET);
  if (!verifiedUserId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const session = await c.env.DB.prepare(
    `SELECT cs.caller_id, h.user_id as host_user_id FROM call_sessions cs LEFT JOIN hosts h ON h.id = cs.host_id WHERE cs.id = ?`
  ).bind(sessionId).first<any>();
  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Derive role from the JWT-verified userId (server is the authority — never trust client claims)
  let role: 'caller' | 'host';
  if (session.caller_id === verifiedUserId) role = 'caller';
  else if (session.host_user_id === verifiedUserId) role = 'host';
  else return c.json({ error: 'Access denied to this call session' }, 403);

  // Build a trusted request: copy original headers (preserves WebSocket upgrade
  // headers like Sec-WebSocket-Key/Version/Extensions) and set our trusted ones.
  // The DO requires X-CF-User-Id + X-CF-Role and ignores URL query params.
  const trustedHeaders = new Headers(c.req.raw.headers);
  trustedHeaders.set('X-CF-User-Id', verifiedUserId);
  trustedHeaders.set('X-CF-Role', role);
  const trustedReq = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: trustedHeaders,
  });

  const id = c.env.CALL_SIGNALING.idFromName(sessionId);
  const stub = c.env.CALL_SIGNALING.get(id);
  return stub.fetch(trustedReq);
});

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
  // Active calls: 30 min ke baad expire (crash/disconnect scenario)
  const activeCutoff = now - (30 * 60);

  try {
    const staleCalls = await db
      .prepare(
        `SELECT cs.id, cs.caller_id, cs.host_id, cs.started_at, cs.created_at, cs.rate_per_minute, cs.type,
                cs.cf_session_id, cs.cf_host_session_id,
                h.user_id as host_user_id, h.level as host_level,
                cs.status
         FROM call_sessions cs
         JOIN hosts h ON h.id = cs.host_id
         WHERE (cs.status = 'pending' AND cs.created_at < ?)
            OR (cs.status = 'active'  AND cs.started_at < ?)
         LIMIT 50`
      )
      .bind(pendingCutoff, activeCutoff)
      .all<any>();

    if (!staleCalls.results.length) return;

    // CF Calls sessions idle-timeout on their own, but tearing them down
    // promptly when we reap a call frees SFU resources immediately instead of
    // waiting out the idle window.
    const cfCalls = createCFCalls(env);

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

      // Best-effort: close the CF Calls sessions for this reaped call so SFU
      // media tears down right away rather than lingering until idle-timeout.
      if (cfCalls) {
        for (const sid of [call.cf_session_id, call.cf_host_session_id]) {
          if (sid) {
            try { await cfCalls.closeSession(sid); } catch (e) { console.warn('[Cron] CF closeSession failed for', call.id, e); }
          }
        }
      }
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

    const title = '🔥 Keep your streak alive!';
    const body = "Claim today's reward before midnight — don't break your streak!";

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

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reapStaleCalls(env));
    ctx.waitUntil(reconcileStuckEndedCalls(env));
    ctx.waitUntil(maybeRecalcLevelsDaily(env));
    ctx.waitUntil(maybeRefreshFxRates(env));
    ctx.waitUntil(maybeRunReengagement(env));
    ctx.waitUntil(maybeSendStreakReminders(env));
    ctx.waitUntil(maybeRollupEngagement(env));
  },
};
