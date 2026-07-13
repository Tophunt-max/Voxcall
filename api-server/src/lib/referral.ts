import type { Env } from '../types';
import { pushCoinUpdate, notifyUser } from './realtime';
import { bumpRewardProgress } from '../routes/rewards';

/**
 * Record a referral attribution for a BRAND-NEW account, across every signup
 * method (email register, Google sign-up, Quick-Login). Creates a `pending`
 * referral_uses row that is only credited later by {@link maybeUnlockReferral}
 * once the referred user proves they are genuine.
 *
 * Guards:
 *   - No self-referral (a user can't redeem their own code).
 *   - No same-device self-referral (referrer and referred on the same physical
 *     device — the classic reinstall/second-account farm).
 *   - `referral_uses.UNIQUE(referred_id)` + INSERT OR IGNORE make this
 *     idempotent: a user can only ever be attributed to ONE referrer, and only
 *     for their first account creation.
 *
 * Best-effort: never throws — a referral bookkeeping failure must never block
 * account creation.
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

    // Same-device self-referral guard: if the referrer's account lives on the
    // same physical device as the new account, this is almost certainly one
    // person farming their own code across a reinstall / second account.
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

/**
 * Credit a pending referral once the referred user has proven to be a GENUINE
 * user — NOT a farmed / throwaway account.
 *
 * WHY THIS EXISTS
 * ----------------
 * The referral reward used to be granted the instant the referred user verified
 * their email OTP. That was wrong on two counts:
 *   1. The app's real signup paths are Google + Quick-Login, which never touch
 *      email OTP — so referrals via those methods were never even recorded, and
 *      the reward could never unlock.
 *   2. Verifying an email is free, so it was trivial to farm `referrer_reward`
 *      coins with throwaway accounts.
 *
 * ANTI-FRAUD UNLOCK CONDITION
 * ---------------------------
 * The referred user must show REAL, hard-to-fake engagement — either:
 *   • they made at least one successful REAL-MONEY recharge (coin purchase), OR
 *   • they completed at least `min_calls_to_unlock` PAID calls (coins actually
 *     charged — free-trial-minute calls do NOT count, so a fresh account's free
 *     minutes can't be turned into referral payouts).
 * A same-device self-referral is voided outright.
 *
 * This is auth-method-agnostic (no email-verification dependency), so it works
 * identically for Google and Quick-Login users.
 *
 * IDEMPOTENCY / RACE-SAFETY
 * -------------------------
 * The credit is a single-winner atomic UPDATE guarded by
 * (status = 'pending' AND coins_given = 0) that flips status -> 'unlocked', so
 * concurrent/duplicate triggers (a call end AND a recharge landing together)
 * can never double-credit — even when `referrer_reward` is 0. Legacy rows
 * already credited under the old OTP path have coins_given > 0, so the
 * `coins_given = 0` guard also protects them from being re-credited.
 *
 * Trigger points (all best-effort, off the response path):
 *   • routes/call.ts   — after a paid call is settled
 *   • routes/payment.ts (approveDeposit) — after a real recharge is credited
 * Never throws.
 */
export async function maybeUnlockReferral(env: Env, referredUserId: string): Promise<void> {
  const db = env.DB;
  try {
    const pending = await db
      .prepare("SELECT id, referrer_id FROM referral_uses WHERE referred_id = ? AND status = 'pending' AND coins_given = 0 LIMIT 1")
      .bind(referredUserId)
      .first<{ id: string; referrer_id: string }>();
    if (!pending) return;

    // Admin config (single round-trip). Defaults mirror /admin/referral-config.
    const rows = await db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('min_calls_to_unlock','referrer_reward','new_user_reward','referral_active')")
      .all<{ key: string; value: string }>();
    const cfg: Record<string, string> = {};
    for (const r of rows.results || []) cfg[r.key] = r.value;
    const active = cfg['referral_active'] === undefined ? true : cfg['referral_active'] === '1';
    if (!active) return;
    const referrerReward = Math.max(0, parseInt(cfg['referrer_reward'] ?? '100') || 0);
    const newUserReward = Math.max(0, parseInt(cfg['new_user_reward'] ?? '50') || 0);
    // Require at least ONE paid call even when admins set 0 — the whole point is
    // that a reward never fires on a zero-effort account.
    const needCalls = Math.max(1, parseInt(cfg['min_calls_to_unlock'] ?? '1') || 1);

    // Same-device self-referral guard — void it so it never pays out and we
    // stop re-checking it on every future call/recharge.
    const [refUser, referrer] = await Promise.all([
      db.prepare('SELECT device_id FROM users WHERE id = ?').bind(referredUserId).first<{ device_id: string | null }>(),
      db.prepare('SELECT device_id FROM users WHERE id = ?').bind(pending.referrer_id).first<{ device_id: string | null }>(),
    ]);
    if (refUser?.device_id && referrer?.device_id && refUser.device_id === referrer.device_id) {
      await db.prepare("UPDATE referral_uses SET status = 'void' WHERE id = ? AND status = 'pending'").bind(pending.id).run();
      return;
    }

    // Genuine-user check: a real recharge, OR enough PAID calls.
    let genuine = false;
    const recharged = await db
      .prepare("SELECT 1 as ok FROM coin_purchases WHERE user_id = ? AND status = 'success' AND amount > 0 LIMIT 1")
      .bind(referredUserId)
      .first<{ ok: number }>();
    if (recharged) {
      genuine = true;
    } else {
      const cnt = await db
        .prepare("SELECT COUNT(*) as n FROM call_sessions WHERE caller_id = ? AND status = 'ended' AND coins_charged > 0")
        .bind(referredUserId)
        .first<{ n: number }>();
      if ((Number(cnt?.n) || 0) >= needCalls) genuine = true;
    }
    if (!genuine) return;

    // Atomic single-winner credit. Flipping status -> 'unlocked' makes this
    // idempotent even when referrerReward is 0 (coins_given would stay 0).
    const claim = await db
      .prepare("UPDATE referral_uses SET coins_given = ?, status = 'unlocked' WHERE id = ? AND status = 'pending' AND coins_given = 0")
      .bind(referrerReward, pending.id)
      .run();
    if (!claim.meta?.changes) return; // lost the race — already unlocked

    const ops: D1PreparedStatement[] = [];
    if (newUserReward > 0) ops.push(db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(newUserReward, referredUserId));
    if (referrerReward > 0) ops.push(db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(referrerReward, pending.referrer_id));
    if (ops.length) await db.batch(ops);

    // Ledger rows (best-effort audit trail for both sides).
    try {
      const ledger: D1PreparedStatement[] = [];
      if (newUserReward > 0) ledger.push(db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), referredUserId, 'bonus', newUserReward, 'Referral signup bonus (unlocked)', pending.id));
      if (referrerReward > 0) ledger.push(db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), pending.referrer_id, 'bonus', referrerReward, 'Referral reward (invited a friend)', pending.id));
      if (ledger.length) await db.batch(ledger);
    } catch (e) {
      console.warn('[referral] ledger write failed (credit already applied):', e);
    }

    // Reward-hub progress for the referrer (refer_friend tasks).
    await bumpRewardProgress(db, pending.referrer_id, 'refer_friend', 1);

    // Real-time balance push + notification for both parties.
    if (referrerReward > 0) {
      await pushCoinUpdate(env, pending.referrer_id, referrerReward);
      await notifyUser(env, pending.referrer_id, '🎉 Referral Reward Earned!', `Your friend just got active on VoxLink — and you scored ${referrerReward} coins! Invite more friends, earn more coins. 🤝`, 'referral');
    }
    if (newUserReward > 0) {
      await pushCoinUpdate(env, referredUserId, newUserReward);
      await notifyUser(env, referredUserId, '🎁 Referral Bonus Unlocked!', `You just earned ${newUserReward} bonus coins for joining with a friend's invite. Enjoy! 💛`, 'referral');
    }
  } catch (e) {
    console.warn('[referral] maybeUnlockReferral failed:', e);
  }
}
