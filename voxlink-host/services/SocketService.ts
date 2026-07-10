// VoxLink Socket Service
// Connects to backend NotificationHub Durable Object for real-time events
// Falls back to event emitter only when WebSocket is unavailable

import { SocketEvents } from "@/constants/events";
import { refreshAuthToken } from "@/services/api";
import { API_BASE_URL } from "@/constants/config";

const BASE_URL = API_BASE_URL;

function getWsUrl(userId: string): string {
  const wsBase = BASE_URL.replace(/^https?:\/\//, (match: string) =>
    match === "https://" ? "wss://" : "ws://"
  );
  // FIX (#5): the JWT is NOT placed in the URL anymore — it now rides in the
  // Sec-WebSocket-Protocol header (see _openWebSocket) so it can't leak into
  // request logs / proxies / history. userId stays in the query (not secret;
  // the server cross-checks it against the verified token's subject).
  const params = new URLSearchParams({ userId });
  return `${wsBase}/api/ws/notifications?${params.toString()}`;
}

type EventHandler = (...args: any[]) => void;

class SocketService {
  private static instance: SocketService | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private _connected = false;
  private _userId: string | null = null;
  private _token: string | undefined = undefined;
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  // FIX #16: Increased from 8 to 50 to match user app — hosts on poor networks
  // need many more retries so they don't miss incoming calls
  private maxReconnectAttempts = 50;
  // ─── Token-expiry refresh signal ───────────────────────────────────────────
  // Mirrors the user-app SocketService. Server rejects WS upgrades with HTTP
  // 401 when the JWT in the querystring is invalid/expired; browsers and RN
  // surface this only as `onclose` with code 1006, indistinguishable from a
  // network drop. We use "did we ever see onopen since the last connect
  // attempt?" as the auth-failure heuristic to fire a one-shot token refresh
  // before falling back to exponential reconnect backoff. The refresh is
  // single-flight via api.ts's shared Promise so a REST 401 racing a failed
  // WS upgrade only issues one /api/auth/refresh request.
  private _didOpenThisAttempt = false;
  private _authRefreshAttempted = false;
  // Zombie-socket watchdog: a WebSocket can sit in readyState OPEN long after
  // the underlying connection is dead (TCP half-open) — `send()` won't throw
  // and `onclose` may not fire for minutes, during which a host SILENTLY MISSES
  // INCOMING CALLS. The server's NotificationHub replies to our `ping` with a
  // `pong`, so any live connection sees inbound traffic every heartbeat cycle.
  // We track the last inbound activity and, if nothing arrives within
  // WATCHDOG_MS (~2.5 missed cycles), treat the socket as dead and force a
  // reconnect. A genuinely-idle-but-alive connection still receives pongs, so
  // this never false-positives.
  private _lastActivityAt = 0;
  private static readonly HEARTBEAT_MS = 30000;
  private static readonly WATCHDOG_MS = 75000;

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
    this._token = token;
    // Re-arm the auth-refresh attempt: a fresh `connect` call usually means
    // the AuthContext just installed a new token and we want to be willing
    // to try refreshing once again next time the WS upgrade gets rejected.
    this._authRefreshAttempted = false;
    this._openWebSocket(userId, token);
  }

  private _openWebSocket(userId: string, token?: string): void {
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
      const authToken = token ?? this._token;
      const ws = authToken ? new WebSocket(url, ["jwt", authToken]) : new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this._connected = true;
        this._didOpenThisAttempt = true;
        this._lastActivityAt = Date.now();
        // Successful open proves the token is valid right now — re-arm the
        // refresh attempt so a future expiry can recover via refresh again.
        this._authRefreshAttempted = false;
        this.reconnectAttempts = 0;
        this.emit(SocketEvents.CONNECT, { userId });
        this.startHeartbeat();
        console.log("[Socket] Connected to NotificationHub as", userId);
      };

      ws.onmessage = (event) => {
        // Any inbound frame (including the server's `pong`) proves liveness.
        this._lastActivityAt = Date.now();
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
        this._openWebSocket(this._userId, newToken);
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
          coinsPerMinute: msg.rate_per_minute,
          // FIX: server now sends max_seconds — propagate it so the host call
          // timer has a real upper bound (no UI overshoot past caller's balance).
          maxSeconds: msg.max_seconds,
          timestamp: Date.now(),
        });
        break;
      // Fix H1: handle call_accepted and call_declined from backend
      case "call_accepted":
        this.emit(SocketEvents.CALL_ACCEPT, {
          sessionId: msg.session_id,
          startedAt: msg.started_at ?? null,
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
          senderId: msg.sender_id,
          senderName: msg.sender_name ?? "User",
          text: msg.content ?? msg.text ?? "",
          mediaUrl: msg.media_url ?? null,
          mediaType: msg.media_type ?? null,
          // Gift metadata (present only for gift messages).
          kind: msg.msg_kind ?? null,
          giftIcon: msg.gift_icon ?? null,
          giftName: msg.gift_name ?? null,
          giftAmount: msg.gift_amount ?? null,
          timestamp: msg.created_at ? msg.created_at * 1000 : (msg.timestamp ?? Date.now()),
        });
        break;
      case "chat_read":
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
      case "level_up":
        this.emit(SocketEvents.HOST_LEVEL_UP, {
          oldLevel: msg.old_level ?? 1,
          newLevel: msg.new_level ?? 1,
          levelName: msg.level_name ?? "",
          badge: msg.badge ?? "🎉",
          color: msg.color ?? "#A00AE7",
          coinsAwarded: msg.coins_awarded ?? 0,
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
      case "presence":
        this.emit(SocketEvents.PRESENCE_UPDATE, {
          userId: msg.user_id,
          hostId: msg.host_id,
          isOnline: msg.is_online ?? false,
          timestamp: Date.now(),
        });
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
      case "chat_typing":
        // BUG FIX: host app never handled the user's typing relay, so the host
        // chat header could not show "typing…". Re-route to MESSAGE_TYPING /
        // MESSAGE_TYPING_STOP (ChatContext listens and flips convo.isTyping).
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
      case "tip_received":
        // BUG FIX: backend pushed tip_received but no app handled it. Surface a
        // live toast + trigger earnings/balance refresh (AppBridge listens).
        this.emit(SocketEvents.TIP_RECEIVED, {
          amount: msg.amount ?? 0,
          senderName: msg.sender_name ?? "Someone",
          message: msg.message ?? null,
          timestamp: Date.now(),
        });
        break;
      case "review_received":
        // A user just rated this host — live toast + rating/profile refresh.
        this.emit(SocketEvents.REVIEW_RECEIVED, {
          stars: msg.stars ?? 0,
          comment: msg.comment ?? null,
          timestamp: Date.now(),
        });
        break;
      case "favorited":
        // A user added this host to favorites.
        this.emit(SocketEvents.FAVORITED, {
          byName: msg.by_name ?? "Someone",
          timestamp: Date.now(),
        });
        break;
      case "data_changed":
        // REAL-TIME CATALOG UPDATE
        // Admin added/edited/deleted a catalog (gifts, banners, rewards, level
        // config, …). Forward the resource so listeners (AppBridge) invalidate
        // the matching query and open screens refresh instantly.
        this.emit(SocketEvents.DATA_CHANGED, {
          resource: msg.resource ?? "",
          timestamp: Date.now(),
        });
        break;
      case "notification_new":
        // A new in-app notification for this host — deliver live so the list +
        // unread badge update without a refetch.
        this.emit(SocketEvents.NOTIFICATION_NEW, {
          notification: msg.notification ?? null,
          timestamp: Date.now(),
        });
        break;
      case "account_banned":
        // Admin banned/suspended this host — raise the blocking ban popup
        // instantly (no logout).
        import("@/services/banState").then(({ setBanState }) => {
          setBanState({ reason: msg.reason ?? null, expires_at: msg.expires_at ?? null });
        }).catch(() => {});
        break;
      case "account_unbanned":
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
      // FIX BUG-9: Don't permanently die — retry after 5 minutes.
      // Host app MUST stay connected to receive incoming calls.
      // Without this, hosts on poor networks stop receiving calls forever.
      console.warn("[Socket] Max reconnect attempts reached — will retry in 5 minutes");
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectAttempts = 0;
        if (this._userId) this._openWebSocket(this._userId, this._token);
      }, 5 * 60 * 1000);
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[Socket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => {
      if (this._userId) this._openWebSocket(this._userId, this._token);
    }, delay);
  }

  reconnect(): void {
    if (this._connected) return;
    if (this._userId) this._openWebSocket(this._userId, this._token);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this._connected || !this.ws) {
        this.stopHeartbeat();
        return;
      }
      // Zombie-socket watchdog: if no inbound frame (not even a pong) has
      // arrived within WATCHDOG_MS, the connection is dead despite a stale
      // OPEN readyState. Force-close it so onclose fires and we reconnect —
      // otherwise the host could miss incoming calls indefinitely.
      if (this._lastActivityAt && Date.now() - this._lastActivityAt > SocketService.WATCHDOG_MS) {
        console.warn("[Socket] Heartbeat watchdog: no pong — forcing reconnect");
        try { this.ws.close(); } catch {}
        // onclose handler will run stopHeartbeat() + scheduleReconnect().
        return;
      }
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ping" }));
        }
      } catch (e) {
        console.warn("[Socket] Heartbeat send failed:", e);
      }
    }, SocketService.HEARTBEAT_MS);
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
