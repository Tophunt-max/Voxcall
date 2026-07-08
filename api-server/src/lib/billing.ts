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
 * PER-MINUTE ROUND-UP billing — the canonical, product-mandated rule.
 *
 * Any STARTED minute is charged in full (round UP), with a hard 1-minute floor
 * for a connected call. Concretely:
 *   - a 2-second answered call   → 1 minute billed
 *   - a 59-second call           → 1 minute billed
 *   - a 61-second call           → 2 minutes billed
 * i.e. every 1–60s bucket = exactly one billed minute. A non-positive /
 * non-finite duration bills 0 (a pending call that never connected is free).
 *
 * This is the DEFAULT granularity the platform bills at. A different bucket
 * size can be selected at runtime via `app_settings.billing_granularity_sec`
 * (see MIN_BILLING_GRANULARITY_SEC + billedUnits); when it stays at 60 the
 * math here and in billedUnits are identical.
 */
export function billedMinutes(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(1, Math.ceil(durationSec / 60));
}

/**
 * DEFAULT billing granularity in seconds. The call settle paths bill PER MINUTE
 * with a 1-minute round-up floor unless `app_settings.billing_granularity_sec`
 * selects a different bucket. This value is the fallback used by `billedUnits`
 * and `rateForGranularity` whenever the requested granularity is missing or
 * invalid (0 / negative / NaN), so billing always has a sane per-minute default.
 */
export const MIN_BILLING_GRANULARITY_SEC = 60;

/**
 * Granularity-aware billable units for a call.
 *
 * `granularitySec` is how many real seconds equal one billing unit:
 *   - 60 → per-minute (legacy, default). Returns whole minutes (round up).
 *   - 1  → per-second. Returns whole seconds (round up so a 0.4s call still
 *          counts as 1).
 *   - any other value → grid round-up to the next granularity bucket.
 *
 * The corresponding `ratePerUnit` for each granularity is computed by
 * {@link rateForGranularity} so the caller can use the same downstream math
 * regardless of the chosen unit.
 *
 * This is the building block for the admin-tunable
 * `app_settings.billing_granularity_sec` (default 60). All billing helpers
 * route through here so a future per-second admin flip (or per-100-millisecond
 * test mode) doesn't require code changes.
 */
export function billedUnits(durationSec: number, granularitySec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  // Honour the requested granularity. Fall back to the per-minute default only
  // when the value is missing or invalid (0 / negative / NaN) so a misconfigured
  // setting degrades to the safe per-minute rule instead of dividing by zero.
  const g = Number.isFinite(granularitySec) && granularitySec > 0 ? granularitySec : MIN_BILLING_GRANULARITY_SEC;
  // Floor at 1 unit so any connected call costs at least one billing unit.
  return Math.max(1, Math.ceil(durationSec / g));
}

/**
 * Convert a per-minute rate into the per-unit rate for a given granularity.
 * `rateForGranularity(10, 60) = 10`  (per-minute, identical)
 * `rateForGranularity(10, 1)  = 10/60 ≈ 0.1667`  (per-second)
 *
 * Coin amounts are integers — we return a fractional rate here so the caller
 * can multiply units × rate, then round/floor exactly once at the end of the
 * full coin calculation. This avoids "round each second then sum" drift.
 */
export function rateForGranularity(ratePerMinute: number, granularitySec: number): number {
  if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return 0;
  // Use the same granularity resolution as billedUnits so the per-unit rate
  // always matches the billing unit. With g === 60 this is just ratePerMinute;
  // an invalid granularity falls back to the per-minute default.
  const g = Number.isFinite(granularitySec) && granularitySec > 0 ? granularitySec : MIN_BILLING_GRANULARITY_SEC;
  return (ratePerMinute * g) / 60;
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
 * Seconds a caller can afford to talk, accounting for BOTH their coin balance
 * and their free-minute pool.
 *
 * Billing (chargeCallerWithFreePool) consumes the free-minute pool first and
 * only then charges coins, so the real affordable duration is:
 *
 *   (coins / ratePerMinute) * 60   +   freeMinutes * 60
 *
 * Centralised here so the call-admission gate (/initiate), the per-call
 * `max_seconds` cap, the host's incoming-call timer (/pending-for-host) and
 * the mid-call balance check (/heartbeat) all agree with how the call is
 * actually settled. Before this, those sites used `coins/rate` only and so
 * ignored the free pool — blocking coinless-but-free-minute callers and
 * force-ending calls earlier than the caller could actually afford.
 */
export function affordableCallSeconds(
  coins: number,
  freeMinutes: number,
  ratePerMinute: number,
): number {
  const rate = Number.isFinite(ratePerMinute) && ratePerMinute > 0 ? ratePerMinute : 0;
  if (rate <= 0) return 0;
  const c = Number.isFinite(coins) && coins > 0 ? coins : 0;
  const fm = Number.isFinite(freeMinutes) && freeMinutes > 0 ? freeMinutes : 0;
  return Math.floor((c / rate + fm) * 60);
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
    /**
     * Billing granularity in seconds — 60 (default) for per-minute round-up,
     * 1 for whole-second precision. Read from app_settings by the call sites,
     * passed through here so the math stays a pure function. Caller-side
     * uniform default keeps backward-compat: omit this param and the helper
     * behaves exactly like the legacy per-minute version.
     */
    granularitySec?: number;
  },
): Promise<{
  charged: number;
  hostEarned: number;
  free_minutes_used: number;
  billed_minutes: number;
}> {
  const granularity = params.granularitySec ?? 60;
  // For audit + the existing caller-app contract we keep returning
  // `billed_minutes` (the legacy field name) but it's actually the number of
  // billing UNITS — at granularity=60 that's literally minutes; at
  // granularity=1 it's seconds. Existing call sites store this as
  // call_sessions.duration_seconds when granularity=1, so the column name
  // agnostic naming holds.
  const totalUnits = billedUnits(params.durationSec, granularity);
  if (totalUnits <= 0 || !params.hostUserId) {
    return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: 0 };
  }
  // Per-unit rate for the chosen granularity. Per-minute (60s) → identical
  // rate; per-second (1s) → rate/60.
  const ratePerUnit = rateForGranularity(params.ratePerMinute, granularity);
  if (ratePerUnit <= 0) {
    return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: totalUnits };
  }

  // Free pool is denominated in MINUTES (users.free_call_minutes column +
  // admin setting). Convert to UNITS at the chosen granularity so the
  // free-trial pool math stays consistent across granularities.
  //   per-minute: 5 free minutes → 5 free units
  //   per-second: 5 free minutes → 300 free units
  const freePoolUnitsPerFreeMinute = 60 / granularity;

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

  // 2. Split free vs paid units.
  // Free pool stored as MINUTES, converted to UNITS at the active
  // granularity. At per-minute billing (60), one free minute = 1 unit; at
  // per-second billing, one free minute = 60 units. The decrement back into
  // users.free_call_minutes is converted in reverse (units → ceil(minutes))
  // so a partial-minute consumption still leaves the user's pool clamped to
  // whole minutes (the column is INTEGER).
  const freePoolUnits = freePool * freePoolUnitsPerFreeMinute;
  const freeUnitsUsed = Math.min(freePoolUnits, totalUnits);
  const paidUnits = totalUnits - freeUnitsUsed;
  // Caller pays integer coins for paid portion (round to nearest whole coin
  // — fractional rates × integer units can produce decimals on per-second
  // billing). Math.floor preserves the platform-never-overcharges guarantee.
  const callerOwes = Math.floor(paidUnits * ratePerUnit);
  // Host paid for ALL units (free + paid) — platform absorbs the
  // free-portion cost. Multiply once at the end so per-second billing
  // doesn't accumulate sub-coin rounding drift.
  const fullCallCoins = totalUnits * ratePerUnit;
  const hostEarn = hostShareOf(fullCallCoins, params.earningShare);
  // Convert free units back to whole minutes for the column decrement.
  // ceil so a fractional minute (e.g. 1.5 minutes worth of seconds) burns
  // 2 free minutes — fair to the platform's free-trial budget.
  const freeMinutesToDecrement = Math.ceil(freeUnitsUsed / freePoolUnitsPerFreeMinute);

  // 3. Best-effort cap on the caller's debit (same partial-billing model
  //    as chargeCallerAffordable).
  const callerActuallyPays = affordableCoins(callerOwes, callerCoins);

  // 4. Atomic batch: decrement free pool + debit caller + credit host.
  //    SQLite/D1 batches are transactional — either all three land or none.
  const ops: D1PreparedStatement[] = [];
  // Track the caller-debit's position so we can verify it actually applied.
  let debitOpIndex = -1;
  if (freeMinutesToDecrement > 0) {
    ops.push(
      db
        .prepare('UPDATE users SET free_call_minutes = MAX(0, COALESCE(free_call_minutes, 0) - ?) WHERE id = ?')
        .bind(freeMinutesToDecrement, params.callerId),
    );
  }
  if (callerActuallyPays > 0) {
    debitOpIndex = ops.length;
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

  let actualCharged = callerActuallyPays;
  if (ops.length > 0) {
    let results: D1Result[];
    try {
      results = await db.batch(ops);
    } catch (err) {
      console.warn('[billing] free-pool batch failed:', err);
      return { charged: 0, hostEarned: 0, free_minutes_used: 0, billed_minutes: totalUnits };
    }
    // Verify the caller-debit actually applied. The debit is guarded by
    // `coins >= ?`; if a concurrent debit drained the caller between our
    // balance read above and this batch, it matches 0 rows. The host is still
    // paid (platform absorbs, same model as free minutes) but we must NOT
    // report `charged`, else the caller-spend ledger row written by the call
    // routes would claim coins that were never deducted (balance/ledger
    // drift). Only zero out when changes is EXPLICITLY 0 — if a runtime
    // doesn't surface per-statement changes we keep the optimistic value,
    // preserving the prior behaviour exactly.
    if (debitOpIndex >= 0) {
      const changes = results?.[debitOpIndex]?.meta?.changes;
      if (changes === 0) actualCharged = 0;
    }
  }

  return {
    charged: actualCharged,
    hostEarned: hostEarn,
    free_minutes_used: freeMinutesToDecrement,
    billed_minutes: totalUnits,
  };
}

// ============================================================================
// Prepaid coin hold (item 2)
// ============================================================================
//
// When enabled, the caller's SPENDABLE coins are RESERVED for the duration of
// an active call so they can't be double-spent (tips / a second call) while the
// call is still billing — guaranteeing the coins are there to charge at settle.
//
// Mechanics:
//   • The hold lives in `users.coins_held`; a user's spendable balance is
//     (coins - coins_held). The call's own settlement debits `coins` directly
//     and is UNAFFECTED by the hold — only OTHER spend paths (tips, new call
//     admission) subtract coins_held.
//   • `call_sessions.coins_reserved` records how much this call holds, so
//     release is exact and idempotent.
//   • Trade-off: with the hold ON, a caller cannot tip DURING a call. Toggle
//     `call_prepaid_hold_enabled` off if you prefer gifting-during-call.

/** Whether the prepaid-hold feature is enabled (admin kill-switch, default ON). */
export async function isPrepaidHoldEnabled(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'call_prepaid_hold_enabled'").first<{ value: string }>();
    return (row?.value ?? '1') !== '0';
  } catch {
    return true;
  }
}

/**
 * Reserve the caller's full spendable balance for an active call. Atomic +
 * idempotent (a second call for the same session is a no-op). Tolerates a
 * legacy DB missing the coins_held / coins_reserved columns (returns 0).
 * Returns the amount actually held.
 */
export async function placeCallHold(
  db: D1Database,
  params: { callerId: string; sessionId: string },
): Promise<number> {
  try {
    const existing = await db
      .prepare('SELECT coins_reserved FROM call_sessions WHERE id = ?')
      .bind(params.sessionId)
      .first<{ coins_reserved: number }>();
    if ((existing?.coins_reserved ?? 0) > 0) return existing!.coins_reserved; // already held
    const u = await db
      .prepare('SELECT coins, COALESCE(coins_held, 0) as coins_held FROM users WHERE id = ?')
      .bind(params.callerId)
      .first<{ coins: number; coins_held: number }>();
    if (!u) return 0;
    const spendable = Math.max(0, (Number(u.coins) || 0) - (Number(u.coins_held) || 0));
    if (spendable <= 0) return 0;
    // Atomic guard: only reserve coins that are still spendable right now.
    const res = await db
      .prepare('UPDATE users SET coins_held = COALESCE(coins_held, 0) + ? WHERE id = ? AND (coins - COALESCE(coins_held, 0)) >= ?')
      .bind(spendable, params.callerId, spendable)
      .run();
    if (!res.meta?.changes) return 0;
    await db.prepare('UPDATE call_sessions SET coins_reserved = ? WHERE id = ?').bind(spendable, params.sessionId).run();
    return spendable;
  } catch (e) {
    console.warn('[billing] placeCallHold failed:', e);
    return 0;
  }
}

/**
 * Release a call's coin hold back to the caller's spendable balance. Idempotent
 * — zeroes coins_reserved so a repeated call (end + cron) never double-releases.
 * Safe on a legacy DB missing the columns.
 */
export async function releaseCallHold(
  db: D1Database,
  params: { callerId: string; sessionId: string },
): Promise<void> {
  try {
    const s = await db
      .prepare('SELECT coins_reserved FROM call_sessions WHERE id = ?')
      .bind(params.sessionId)
      .first<{ coins_reserved: number }>();
    const reserved = Number(s?.coins_reserved) || 0;
    if (reserved <= 0) return;
    await db.batch([
      db.prepare('UPDATE users SET coins_held = MAX(0, COALESCE(coins_held, 0) - ?) WHERE id = ?').bind(reserved, params.callerId),
      db.prepare('UPDATE call_sessions SET coins_reserved = 0 WHERE id = ?').bind(params.sessionId),
    ]);
  } catch (e) {
    console.warn('[billing] releaseCallHold failed:', e);
  }
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
