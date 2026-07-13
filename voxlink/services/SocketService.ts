// VoxLink Socket Service
// Connects to backend NotificationHub Durable Object for real-time events
// Falls back to event emitter only when WebSocket is unavailable

import { SocketEvents } from "@/constants/events";
import { refreshAuthToken } from "@/services/api";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://voxlink-api.ssunilkumarmohanta3.workers.dev";

// FIX (#5): the JWT is NOT placed in the URL anymore — it now rides in the
// Sec-WebSocket-Protocol header (see _openWebSocket) so it can't leak into
// request logs / proxies / history. userId stays in the query (not secret;
// the server cross-checks it against the verified token's subject).
function getWsUrl(userId: string): string {
  const wsBase = BASE_URL.replace(/^https?:\/\//, (match: string) =>
    match === "https://" ? "wss://" : "ws://"
  );
  const params = new URLSearchParams({ userId });
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
  // ─── Token-expiry refresh signal ───────────────────────────────────────────
  // The server rejects WebSocket upgrades with HTTP 401 when the JWT in the
  // querystring is invalid/expired. Browsers and RN do NOT surface the 401
  // status to JS — `onopen` simply never fires and `onclose` arrives with the
  // generic 1006 "abnormal closure" code that's also used for plain network
  // failures. We therefore use "did we ever see onopen since the last connect
  // attempt?" as the auth-failure signal: a close-without-open is treated as
  // a likely auth failure and triggers a one-shot token refresh + reconnect.
  // The refresh is single-flight (shared Promise with api.ts so a REST 401
  // racing a failed WS upgrade only fires one /api/auth/refresh request).
  private _didOpenThisAttempt = false;
  private _authRefreshAttempted = false;

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
    // Re-arm the auth-refresh attempt: a fresh `connect` call usually means
    // the AuthContext just installed a new token (login / refresh elsewhere)
    // and we want to be willing to try refreshing once again next time the
    // WS upgrade gets rejected.
    this._authRefreshAttempted = false;
    this._openWebSocket(userId);
  }

  private _openWebSocket(userId: string): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    // Reset the per-attempt open flag so onclose can distinguish "connection
    // dropped after handshake" (likely network) from "connection never
    // opened" (likely auth).
    this._didOpenThisAttempt = false;

    try {
      const url = getWsUrl(userId);
      // FIX (#5): pass the JWT as a subprotocol instead of in the URL. The
      // server reads ["jwt", "<token>"] from Sec-WebSocket-Protocol and echoes
      // "jwt" back on the 101 handshake. Falls back to a plain connection if no
      // token (which the server will then reject — as before).
      const authToken = this._token ?? undefined;
      const ws = authToken ? new WebSocket(url, ["jwt", authToken]) : new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this._connected = true;
        this._didOpenThisAttempt = true;
        // Successful open proves the token is valid right now — re-arm the
        // refresh attempt so a future expiry can recover via refresh again.
        this._authRefreshAttempted = false;
        this.reconnectAttempts = 0;
        this.emit(SocketEvents.CONNECT, { userId });
        this.startHeartbeat();
        console.log("[Socket] Connected to NotificationHub as", userId);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(typeof event.data === "string" ? event.data : "{}");
          this._handleServerMessage(msg);
        } catch (e) {
          console.warn("[Socket] Failed to parse/handle server message:", e);
        }
      };

      ws.onerror = (err) => {
        console.warn("[Socket] WebSocket error:", err);
      };

      ws.onclose = () => {
        this._connected = false;
        this.ws = null;
        this.stopHeartbeat();
        this.emit(SocketEvents.DISCONNECT, {});
        if (!this._userId) return;

        // Auth-failure heuristic: if we never saw `onopen` AND we haven't
        // already tried refreshing in this auth-fail burst, attempt a single
        // token refresh. On success we update _token and reconnect
        // immediately. On failure we fall through to the normal exponential
        // backoff and let api.ts's REST 401 path drive the user to re-login.
        if (!this._didOpenThisAttempt && !this._authRefreshAttempted) {
          this._authRefreshAttempted = true;
          void this._refreshTokenAndReconnect();
          return;
        }

        this._scheduleReconnect();
      };
    } catch (err) {
      console.warn("[Socket] WebSocket open failed:", err);
      this._scheduleReconnect();
    }
  }

  private async _refreshTokenAndReconnect(): Promise<void> {
    try {
      const newToken = await refreshAuthToken();
      if (newToken && this._userId) {
        this._token = newToken;
        console.log("[Socket] Token refreshed after auth-fail close, reconnecting");
        this._openWebSocket(this._userId);
        return;
      }
      console.warn("[Socket] Token refresh failed after auth-fail close — will fall back to backoff");
    } catch (e) {
      console.warn("[Socket] Token refresh threw:", e);
    }
    if (this._userId) this._scheduleReconnect();
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
          // FIX: forward rate + max_seconds when present (server now includes them)
          coinsPerMinute: msg.rate_per_minute,
          maxSeconds: msg.max_seconds,
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
      case "call_low_balance":
        // Server's heartbeat detected the caller has < N seconds of coins
        // left. Drives the mid-call top-up modal in the user app — listener
        // is wired up in app/_layout.tsx (AppBridge).
        this.emit(SocketEvents.CALL_LOW_BALANCE, {
          sessionId: msg.session_id,
          remainingSeconds: msg.remaining_seconds,
          ratePerMinute: msg.rate_per_minute,
          timestamp: Date.now(),
        });
        break;
      case "message":
      case "chat_message":
        this.emit(SocketEvents.MESSAGE_RECEIVED, {
          chatId: msg.room_id ?? msg.chat_id,
          id: msg.id ?? `msg_${Date.now()}`,
          senderId: msg.sender_id,
          senderName: msg.sender_name ?? "User",
          text: msg.content ?? msg.text ?? "",
          mediaUrl: msg.media_url ?? null,
          mediaType: msg.media_type ?? null,
          // Gift metadata (present only for gift messages) so the chat can
          // render a gift bubble instantly instead of dropping to plain text.
          kind: msg.msg_kind ?? null,
          giftIcon: msg.gift_icon ?? null,
          giftName: msg.gift_name ?? null,
          giftAmount: msg.gift_amount ?? null,
          timestamp: msg.created_at ? msg.created_at * 1000 : (msg.timestamp ?? Date.now()),
        });
        break;
      case "chat_read":
        // The other party opened the thread and read our messages — flip our
        // sent bubbles to "Seen".
        this.emit(SocketEvents.MESSAGE_READ, {
          roomId: msg.room_id,
          readerId: msg.reader_id,
          timestamp: Date.now(),
        });
        break;
      case "chat_message_edited":
        this.emit(SocketEvents.MESSAGE_EDITED, {
          roomId: msg.room_id,
          id: msg.id,
          content: msg.content ?? "",
          editedAt: msg.edited_at ? msg.edited_at * 1000 : Date.now(),
        });
        break;
      case "chat_message_deleted":
        this.emit(SocketEvents.MESSAGE_DELETED, {
          roomId: msg.room_id,
          id: msg.id,
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
      case "peer_media_state":
        this.emit(SocketEvents.PEER_MEDIA_STATE, {
          sessionId: msg.session_id,
          audio: msg.audio !== false, // true = remote mic on (unmuted)
          video: msg.video !== false, // true = remote camera on
          timestamp: Date.now(),
        });
        break;
      case "call_gift":
        this.emit(SocketEvents.CALL_GIFT, {
          sessionId: msg.session_id,
          roomId: msg.room_id,
          senderName: msg.sender_name ?? "Someone",
          giftIcon: msg.gift_icon ?? "🎁",
          giftName: msg.gift_name ?? "Gift",
          giftAmount: msg.gift_amount ?? 0,
          timestamp: Date.now(),
        });
        break;
      case "presence":
        this.emit(SocketEvents.PRESENCE_UPDATE, {
          userId: msg.user_id,
          hostId: msg.host_id,      // FIX: hosts.id (PK) — user app cache match ke liye
          isOnline: msg.is_online ?? false,
          timestamp: Date.now(),
        });
        break;
      case "chat_typing":
        // Ephemeral typing relay from chat.post('/rooms/:id/typing'). We
        // re-route through MESSAGE_TYPING / MESSAGE_TYPING_STOP so consumers
        // can subscribe by intent rather than payload-shape.
        this.emit(
          msg.is_typing ? SocketEvents.MESSAGE_TYPING : SocketEvents.MESSAGE_TYPING_STOP,
          {
            roomId: msg.room_id,
            userId: msg.user_id,
            senderName: msg.sender_name ?? "",
            isTyping: !!msg.is_typing,
            timestamp: Date.now(),
          }
        );
        break;
      case "app_settings_update":
        // REAL-TIME COIN VALUE UPDATE
        // Admin changed coin_to_usd_rate or call rates - update immediately
        // without requiring app refresh. The useAppConfig hook listens for this.
        this.emit(SocketEvents.APP_SETTINGS_UPDATE, {
          settings: msg.settings ?? {},
          critical: msg.critical ?? false, // True when coin value changed
          timestamp: Date.now(),
        });
        // Also update the useAppConfig cache directly for immediate effect
        import("@/hooks/useAppConfig").then(({ updateConfigCache }) => {
          updateConfigCache(msg.settings ?? {});
        }).catch((e) => {
          console.warn("[Socket] Failed to update config cache:", e);
        });
        break;
      case "data_changed":
        // REAL-TIME CATALOG UPDATE
        // Admin added/edited/deleted a catalog (coin plans, gifts, banners,
        // talk topics, rewards, payment methods, …). Forward the resource name
        // so listeners (AppBridge) can invalidate the matching query and open
        // screens refresh instantly — no re-open required.
        this.emit(SocketEvents.DATA_CHANGED, {
          resource: msg.resource ?? "",
          timestamp: Date.now(),
        });
        break;
      case "notification_new":
        // A new in-app notification was created for this user — deliver it live
        // so the notifications list + unread badge update without a refetch.
        this.emit(SocketEvents.NOTIFICATION_NEW, {
          notification: msg.notification ?? null,
          timestamp: Date.now(),
        });
        break;
      case "account_banned":
        // Admin banned/suspended this account — raise the blocking ban popup
        // instantly (no logout). Reason + expiry drive the popup text.
        import("@/services/banState").then(({ setBanState }) => {
          setBanState({ reason: msg.reason ?? null, expires_at: msg.expires_at ?? null });
        }).catch(() => {});
        break;
      case "account_unbanned":
        // Ban lifted — dismiss the popup.
        import("@/services/banState").then(({ setBanState }) => setBanState(null)).catch(() => {});
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
      } catch (e) {
        console.warn("[Socket] Heartbeat send failed:", e);
      }
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
}

export const socketService = SocketService.getInstance();
export default socketService;
