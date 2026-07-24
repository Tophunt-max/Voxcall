// ============================================================================
// Host Level-Up Engine
// ============================================================================
//
// applyLevelUp() is the single, idempotent code path that promotes a host and
// fires every side-effect of a level-up. It is called from:
//
//   • call.ts  — right after a rating updates a host's rating/review_count
//                (the real-time trigger), and
//   • the admin "recalculate levels" endpoint + the daily cron safety net
//     (via recalcAllHostLevels), so manual/scheduled runs are consistent with
//     the live path.
//
// On a genuine promotion it:
//   1. Atomically claims the new level (optimistic concurrency — no double-fire)
//   2. Records an audit row per crossed rung in host_level_history. The
//      UNIQUE(host_id, new_level) index makes the coin reward strictly
//      one-time, even across demote/re-promote or concurrent callers.
//   3. Credits the configured one-time coin reward to the host wallet + ledger
//   4. Persists an in-app notification, emits a real-time socket event, and
//      sends an FCM push (all best-effort — a failure here never rolls back the
//      promotion or the reward).
//
// Promotion-only by design: a single bad day never demotes a host (sticky
// levels). Demotions, if ever desired, should be a separate deliberate flow.
// ============================================================================

import type { Env } from '../types';
import { getLevelConfig, evaluateLevel, type LevelDef } from './levels';
import { sendFCMPush, getFCMTokens } from './fcm';

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  coinsAwarded: number;
}

const NO_CHANGE = (lvl: number): LevelUpResult => ({
  leveledUp: false,
  oldLevel: lvl,
  newLevel: lvl,
  coinsAwarded: 0,
});

// Max "mystery box" bonus as a fraction of the base reward (admin-tunable via
// app_settings.level_reward_bonus_max_pct, a whole percent; default 50%).
async function getRewardBonusMaxPct(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'level_reward_bonus_max_pct'").first<{ value: string }>();
    const pct = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(pct) && pct >= 0) return Math.min(pct, 500) / 100;
  } catch { /* fall through to default */ }
  return 0.5;
}

// Random surprise bonus on top of a base reward: usually 0..maxPct of base,
// with a ~10% "jackpot" that doubles the base. Returns 0 for a zero base.
function mysteryBonus(base: number, maxPct: number): number {
  if (base <= 0 || maxPct <= 0) return 0;
  const jackpot = Math.random() < 0.1;
  const factor = jackpot ? 1 : Math.random() * maxPct;
  return Math.round(base * factor);
}

/**
 * Evaluate a single host and, if their stats now qualify them for a higher
 * level, promote them and fire all side-effects. Safe to call on every rating;
 * a no-op (one SELECT) when no promotion is due.
 *
 * @param config Optional pre-loaded ladder to avoid re-reading app_settings in
 *               batch contexts (recalc/cron). Falls back to getLevelConfig.
 */
export async function applyLevelUp(
  env: Env,
  hostId: string,
  reason: 'auto' | 'admin' | 'recalc' = 'auto',
  config?: LevelDef[],
): Promise<LevelUpResult> {
  const db = env.DB;

  const host = await db
    .prepare(
      `SELECT h.id, h.user_id, h.level, h.rating, h.review_count,
              h.total_minutes, h.total_earnings,
              h.unique_callers, h.answered_calls, h.incoming_calls,
              h.favorite_count, h.streak_max, h.identity_verified, h.created_at,
              h.online_minutes, h.active_days,
              h.is_active,
              u.status AS user_status
       FROM hosts h JOIN users u ON u.id = h.user_id
       WHERE h.id = ?`,
    )
    .bind(hostId)
    .first<any>();
  if (!host) return NO_CHANGE(1);

  const oldLevel = Math.max(1, Number(host.level) || 1);

  // Standing checks — never promote an inactive or banned/deleted host.
  if (Number(host.is_active) === 0 || host.user_status !== 'active') {
    return NO_CHANGE(oldLevel);
  }

  const cfg = config ?? (await getLevelConfig(db));
  const target = evaluateLevel(
    {
      review_count: Number(host.review_count) || 0,
      rating: Number(host.rating) || 0,
      total_minutes: Number(host.total_minutes) || 0,
      total_earnings: Number(host.total_earnings) || 0,
      unique_callers: Number(host.unique_callers) || 0,
      answered_calls: Number(host.answered_calls) || 0,
      incoming_calls: Number(host.incoming_calls) || 0,
      favorite_count: Number(host.favorite_count) || 0,
      streak_max: Number(host.streak_max) || 0,
      identity_verified: Number(host.identity_verified) || 0,
      created_at: Number(host.created_at) || 0,
      online_minutes: Number(host.online_minutes) || 0,
      active_days: Number(host.active_days) || 0,
    },
    cfg,
  );
  if (target <= oldLevel) return NO_CHANGE(oldLevel);

  // Atomic claim: only promote if the host is still below the target level.
  // Two concurrent raters can't both win — exactly one UPDATE reports a change.
  const claim = await db
    .prepare('UPDATE hosts SET level = ?, level_updated_at = unixepoch() WHERE id = ? AND level < ?')
    .bind(target, hostId, target)
    .run();
  if (!claim.meta?.changes) return NO_CHANGE(oldLevel);

  const ladder = cfg.slice().sort((a, b) => a.level - b.level);
  const targetDef = ladder.find((x) => x.level === target) ?? ladder[ladder.length - 1];

  // "Mystery box" surprise: add a random bonus on top of each rung's base
  // reward (variable rewards are the strongest dopamine driver). The amount is
  // locked in at first insert (history row), so it stays idempotent.
  const bonusMaxPct = await getRewardBonusMaxPct(db);

  // Record an audit row per newly-crossed rung; accumulate one-time rewards.
  // INSERT OR IGNORE + UNIQUE(host_id,new_level) ⇒ reward granted once ever.
  let coinsAwarded = 0;
  for (let L = oldLevel + 1; L <= target; L++) {
    const def = ladder.find((x) => x.level === L);
    const base = def?.coin_reward ?? 0;
    const reward = base + mysteryBonus(base, bonusMaxPct);
    try {
      const ins = await db
        .prepare(
          `INSERT OR IGNORE INTO host_level_history
             (id, host_id, old_level, new_level, reason, coins_awarded, rating, review_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), hostId, oldLevel, L, reason, reward, host.rating ?? 0, host.review_count ?? 0)
        .run();
      if (ins.meta?.changes) coinsAwarded += reward;
    } catch (e) {
      console.warn('[applyLevelUp] history insert failed for level', L, e);
    }
  }

  // One-time coin reward → host wallet (users.coins) + ledger entry.
  if (coinsAwarded > 0 && host.user_id) {
    try {
      await db.batch([
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(coinsAwarded, host.user_id),
        db
          .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), host.user_id, 'bonus', coinsAwarded, `Level ${target} (${targetDef.name}) reward`, `levelup_${hostId}_${target}`),
      ]);
    } catch (e) {
      console.error('[applyLevelUp] reward credit failed (level applied without reward):', e);
    }
  }

  const title = `🎉 Level Up — ${targetDef.name}!`;
  const body =
    coinsAwarded > 0
      ? `Aap ab ${targetDef.badge} ${targetDef.name} ban gaye! +${coinsAwarded} coins reward mila.`
      : `Badhai ho! Aap ab ${targetDef.badge} ${targetDef.name} level pe pahunch gaye.`;
  const payload = {
    old_level: oldLevel,
    new_level: target,
    level_name: targetDef.name,
    badge: targetDef.badge,
    color: targetDef.color,
    coins_awarded: coinsAwarded,
  };

  // In-app notification (persisted) — best-effort.
  try {
    await db
      .prepare('INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), host.user_id, 'level_up', title, body, JSON.stringify(payload))
      .run();
  } catch (e) {
    console.warn('[applyLevelUp] notification insert failed:', e);
  }

  // Real-time socket event so the app can celebrate immediately — best-effort.
  try {
    const stub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(host.user_id));
    await stub.fetch('https://dummy/notify', {
      method: 'POST',
      body: JSON.stringify({ type: 'level_up', ...payload }),
    });
  } catch (e) {
    console.warn('[applyLevelUp] socket emit failed:', e);
  }

  // Push notification — best-effort (no-op if FCM not configured / no token).
  try {
    const tokens = await getFCMTokens(db, [host.user_id]);
    if (tokens.length) {
      await sendFCMPush(env.FIREBASE_SERVICE_ACCOUNT, tokens, title, body, {
        type: 'level_up',
        new_level: String(target),
      }, db);
    }
  } catch (e) {
    console.warn('[applyLevelUp] push failed:', e);
  }

  return { leveledUp: true, oldLevel, newLevel: target, coinsAwarded };
}

export interface RecalcResult {
  processed: number;
  promoted: number;
  coinsAwarded: number;
}

/**
 * Backfill/consistency pass over all active hosts — used by the admin
 * "recalculate levels" endpoint and the daily cron safety net. Loads the
 * config once and runs applyLevelUp per host (idempotent, promotion-only).
 *
 * ── Scalability ────────────────────────────────────────────────────────────
 * Two cheap optimizations keep this bounded as the host base grows into the
 * hundreds of thousands:
 *   1. SQL PRE-FILTER — hosts already at the top rung (`h.level >= maxLevel`)
 *      can never be promoted further, so they're excluded up front. Over time
 *      this is the bulk of the table, turning an O(all hosts) scan into
 *      O(hosts-still-climbing).
 *   2. KEYSET PAGINATION — candidates are streamed in `chunk`-sized pages
 *      ordered by id, so we never materialize the whole result set in memory
 *      and each page is an index-friendly `id > cursor` seek. `limit` bounds
 *      total work per invocation so a cron run is always time-boxed.
 * Per-host promotion is still one idempotent SELECT when nothing changed.
 */
export async function recalcAllHostLevels(
  env: Env,
  reason: 'admin' | 'recalc' = 'recalc',
  limit = 5000,
  chunk = 500,
): Promise<RecalcResult> {
  const db = env.DB;
  const cfg = await getLevelConfig(db);
  // Highest rung that exists — hosts already here are skipped by the pre-filter.
  const maxLevel = cfg.reduce((m, l) => Math.max(m, l.level), 1);

  let processed = 0;
  let promoted = 0;
  let coinsAwarded = 0;
  let cursor = '';
  const pageSize = Math.max(1, Math.min(chunk, limit));

  while (processed < limit) {
    const remaining = limit - processed;
    const take = Math.min(pageSize, remaining);
    const page = await db
      .prepare(
        `SELECT h.id FROM hosts h JOIN users u ON u.id = h.user_id
         WHERE h.is_active = 1 AND u.status = 'active'
           AND COALESCE(h.level, 1) < ?
           AND h.id > ?
         ORDER BY h.id ASC LIMIT ?`,
      )
      .bind(maxLevel, cursor, take)
      .all<{ id: string }>();

    const results = page.results ?? [];
    if (results.length === 0) break; // no more climbing candidates

    for (const r of results) {
      processed++;
      cursor = r.id;
      try {
        const res = await applyLevelUp(env, r.id, reason, cfg);
        if (res.leveledUp) {
          promoted++;
          coinsAwarded += res.coinsAwarded;
        }
      } catch (e) {
        console.warn('[recalcAllHostLevels] host failed:', r.id, e);
      }
    }

    if (results.length < take) break; // last page
  }

  return { processed, promoted, coinsAwarded };
}
