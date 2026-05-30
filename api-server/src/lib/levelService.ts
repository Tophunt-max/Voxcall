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
      `SELECT h.id, h.user_id, h.level, h.rating, h.review_count, h.is_active,
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
    { review_count: Number(host.review_count) || 0, rating: Number(host.rating) || 0 },
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

  // Record an audit row per newly-crossed rung; accumulate one-time rewards.
  // INSERT OR IGNORE + UNIQUE(host_id,new_level) ⇒ reward granted once ever.
  let coinsAwarded = 0;
  for (let L = oldLevel + 1; L <= target; L++) {
    const def = ladder.find((x) => x.level === L);
    const reward = def?.coin_reward ?? 0;
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
      });
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
 * NOTE: This is O(N) in DB round-trips. It is only ever invoked from
 * admin-triggered or once-a-day scheduled contexts, never on the hot path.
 */
export async function recalcAllHostLevels(
  env: Env,
  reason: 'admin' | 'recalc' = 'recalc',
  limit = 5000,
): Promise<RecalcResult> {
  const db = env.DB;
  const cfg = await getLevelConfig(db);
  const rows = await db
    .prepare(
      `SELECT h.id FROM hosts h JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND u.status = 'active'
       ORDER BY h.review_count DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();

  let processed = 0;
  let promoted = 0;
  let coinsAwarded = 0;
  for (const r of rows.results ?? []) {
    processed++;
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
  return { processed, promoted, coinsAwarded };
}
