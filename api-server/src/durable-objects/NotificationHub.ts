// NotificationHub Durable Object — real-time notifications per user
// Uses Cloudflare Hibernatable WebSocket API — the DO can sleep between events
// without losing connected WebSocket clients (getWebSockets() survives hibernation).
import type { Env } from '../types';

export class NotificationHub {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal push from Worker — broadcast to all WebSocket clients.
    // CRITICAL FIX: use this.state.getWebSockets() NOT an in-memory Set.
    // When the DO hibernates, in-memory state is lost but getWebSockets()
    // always returns live connections managed by the Cloudflare runtime.
    if (url.pathname === '/notify' && request.method === 'POST') {
      const data = await request.json() as any;
      const msg = JSON.stringify(data);
      const sockets = this.state.getWebSockets();
      let sent = 0;
      for (const ws of sockets) {
        try { ws.send(msg); sent++; } catch {}
      }
      return new Response(JSON.stringify({ pushed: sent, total: sockets.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade from client
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // userId is passed as a query param by the route handler (already verified via JWT)
    const userId = url.searchParams.get('userId') || '';

    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket registers the WS with Cloudflare runtime — survives
    // DO hibernation and is returned by getWebSockets() on wake-up.
    // Do NOT use server.addEventListener here — use the class methods below.
    this.state.acceptWebSocket(server);
    // Attach userId so we can identify which user disconnected on close.
    // serializeAttachment survives DO hibernation alongside the WS.
    server.serializeAttachment({ userId });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Cloudflare Hibernatable WS handlers — called when DO wakes from hibernation

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const msg = JSON.parse(typeof message === 'string' ? message : '{}');
      if (msg?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(); } catch {}
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try { ws.close(); } catch {}
    await this.handleDisconnect(ws);
  }

  // FIX: Mark host offline & broadcast presence when their WebSocket disconnects
  // (browser close, network drop, app crash). Without this, hosts.is_online
  // stays at 1 forever and users keep seeing them as "Online".
  private async handleDisconnect(ws: WebSocket): Promise<void> {
    let userId: string | undefined;
    try {
      const att = ws.deserializeAttachment() as { userId?: string } | null;
      userId = att?.userId;
    } catch {}
    if (!userId) return;

    // Multi-tab safety: if another WS for this user is still open, don't mark offline.
    // The closing WS may still appear in getWebSockets(), so filter it out.
    const remaining = this.state.getWebSockets().filter((w) => w !== ws);
    if (remaining.length > 0) return;

    try {
      const host = await this.env.DB.prepare(
        'SELECT id, is_online FROM hosts WHERE user_id = ?'
      ).bind(userId).first<{ id: string; is_online: number }>();
      // Only act if this user is a host that's currently marked online
      if (!host || !host.is_online) return;

      await this.env.DB.prepare(
        'UPDATE hosts SET is_online = 0, updated_at = unixepoch() WHERE user_id = ?'
      ).bind(userId).run();

      // Broadcast presence change to recent users so their UI updates immediately
      const recentUsers = await this.env.DB.prepare(
        `SELECT id FROM users WHERE role = 'user' ORDER BY updated_at DESC LIMIT 100`
      ).all<{ id: string }>();

      const presenceMsg = JSON.stringify({
        type: 'presence',
        user_id: userId,
        host_id: host.id,
        is_online: false,
      });
      await Promise.allSettled(
        (recentUsers.results ?? []).map(async (u) => {
          try {
            const stub = this.env.NOTIFICATION_HUB.get(this.env.NOTIFICATION_HUB.idFromName(u.id));
            await stub.fetch('https://dummy/notify', { method: 'POST', body: presenceMsg });
          } catch {}
        })
      );
    } catch {}
  }
}
