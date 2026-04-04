// NotificationHub Durable Object — real-time notifications per user
// NOTE: Durable Objects are NOT publicly routable in Cloudflare — they can only
// be reached from the same-account Worker via binding. No additional auth is
// needed on the /notify endpoint.
export class NotificationHub {
  private state: DurableObjectState;
  private connections: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal push from Worker — broadcast to all connected WebSocket clients
    if (url.pathname === '/notify' && request.method === 'POST') {
      const data = await request.json() as any;
      const msg = JSON.stringify(data);
      let sent = 0;
      for (const ws of this.connections) {
        if (ws.readyState === WebSocket.READY_STATE_OPEN) {
          try { ws.send(msg); sent++; } catch {}
        }
      }
      return new Response(JSON.stringify({ pushed: sent, total: this.connections.size }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade from client
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    this.connections.add(server);
    server.addEventListener('close', () => { this.connections.delete(server); });
    return new Response(null, { status: 101, webSocket: client });
  }
}
