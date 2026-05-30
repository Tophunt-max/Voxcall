// ============================================================================
// Call billing — single source of truth for per-call coin math + transfer
// ============================================================================
//
// The per-minute billing math and the atomic caller→host coin transfer used to
// be duplicated, verbatim, in two hot paths:
//
//   • routes/call.ts   → POST /api/calls/end  (user/host ends the call)
//   • index.ts         → reapStaleCalls()      (cron ends crashed calls)
//
// Two copies of money logic is a latent bug: a fix to one site can silently
// diverge from the other. This module centralizes the math and the transfer so
// both paths bill identically, and so the logic is unit-testable in isolation
// (see test/billing.test.ts and test/billing.integration.test.ts).
//
// Behaviour is intentionally identical to the previous inline code — this is a
// pure extraction, not a billing change.
// ============================================================================

/**
 * Whole minutes billed for a call of `durationSec` seconds.
 *
 * Any started minute is charged in full (round UP), matching the historical
 * behaviour `Math.max(1, Math.ceil(durationSec / 60))` on the live /end path.
 * A non-positive / non-finite duration bills 0 minutes (e.g. a pending call
 * that never connected). Note that for any `durationSec > 0`, `ceil(...) >= 1`,
 * so the 1-minute floor only matters as a guard — it never inflates a real
 * sub-minute call beyond the single minute it already rounds up to.
 */
export function billedMinutes(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(1, Math.ceil(durationSec / 60));
}

/**
 * Coins the caller is charged for a call.
 *
 * Only 'active' calls that actually ran (durationSec > 0) cost coins; a
 * 'pending' call that was never answered is free. The rate is coins/minute.
 */
export function coinsForCall(params: {
  status: string;
  durationSec: number;
  ratePerMinute: number;
}): number {
  if (params.status !== 'active') return 0;
  const minutes = billedMinutes(params.durationSec);
  if (minutes <= 0) return 0;
  const rate = Number.isFinite(params.ratePerMinute) && params.ratePerMinute > 0
    ? params.ratePerMinute
    : 0;
  return minutes * rate;
}

/**
 * The host's cut of the coins charged, given their level-based earning share
 * (0–1). Always rounds DOWN — the platform never pays out a fractional coin it
 * didn't collect. Matches `Math.floor(coinsCharged * share)`.
 */
export function hostShareOf(coinsCharged: number, earningShare: number): number {
  if (!Number.isFinite(coinsCharged) || coinsCharged <= 0) return 0;
  const share = Number.isFinite(earningShare) && earningShare > 0 ? earningShare : 0;
  return Math.floor(coinsCharged * share);
}

/**
 * Atomically move coins from caller to host in a SINGLE SQL statement.
 *
 * A single UPDATE with a CASE expression and an EXISTS guard:
 *   - caller has >= coinsCharged  →  EXISTS true  →  both rows update
 *                                    (caller -= coinsCharged, host += hostShare)
 *   - caller has < coinsCharged   →  EXISTS false →  WHERE matches no rows →
 *                                    ZERO money moves.
 *
 * This is atomic at the SQLite engine level — there is no window in which the
 * host is credited but the caller is not debited (the bug the original inline
 * version was written to kill). Returns `true` only when BOTH rows changed
 * (changes === 2), i.e. the transfer fully succeeded.
 */
export async function atomicCallTransfer(
  db: D1Database,
  params: {
    callerId: string;
    hostUserId: string;
    coinsCharged: number;
    hostShare: number;
  },
): Promise<boolean> {
  if (!(params.coinsCharged > 0) || !params.hostUserId) return false;
  const transfer = await db
    .prepare(
      `UPDATE users
         SET coins = coins + CASE id
           WHEN ?1 THEN -?2
           WHEN ?3 THEN ?4
           ELSE 0
         END
         WHERE id IN (?1, ?3)
           AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND coins >= ?2)`,
    )
    .bind(params.callerId, params.coinsCharged, params.hostUserId, params.hostShare)
    .run();
  return transfer.meta?.changes === 2;
}
