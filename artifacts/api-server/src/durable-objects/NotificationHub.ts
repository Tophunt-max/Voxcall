// NotificationHub Durable Object — real-time notifications per user
export class NotificationHub {
  private state: DurableObjectState;
  private connections: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal call from Worker to push notification
    if (url.pathname === '/notify' && request.method === 'POST') {
      const data = await request.json() as any;
      const msg = JSON.stringify(data);
      for (const ws of this.connections) {
        if (ws.readyState === WebSocket.READY_STATE_OPEN) {
          try { ws.send(msg); } catch {}
        }
      }
      return new Response(JSON.stringify({ pushed: this.connections.size }), { headers: { 'Content-Type': 'application/json' } });
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
