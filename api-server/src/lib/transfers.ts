// ============================================================================
// Atomic peer coin transfers — gifts & withdrawal claims
// ============================================================================
//
// These wrap the single-statement, race-safe SQL that the gift-send and
// withdrawal-request routes rely on, so the money-critical invariants can be
// exercised directly against a real SQLite engine (see
// test/transfers.integration.test.ts). Every guard is enforced IN the SQL —
// spendable balance = coins - coins_held — so a concurrent debit can never
// produce a negative balance, a free credit, or a double payout.
// ============================================================================

/**
 * Atomic user→host coin transfer for a gift/tip. Debits the sender and credits
 * the host in ONE UPDATE, and ONLY if the sender's SPENDABLE balance
 * (coins - coins_held) covers the amount. Mirrors atomicCallTransfer: the host
 * is never credited unless the sender was actually debited. Returns true iff
 * the transfer happened.
 */
export async function atomicGiftTransfer(
  db: D1Database,
  params: { senderId: string; hostUserId: string; amount: number },
): Promise<boolean> {
  const { senderId, hostUserId } = params;
  const amount = Math.floor(Number(params.amount));
  // A gift only flows sender → a DISTINCT host, for a positive amount.
  if (!senderId || !hostUserId || senderId === hostUserId) return false;
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const res = await db
    .prepare(
      `UPDATE users SET coins = coins + CASE id
         WHEN ? THEN -?
         WHEN ? THEN ?
         ELSE 0
       END, updated_at = unixepoch()
       WHERE id IN (?, ?)
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND (coins - COALESCE(coins_held, 0)) >= ?)`,
    )
    .bind(senderId, amount, hostUserId, amount, senderId, hostUserId, senderId, amount)
    .run();
  return !!res.meta?.changes;
}

/**
 * Compensating reversal of a gift transfer: refund the sender and debit the
 * host UNCONDITIONALLY (single atomic UPDATE). Used when the post-transfer
 * persistence (gift message + ledger) fails, so a sender is never charged for
 * a gift that didn't save. Unlike the forward transfer this does NOT guard on
 * balance — the refund must always land; the host debit reverses coins they
 * were credited moments earlier.
 */
export async function reverseGiftTransfer(
  db: D1Database,
  params: { senderId: string; hostUserId: string; amount: number },
): Promise<void> {
  const amount = Math.floor(Number(params.amount));
  const { senderId, hostUserId } = params;
  if (!senderId || !hostUserId || senderId === hostUserId) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .prepare(
      `UPDATE users SET coins = coins + CASE id
         WHEN ? THEN ?
         WHEN ? THEN -?
         ELSE 0
       END, updated_at = unixepoch()
       WHERE id IN (?, ?)`,
    )
    .bind(senderId, amount, hostUserId, amount, senderId, hostUserId)
    .run();
}

export type WithdrawalClaim = { ok: true } | { ok: false; reason: 'pending' | 'insufficient' };

/**
 * Atomically reserve a host withdrawal. Two layered, race-safe guards prevent
 * the concurrent "2× payout" bug:
 *   (a) INSERT…SELECT…WHERE NOT EXISTS(pending) AND EXISTS(spendable >= coins)
 *       — SQLite serializes writes per-DB, so two concurrent requests for the
 *       same host can't both insert a pending row.
 *   (b) A follow-up debit guarded on spendable balance; if a racing debit
 *       (e.g. a call settling) drained the wallet in between, the just-inserted
 *       request row is rolled back so no ghost pending row is leaked.
 *
 * Debit is on SPENDABLE (coins - coins_held) so active-call reservations and
 * held referral rewards are correctly excluded from withdrawal.
 */
export async function claimWithdrawal(
  db: D1Database,
  params: {
    withdrawId: string;
    hostId: string;
    userId: string;
    coins: number;
    localAmount: number;
    currency: string;
    method: string;
    accountInfo: string;
  },
): Promise<WithdrawalClaim> {
  const { withdrawId, hostId, userId, coins, localAmount, currency, method, accountInfo } = params;

  const insertResult = await db
    .prepare(
      `INSERT INTO withdrawal_requests
         (id, host_id, coins, amount, currency, payment_method, account_details, status)
       SELECT ?1, ?2, ?3, ?4, ?8, ?5, ?6, 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM withdrawal_requests WHERE host_id = ?2 AND status = 'pending'
       )
       AND EXISTS (
         SELECT 1 FROM users WHERE id = ?7 AND (coins - COALESCE(coins_held, 0)) >= ?3
       )`,
    )
    .bind(withdrawId, hostId, coins, localAmount, method, accountInfo, userId, currency)
    .run();

  if (!insertResult.meta?.changes) {
    const pending = await db
      .prepare("SELECT 1 as ok FROM withdrawal_requests WHERE host_id = ? AND status = 'pending' LIMIT 1")
      .bind(hostId)
      .first<{ ok: number }>();
    return { ok: false, reason: pending ? 'pending' : 'insufficient' };
  }

  const debit = await db
    .prepare(
      'UPDATE users SET coins = coins - ?, updated_at = unixepoch() WHERE id = ? AND (coins - COALESCE(coins_held, 0)) >= ?',
    )
    .bind(coins, userId, coins)
    .run();

  if (!debit.meta?.changes) {
    // Debit lost a race — roll back the ghost pending row.
    await db.prepare('DELETE FROM withdrawal_requests WHERE id = ?').bind(withdrawId).run().catch(() => {});
    return { ok: false, reason: 'insufficient' };
  }
  return { ok: true };
}
