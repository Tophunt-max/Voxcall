// ============================================================================
// Host availability window
// ============================================================================
// Hosts can optionally set a daily availability window (`available_from`,
// `available_to` as "HH:MM" strings, interpreted in the host's `timezone`).
// This module is the single source of truth for deciding whether a host is
// within that window right now, so both the call chokepoint (call.ts
// /initiate) and random matching (match.ts) enforce it identically.
//
// Design rules (deliberately permissive to avoid ever locking a host out by
// accident):
//   • No window configured (either bound missing/blank) → always available.
//   • A zero-length window (from === to)               → always available.
//   • Normal window (from < to)                        → from <= now < to.
//   • Overnight window (from > to, e.g. 22:00–06:00)   → now >= from || now < to.
// ============================================================================

export interface AvailabilitySchedule {
  available_from?: string | null;
  available_to?: string | null;
  timezone?: string | null;
}

/** Parse an "HH:MM" string into minutes-of-day, or null if malformed/blank. */
function parseHHMM(s?: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Current minutes-of-day in the given IANA timezone (falls back to UTC). */
export function minutesOfDayInTz(tz?: string | null, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz || 'UTC',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const mi = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + mi;
  } catch {
    // Invalid/unknown timezone → fall back to UTC so we never throw on a hot path.
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Whether the host is currently within their configured availability window.
 * Returns `true` when no usable window is configured (see module rules), so a
 * missing schema column or an unset schedule never blocks a call.
 */
export function isWithinAvailability(
  sched: AvailabilitySchedule | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sched) return true;
  const from = parseHHMM(sched.available_from);
  const to = parseHHMM(sched.available_to);
  if (from === null || to === null) return true; // no / partial window
  if (from === to) return true;                   // zero-length → always on

  const cur = minutesOfDayInTz(sched.timezone, now);
  return from < to
    ? cur >= from && cur < to          // same-day window
    : cur >= from || cur < to;         // overnight window
}
