// ============================================================================
// Outgoing event notifications — best-effort POST to NOTIFY_WEBHOOK_URL.
// ============================================================================
// Fires a short message on notable OTA events (promote, rollback, auto-rollback,
// new build). The payload carries BOTH `content` (Discord) and `text` (Slack)
// so a single URL works with either. Failures are swallowed — a flaky webhook
// must never break a deploy action. Call via ctx.waitUntil() so it never adds
// latency to the response.
// ============================================================================

import { type Env } from './shared';

export async function notify(env: Env, message: string): Promise<void> {
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch {
    // ignore — notifications are best-effort
  }
}
