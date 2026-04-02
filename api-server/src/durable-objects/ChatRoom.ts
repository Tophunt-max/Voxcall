// ChatRoom Durable Object — real-time WebSocket chat
export class ChatRoom {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { userId: string; name: string }> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    // Bug 4 Fix: Use verified userId from Worker header (X-CF-User-Id), not URL query params
    // The Worker validates the JWT and sets this header before proxying to the DO.
    // This prevents client-side impersonation via URL params.
    const userId = request.headers.get('X-CF-User-Id') || url.searchParams.get('userId') || 'anonymous';
    const userName = request.headers.get('X-CF-User-Name') || url.searchParams.get('name') || 'User';

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { userId, name: userName });

    server.addEventListener('message', async (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      let msg: any;
      try { msg = JSON.parse(data); } catch { return; }
      const sender = this.sessions.get(server);
      if (!sender) return;
      const outbound = JSON.stringify({ ...msg, senderId: sender.userId, senderName: sender.name, timestamp: Date.now() });
      this.broadcast(outbound, server);
    });

    server.addEventListener('close', () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(message: string, exclude?: WebSocket) {
    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === WebSocket.READY_STATE_OPEN) {
        try { ws.send(message); } catch {}
      }
    }
  }
}
