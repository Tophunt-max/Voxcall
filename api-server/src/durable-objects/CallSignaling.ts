// CallSignaling Durable Object — WebRTC signaling for Cloudflare Calls
//
// SECURITY: This DO MUST be called only via the verified WebSocket route in
// index.ts (`/api/ws/call/:sessionId`). The Worker verifies the JWT and the
// caller's session membership, then forwards the request with TWO trusted
// headers that this DO uses as the source of truth:
//   - X-CF-User-Id : the JWT-verified user ID
//   - X-CF-Role    : derived role ('caller' | 'host') based on session
//
// URL search params (`userId`, `role`) are IGNORED because they are
// attacker-controllable. Without this fix, any authenticated user with
// access to a session could spoof their identity as the OTHER party in the
// signaling stream by tampering with the query string.
//
// HIBERNATION FIX: this DO uses Cloudflare's Hibernatable WebSocket API
// (`state.acceptWebSocket`) so it can sleep between events without dropping
// connected sockets. The previous implementation MIXED hibernatable accept
// with the non-hibernatable `server.addEventListener('message', ...)` pattern
// and tracked per-socket state in an in-memory `Map`. Both break across
// hibernation:
//   - addEventListener handlers do NOT fire after the runtime hibernates the
//     DO. Cloudflare delivers events via the class methods below
//     (webSocketMessage / webSocketClose / webSocketError) instead.
//   - In-memory state (the Map) is reset to empty on wake. That made the
//     REST-fan-out path (which iterates the Map) silently drop messages.
// Both issues meant signaling broke after a few seconds of idle, but the
// failure was silent — no errors, just messages going nowhere.
//
// We now:
//   - Use the hibernatable lifecycle methods exclusively.
//   - Persist per-socket identity via `serializeAttachment({userId, role})`
//     so it survives hibernation along with the socket itself.
//   - Read live sockets from `state.getWebSockets()` (which the runtime
//     keeps populated across hibernation cycles) for every fan-out.
// See NotificationHub for the rationale — clients send the JWT as a WebSocket
// subprotocol; we echo the scheme marker (never the token) on the 101 so
// browsers accept the handshake. Backward compatible: no subprotocol → null.
function negotiateWsSubprotocol(request: Request): string | null {
  const raw = request.headers.get('Sec-WebSocket-Protocol');
  if (!raw) return null;
  const offered = raw.split(',').map((s) => s.trim());
  for (const scheme of ['bearer', 'jwt', 'access_token']) {
    if (offered.includes(scheme)) return scheme;
  }
  return null;
}

export class CallSignaling {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers — read identity from a hibernatable socket attachment.
  // serializeAttachment is set once at acceptWebSocket() time and persists
  // across DO hibernation, so we never need an in-memory cache.
  // ──────────────────────────────────────────────────────────────────────────
  private getMeta(ws: WebSocket): { userId?: string; role?: 'caller' | 'host' } {
    try {
      return (ws.deserializeAttachment() as any) ?? {};
    } catch (e) {
      console.warn('[CallSignaling] Failed to deserialize socket attachment:', e);
      return {};
    }
  }

  // Send an outbound message to every connected socket whose userId matches
  // `targetUserId`. When `targetUserId` is undefined we broadcast to all
  // sockets except `excludeWs`.
  private fanout(payload: string, opts: { targetUserId?: string; excludeWs?: WebSocket }): number {
    const sockets = this.state.getWebSockets();
    let sent = 0;
    for (const ws of sockets) {
      if (opts.excludeWs && ws === opts.excludeWs) continue;
      if (opts.targetUserId) {
        const meta = this.getMeta(ws);
        if (meta.userId !== opts.targetUserId) continue;
      }
      try {
        ws.send(payload);
        sent++;
      } catch {
        // Socket may be closing — ignore; runtime will clean it up.
      }
    }
    return sent;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');

    // Trusted identity from Worker — REQUIRED. Reject if missing.
    const userId = request.headers.get('X-CF-User-Id');
    const roleHdr = request.headers.get('X-CF-Role');
    if (!userId || (roleHdr !== 'caller' && roleHdr !== 'host')) {
      return new Response(JSON.stringify({ error: 'Unauthorized — missing trusted identity headers' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const role = roleHdr as 'caller' | 'host';

    // REST: send signal to other peer. Used for the rare case a caller wants
    // to push a single signaling event without holding a WebSocket open.
    if (!upgradeHeader) {
      let to: string, type: string, payload: unknown;
      try {
        const body = (await request.json()) as any;
        to = body.to;
        type = body.type;
        payload = body.payload;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!to || !type) {
        return new Response(JSON.stringify({ error: 'Missing to/type' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // `from` is the trusted JWT-verified userId — never from a URL param.
      const msg = JSON.stringify({ type, payload, from: userId });
      const sent = this.fanout(msg, { targetUserId: to });
      return new Response(JSON.stringify({ ok: true, delivered: sent }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    // Store identity on the socket itself — survives DO hibernation.
    server.serializeAttachment({ userId, role });
    const subprotocol = negotiateWsSubprotocol(request);
    const init: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: client };
    if (subprotocol) init.headers = { 'Sec-WebSocket-Protocol': subprotocol };
    return new Response(null, init);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Hibernatable WebSocket lifecycle handlers. The Cloudflare runtime calls
  // these methods directly (no JS event listener required), so they survive
  // DO hibernation and remain wired up after the DO wakes back up.
  // ──────────────────────────────────────────────────────────────────────────
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    // Lightweight ping/pong (clients use it to keep the WS alive across NAT
    // timeouts). Reply on the same socket; do NOT fan out.
    if (msg?.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
      return;
    }
    const { userId } = this.getMeta(ws);
    if (!userId) return;
    // Stamp `from` with the trusted userId from the attachment — clients
    // cannot forge identity even if they spoof a `from` field in their JSON.
    const outbound = JSON.stringify({ ...msg, from: userId });
    this.fanout(outbound, { excludeWs: ws });
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close();
    } catch {}
    // No per-socket state to drop — runtime handles socket cleanup, and
    // attachment vanishes with the socket.
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close();
    } catch {}
  }
}
