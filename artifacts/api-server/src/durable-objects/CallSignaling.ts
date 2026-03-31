// CallSignaling Durable Object — WebRTC signaling for Cloudflare Calls
export class CallSignaling {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { userId: string; role: 'caller' | 'host' }> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // REST: send signal to other peer
    if (!upgradeHeader) {
      const { to, type, payload } = await request.json() as any;
      const msg = JSON.stringify({ type, payload, from: url.searchParams.get('userId') });
      for (const [ws, meta] of this.sessions) {
        if (meta.userId === to && ws.readyState === WebSocket.READY_STATE_OPEN) {
          ws.send(msg);
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const userId = url.searchParams.get('userId') || 'unknown';
    const role = (url.searchParams.get('role') || 'caller') as 'caller' | 'host';
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { userId, role });

    server.addEventListener('message', async (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }
      // Relay to all other participants
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
