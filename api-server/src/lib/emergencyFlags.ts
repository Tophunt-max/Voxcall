// ============================================================================
// Emergency operational flags — admin-controlled kill switches.
// ============================================================================
//
// These live in `app_settings` as `emergency_*` keys so the whole platform
// can share one source of truth (surfaced on the admin dashboard, read on
// every enforcement route). Values are stored as '0' / '1' strings for
// consistency with every other app_settings entry.
//
// FLAGS:
//   emergency_payouts_frozen       — POST /coin/withdraw returns 503
//   emergency_registrations_paused — POST /auth/register + verify-otp +
//                                     google-login return 503
//   emergency_new_calls_paused     — POST /call/initiate returns 503
//
// Callers use `isEmergencyOn(db, key)` in a lightweight check right before
// the operation would happen. If the flag is set, the caller returns 503
// with a code the client can localise. Failure to read the setting fails
// OPEN — a DB blip should not accidentally lock out the whole platform.
// ============================================================================

export type EmergencyFlagKey =
  | 'payouts_frozen'
  | 'registrations_paused'
  | 'new_calls_paused';

const SETTING_KEY: Record<EmergencyFlagKey, string> = {
  payouts_frozen: 'emergency_payouts_frozen',
  registrations_paused: 'emergency_registrations_paused',
  new_calls_paused: 'emergency_new_calls_paused',
};

/**
 * Return true iff the given emergency flag is currently ON (value === '1').
 * Fails OPEN (returns false) on any DB error so a transient blip can't lock
 * out normal traffic. The admin dashboard renders the authoritative flag
 * state via GET /admin/emergency-flags, which uses the same store.
 */
export async function isEmergencyOn(
  db: D1Database,
  flag: EmergencyFlagKey,
): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(SETTING_KEY[flag])
      .first<{ value: string }>();
    return String(row?.value ?? '0') === '1';
  } catch (err) {
    console.warn(`[emergencyFlags] read failed for ${flag}, failing open:`, err);
    return false;
  }
}

/**
 * Read the FULL set of emergency-flag states in a single query. Used by
 * GET /admin/emergency-flags to hydrate the dashboard emergency-switches
 * card. Returns booleans keyed by short flag name.
 */
export async function readAllEmergencyFlags(
  db: D1Database,
): Promise<Record<EmergencyFlagKey, boolean>> {
  const keys = Object.values(SETTING_KEY);
  const placeholders = keys.map(() => '?').join(', ');
  const out: Record<EmergencyFlagKey, boolean> = {
    payouts_frozen: false,
    registrations_paused: false,
    new_calls_paused: false,
  };
  try {
    const res = await db
      .prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
      .bind(...keys)
      .all<{ key: string; value: string }>();
    for (const row of res.results ?? []) {
      for (const [short, full] of Object.entries(SETTING_KEY) as Array<[EmergencyFlagKey, string]>) {
        if (row.key === full) out[short] = String(row.value ?? '0') === '1';
      }
    }
  } catch (err) {
    console.warn('[emergencyFlags] readAll failed:', err);
  }
  return out;
}

/**
 * Set a flag to on/off. Idempotent — repeated writes are safe. Callers are
 * expected to log an audit entry alongside (the admin PATCH endpoint does
 * this automatically).
 */
export async function setEmergencyFlag(
  db: D1Database,
  flag: EmergencyFlagKey,
  on: boolean,
): Promise<void> {
  const key = SETTING_KEY[flag];
  const value = on ? '1' : '0';
  await db
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(key, value)
    .run();
}

/**
 * Machine-readable error body returned by every enforcement site when a
 * flag is engaged. Shape matches the platform's other 4xx/5xx bodies so
 * the client can uniformly surface a "temporarily unavailable" screen.
 */
export function emergencyBlockedBody(flag: EmergencyFlagKey) {
  const messages: Record<EmergencyFlagKey, string> = {
    payouts_frozen: 'Withdrawals are temporarily paused by the platform. Please try again later.',
    registrations_paused: 'New account creation is temporarily paused. Please try again shortly.',
    new_calls_paused: 'New calls are temporarily paused by the platform. Please try again shortly.',
  };
  return { error: 'service_paused', flag, message: messages[flag] };
}
