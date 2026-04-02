// VoxLink Socket Event Constants
// All real-time event names for the socket service

export const SocketEvents = {
  // Connection
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  RECONNECT: "reconnect",
  ERROR: "error",

  // Auth
  AUTH: "auth",
  AUTH_SUCCESS: "auth:success",
  AUTH_FAIL: "auth:fail",

  // User Presence
  USER_ONLINE: "user:online",
  USER_OFFLINE: "user:offline",
  PRESENCE_UPDATE: "presence:update",
  HOST_STATUS_CHANGE: "host:status_change",

  // Call Events
  CALL_INITIATE: "call:initiate",
  CALL_INCOMING: "call:incoming",
  CALL_ACCEPT: "call:accept",
  CALL_REJECT: "call:reject",
  CALL_END: "call:end",
  CALL_BUSY: "call:busy",
  CALL_TIMEOUT: "call:timeout",
  CALL_STATE_UPDATE: "call:state_update",
  CALL_DURATION_TICK: "call:duration_tick",
  CALL_COIN_DEDUCT: "call:coin_deduct",
  CALL_LOW_COINS: "call:low_coins",

  // Chat Events
  MESSAGE_SEND: "message:send",
  MESSAGE_RECEIVED: "message:received",
  MESSAGE_DELIVERED: "message:delivered",
  MESSAGE_READ: "message:read",
  MESSAGE_TYPING: "message:typing",
  MESSAGE_TYPING_STOP: "message:typing_stop",
  CHAT_HISTORY: "chat:history",

  // Notification Events
  NOTIFICATION_NEW: "notification:new",
  NOTIFICATION_READ: "notification:read",
  NOTIFICATION_CLEAR_ALL: "notification:clear_all",

  // Coin Events
  COIN_BALANCE_UPDATE: "coin:balance_update",
  COIN_PURCHASE_SUCCESS: "coin:purchase_success",
  COIN_DEDUCTED: "coin:deducted",

  // Host Events
  HOST_EARNINGS_UPDATE: "host:earnings_update",
  HOST_REVIEW_NEW: "host:review_new",
  HOST_STATS_UPDATE: "host:stats_update",

  // System
  MAINTENANCE: "system:maintenance",
  VERSION_CHECK: "system:version_check",
  FORCE_LOGOUT: "system:force_logout",
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
