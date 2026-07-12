// ============================================================================
// Engagement notification gate.
// ============================================================================
//
// A single chokepoint that EVERY engagement / marketing notification should go
// through (favorite-host-online, onboarding drip, abandoned recharge, low
// balance, weekly recap, re-engagement, streak/near-level/VIP reminders). It
// enforces three global rails so we never spam users:
//
//   1. Quiet hours (IST)      — no engagement pushes during the configured
//      deep-night window (default 23:00–08:00 IST). This is a companionship /
//      calling app where evening/night is PEAK, so the quiet window is
//      deliberately narrow (late night only) and admin-tunable.
//   2. Per-user daily cap     — at most `engagement_daily_cap` (default 3)
//      engagement notifications per user per rolling 24h, across ALL types.
//   3. Opt-out                — respects notification_preferences (maps each
//      notification type to a preference category).
//
// notifyEngagement() applies all three, then delegates to notifyUser() (row +
// real-time notification_new + FCM). Returns whether it actually sent.
// ============================================================================

import type { Env } from '../types';
import { notifyUser } from './realtime';

// Types that count toward the engagement daily cap + are gated below.
export const ENGAGEMENT_TYPES = [
  'reengagement', 'streak_reminder', 'near_level', 'vip_expiring',
  'favorite_online', 'onboarding_d0', 'onboarding_d1', 'onboarding_d3',
  'abandoned_recharge', 'low_balance', 'weekly_recap',
  'free_spin', 'profile_completion', 'online_hosts', 'happy_hour',
] as const;

const ENGAGEMENT_TYPE_SET = new Set<string>(ENGAGEMENT_TYPES);

// notification type → notification_preferences category (for opt-out).
function categoryForType(type: string): string {
  if (type === 'reengagement') return 'reengagement';
  if (type === 'streak_reminder') return 'streak';
  return 'marketing'; // favorite_online / onboarding / abandoned_recharge / low_balance / weekly_recap / near_level / vip_expiring
}

async function readIntSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Read a boolean engagement feature flag from app_settings. Treats '0' / 'false'
 * as OFF and anything else (including a missing row) as the fallback. Lets the
 * admin panel toggle each engagement trigger on/off without a deploy.
 */
export async function engagementFeatureEnabled(env: Env, key: string, fallback = true): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch {
    return fallback;
  }
}

/**
 * Is it currently inside the engagement quiet-hours window (IST)?
 * Default window 23:00 → 08:00 IST; both bounds admin-tunable. Cron jobs should
 * call this ONCE up-front and bail early to avoid per-user work at night.
 */
export async function isQuietHoursIST(env: Env): Promise<boolean> {
  const startH = await readIntSetting(env.DB, 'engagement_quiet_start_ist', 23);
  const endH = await readIntSetting(env.DB, 'engagement_quiet_end_ist', 8);
  if (startH === endH) return false;
  // IST = UTC + 5:30
  const istHour = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).getUTCHours();
  return startH < endH ? (istHour >= startH && istHour < endH) : (istHour >= startH || istHour < endH);
}

async function isOptedOut(db: D1Database, userId: string, category: string): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND category = ?')
      .bind(userId, category)
      .first<{ enabled: number }>();
    return row ? row.enabled === 0 : false; // default = enabled
  } catch {
    return false;
  }
}

async function engagementCountLast24h(db: D1Database, userId: string): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const ph = ENGAGEMENT_TYPES.map(() => '?').join(',');
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND created_at >= ? AND type IN (${ph})`)
      .bind(userId, since, ...ENGAGEMENT_TYPES)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Send an engagement notification through the global rails. Returns true if it
 * was actually delivered, false if suppressed (quiet hours / cap / opt-out).
 */
export async function notifyEngagement(
  env: Env,
  userId: string,
  title: string,
  body: string,
  type: string,
  opts?: { data?: Record<string, string> },
): Promise<boolean> {
  try {
    // Master kill switch — admin can disable ALL engagement notifications.
    if (!(await engagementFeatureEnabled(env, 'engagement_notifications_enabled', true))) return false;
    if (await isQuietHoursIST(env)) return false;
    if (await isOptedOut(env.DB, userId, categoryForType(type))) return false;
    // Best-Time-To-Notify: when smart timing is ON and we know this user's
    // active hour, only deliver near that hour (fail-open when unknown/off).
    {
      const { isWithinActiveWindow } = await import('./bestTime');
      if (!(await isWithinActiveWindow(env.DB, userId))) return false;
    }
    const cap = await readIntSetting(env.DB, 'engagement_daily_cap', 3);
    if (ENGAGEMENT_TYPE_SET.has(type) && (await engagementCountLast24h(env.DB, userId)) >= cap) return false;
    await notifyUser(env, userId, title, body, type, opts);
    return true;
  } catch (e) {
    console.warn('[engagementNotify] failed for', userId, type, e);
    return false;
  }
}

/**
 * #1 — Real-time "your favorite host is online" push. Fires when a host toggles
 * online. Targets users who favorited them, are active, have a token, are NOT
 * currently in a call, and haven't had a favorite_online nudge in the last 6h
 * (per-user cooldown). Best-effort; capped so a popular host can't blast.
 */
export async function notifyFavoritersHostOnline(env: Env, hostId: string, hostUserId: string): Promise<void> {
  try {
    if (!(await engagementFeatureEnabled(env, 'favorite_online_enabled', true))) return;
    if (await isQuietHoursIST(env)) return;
    const host = await env.DB.prepare('SELECT display_name FROM hosts WHERE id = ?').bind(hostId).first<{ display_name: string | null }>();
    const name = host?.display_name || 'A host you follow';
    const cooldownCutoff = Math.floor(Date.now() / 1000) - 6 * 3600;
    const rows = await env.DB.prepare(
      `SELECT uf.user_id AS user_id
         FROM user_favorites uf
         JOIN users u ON u.id = uf.user_id
        WHERE uf.host_id = ?
          AND u.id != ?
          AND u.role = 'user'
          AND COALESCE(u.status, 'active') = 'active'
          AND u.fcm_token IS NOT NULL AND u.fcm_token != ''
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id = uf.user_id AND n.type = 'favorite_online' AND n.created_at >= ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM call_sessions cs
             WHERE cs.caller_id = uf.user_id AND cs.status IN ('pending', 'active')
          )
        LIMIT 100`,
    ).bind(hostId, hostUserId, cooldownCutoff).all<{ user_id: string }>();

    for (const r of rows.results ?? []) {
      await notifyEngagement(
        env, r.user_id,
        `🟢 ${name} is Online Now!`,
        `Great news! Aapke favorite host ${name} abhi available hain aur aapse baat karne ke liye ready. 💛 Ek call ho jaaye? ✨`,
        'favorite_online',
        { data: { type: 'favorite_online', host_id: hostId } },
      );
    }
  } catch (e) {
    console.warn('[engagementNotify] notifyFavoritersHostOnline failed for host', hostId, e);
  }
}
