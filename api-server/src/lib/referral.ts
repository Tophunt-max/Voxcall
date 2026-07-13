import type { Env } from '../types';
import { pushCoinUpdate, notifyUser } from './realtime';
import { bumpRewardProgress } from '../routes/rewards';

/**
 * Credit a pending referral once the referred user has satisfied the
 * admin-configured unlock condition (`min_calls_to_unlock` completed calls).
 *
 * WHY THIS EXISTS
 * ----------------
 * The referral reward used to be granted the instant the referred user verified
 * their email OTP, which completely ignored the `min_calls_to_unlock` setting the
 * admin panel exposes. That let anyone farm `referrer_reward` coins with a batch
 * of throwaway email accounts (email OTP is cheap). We now unlock the reward only
 * after the referred user has actually USED the product (completed N calls), which
 * is what the admin setting always implied.
 *
 * IDEMPOTENCY / RACE-SAFETY
 * -------------------------
 * The credit is gated by an atomic UPDATE on `referral_uses` guarded by
 * (status = 'pending' AND coins_given = 0). The single winning UPDATE flips
 * status -> 'unlocked', so a concurrent/duplicate call-end — or any later call —
 * can never double-credit, even when `referrer_reward` is 0 (which would leave
 * coins_given at 0). Legacy rows already credited under the old OTP path have
 * coins_given > 0, so the `coins_given = 0` guard also protects them from being
 * re-credited after deploy.
 *
 * Safe to call from BOTH the OTP-verify path (handles `min_calls_to_unlock = 0`,
 * i.e. unlock immediately on verify) and every call-completion path (handles
 * >= 1). Best-effort: never throws; all failures are logged.
 */
export async function maybeUnlockReferral(env: Env, referredUserId: string): Promise<void> {
  const db = env.DB;
  try {
    const pending = await db
      .prepare("SELECT id, referrer_id FROM referral_uses WHERE referred_id = ? AND status = 'pending' AND coins_given = 0 LIMIT 1")
      .bind(referredUserId)
      .first<{ id: string; referrer_id: string }>();
    if (!pending) return;

    // Sybil protection preserved: the referred user must be email-verified.
    const verified = await db
      .prepare('SELECT is_verified FROM users WHERE id = ?')
      .bind(referredUserId)
      .first<{ is_verified: number }>();
    if (!verified || Number(verified.is_verified) !== 1) return;

    // Admin config (single round-trip). Defaults mirror /admin/referral-config.
    const rows = await db
      .prepare("SELECT key, value FROM app_settings WHERE key IN ('min_calls_to_unlock','referrer_reward','new_user_reward','referral_active')")
      .all<{ key: string; value: string }>();
    const cfg: Record<string, string> = {};
    for (const r of rows.results || []) cfg[r.key] = r.value;
    const active = cfg['referral_active'] === undefined ? true : cfg['referral_active'] === '1';
    if (!active) return;
    const minCalls = Math.max(0, parseInt(cfg['min_calls_to_unlock'] ?? '1') || 0);
    const referrerReward = Math.max(0, parseInt(cfg['referrer_reward'] ?? '100') || 0);
    const newUserReward = Math.max(0, parseInt(cfg['new_user_reward'] ?? '50') || 0);

    // Unlock condition: referred user has completed >= minCalls real calls.
    // (minCalls = 0 → unlock immediately, e.g. straight after OTP verify.)
    if (minCalls > 0) {
      const cnt = await db
        .prepare("SELECT COUNT(*) as n FROM call_sessions WHERE caller_id = ? AND status = 'ended' AND duration_seconds > 0")
        .bind(referredUserId)
        .first<{ n: number }>();
      if ((Number(cnt?.n) || 0) < minCalls) return;
    }

    // Atomic single-winner credit. Flipping status -> 'unlocked' makes this
    // idempotent even when referrerReward is 0 (coins_given stays 0).
    const claim = await db
      .prepare("UPDATE referral_uses SET coins_given = ?, status = 'unlocked' WHERE id = ? AND status = 'pending' AND coins_given = 0")
      .bind(referrerReward, pending.id)
      .run();
    if (!claim.meta?.changes) return; // lost the race — another end already unlocked

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
      await notifyUser(env, pending.referrer_id, '🎉 Referral Reward Earned!', `Your friend just got started on VoxLink — and you scored ${referrerReward} coins! Invite more friends, earn more coins. 🤝`, 'referral');
    }
    if (newUserReward > 0) {
      await pushCoinUpdate(env, referredUserId, newUserReward);
      await notifyUser(env, referredUserId, '🎁 Referral Bonus Unlocked!', `You just earned ${newUserReward} bonus coins for joining with a friend's invite. Enjoy! 💛`, 'referral');
    }
  } catch (e) {
    console.warn('[referral] maybeUnlockReferral failed:', e);
  }
}
