// ============================================================================
// Ban enforcement helpers — admin-controlled user / device bans.
// ============================================================================
//
// Admins create bans from the Ban Management page (POST /admin/bans), which
// writes a row into `user_bans`. Historically that table was ONLY used for
// display — nothing read it for enforcement, so a ban had no effect. Two
// enforcement layers now use these helpers:
//
//   1. Account-level  — POST /admin/bans also flips `users.status='banned'`,
//      which the auth middleware already rejects on every request. Unban
//      restores `status='active'`.
//   2. Identity-level — at register / login / quick-login / google-login we
//      call `findActiveBan()` so a banned EMAIL (not yet registered) or a
//      banned DEVICE (reinstall / new account) is blocked before an account
//      is created or a token is issued.
//
// A ban is "active" when it has no expiry, an empty expiry, or an expiry date
// that is today or later. `expires_at` is stored as a TEXT date (YYYY-MM-DD),
// so we compare with SQLite's date() function.
//
// All helpers fail OPEN (return "not banned") on a DB error so a transient
// blip never locks legitimate users out of auth entirely.
// ============================================================================

export interface ActiveBan {
  id: string;
  reason: string;
  ban_type: string;
  expires_at: string | null;
}

interface BanLookup {
  userId?: string | null;
  email?: string | null;
  deviceId?: string | null;
}

const ACTIVE_CLAUSE =
  "(expires_at IS NULL OR expires_at = '' OR date(expires_at) >= date('now'))";

/**
 * Return the most recent still-active ban matching any of the supplied
 * identifiers (user id, email, device id), or null if none apply.
 */
export async function findActiveBan(
  db: D1Database,
  { userId, email, deviceId }: BanLookup,
): Promise<ActiveBan | null> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (userId) {
    clauses.push('user_id = ?');
    binds.push(userId);
  }
  if (email) {
    clauses.push('lower(user_email) = lower(?)');
    binds.push(email);
  }
  if (deviceId) {
    clauses.push('device_id = ?');
    binds.push(deviceId);
  }
  if (!clauses.length) return null;
  try {
    const row = await db
      .prepare(
        `SELECT id, reason, ban_type, expires_at FROM user_bans
         WHERE (${clauses.join(' OR ')}) AND ${ACTIVE_CLAUSE}
         ORDER BY banned_at DESC LIMIT 1`,
      )
      .bind(...binds)
      .first<ActiveBan>();
    return row ?? null;
  } catch {
    // Fail open — never block auth because the ban table couldn't be read.
    return null;
  }
}

/** Standard 403 body for a blocked-by-ban auth attempt. */
export function bannedBody(ban: ActiveBan | null) {
  return {
    error: 'Account suspended. Contact support if you believe this is an error.',
    code: 'account_banned',
    reason: ban?.reason ?? undefined,
  };
}
