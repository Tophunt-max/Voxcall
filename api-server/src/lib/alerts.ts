// ============================================================================
// Admin alerts — persist + optional external delivery
// ============================================================================
//
// A single chokepoint for operational alerts (coin-drift watchdog, payment
// amount mismatches, and any future critical signal). Every alert is:
//   1. persisted to app_errors — so it shows in GET /admin/alerts, the
//      dashboard error count, and the health monitor; and
//   2. (optionally) POSTed to an admin-configured webhook (app_settings
//      'alert_webhook_url') in a Slack-compatible { text } shape — so an
//      operator is paged even with no dashboard open.
// Best-effort throughout: an alert must never break the money/cron path that
// raised it.
// ============================================================================

export type AlertSeverity = 'info' | 'warn' | 'critical';

/** One-line, channel-friendly rendering of an alert (Slack/Discord/email). */
export function formatAlertText(context: string, message: string, severity: AlertSeverity = 'warn'): string {
  const icon = severity === 'critical' ? '🔴' : severity === 'warn' ? '🟠' : '🔵';
  return `${icon} [VoxLink ${severity.toUpperCase()}] ${context}: ${message}`;
}

/**
 * Raise an admin alert. Writes an app_errors row and, when a webhook is
 * configured, fires a best-effort HTTPS POST. Never throws.
 */
export async function raiseAdminAlert(
  db: D1Database,
  alert: {
    context: string;
    message: string;
    severity?: AlertSeverity;
    userId?: string | null;
    platform?: string;
  },
): Promise<void> {
  const { context, message, severity = 'warn', userId = null, platform = 'server' } = alert;

  // 1. Persist (source of truth for the in-dashboard feed + hourly error count).
  try {
    await db
      .prepare('INSERT INTO app_errors (user_id, message, context, platform, app_version) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, message, context, platform, severity)
      .run();
  } catch (e) {
    console.warn('[alerts] app_errors insert failed:', e);
  }

  // 2. External delivery — opt-in, HTTPS-only (SSRF guard), best-effort.
  try {
    const row = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'alert_webhook_url'")
      .first<{ value: string }>()
      .catch(() => null);
    const url = row?.value?.trim();
    if (url && /^https:\/\//i.test(url)) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: formatAlertText(context, message, severity) }),
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[alerts] webhook post failed:', e);
  }
}
