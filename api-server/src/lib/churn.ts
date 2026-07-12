// ============================================================================
// Churn Prediction engine — score each user's likelihood of leaving.
// ============================================================================
//
// A transparent, explainable risk model (no black box) computed by a daily
// cron and stored on the user row so the admin can see who's slipping away and
// the win-back machinery can prioritize them.
//
// SIGNALS (blended into a 0..1 risk):
//   • recency  (dominant, 70%) — days since last activity vs a churn horizon.
//     0 days idle → 0 risk; >= horizon days idle → 1.0.
//   • decline  (30%)           — call frequency trend: calls in the last 7 days
//     vs the previous 7. A sharp drop signals disengagement even if recent.
//
//   risk = clamp( 0.7 * recencyRisk + 0.3 * declineRisk , 0, 1 )
//
// TIERS: risk >= high_threshold → 'high'; >= medium_threshold → 'medium'; else
// 'low'. Stored as users.churn_risk / churn_tier / churn_computed_at.
//
// Admin-tunable thresholds/horizon; defaults DISABLED (opt-in). Read-only —
// computing risk never messages the user or moves money.
// ============================================================================

const SECONDS_PER_DAY = 86400;

async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readFloat(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = Number(row?.value);
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

const clamp01 = (n: number) => (!Number.isFinite(n) || n <= 0 ? 0 : n > 1 ? 1 : n);

/**
 * Pure risk formula — exported for unit testing and reuse.
 * @param idleDays days since last activity
 * @param horizonDays churn horizon (idle >= horizon ⇒ recencyRisk = 1)
 * @param calls7 calls in the last 7 days
 * @param callsPrev7 calls in the 7 days before that
 */
export function churnRisk(idleDays: number, horizonDays: number, calls7: number, callsPrev7: number): number {
  const horizon = horizonDays > 0 ? horizonDays : 30;
  const recencyRisk = clamp01(idleDays / horizon);
  // Decline: only counts as risk when activity dropped vs the prior week.
  const declineRisk = callsPrev7 > 0 ? clamp01((callsPrev7 - calls7) / callsPrev7) : 0;
  return clamp01(0.7 * recencyRisk + 0.3 * declineRisk);
}

export function tierFor(risk: number, high: number, medium: number): 'high' | 'medium' | 'low' {
  if (risk >= high) return 'high';
  if (risk >= medium) return 'medium';
  return 'low';
}

export interface ChurnRunResult {
  skipped?: string;
  scored: number;
  high: number;
  medium: number;
  low: number;
}

/**
 * Recompute churn risk for the active user base and store it. Daily cron.
 * Bounded (churn_max_users) and best-effort — never throws into the cron.
 */
export async function recomputeChurnRisk(db: D1Database): Promise<ChurnRunResult> {
  try {
    if (!(await readBool(db, 'churn_prediction_enabled', false))) {
      return { skipped: 'disabled', scored: 0, high: 0, medium: 0, low: 0 };
    }
    const horizon = Math.max(1, await readInt(db, 'churn_horizon_days', 30));
    const highT = await readFloat(db, 'churn_high_threshold', 0.7);
    const medT = await readFloat(db, 'churn_medium_threshold', 0.4);
    const maxUsers = Math.max(1, Math.min(20000, await readInt(db, 'churn_max_users', 5000)));

    const now = Math.floor(Date.now() / 1000);
    const d7 = now - 7 * SECONDS_PER_DAY;
    const d14 = now - 14 * SECONDS_PER_DAY;

    // One query: per-user last activity + call counts for the two 7-day windows.
    // Bounded to the most-recently-touched users (the churnable population).
    const rows = await db
      .prepare(
        `SELECT u.id AS uid,
                MAX(
                  COALESCE((SELECT MAX(created_at) FROM call_sessions WHERE caller_id = u.id), 0),
                  COALESCE(u.updated_at, 0),
                  COALESCE(u.created_at, 0)
                ) AS last_activity,
                (SELECT COUNT(*) FROM call_sessions WHERE caller_id = u.id AND created_at > ?1) AS c7,
                (SELECT COUNT(*) FROM call_sessions WHERE caller_id = u.id AND created_at > ?2 AND created_at <= ?1) AS cprev7
           FROM users u
          WHERE u.role = 'user' AND COALESCE(u.status, 'active') = 'active'
          ORDER BY u.updated_at DESC
          LIMIT ?3`,
      )
      .bind(d7, d14, maxUsers)
      .all<{ uid: string; last_activity: number; c7: number; cprev7: number }>();

    const results = rows.results ?? [];
    if (results.length === 0) return { scored: 0, high: 0, medium: 0, low: 0 };

    let high = 0, medium = 0, low = 0;
    const updates: { uid: string; risk: number; tier: string }[] = results.map((r) => {
      const idleDays = Math.max(0, (now - (Number(r.last_activity) || now)) / SECONDS_PER_DAY);
      const risk = churnRisk(idleDays, horizon, Number(r.c7) || 0, Number(r.cprev7) || 0);
      const tier = tierFor(risk, highT, medT);
      if (tier === 'high') high++; else if (tier === 'medium') medium++; else low++;
      return { uid: r.uid, risk: Math.round(risk * 1000) / 1000, tier };
    });

    for (let i = 0; i < updates.length; i += 90) {
      const chunk = updates.slice(i, i + 90);
      try {
        await db.batch(
          chunk.map((u) =>
            db.prepare('UPDATE users SET churn_risk = ?, churn_tier = ?, churn_computed_at = ? WHERE id = ?')
              .bind(u.risk, u.tier, now, u.uid),
          ),
        );
      } catch (e) {
        console.warn('[churn] update batch failed (non-fatal):', e);
      }
    }
    return { scored: updates.length, high, medium, low };
  } catch (e) {
    console.warn('[churn] recomputeChurnRisk failed:', e);
    return { skipped: 'error', scored: 0, high: 0, medium: 0, low: 0 };
  }
}

/** Admin summary: churn tier distribution + a sample of the highest-risk users. */
export async function getChurnSummary(db: D1Database): Promise<{
  enabled: boolean;
  computed_at: number;
  distribution: { high: number; medium: number; low: number };
  top_at_risk: { id: string; name: string | null; churn_risk: number; churn_tier: string }[];
}> {
  const enabled = await readBool(db, 'churn_prediction_enabled', false);
  const distRows = await db
    .prepare("SELECT churn_tier AS tier, COUNT(*) AS n FROM users WHERE role = 'user' AND churn_computed_at > 0 GROUP BY churn_tier")
    .all<{ tier: string; n: number }>()
    .catch(() => ({ results: [] as { tier: string; n: number }[] }));
  const distribution = { high: 0, medium: 0, low: 0 };
  for (const r of distRows.results ?? []) {
    if (r.tier === 'high') distribution.high = Number(r.n) || 0;
    else if (r.tier === 'medium') distribution.medium = Number(r.n) || 0;
    else distribution.low = Number(r.n) || 0;
  }
  const computedRow = await db
    .prepare('SELECT MAX(churn_computed_at) AS ts FROM users WHERE churn_computed_at > 0')
    .first<{ ts: number }>()
    .catch(() => null);
  const top = await db
    .prepare(
      `SELECT id, name, churn_risk, churn_tier FROM users
        WHERE role = 'user' AND churn_computed_at > 0 AND churn_tier = 'high'
        ORDER BY churn_risk DESC LIMIT 50`,
    )
    .all<{ id: string; name: string | null; churn_risk: number; churn_tier: string }>()
    .catch(() => ({ results: [] as any[] }));
  return {
    enabled,
    computed_at: Number(computedRow?.ts) || 0,
    distribution,
    top_at_risk: top.results ?? [],
  };
}
