// NotificationHub Durable Object — real-time notifications per user
// Uses Cloudflare Hibernatable WebSocket API — the DO can sleep between events
// without losing connected WebSocket clients (getWebSockets() survives hibernation).
import type { Env } from '../types';

// Negotiate the WebSocket subprotocol: clients now send the JWT as a
// subprotocol (["jwt", "<token>"]) instead of a ?token= query param so the
// token never lands in request logs / proxies. Browsers require the server to
// echo ONE of the offered protocols on the 101 response, so we echo the scheme
// marker (never the token). Old clients send no subprotocol → returns null →
// response is unchanged (backward compatible).
function negotiateWsSubprotocol(request: Request): string | null {
  const raw = request.headers.get('Sec-WebSocket-Protocol');
  if (!raw) return null;
  const offered = raw.split(',').map((s) => s.trim());
  for (const scheme of ['bearer', 'jwt', 'access_token']) {
    if (offered.includes(scheme)) return scheme;
  }
  return null;
}

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
        try { ws.send(msg); sent++; } catch (e) {
          console.warn('[NotificationHub] /notify ws.send failed:', e);
        }
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

    // Chat presence: on the user's FIRST live socket, tell their chat partners
    // they're online. Fire-and-forget so the WS handshake isn't delayed. This
    // is a no-op for hosts (whose presence is driven by the explicit online
    // toggle, not socket connectivity) — see broadcastUserPresence.
    if (userId && this.state.getWebSockets().length === 1) {
      this.broadcastUserPresence(userId, true).catch((e) =>
        console.warn('[NotificationHub] connect presence failed:', e));
    }
    const subprotocol = negotiateWsSubprotocol(request);
    const init: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: client };
    if (subprotocol) init.headers = { 'Sec-WebSocket-Protocol': subprotocol };
    return new Response(null, init);
  }

  // Cloudflare Hibernatable WS handlers — called when DO wakes from hibernation

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const msg = JSON.parse(typeof message === 'string' ? message : '{}');
      if (msg?.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.warn('[NotificationHub] webSocketMessage parse/send error:', e);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(); } catch {}
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try { ws.close(); } catch {}
    await this.handleDisconnect(ws);
  }

  // Broadcast a regular user's chat presence (online/offline) to the hosts they
  // have chat rooms with, so the host app's chat header updates in real time.
  //
  // Only regular users produce socket-driven presence: the query looks up rooms
  // where this user is the `user_id` (i.e. the customer side). For a host caller
  // that returns zero rows → no-op, so host presence stays toggle-driven.
  private async broadcastUserPresence(userId: string, isOnline: boolean): Promise<void> {
    const rows = await this.env.DB.prepare(
      `SELECT h.user_id AS partner
       FROM chat_rooms cr JOIN hosts h ON h.id = cr.host_id
       WHERE cr.user_id = ? LIMIT 200`
    ).bind(userId).all<{ partner: string }>();
    const partners = (rows.results ?? []).map((r) => r.partner).filter((p) => p && p !== userId);
    if (partners.length === 0) return;

    const msg = JSON.stringify({ type: 'presence', user_id: userId, is_online: isOnline });
    await Promise.allSettled(
      partners.map(async (p) => {
        try {
          const stub = this.env.NOTIFICATION_HUB.get(this.env.NOTIFICATION_HUB.idFromName(p));
          await stub.fetch('https://dummy/notify', { method: 'POST', body: msg });
        } catch {
          /* one partner's hub failure must not abort the rest */
        }
      })
    );
  }

  // FIX: Mark host offline & broadcast presence when their WebSocket disconnects
  // (browser close, network drop, app crash). Without this, hosts.is_online
  // stays at 1 forever and users keep seeing them as "Online".
  private async handleDisconnect(ws: WebSocket): Promise<void> {
    let userId: string | undefined;
    try {
      const att = ws.deserializeAttachment() as { userId?: string } | null;
      userId = att?.userId;
    } catch (e) {
      console.warn('[NotificationHub] Failed to read socket attachment on disconnect:', e);
    }
    if (!userId) return;

    // Multi-tab safety: if another WS for this user is still open, don't mark offline.
    // The closing WS may still appear in getWebSockets(), so filter it out.
    const remaining = this.state.getWebSockets().filter((w) => w !== ws);
    if (remaining.length > 0) return;

    // Chat presence: last socket closed → tell this user's chat partners they
    // went offline (no-op for hosts; their offline is handled just below).
    await this.broadcastUserPresence(userId, false).catch((e) =>
      console.warn('[NotificationHub] disconnect presence failed:', e));

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
          } catch (e) {
            console.warn('[NotificationHub] presence broadcast to', u.id, 'failed:', e);
          }
        })
      );
    } catch (e) {
      console.error('[NotificationHub] handleDisconnect DB/presence error for user', userId, ':', e);
    }
  }
}
