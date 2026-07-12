// ============================================================================
// Smart-engines v2 routes — user-facing read endpoints.
// ============================================================================
//
//   GET  /api/smart/rail-order            — personalized home rail ordering.
//   GET  /api/smart/availability/:hostId  — data-driven "usually online" hint.
//   POST /api/smart/instant-connect       — best host to connect to right now
//                                           (or an honest wait ETA + queue pos).
//
// Every endpoint is authenticated, best-effort, and honours its engine's
// DEFAULT-OFF flag: when the feature is disabled the response falls back to a
// neutral shape (`enabled:false` + the static default) so clients can call it
// unconditionally and simply ignore a disabled engine.
// ============================================================================

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';
import {
  orderRails,
  normalizeRailWeights,
  type RailStat,
} from '../lib/railOrder';
import { predictHostAvailability } from '../lib/availabilityPredict';
import {
  decideInstant,
  normalizeInstantWeights,
  type InstantCandidate,
} from '../lib/instantConnect';
import { getLevelConfig, getRankBoost } from '../lib/levels';

const smart = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// The canonical home rails, in their static/default order. Rail ids must match
// what the client renders + what it reports as `surface` in engagement events.
const DEFAULT_RAILS = ['favorites', 'recommended', 'online', 'interest', 'new', 'top'];

async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}
async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch { return fallback; }
}
async function readJson(db: D1Database, key: string): Promise<unknown> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ? JSON.parse(row.value) : undefined;
  } catch { return undefined; }
}

// ── GET /api/smart/rail-order ───────────────────────────────────────────────
// Returns the per-user rail order derived from the user's own tap history
// (engagement_events, surface = rail id). Disabled → the static default order.
smart.get('/rail-order', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  if (!(await readBool(db, 'rail_order_enabled', false))) {
    return c.json({ enabled: false, order: DEFAULT_RAILS });
  }

  const weights = normalizeRailWeights(await readJson(db, 'rail_order_weights'));
  const lookbackDays = Math.max(3, await readInt(db, 'rail_order_lookback_days', 30));
  const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  const stats: Record<string, RailStat> = {};
  try {
    // Aggregate this user's engagement per rail (surface) into impression /
    // click / conversion counts. Unknown event types are ignored.
    const rows = await db
      .prepare(
        `SELECT surface,
                SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
                SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
                SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END) AS conversions
         FROM engagement_events
         WHERE user_id = ? AND created_at > ? AND surface IS NOT NULL
         GROUP BY surface`,
      )
      .bind(sub, cutoff)
      .all<{ surface: string; impressions: number; clicks: number; conversions: number }>();
    for (const r of rows.results ?? []) {
      stats[r.surface] = {
        surface: r.surface,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        conversions: Number(r.conversions) || 0,
      };
    }
  } catch (e) {
    console.warn('[smart/rail-order] engagement aggregate failed (non-fatal):', e);
  }

  const order = orderRails(DEFAULT_RAILS, stats, weights);
  return c.json({ enabled: true, order });
});

// ── GET /api/smart/availability/:hostId ─────────────────────────────────────
// Data-driven "usually online now" / "usually online around 8 PM" hint from
// the host's historical activity. NEVER claims live presence — it's a
// probability. Disabled → { enabled:false }.
smart.get('/availability/:hostId', authMiddleware, async (c) => {
  const hostId = c.req.param('hostId');
  if (!hostId) return c.json({ error: 'hostId required' }, 400);
  const prediction = await predictHostAvailability(c.env, hostId);
  return c.json(prediction);
});

// ── POST /api/smart/instant-connect ─────────────────────────────────────────
// "Talk Now" brain: pick the best host for THIS user right now, blending
// personal affinity + quality + fair load-spreading. When nobody's online,
// return an honest ETA + queue position instead of a dead end.
// Body: { call_type?: 'audio' | 'video' }. Disabled → { enabled:false }.
smart.post('/instant-connect', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  if (!(await readBool(db, 'instant_connect_enabled', false))) {
    return c.json({ enabled: false });
  }

  let callType: 'audio' | 'video' = 'audio';
  try {
    const body = await c.req.json<{ call_type?: string }>().catch(() => ({} as { call_type?: string }));
    if (body?.call_type === 'video') callType = 'video';
  } catch { /* default audio */ }

  const weights = normalizeInstantWeights(await readJson(db, 'instant_connect_weights'));
  const maxWait = Math.max(30, await readInt(db, 'instant_connect_max_wait_seconds', 300));
  const loadWindowMin = Math.max(5, await readInt(db, 'instant_connect_load_window_min', 30));
  const now = Math.floor(Date.now() / 1000);
  const loadCutoff = now - loadWindowMin * 60;

  const config = await getLevelConfig(db);
  const maxRankBoost = Math.max(1, ...config.map((l) => getRankBoost(l.level, config)));

  // Online candidate pool + this user's affinity signals + recent per-host load.
  const [poolRes, favRes, callRes, loadRes, onlineCountRes] = await Promise.all([
    db.prepare(
      `SELECT h.id AS host_id, h.rating AS rating, h.review_count AS review_count,
              h.created_at AS created_at, h.level AS level, h.is_online AS is_online
       FROM hosts h
       WHERE h.is_active = 1 AND h.is_online = 1
         ${callType === 'video' ? 'AND COALESCE(h.allows_video, 1) = 1' : ''}
       ORDER BY h.rating DESC, h.review_count DESC LIMIT 60`,
    ).all<{ host_id: string; rating: number; review_count: number; created_at: number; level: number; is_online: number }>().catch(() => ({ results: [] as any[] })),
    db.prepare('SELECT host_id FROM user_favorites WHERE user_id = ?').bind(sub).all<{ host_id: string }>().catch(() => ({ results: [] as any[] })),
    db.prepare(
      `SELECT host_id, COUNT(*) AS cnt FROM call_sessions
       WHERE caller_id = ? AND status = 'ended' GROUP BY host_id`,
    ).bind(sub).all<{ host_id: string; cnt: number }>().catch(() => ({ results: [] as any[] })),
    db.prepare(
      `SELECT host_id, COUNT(*) AS cnt FROM call_sessions
       WHERE created_at > ? GROUP BY host_id`,
    ).bind(loadCutoff).all<{ host_id: string; cnt: number }>().catch(() => ({ results: [] as any[] })),
    // Expected supply for the wait estimate: distinct hosts active in the last 2h.
    db.prepare(
      `SELECT COUNT(DISTINCT host_id) AS n FROM call_sessions WHERE created_at > ?`,
    ).bind(now - 7200).first<{ n: number }>().catch(() => null),
  ]);

  const favorites = new Set<string>((favRes.results ?? []).map((r: any) => r.host_id));
  const callCount = new Map<string, number>();
  for (const r of callRes.results ?? []) callCount.set((r as any).host_id, Number((r as any).cnt) || 0);
  const recentLoad = new Map<string, number>();
  for (const r of loadRes.results ?? []) recentLoad.set((r as any).host_id, Number((r as any).cnt) || 0);

  const candidates: InstantCandidate[] = (poolRes.results ?? []).map((h: any) => ({
    host_id: h.host_id,
    is_online: !!h.is_online,
    rating: Number(h.rating) || 0,
    review_count: Number(h.review_count) || 0,
    created_at: Number(h.created_at) || now,
    rank_boost_norm: getRankBoost(Number(h.level) || 1, config) / maxRankBoost,
    past_calls: callCount.get(h.host_id) ?? 0,
    is_favorite: favorites.has(h.host_id),
    recent_matches: recentLoad.get(h.host_id) ?? 0,
  }));

  // Rough expected-online for the ETA: distinct recently-active hosts, damped.
  const poolLikelihood = Math.max(0, Number(onlineCountRes?.n) || 0) / 4;

  const decision = decideInstant(candidates, weights, {
    now,
    poolLikelihood,
    queuePosition: 1,
    maxWaitSeconds: maxWait,
  });

  return c.json({ enabled: true, call_type: callType, ...decision });
});

export default smart;
