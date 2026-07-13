import type { Env } from '../types';
import { pushCoinUpdate, notifyUser } from './realtime';
import { bumpRewardProgress } from '../routes/rewards';

// ============================================================================
// Referral system — attribution + anti-fraud integrity pipeline
// ============================================================================
//
// Lifecycle of a referral_uses row:
//   pending  → recorded at signup (recordReferral), not yet earned
//   review   → genuine but held for admin review (velocity cap / high risk)
//   unlocked → credited (maybeUnlockReferral / admin approve)
//   void     → self-referral or admin-rejected, never pays out
//
// referrer-reward payout hold (reward_state): none → held → released|clawed_back
//   A held reward is added to BOTH users.coins AND users.coins_held, so it is
//   non-spendable (calls/tips use coins - coins_held) AND non-withdrawable
//   (the withdraw path subtracts coins_held). That guarantees clawback can
//   always fully reverse a held reward without driving a balance negative.
//   The release cron flips held→released and frees it from coins_held; a ban
//   within the clawback window flips held→clawed_back and reverses it.
//
// The three decision helpers (selfReferralReason / referralOutcome /
// computeHold) are PURE and unit-tested (see test/referral.test.ts).
// ============================================================================

/**
 * Record a referral attribution for a BRAND-NEW account, across every signup
 * method (email register, Google sign-up, Quick-Login). Creates a `pending`
 * referral_uses row that is only credited later by {@link maybeUnlockReferral}.
 *
 * Guards: no self-referral by own code, no same-device self-referral, and
 * `referral_uses.UNIQUE(referred_id)` + INSERT OR IGNORE make it idempotent (a
 * user can only ever be attributed to ONE referrer, for their first account).
 * Best-effort — never throws (a referral failure must never block signup).
 */
export async function recordReferral(
  db: D1Database,
  referralCode: string | null | undefined,
  newUserId: string,
  newUserDeviceId?: string | null,
): Promise<void> {
  if (!referralCode) return;
  try {
    const code = referralCode.trim().toUpperCase();
    if (!code) return;

    const ref = await db
      .prepare('SELECT user_id FROM referral_codes WHERE code = ?')
      .bind(code)
      .first<{ user_id: string }>();
    if (!ref || !ref.user_id) return;
    if (ref.user_id === newUserId) return; // self-referral by own code

    if (newUserDeviceId) {
      const referrer = await db
        .prepare('SELECT device_id FROM users WHERE id = ?')
        .bind(ref.user_id)
        .first<{ device_id: string | null }>();
      if (referrer?.device_id && referrer.device_id === newUserDeviceId) return;
    }

    await db
      .prepare(
        "INSERT OR IGNORE INTO referral_uses (id, referrer_id, referred_id, code, coins_given, status) VALUES (?, ?, ?, ?, 0, 'pending')",
      )
      .bind(crypto.randomUUID(), ref.user_id, newUserId, code)
      .run();
  } catch (e) {
    console.warn('[referral] recordReferral failed:', e);
  }
}

// ─── Pure decision helpers (unit-tested) ─────────────────────────────────────

/**
 * Detect a self-referral from the two accounts' device + phone. Returns the
 * reason ('same_device' | 'same_phone') or null. Phone compared on the last 10
 * digits so a country-code prefix difference doesn't defeat it.
 */
export function selfReferralReason(
  referred: { deviceId?: string | null; phone?: string | null },
  referrer: { deviceId?: string | null; phone?: string | null },
): string | null {
  if (referred.deviceId && referrer.deviceId && referred.deviceId === referrer.deviceId) {
    return 'same_device';
  }
  const digits = (p?: string | null) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');
  const a = digits(referred.phone);
  const b = digits(referrer.phone);
  if (a.length >= 10 && a === b) return 'same_phone';
  return null;
}

export type ReferralAction = 'void' | 'credit' | 'review' | 'skip';

/**
 * Decide what to do with a pending referral, given the fraud signals. Pure so
 * the policy is testable in isolation.
 *   void   — self-referral; never pays out
 *   skip   — not genuine yet; stays pending, re-checked on next activity
 *   review — genuine but throttled (velocity/total cap) or high-risk; held for
 *            admin approval
 *   credit — genuine and within limits; pay out now
 */
export function referralOutcome(input: {
  selfReferral: boolean;
  genuine: boolean;
  integrityEnabled: boolean;
  dailyUnlockCount: number;
  dailyCap: number; // 0 = unlimited
  totalUnlockCount: number;
  totalCap: number; // 0 = unlimited
  riskTier: 'low' | 'medium' | 'high' | null;
}): { action: ReferralAction; reason: string } {
  if (input.selfReferral) return { action: 'void', reason: 'self_referral' };
  if (!input.genuine) return { action: 'skip', reason: 'not_genuine_yet' };
  if (!input.integrityEnabled) return { action: 'credit', reason: 'genuine' };
  if (input.riskTier === 'high') return { action: 'review', reason: 'high_risk' };
  if (input.dailyCap > 0 && input.dailyUnlockCount >= input.dailyCap) return { action: 'review', reason: 'daily_cap' };
  if (input.totalCap > 0 && input.totalUnlockCount >= input.totalCap) return { action: 'review', reason: 'total_cap' };
  return { action: 'credit', reason: 'genuine' };
}

/** Payout-hold window for the referrer reward. holdDays<=0 → released now. */
export function computeHold(now: number, holdDays: number): { rewardState: 'held' | 'released'; holdUntil: number } {
  const d = Number.isFinite(holdDays) && holdDays > 0 ? Math.floor(holdDays) : 0;
  return d <= 0 ? { rewardState: 'released', holdUntil: now } : { rewardState: 'held', holdUntil: now + d * 86400 };
}

// ─── Config ──────────────────────────────────────────────────────────────────

interface ReferralConfig {
  active: boolean;
  integrityEnabled: boolean;
  referrerReward: number;
  newUserReward: number;
  needCalls: number;
  holdDays: number;
  dailyCap: number;
  totalCap: number;
  riskReview: boolean;
}

async function loadReferralConfig(db: D1Database): Promise<ReferralConfig> {
  const keys = [
    'referral_active', 'referrer_reward', 'new_user_reward', 'min_calls_to_unlock',
    'referral_integrity_enabled', 'referral_hold_days', 'referral_daily_unlock_cap',
    'referral_total_cap', 'referral_risk_review_enabled',
  ];
  const m: Record<string, string> = {};
  try {
    const rows = await db
      .prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`)
      .bind(...keys)
      .all<{ key: string; value: string }>();
    for (const r of rows.results || []) m[r.key] = r.value;
  } catch (e) {
    console.warn('[referral] loadReferralConfig failed, using defaults:', e);
  }
  const intOr = (k: string, d: number) => {
    const n = parseInt(m[k] ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const boolOr = (k: string, d: boolean) => (m[k] === undefined ? d : m[k] === '1');
  return {
    active: boolOr('referral_active', true),
    integrityEnabled: boolOr('referral_integrity_enabled', true),
    referrerReward: intOr('referrer_reward', 100),
    newUserReward: intOr('new_user_reward', 50),
    needCalls: Math.max(1, intOr('min_calls_to_unlock', 1)),
    holdDays: intOr('referral_hold_days', 7),
    dailyCap: intOr('referral_daily_unlock_cap', 25),
    totalCap: intOr('referral_total_cap', 0),
    riskReview: boolOr('referral_risk_review_enabled', true),
  };
}

// ─── DB-driven signal checks ─────────────────────────────────────────────────

/**
 * The referred account must show REAL, hard-to-fake value. Any ONE of:
 *   1. a real-money recharge (genuine caller),
 *   2. a KYC-APPROVED host (verified identity + documents — the strongest
 *      signal, and the only one that fits a referred HOST, who earns rather
 *      than recharges / makes outgoing paid calls), or
 *   3. >= needCalls PAID calls AS CALLER (coins actually charged — free-trial
 *      minutes don't count, so a fresh account's freebie can't be farmed).
 */
async function isGenuineReferredUser(db: D1Database, referredUserId: string, needCalls: number): Promise<boolean> {
  const recharged = await db
    .prepare("SELECT 1 as ok FROM coin_purchases WHERE user_id = ? AND status = 'success' AND amount > 0 LIMIT 1")
    .bind(referredUserId)
    .first<{ ok: number }>()
    .catch(() => null);
  if (recharged) return true;

  const approvedHost = await db
    .prepare("SELECT 1 as ok FROM host_applications WHERE user_id = ? AND status = 'approved' LIMIT 1")
    .bind(referredUserId)
    .first<{ ok: number }>()
    .catch(() => null);
  if (approvedHost) return true;

  const cnt = await db
    .prepare("SELECT COUNT(*) as n FROM call_sessions WHERE caller_id = ? AND status = 'ended' AND coins_charged > 0")
    .bind(referredUserId)
    .first<{ n: number }>()
    .catch(() => null);
  return (Number(cnt?.n) || 0) >= needCalls;
}

/** Referred-user risk tier from lib/riskScore (best-effort; null if disabled/errors). */
async function referredRiskTier(env: Env, referredUserId: string): Promise<'low' | 'medium' | 'high' | null> {
  try {
    const rs = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'risk_scoring_enabled'").first<{ value: string }>();
    if ((rs?.value ?? '0') !== '1') return null;
    const settings = await env.DB
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('risk_lookback_days','risk_velocity_window_hours','risk_velocity_burst','risk_new_account_days','risk_weights')")
      .all<{ key: string; value: string }>();
    const m: Record<string, string> = {};
    for (const r of settings.results || []) m[r.key] = r.value;
    const num = (k: string, d: number) => { const n = parseFloat(m[k] ?? ''); return Number.isFinite(n) && n > 0 ? n : d; };
    const { gatherRiskFeatures, computeRiskScore, normalizeRiskWeights } = await import('./riskScore');
    let weights;
    try { weights = normalizeRiskWeights(JSON.parse(m['risk_weights'] ?? '{}')); } catch { weights = normalizeRiskWeights({}); }
    const features = await gatherRiskFeatures(env.DB, referredUserId, num('risk_lookback_days', 30), num('risk_velocity_window_hours', 1));
    const assessment = computeRiskScore(features, weights, {
      velocityBurst: num('risk_velocity_burst', 4),
      newAccountDays: num('risk_new_account_days', 3),
    });
    return assessment.tier;
  } catch (e) {
    console.warn('[referral] risk tier check failed (skipping gate):', e);
    return null;
  }
}

// ─── Credit (shared by auto-unlock + admin approve) ──────────────────────────

type ReferralRow = { id: string; referrer_id: string; referred_id: string };

/**
 * Atomically credit a referral. Single-winner UPDATE (pending|review →
 * unlocked) guarantees a referral is credited at most once even under
 * concurrent triggers. Held rewards land in coins + coins_held; released ones
 * in coins only. Returns false if the row was already processed / lost the race.
 */
async function creditReferralInternal(
  env: Env,
  row: ReferralRow,
  referrerReward: number,
  newUserReward: number,
  holdDays: number,
): Promise<boolean> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  const { rewardState, holdUntil } = computeHold(now, holdDays);

  const claim = await db
    .prepare(
      `UPDATE referral_uses
         SET status = 'unlocked', flagged = 0, coins_given = ?, referrer_reward = ?,
             new_user_reward = ?, unlocked_at = ?, reward_state = ?, hold_until = ?
       WHERE id = ? AND status IN ('pending', 'review')`,
    )
    .bind(referrerReward, referrerReward, newUserReward, now, rewardState, holdUntil, row.id)
    .run();
  if (!claim.meta?.changes) return false; // already processed / lost race

  // Credit coins. Held referrer reward also bumps coins_held (locks it).
  const ops: D1PreparedStatement[] = [];
  if (newUserReward > 0) {
    ops.push(db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(newUserReward, row.referred_id));
  }
  if (referrerReward > 0) {
    ops.push(
      rewardState === 'held'
        ? db.prepare('UPDATE users SET coins = coins + ?, coins_held = COALESCE(coins_held, 0) + ?, updated_at = unixepoch() WHERE id = ?').bind(referrerReward, referrerReward, row.referrer_id)
        : db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(referrerReward, row.referrer_id),
    );
  }
  if (ops.length) await db.batch(ops);

  // Ledger (best-effort audit).
  try {
    const ledger: D1PreparedStatement[] = [];
    if (newUserReward > 0) ledger.push(db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), row.referred_id, 'bonus', newUserReward, 'Referral signup bonus (unlocked)', row.id));
    if (referrerReward > 0) ledger.push(db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), row.referrer_id, 'bonus', referrerReward, rewardState === 'held' ? `Referral reward (held ${holdDays}d)` : 'Referral reward (invited a friend)', row.id));
    if (ledger.length) await db.batch(ledger);
  } catch (e) {
    console.warn('[referral] ledger write failed (credit already applied):', e);
  }

  await bumpRewardProgress(db, row.referrer_id, 'refer_friend', 1);

  // Real-time + notifications.
  if (referrerReward > 0) {
    await pushCoinUpdate(env, row.referrer_id, referrerReward);
    const holdNote = rewardState === 'held' ? ` Withdrawable in ${holdDays} day${holdDays === 1 ? '' : 's'}.` : '';
    await notifyUser(env, row.referrer_id, '🎉 Referral Reward Earned!', `Your friend just got active on VoxLink — you earned ${referrerReward} coins!${holdNote} 🤝`, 'referral');
  }
  if (newUserReward > 0) {
    await pushCoinUpdate(env, row.referred_id, newUserReward);
    await notifyUser(env, row.referred_id, '🎁 Referral Bonus Unlocked!', `You earned ${newUserReward} bonus coins for joining with a friend's invite. Enjoy! 💛`, 'referral');
  }
  return true;
}

// ─── Public: unlock check (called from call end / recharge / KYC approve) ────

export async function maybeUnlockReferral(env: Env, referredUserId: string): Promise<void> {
  const db = env.DB;
  try {
    const pending = await db
      .prepare("SELECT id, referrer_id, referred_id FROM referral_uses WHERE referred_id = ? AND status = 'pending' AND coins_given = 0 LIMIT 1")
      .bind(referredUserId)
      .first<ReferralRow>();
    if (!pending) return;

    const cfg = await loadReferralConfig(db);
    if (!cfg.active) return;

    // Self-referral guards.
    const [refUser, referrer] = await Promise.all([
      db.prepare('SELECT device_id, phone FROM users WHERE id = ?').bind(referredUserId).first<{ device_id: string | null; phone: string | null }>(),
      db.prepare('SELECT device_id, phone FROM users WHERE id = ?').bind(pending.referrer_id).first<{ device_id: string | null; phone: string | null }>(),
    ]);
    const selfReason = selfReferralReason(
      { deviceId: refUser?.device_id, phone: refUser?.phone },
      { deviceId: referrer?.device_id, phone: referrer?.phone },
    );

    const genuine = selfReason ? false : await isGenuineReferredUser(db, referredUserId, cfg.needCalls);

    // Velocity / total / risk signals — only computed when relevant.
    let dailyUnlockCount = 0;
    let totalUnlockCount = 0;
    let riskTier: 'low' | 'medium' | 'high' | null = null;
    if (!selfReason && genuine && cfg.integrityEnabled) {
      const since = Math.floor(Date.now() / 1000) - 86400;
      const daily = await db.prepare("SELECT COUNT(*) as n FROM referral_uses WHERE referrer_id = ? AND status = 'unlocked' AND unlocked_at >= ?").bind(pending.referrer_id, since).first<{ n: number }>().catch(() => null);
      dailyUnlockCount = Number(daily?.n) || 0;
      if (cfg.totalCap > 0) {
        const total = await db.prepare("SELECT COUNT(*) as n FROM referral_uses WHERE referrer_id = ? AND status = 'unlocked'").bind(pending.referrer_id).first<{ n: number }>().catch(() => null);
        totalUnlockCount = Number(total?.n) || 0;
      }
      if (cfg.riskReview) riskTier = await referredRiskTier(env, referredUserId);
    }

    const { action, reason } = referralOutcome({
      selfReferral: !!selfReason,
      genuine,
      integrityEnabled: cfg.integrityEnabled,
      dailyUnlockCount,
      dailyCap: cfg.dailyCap,
      totalUnlockCount,
      totalCap: cfg.totalCap,
      riskTier,
    });

    if (action === 'void') {
      await db.prepare("UPDATE referral_uses SET status = 'void', flag_reason = ? WHERE id = ? AND status = 'pending'").bind(selfReason, pending.id).run();
      console.warn('[referral] voided self-referral', pending.id, selfReason);
      return;
    }
    if (action === 'skip') return;
    if (action === 'review') {
      // Freeze the reward amounts + flag for admin. NO coins credited yet.
      await db
        .prepare("UPDATE referral_uses SET status = 'review', flagged = 1, flag_reason = ?, referrer_reward = ?, new_user_reward = ? WHERE id = ? AND status = 'pending'")
        .bind(reason, cfg.referrerReward, cfg.newUserReward, pending.id)
        .run();
      console.warn('[referral] flagged for review', pending.id, reason);
      return;
    }

    // action === 'credit'
    await creditReferralInternal(env, pending, cfg.referrerReward, cfg.newUserReward, cfg.integrityEnabled ? cfg.holdDays : 0);
  } catch (e) {
    console.warn('[referral] maybeUnlockReferral failed:', e);
  }
}

// ─── Payout hold release (cron) ──────────────────────────────────────────────

/**
 * Release referral payout holds whose window has elapsed: held → released, and
 * free the amount from coins_held so it becomes withdrawable. Per-row atomic
 * CAS makes it idempotent. Best-effort; tolerates a legacy DB (missing columns
 * → caught, no-op).
 */
export async function releaseExpiredReferralHolds(env: Env): Promise<void> {
  const db = env.DB;
  try {
    const now = Math.floor(Date.now() / 1000);
    const due = await db
      .prepare("SELECT id, referrer_id, referrer_reward FROM referral_uses WHERE reward_state = 'held' AND hold_until > 0 AND hold_until <= ? LIMIT 500")
      .bind(now)
      .all<{ id: string; referrer_id: string; referrer_reward: number }>();
    for (const r of due.results || []) {
      const claim = await db.prepare("UPDATE referral_uses SET reward_state = 'released' WHERE id = ? AND reward_state = 'held'").bind(r.id).run();
      if (!claim.meta?.changes) continue; // another sweep won
      const amt = Number(r.referrer_reward) || 0;
      if (amt > 0) {
        await db.prepare('UPDATE users SET coins_held = MAX(0, COALESCE(coins_held, 0) - ?) WHERE id = ?').bind(amt, r.referrer_id).run()
          .catch((e) => console.warn('[referral] release hold decrement failed:', e));
      }
    }
  } catch (e) {
    console.warn('[referral] releaseExpiredReferralHolds failed (schema may lag):', e);
  }
}

// ─── Clawback (called when a referred account is banned) ──────────────────────

/**
 * Reverse still-HELD referral rewards earned by referring the now-banned
 * account. Only 'held' rewards are reversed — they're guaranteed present in
 * coins_held, so the reversal can never drive a balance negative (released /
 * withdrawn rewards are left untouched). Per-row atomic CAS = idempotent.
 */
export async function clawbackReferrals(env: Env, referredUserId: string, reason = 'fraud'): Promise<void> {
  const db = env.DB;
  try {
    const rows = await db
      .prepare("SELECT id, referrer_id, referrer_reward, new_user_reward FROM referral_uses WHERE referred_id = ? AND status = 'unlocked' AND reward_state = 'held'")
      .bind(referredUserId)
      .all<{ id: string; referrer_id: string; referrer_reward: number; new_user_reward: number }>();
    for (const r of rows.results || []) {
      const claim = await db.prepare("UPDATE referral_uses SET reward_state = 'clawed_back', status = 'void', flag_reason = ? WHERE id = ? AND reward_state = 'held'").bind(`clawback:${reason}`, r.id).run();
      if (!claim.meta?.changes) continue;
      const rr = Number(r.referrer_reward) || 0;
      const nr = Number(r.new_user_reward) || 0;
      const ops: D1PreparedStatement[] = [];
      if (rr > 0) ops.push(db.prepare('UPDATE users SET coins = MAX(0, coins - ?), coins_held = MAX(0, COALESCE(coins_held, 0) - ?), updated_at = unixepoch() WHERE id = ?').bind(rr, rr, r.referrer_id));
      if (nr > 0) ops.push(db.prepare('UPDATE users SET coins = MAX(0, coins - ?), updated_at = unixepoch() WHERE id = ?').bind(nr, referredUserId));
      if (ops.length) await db.batch(ops);
      try {
        if (rr > 0) {
          await db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), r.referrer_id, 'adjustment', -rr, `Referral reward reversed (${reason})`, r.id).run();
        }
      } catch (e) { console.warn('[referral] clawback ledger failed:', e); }
      // Live-update the referrer's balance.
      try { await pushCoinUpdate(env, r.referrer_id, -rr); } catch { /* best-effort */ }
    }
  } catch (e) {
    console.warn('[referral] clawbackReferrals failed:', e);
  }
}

// ─── Admin review-queue actions ──────────────────────────────────────────────

/** Approve a referral that was held for review → credit it (with hold). */
export async function approveReviewReferral(env: Env, referralId: string): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;
  const row = await db
    .prepare('SELECT id, referrer_id, referred_id, referrer_reward, new_user_reward, status FROM referral_uses WHERE id = ?')
    .bind(referralId)
    .first<ReferralRow & { referrer_reward: number; new_user_reward: number; status: string }>();
  if (!row) return { ok: false, error: 'Referral not found' };
  if (row.status !== 'review') return { ok: false, error: `Referral is ${row.status}, not in review` };
  const cfg = await loadReferralConfig(db);
  const rr = Number(row.referrer_reward) > 0 ? Number(row.referrer_reward) : cfg.referrerReward;
  const nr = Number(row.new_user_reward) > 0 ? Number(row.new_user_reward) : cfg.newUserReward;
  const ok = await creditReferralInternal(env, row, rr, nr, cfg.integrityEnabled ? cfg.holdDays : 0);
  return ok ? { ok: true } : { ok: false, error: 'Already processed' };
}

/** Reject a referral that was held for review → void it (never pays out). */
export async function rejectReviewReferral(env: Env, referralId: string, reason = 'rejected'): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;
  const res = await db
    .prepare("UPDATE referral_uses SET status = 'void', flagged = 0, flag_reason = ? WHERE id = ? AND status = 'review'")
    .bind(`admin_reject:${reason}`.slice(0, 200), referralId)
    .run();
  return res.meta?.changes ? { ok: true } : { ok: false, error: 'Referral not in review' };
}
