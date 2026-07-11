import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { checkRateLimit } from '../lib/rateLimit';
import type { Env, JWTPayload } from '../types';

// ============================================================================
// Engagement event ingest — the feedback loop for the recommender + home feed.
// ============================================================================
//
// POST /api/engagement/events  (authenticated, batched)
//
// The client buffers impression/click events and flushes them in batches (see
// voxlink/services/engagement.ts). This endpoint validates + bounds the batch
// and appends rows to engagement_events. The daily rollup cron (index.ts)
// aggregates them into host_engagement_stats and prunes the raw table.
//
// Design notes:
//   • Best-effort / non-critical — analytics, never the user's critical path.
//     A failure returns ok:false but HTTP 200 so the client just drops the
//     batch instead of retrying forever.
//   • Feature-flagged (engagement_events_enabled) so it can be killed instantly
//     from the admin panel without a deploy.
//   • Allow-listed event types + hard caps on batch size and field lengths so
//     the table can't be flooded or filled with junk by a hostile client.
//   • Per-user rate limit on top of the batch cap.

const engagement = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

/** Event types the client is allowed to log. Anything else is dropped. */
const ALLOWED_EVENT_TYPES = new Set<string>([
  'reco_impression',
  'reco_click',
  'host_impression',
  'host_click',
  'banner_click',
  'call_start',
  'call_complete',
  // Notification CTR: logged when the user opens/taps a push (surface = type).
  'notif_open',
]);

/** Hard cap on events accepted per request (extra are ignored). */
const MAX_BATCH = 50;
/** Per-user rate limit: requests allowed per 60s window. Generous (batched). */
const RL_MAX_PER_MIN = 120;

interface RawEvent {
  type?: unknown;
  host_id?: unknown;
  surface?: unknown;
  score?: unknown;
  meta?: unknown;
  ts?: unknown;
}

engagement.post('/events', authMiddleware, async (c) => {
  const { sub } = c.get('user');

  // Kill switch — make the endpoint a cheap no-op when disabled.
  const flag = await c.env.DB
    .prepare("SELECT value FROM app_settings WHERE key = 'engagement_events_enabled'")
    .first<{ value: string }>()
    .catch(() => null);
  if (flag?.value === '0') return c.json({ ok: true, stored: 0, disabled: true });

  // Per-user rate limit (fails open on DB error inside checkRateLimit).
  const rlKey = `rl:engage:${sub}:${Math.floor(Date.now() / 60000)}`;
  const { limited } = await checkRateLimit(c.env.DB, rlKey, RL_MAX_PER_MIN, 60);
  if (limited) return c.json({ ok: false, stored: 0, error: 'rate_limited' }, 429);

  const body = await c.req.json().catch(() => ({}));
  const rawEvents: RawEvent[] = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: RawEvent[] }).events)
    : [];
  if (rawEvents.length === 0) return c.json({ ok: true, stored: 0 });

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const rows: Array<{
    type: string;
    hostId: string | null;
    surface: string | null;
    score: number | null;
    meta: string | null;
    ts: number;
  }> = [];

  for (const e of rawEvents.slice(0, MAX_BATCH)) {
    const type = String(e?.type ?? '').slice(0, 40);
    if (!ALLOWED_EVENT_TYPES.has(type)) continue;

    const hostId = e?.host_id != null ? String(e.host_id).slice(0, 64) : null;
    const surface = e?.surface != null ? String(e.surface).slice(0, 40) : null;

    const scoreNum = Number(e?.score);
    const score = Number.isFinite(scoreNum) ? scoreNum : null;

    let meta: string | null = null;
    if (e?.meta && typeof e.meta === 'object') {
      try { meta = JSON.stringify(e.meta).slice(0, 500); } catch { meta = null; }
    }

    // Clamp client timestamp to [now-24h, now] so clock skew / spoofing can't
    // land events in the future or far past (which would corrupt the rollup).
    const tsNum = Math.floor(Number(e?.ts));
    const ts = Number.isFinite(tsNum) ? Math.min(now, Math.max(dayAgo, tsNum)) : now;

    rows.push({ type, hostId, surface, score, meta, ts });
  }

  if (rows.length === 0) return c.json({ ok: true, stored: 0 });

  try {
    await c.env.DB.batch(
      rows.map((r) =>
        c.env.DB
          .prepare(
            `INSERT INTO engagement_events (id, user_id, event_type, host_id, surface, score, meta, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), sub, r.type, r.hostId, r.surface, r.score, r.meta, r.ts),
      ),
    );
  } catch (err) {
    // Non-fatal: analytics must never break the client. HTTP 200 so the client
    // drops the batch rather than retrying into a tight failure loop.
    console.warn('[engagement] batch insert failed (non-fatal):', err);
    return c.json({ ok: false, stored: 0 });
  }

  return c.json({ ok: true, stored: rows.length });
});

export default engagement;
