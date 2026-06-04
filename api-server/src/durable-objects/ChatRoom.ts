// ChatRoom Durable Object — real-time WebSocket chat
//
// HIBERNATION FIX: this DO uses Cloudflare's Hibernatable WebSocket API
// (`state.acceptWebSocket`) so it can sleep between events without dropping
// connected sockets. The previous implementation MIXED hibernatable accept
// with the non-hibernatable `server.addEventListener('message'|'close', ...)`
// pattern and tracked per-socket state in an in-memory `Map`. Both break
// across hibernation:
//   - addEventListener handlers do NOT fire after the runtime hibernates the
//     DO. Cloudflare delivers events via the class methods below
//     (webSocketMessage / webSocketClose / webSocketError) instead.
//   - In-memory state (the Map) is reset to empty on wake. That made the
//     broadcast() path silently drop all messages because it iterated an
//     empty Map.
// Both issues meant chat broke after a few seconds of idle, but the failure
// was silent — no errors, just messages going nowhere.
//
// We now:
//   - Use the hibernatable lifecycle methods exclusively.
//   - Persist per-socket identity via `serializeAttachment({userId, name})`
//     so it survives hibernation along with the socket itself.
//   - Read live sockets from `state.getWebSockets()` (which the runtime
//     keeps populated across hibernation cycles) for every broadcast.
//
// SECURITY: This DO MUST be called only via the verified WebSocket route in
// the Worker. The Worker validates the JWT and sets X-CF-User-Id (and
// optionally X-CF-User-Name) before proxying. URL search params are NOT
// trusted because they are attacker-controllable.
export class ChatRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Trusted identity from Worker — REQUIRED. Reject if missing.
    const userId = request.headers.get('X-CF-User-Id');
    const userName = request.headers.get('X-CF-User-Name') || 'User';
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized — missing verified identity' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    // Store identity on the socket itself — survives DO hibernation.
    server.serializeAttachment({ userId, name: userName });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers — read identity from a hibernatable socket attachment.
  // serializeAttachment is set once at acceptWebSocket() time and persists
  // across DO hibernation, so we never need an in-memory cache.
  // ──────────────────────────────────────────────────────────────────────────
  private getMeta(ws: WebSocket): { userId?: string; name?: string } {
    try {
      return (ws.deserializeAttachment() as any) ?? {};
    } catch (e) {
      console.warn('[ChatRoom] Failed to deserialize socket attachment:', e);
      return {};
    }
  }

  private broadcast(message: string, exclude?: WebSocket): void {
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      if (ws === exclude) continue;
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      try {
        ws.send(message);
      } catch (e) {
        // Closing/closed socket — runtime will clean it up. We swallow per
        // socket so one bad socket doesn't abort the whole broadcast.
        console.warn('[ChatRoom] broadcast send failed:', e);
      }
    }
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
    } catch (e) {
      console.warn('[ChatRoom] Failed to parse incoming message:', e);
      return;
    }
    const meta = this.getMeta(ws);
    if (!meta.userId) return;
    // Stamp senderId/senderName with the trusted identity from the
    // attachment — clients cannot forge identity even if they spoof these
    // fields in their JSON payload.
    const outbound = JSON.stringify({
      ...msg,
      senderId: meta.userId,
      senderName: meta.name ?? 'User',
      timestamp: Date.now(),
    });
    this.broadcast(outbound, ws);
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close();
    } catch {
      // Already closing / closed — nothing to do.
    }
    // Per-socket attachment vanishes with the socket; no state cleanup needed.
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close();
    } catch {
      // Already closing / closed — nothing to do.
    }
  }
}
