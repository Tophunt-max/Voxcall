// VoxLink Socket Service
// Connects to backend NotificationHub Durable Object for real-time events
// Falls back to event emitter only when WebSocket is unavailable

import { SocketEvents } from "@/constants/events";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://voxlink-api.ssunilkumarmohanta3.workers.dev";

function getWsUrl(userId: string, token?: string): string {
  const wsBase = BASE_URL.replace(/^https?:\/\//, (match) =>
    match === "https://" ? "wss://" : "ws://"
  );
  const params = new URLSearchParams({ userId });
  if (token) params.set("token", token);
  return `${wsBase}/api/ws/notifications?${params.toString()}`;
}

type EventHandler = (...args: any[]) => void;

class SocketService {
  private static instance: SocketService | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private _connected = false;
  private _userId: string | null = null;
  private _token: string | null = null;
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;

  static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  get connected(): boolean {
    return this._connected;
  }

  get userId(): string | null {
    return this._userId;
  }

  // ─── Connection Management ────────────────────────────────────────────────

  connect(userId: string, token?: string): void {
    if (this._connected && this._userId === userId) return;
    this._userId = userId;
    if (token) this._token = token;
    this._openWebSocket(userId);
  }

  private _openWebSocket(userId: string): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    try {
      const url = getWsUrl(userId, this._token ?? undefined);
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        this.emit(SocketEvents.CONNECT, { userId });
        this.startHeartbeat();
        console.log("[Socket] Connected to NotificationHub as", userId);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(typeof event.data === "string" ? event.data : "{}");
          this._handleServerMessage(msg);
        } catch {}
      };

      ws.onerror = (err) => {
        console.warn("[Socket] WebSocket error:", err);
      };

      ws.onclose = () => {
        this._connected = false;
        this.ws = null;
        this.stopHeartbeat();
        this.emit(SocketEvents.DISCONNECT, {});
        if (this._userId) this._scheduleReconnect();
      };
    } catch (err) {
      console.warn("[Socket] WebSocket open failed:", err);
      this._scheduleReconnect();
    }
  }

  private _handleServerMessage(msg: any): void {
    if (!msg?.type) return;

    switch (msg.type) {
      case "incoming_call":
        this.emit(SocketEvents.CALL_INCOMING, {
          callId: msg.session_id,
          sessionId: msg.session_id,
          type: msg.call_type ?? "audio",
          callerId: msg.caller_id,
          callerName: msg.caller_name ?? "Caller",
          callerAvatar: msg.caller_avatar ?? undefined,
          timestamp: Date.now(),
        });
        break;
      // Fix H1: handle call_accepted and call_declined from backend
      case "call_accepted":
        this.emit(SocketEvents.CALL_ACCEPT, {
          sessionId: msg.session_id,
          startedAt: msg.started_at ?? null, // Unix seconds from server — use to sync billing timer
          timestamp: Date.now(),
        });
        break;
      case "call_declined":
        this.emit(SocketEvents.CALL_REJECT, {
          sessionId: msg.session_id,
          timestamp: Date.now(),
        });
        break;
      // Fix NEW-1 + NEW-2: remote party ended or cancelled — dismiss our screen
      case "call_ended":
        this.emit(SocketEvents.CALL_END, {
          sessionId: msg.session_id,
          timestamp: Date.now(),
        });
        break;
      case "message":
      case "chat_message":
        this.emit(SocketEvents.MESSAGE_RECEIVED, {
          chatId: msg.room_id ?? msg.chat_id,
          id: msg.id ?? `msg_${Date.now()}`,
          senderName: msg.sender_name ?? "User",
          text: msg.content ?? msg.text ?? "",
          timestamp: msg.timestamp ?? Date.now(),
        });
        break;
      case "coin_update":
        this.emit(SocketEvents.COIN_DEDUCTED, {
          amount: msg.amount ?? 0,
          newBalance: msg.new_balance ?? 0,
          timestamp: Date.now(),
        });
        break;
      case "peer_tracks_ready":
        this.emit(SocketEvents.PEER_TRACKS_READY, {
          sessionId: msg.session_id,
          timestamp: Date.now(),
        });
        break;
      case "presence":
        this.emit(SocketEvents.PRESENCE_UPDATE, {
          userId: msg.user_id,
          isOnline: msg.is_online ?? false,
          timestamp: Date.now(),
        });
        break;
      default:
        break;
    }
  }

  disconnect(): void {
    this._userId = null;
    this._connected = false;
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.emit(SocketEvents.DISCONNECT, {});
    console.log("[Socket] Disconnected");
  }

  private _scheduleReconnect(): void {
    if (!this._userId) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("[Socket] Max reconnect attempts reached — will retry in 5 minutes");
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectAttempts = 0;
        if (this._userId) this._openWebSocket(this._userId);
      }, 5 * 60 * 1000);
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[Socket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => {
      if (this._userId) this._openWebSocket(this._userId);
    }, delay);
  }

  reconnect(): void {
    if (this._connected) return;
    if (this._userId) this._openWebSocket(this._userId);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this._connected || !this.ws) {
        this.stopHeartbeat();
        return;
      }
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ping" }));
        }
      } catch {}
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // ─── Event Emitter ────────────────────────────────────────────────────────

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  once(event: string, handler: EventHandler): void {
    const wrapper: EventHandler = (...args) => {
      handler(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach((h) => {
      try { h(data); } catch (err) {
        console.warn("[Socket] Handler error:", event, err);
      }
    });
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  // ─── Dev/Test Simulation helpers ─────────────────────────────────────────

  simulateIncomingCall(hostName: string, hostAvatar: string, callType: "audio" | "video" = "audio"): void {
    setTimeout(() => {
      this.emit(SocketEvents.CALL_INCOMING, {
        callId: `call_${Date.now()}`,
        hostName,
        hostAvatar,
        type: callType,
        timestamp: Date.now(),
      });
    }, 3000);
  }

  simulateNewMessage(chatId: string, senderName: string, text: string): void {
    setTimeout(() => {
      this.emit(SocketEvents.MESSAGE_RECEIVED, {
        chatId,
        id: `msg_${Date.now()}`,
        senderName,
        text,
        timestamp: Date.now(),
      });
    }, 1500);
  }

  simulatePresenceChange(userId: string, isOnline: boolean): void {
    setTimeout(() => {
      this.emit(SocketEvents.PRESENCE_UPDATE, { userId, isOnline, timestamp: Date.now() });
    }, 500);
  }

  simulateCoinDeduct(amount: number, newBalance: number): void {
    this.emit(SocketEvents.COIN_DEDUCTED, { amount, newBalance, timestamp: Date.now() });
  }

  simulateHostStatusChange(hostId: string, status: "online" | "offline" | "busy"): void {
    this.emit(SocketEvents.HOST_STATUS_CHANGE, { hostId, status });
  }
}

export const socketService = SocketService.getInstance();
export default socketService;
