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
export class CallSignaling {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { userId: string; role: 'caller' | 'host' }> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
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

    // REST: send signal to other peer
    if (!upgradeHeader) {
      const { to, type, payload } = await request.json() as any;
      // `from` is the trusted JWT-verified userId — never the URL param
      const msg = JSON.stringify({ type, payload, from: userId });
      for (const [ws, meta] of this.sessions) {
        if (meta.userId === to && ws.readyState === WebSocket.READY_STATE_OPEN) {
          ws.send(msg);
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { userId, role });

    server.addEventListener('message', async (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }
      // Relay to all other participants — `from` is always the trusted userId
      const outbound = JSON.stringify({ ...msg, from: userId });
      for (const [ws, meta] of this.sessions) {
        if (ws !== server && ws.readyState === WebSocket.READY_STATE_OPEN) {
          try { ws.send(outbound); } catch {}
        }
      }
    });

    server.addEventListener('close', () => { this.sessions.delete(server); });
    return new Response(null, { status: 101, webSocket: client });
  }
}
