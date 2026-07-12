// ============================================================================
// Smart Call-Quality Routing — recommend the initial video tier per user.
// ============================================================================
//
// The client already ADAPTS quality live (agora.ts steps the encoder down when
// the uplink congests). But every call STARTS at the top tier and only steps
// down after the first bad samples — so users on a consistently poor network
// get a few seconds of freeze/artifacting on every connect before it settles.
//
// This engine looks at the user's OWN recent call-quality history (jitter,
// packet loss, RTT that their client already reports to POST /:id/quality) and
// recommends the tier the call should START at. Good-network users still start
// 'high'; chronically-poor-network users start 'medium'/'low' and ramp UP as
// the live adaptation confirms headroom — smoother first impression, no freeze.
//
// Admin-tunable, defaults DISABLED (always 'high' = legacy). Pure hint — the
// client's live adaptation remains the source of truth after connect.
// ============================================================================

export type QualityTier = 'high' | 'medium' | 'low';

async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}

/**
 * Pure tier decision from aggregate quality metrics. Exported for testing.
 * Thresholds chosen to match agora.ts's downgrade behaviour:
 *   - loss > 5%  OR jitter > 60ms OR rtt > 400ms → 'low'
 *   - loss > 2%  OR jitter > 30ms OR rtt > 250ms → 'medium'
 *   - otherwise                                   → 'high'
 */
export function tierFromMetrics(avgJitterMs: number, avgLossPct: number, avgRttMs: number): QualityTier {
  if (avgLossPct > 5 || avgJitterMs > 60 || avgRttMs > 400) return 'low';
  if (avgLossPct > 2 || avgJitterMs > 30 || avgRttMs > 250) return 'medium';
  return 'high';
}

/**
 * Recommend the starting video tier for a user based on their recent call
 * quality samples. Returns 'high' when the feature is off or there's no data
 * (optimistic default). Best-effort; never throws.
 */
export async function recommendInitialTier(db: D1Database, userId: string): Promise<QualityTier> {
  try {
    if (!(await readBool(db, 'smart_call_quality_enabled', false))) return 'high';
    const samples = Math.max(3, Math.min(200, await readInt(db, 'smart_call_quality_samples', 20)));
    const row = await db
      .prepare(
        `SELECT AVG(jitter_ms) AS j, AVG(packet_loss_pct) AS l, AVG(rtt_ms) AS r, COUNT(*) AS n
           FROM (
             SELECT jitter_ms, packet_loss_pct, rtt_ms
               FROM call_quality
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT ?
           )`,
      )
      .bind(userId, samples)
      .first<{ j: number | null; l: number | null; r: number | null; n: number }>();

    // Not enough history to judge → start optimistic.
    if (!row || (Number(row.n) || 0) < 3) return 'high';

    return tierFromMetrics(Number(row.j) || 0, Number(row.l) || 0, Number(row.r) || 0);
  } catch {
    return 'high';
  }
}
