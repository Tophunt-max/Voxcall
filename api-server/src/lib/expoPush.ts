// Expo Push Notification sender
// Calls https://exp.host/--/api/v2/push/send
// Docs: https://docs.expo.dev/push-notifications/sending-notifications/

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
}

function isValidExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') && token.endsWith(']');
}

export async function sendExpoPush(
  tokens: string | string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<PushResult> {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter(isValidExpoToken);
  if (valid.length === 0) return { sent: 0, failed: tokenList.length };

  const messages: PushMessage[] = valid.map((to) => ({
    to,
    title,
    body,
    data: data ?? {},
    sound: 'default',
    priority: 'high',
    channelId: 'default',
  }));

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error('[ExpoPush] HTTP error:', res.status);
      return { sent: 0, failed: valid.length };
    }

    const result: any = await res.json();
    const tickets: any[] = result?.data ?? [];
    const failed = tickets.filter((t) => t.status === 'error').length;
    return { sent: tickets.length - failed, failed };
  } catch (err) {
    console.error('[ExpoPush] fetch error:', err);
    return { sent: 0, failed: valid.length };
  }
}

// Fetch fcm_tokens for a list of user IDs from D1
export async function getPushTokens(
  db: D1Database,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT fcm_token FROM users WHERE id IN (${placeholders}) AND fcm_token IS NOT NULL AND fcm_token != ''`)
    .bind(...userIds)
    .all<{ fcm_token: string }>();
  return result.results.map((r) => r.fcm_token).filter(isValidExpoToken);
}
