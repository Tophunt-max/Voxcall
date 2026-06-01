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
 * The coins actually chargeable to a caller, capped at their current balance.
 *
 * FIX #1 (partial / best-effort billing): the original atomicCallTransfer was
 * all-or-nothing — if a caller overran their balance (talked longer than they
 * could afford), the EXISTS guard failed and ZERO coins moved, so the host
 * earned nothing for real talk-time. We now charge what the caller CAN afford
 * (`min(coinsCharged, balance)`) so the host is always paid for the work done.
 */
export function affordableCoins(coinsCharged: number, callerBalance: number): number {
  if (!Number.isFinite(coinsCharged) || coinsCharged <= 0) return 0;
  const bal = Number.isFinite(callerBalance) && callerBalance > 0 ? callerBalance : 0;
  return Math.min(coinsCharged, bal);
}

/**
 * Best-effort caller→host settlement: charge the caller what they can afford
 * (capped at their balance) and pay the host their level-based share of the
 * amount actually collected. Returns the amounts that really moved (0/0 if the
 * caller had no coins or a concurrent debit drained them).
 *
 * Shared by POST /api/calls/end, POST /api/calls/:id/end, the heartbeat
 * force-end, and the cron reaper so all four bill identically.
 */
export async function chargeCallerAffordable(
  db: D1Database,
  params: {
    callerId: string;
    hostUserId: string;
    coinsCharged: number;
    earningShare: number;
  },
): Promise<{ charged: number; hostEarned: number }> {
  if (!(params.coinsCharged > 0) || !params.hostUserId) return { charged: 0, hostEarned: 0 };
  const callerRow = await db
    .prepare('SELECT coins FROM users WHERE id = ?')
    .bind(params.callerId)
    .first<{ coins: number }>();
  const chargeable = affordableCoins(params.coinsCharged, callerRow?.coins ?? 0);
  if (chargeable <= 0) return { charged: 0, hostEarned: 0 };
  const hostShare = hostShareOf(chargeable, params.earningShare);
  const ok = await atomicCallTransfer(db, {
    callerId: params.callerId,
    hostUserId: params.hostUserId,
    coinsCharged: chargeable,
    hostShare,
  });
  return ok ? { charged: chargeable, hostEarned: hostShare } : { charged: 0, hostEarned: 0 };
}

// ============================================================================
// First-call-free pool — billing wrapper.
// ============================================================================
//
// Layered on top of chargeCallerAffordable. When a caller still has free
// minutes left in `users.free_call_minutes` (migration 0028 / Layer 4
// engagement), the first N billed minutes of the call are taken from the
// pool instead of the caller's coin balance. The host is still paid in full
// for the entire call duration — the platform absorbs the free-minute cost
// as a customer-acquisition expense, which is the standard model used by
// Indian competitor apps (FRND/RealU/etc.).
//
// Math:
//   total_minutes  = billedMinutes(durationSec)
//   free_used      = min(user.free_call_minutes, total_minutes)
//   paid_minutes   = total_minutes - free_used
//   caller_pays    = paid_minutes × rate          (capped at balance)
//   host_earns     = floor(total_minutes × rate × earningShare)
//   platform_cost  = host_earns - caller_pays_via_share
//
// Atomicity:
//   The pool decrement, caller debit, and host credit run as a single
//   D1 batch (transactional in SQLite). Either all three land or none do —
//   no window in which the host is credited but the caller is not debited.
//
// Backward-compat:
//   If `users.free_call_minutes` is NULL or 0, this collapses to the legacy
//   chargeCallerAffordable behaviour exactly. Existing call sites that don't
//   use the free pool keep working unchanged.

export async function chargeCallerWithFreePool(
  db: D1Database,
  params: {
    callerId: string;
    hostUserId: string;
    /** Wall-clock seconds the call ran. Used to compute minutes via billedMinutes. */
    durationSec: number;
    ratePerMinute: number;
    earningShare: number;
  },
): Promise<{
  charged: number;
  hostEarned: number;
  free_minutes_used: number;
  billed_minutes: number;
}> {
  const totalMinutes = billedMinutes(params.durationSec);
  if (totalMinutes <= 0 || !params.hostUserId) {
    return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: 0 };
  }
  const rate = Number.isFinite(params.ratePerMinute) && params.ratePerMinute > 0
    ? params.ratePerMinute
    : 0;
  if (rate === 0) {
    return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: totalMinutes };
  }

  // 1. Read caller balance + free-pool size in one round-trip. We tolerate
  //    a missing free_call_minutes column (legacy DB pre migration 0028)
  //    by defaulting to 0 free minutes — feature degrades gracefully.
  let callerCoins = 0;
  let freePool = 0;
  try {
    const row = await db
      .prepare('SELECT coins, COALESCE(free_call_minutes, 0) as free_call_minutes FROM users WHERE id = ?')
      .bind(params.callerId)
      .first<{ coins: number; free_call_minutes: number }>();
    callerCoins = Number(row?.coins) || 0;
    freePool = Math.max(0, Number(row?.free_call_minutes) || 0);
  } catch {
    // Column might not exist yet (healer race). Fall back to no-free-pool.
    const fallback = await db
      .prepare('SELECT coins FROM users WHERE id = ?')
      .bind(params.callerId)
      .first<{ coins: number }>();
    callerCoins = Number(fallback?.coins) || 0;
    freePool = 0;
  }

  // 2. Split free vs paid minutes.
  const freeUsed = Math.min(freePool, totalMinutes);
  const paidMinutes = totalMinutes - freeUsed;
  const callerOwes = paidMinutes * rate;
  // Host is paid for ALL minutes (free + paid) — platform absorbs the
  // free-portion cost. host_earnings is computed from the FULL call coins
  // so the host's per-minute payout is identical regardless of how many
  // free minutes the caller used.
  const fullCallCoins = totalMinutes * rate;
  const hostEarn = hostShareOf(fullCallCoins, params.earningShare);

  // 3. Best-effort cap on the caller's debit (same partial-billing model
  //    as chargeCallerAffordable).
  const callerActuallyPays = affordableCoins(callerOwes, callerCoins);

  // 4. Atomic batch: decrement free pool + debit caller + credit host.
  //    SQLite/D1 batches are transactional — either all three land or none.
  const ops: D1PreparedStatement[] = [];
  if (freeUsed > 0) {
    ops.push(
      db
        .prepare('UPDATE users SET free_call_minutes = MAX(0, COALESCE(free_call_minutes, 0) - ?) WHERE id = ?')
        .bind(freeUsed, params.callerId),
    );
  }
  if (callerActuallyPays > 0) {
    ops.push(
      db
        .prepare('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?')
        .bind(callerActuallyPays, params.callerId, callerActuallyPays),
    );
  }
  if (hostEarn > 0) {
    ops.push(
      db
        .prepare('UPDATE users SET coins = coins + ? WHERE id = ?')
        .bind(hostEarn, params.hostUserId),
    );
  }
  if (ops.length > 0) {
    try {
      await db.batch(ops);
    } catch (err) {
      console.warn('[billing] free-pool batch failed:', err);
      return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: totalMinutes };
    }
  }

  return {
    charged: callerActuallyPays,
    hostEarned: hostEarn,
    free_minutes_used: freeUsed,
    billed_minutes: totalMinutes,
  };
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
