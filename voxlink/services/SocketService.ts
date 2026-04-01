// VoxLink Socket Service
// Mock WebSocket layer — in production, swap this with socket.io-client
// All events mirror the real-time API contract exactly

import { SocketEvents } from "@/constants/events";

type EventHandler = (...args: any[]) => void;

class SocketService {
  private static instance: SocketService | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private _connected = false;
  private _userId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

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

  connect(userId: string): void {
    if (this._connected) return;
    this._userId = userId;

    // Simulate async connection
    setTimeout(() => {
      this._connected = true;
      this.reconnectAttempts = 0;
      this.emit(SocketEvents.CONNECT, { userId });
      this.startHeartbeat();
      console.log("[Socket] Connected as", userId);
    }, 300);
  }

  disconnect(): void {
    this._connected = false;
    this._userId = null;
    this.stopHeartbeat();
    this.emit(SocketEvents.DISCONNECT, {});
    console.log("[Socket] Disconnected");
  }

  reconnect(): void {
    if (this._connected) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("[Socket] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[Socket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      if (this._userId) this.connect(this._userId);
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this._connected) {
        this.stopHeartbeat();
        return;
      }
      // In production: send ping frame
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

  // ─── Mock Simulation Methods (for dev/testing) ───────────────────────────

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
