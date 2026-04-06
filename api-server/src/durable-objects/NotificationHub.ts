// NotificationHub Durable Object — real-time notifications per user
// Uses Cloudflare Hibernatable WebSocket API — the DO can sleep between events
// without losing connected WebSocket clients (getWebSockets() survives hibernation).
export class NotificationHub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
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

    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket registers the WS with Cloudflare runtime — survives
    // DO hibernation and is returned by getWebSockets() on wake-up.
    // Do NOT use server.addEventListener here — use the class methods below.
    this.state.acceptWebSocket(server);
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

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    try { ws.close(); } catch {}
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    try { ws.close(); } catch {}
  }
}
