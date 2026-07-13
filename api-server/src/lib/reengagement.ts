// ============================================================================
// Re-engagement / churn-prevention engine (Priority 2)
// ============================================================================
//
// Runs from the scheduled() cron (see index.ts, gated to once every
// `reengagement_interval_hours`). Finds users who have gone quiet and nudges
// them back with a push + in-app notification — the "Trigger" in the Hook
// model.
//
// Churn signal: time since last activity, where "activity" = the most recent
// of (their last call as caller) and (users.updated_at, our best "last seen"
// proxy). No new column needed.
//
// Buckets:
//   • idle    (>= reengagement_idle_days, < winback)  → soft nudge.
//   • winback (>= reengagement_winback_days)           → stronger message.
// If the user has a FAVORITE HOST ONLINE RIGHT NOW, the message names them —
// the single highest-converting trigger we can send.
//
// Safety rails (all admin-tunable via app_settings, with safe fallbacks):
//   • reengagement_enabled        — master kill switch ('0' disables).
//   • reengagement_cooldown_days  — min gap between nudges per user (dedup via
//                                   prior type='reengagement' notification).
//   • reengagement_max_per_run    — cap on users processed per run.
//   • reengagement_max_idle_days  — stop pestering long-dead accounts.
//   • reengagement_idle_days / reengagement_winback_days — bucket thresholds.
//
// We only target users who have an `fcm_token` (so a push can actually land)
// and whose role is 'user' with status 'active'. Everything is best-effort:
// a failure logs and is swallowed so a bad run never throws into the cron.
// ============================================================================

import { sendFCMPush, getFCMTokens } from './fcm';
import type { Env } from '../types';

const SECONDS_PER_DAY = 86400;

async function readIntSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

async function readBoolSetting(db: D1Database, key: string, fallbackEnabled: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallbackEnabled;
    return row.value !== '0';
  } catch {
    return fallbackEnabled;
  }
}

interface Candidate {
  id: string;
  name: string | null;
  last_activity: number;
}

export interface ReengagementResult {
  skipped?: string;
  processed: number;
  pushed: number;
  idle: number;
  winback: number;
  favorite_online: number;
}

/** Build the message for a user given their bucket + an optional online favorite host. */
function buildMessage(
  bucket: 'idle' | 'winback',
  favoriteHostName: string | null,
): { title: string; body: string } {
  if (favoriteHostName) {
    return {
      title: `🟢 ${favoriteHostName} is online now`,
      body: 'Aapke favorite host abhi available hain — ek call ho jaaye?',
    };
  }
  if (bucket === 'winback') {
    return {
      title: 'Hum aapko miss kar rahe hain 💙',
      body: 'Wapas aaiye — aaj ki daily reward aur free streak aapka intezaar kar rahe hain.',
    };
  }
  return {
    title: 'Kaise hain aap? 👋',
    body: 'Naye hosts abhi online hain. Ek call karke baat karein?',
  };
}

/**
 * Find idle users, dedup against the cooldown window, personalize with an
 * online favorite where possible, then persist + push notifications in
 * batches. Returns a small summary for the cron log.
 */
export async function runReengagement(env: Env): Promise<ReengagementResult> {
  const db = env.DB;

  const enabled = await readBoolSetting(db, 'reengagement_enabled', true);
  if (!enabled) return { skipped: 'disabled', processed: 0, pushed: 0, idle: 0, winback: 0, favorite_online: 0 };

  const idleDays = await readIntSetting(db, 'reengagement_idle_days', 3);
  const winbackDays = await readIntSetting(db, 'reengagement_winback_days', 7);
  const cooldownDays = await readIntSetting(db, 'reengagement_cooldown_days', 3);
  const maxIdleDays = await readIntSetting(db, 'reengagement_max_idle_days', 45);
  // Hard upper bound so a misconfigured setting can't blast the whole base in
  // one run (FCM/D1 cost + spam protection).
  const maxPerRun = Math.min(500, await readIntSetting(db, 'reengagement_max_per_run', 200));

  const now = Math.floor(Date.now() / 1000);
  const idleCutoff = now - idleDays * SECONDS_PER_DAY;       // last_activity older than this = idle
  const deadCutoff = now - maxIdleDays * SECONDS_PER_DAY;    // older than this = give up
  const cooldownCutoff = now - cooldownDays * SECONDS_PER_DAY;

  // Candidate pull. last_activity = max(last call as caller, updated_at).
  // The NOT EXISTS dedup skips anyone we've already nudged within the cooldown.
  let candidates: Candidate[];
  try {
    const res = await db
      .prepare(
        `SELECT id, name, last_activity FROM (
           SELECT u.id AS id, u.name AS name,
                  MAX(
                    COALESCE((SELECT MAX(created_at) FROM call_sessions WHERE caller_id = u.id), 0),
                    COALESCE(u.updated_at, 0)
                  ) AS last_activity
           FROM users u
           WHERE u.role = 'user'
             AND COALESCE(u.status, 'active') = 'active'
             AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
             AND NOT EXISTS (
               SELECT 1 FROM notifications n
               WHERE n.user_id = u.id AND n.type = 'reengagement' AND n.created_at >= ?
             )
         ) t
         WHERE t.last_activity < ? AND t.last_activity > ?
         ORDER BY t.last_activity ASC
         LIMIT ?`,
      )
      .bind(cooldownCutoff, idleCutoff, deadCutoff, maxPerRun)
      .all<Candidate>();
    candidates = res.results ?? [];
  } catch (err) {
    console.warn('[reengagement] candidate query failed:', err);
    return { skipped: 'query_error', processed: 0, pushed: 0, idle: 0, winback: 0, favorite_online: 0 };
  }

  if (candidates.length === 0) {
    return { processed: 0, pushed: 0, idle: 0, winback: 0, favorite_online: 0 };
  }

  // Map each candidate → one favorite host who is online right now (best-effort).
  const favoriteOnlineByUser = new Map<string, string>();
  try {
    const ids = candidates.map((c) => c.id);
    // Chunk the IN list so we never exceed SQLite's bound-parameter limit.
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const ph = chunk.map(() => '?').join(',');
      const favRes = await db
        .prepare(
          `SELECT uf.user_id AS user_id, COALESCE(h.display_name, u2.name) AS host_name
           FROM user_favorites uf
           JOIN hosts h ON h.id = uf.host_id
           JOIN users u2 ON u2.id = h.user_id
           WHERE uf.user_id IN (${ph}) AND h.is_online = 1 AND h.is_active = 1`,
        )
        .bind(...chunk)
        .all<{ user_id: string; host_name: string }>();
      for (const r of favRes.results ?? []) {
        if (!favoriteOnlineByUser.has(r.user_id)) favoriteOnlineByUser.set(r.user_id, r.host_name);
      }
    }
  } catch (err) {
    console.warn('[reengagement] favorite-online lookup failed (non-fatal):', err);
  }

  const winbackCutoff = now - winbackDays * SECONDS_PER_DAY;

  interface Prepared {
    userId: string;
    title: string;
    body: string;
    bucket: 'idle' | 'winback';
    hasFavorite: boolean;
  }
  const prepared: Prepared[] = candidates.map((c) => {
    const bucket: 'idle' | 'winback' = c.last_activity <= winbackCutoff ? 'winback' : 'idle';
    const favName = favoriteOnlineByUser.get(c.id) ?? null;
    const { title, body } = buildMessage(bucket, favName);
    return { userId: c.id, title, body, bucket, hasFavorite: !!favName };
  });

  // 1. Persist in-app notifications in DB batches of 90 (D1 batch limit is 100).
  let idle = 0;
  let winback = 0;
  let favoriteOnline = 0;
  for (const p of prepared) {
    if (p.bucket === 'winback') winback++; else idle++;
    if (p.hasFavorite) favoriteOnline++;
  }

  for (let i = 0; i < prepared.length; i += 90) {
    const chunk = prepared.slice(i, i + 90);
    try {
      await db.batch(
        chunk.map((p) =>
          db
            .prepare('INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?,?,?,?,?,?)')
            .bind(
              crypto.randomUUID(),
              p.userId,
              'reengagement',
              p.title,
              p.body,
              JSON.stringify({ bucket: p.bucket, favorite_online: p.hasFavorite }),
            ),
        ),
      );
    } catch (err) {
      console.warn('[reengagement] notification batch insert failed (non-fatal):', err);
    }
  }

  // 2. Send push in FCM batches of 100. Group by identical (title, body) so we
  //    send the same copy to many tokens in one call where possible.
  let pushed = 0;
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const byMessage = new Map<string, { title: string; body: string; userIds: string[] }>();
    for (const p of prepared) {
      const key = `${p.title}\u0000${p.body}`;
      const slot = byMessage.get(key) ?? { title: p.title, body: p.body, userIds: [] };
      slot.userIds.push(p.userId);
      byMessage.set(key, slot);
    }
    for (const { title, body, userIds } of byMessage.values()) {
      for (let i = 0; i < userIds.length; i += 100) {
        const batch = userIds.slice(i, i + 100);
        try {
          const tokens = await getFCMTokens(db, batch);
          if (tokens.length) {
            const r = await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, { type: 'reengagement' }, db);
            pushed += r.sent;
          }
        } catch (err) {
          console.warn('[reengagement] push batch failed (non-fatal):', err);
        }
      }
    }
  }

  return { processed: prepared.length, pushed, idle, winback, favorite_online: favoriteOnline };
}
