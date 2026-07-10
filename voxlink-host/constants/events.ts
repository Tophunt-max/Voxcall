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
  PEER_TRACKS_READY: "webrtc:peer_tracks_ready",
  PEER_MEDIA_STATE: "webrtc:peer_media_state",

  // Chat Events
  MESSAGE_SEND: "message:send",
  MESSAGE_RECEIVED: "message:received",
  MESSAGE_DELIVERED: "message:delivered",
  MESSAGE_READ: "message:read",
  MESSAGE_TYPING: "message:typing",
  MESSAGE_TYPING_STOP: "message:typing_stop",
  MESSAGE_EDITED: "message:edited",
  MESSAGE_DELETED: "message:deleted",
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
  TIP_RECEIVED: "host:tip_received",
  REVIEW_RECEIVED: "host:review_received",
  FAVORITED: "host:favorited",
  HOST_REVIEW_NEW: "host:review_new",
  HOST_STATS_UPDATE: "host:stats_update",
  HOST_LEVEL_UP: "host:level_up",

  // System
  MAINTENANCE: "system:maintenance",
  VERSION_CHECK: "system:version_check",
  FORCE_LOGOUT: "system:force_logout",
  
  // Real-time Settings Updates
  // Broadcast when admin changes coin_to_usd_rate, call rates, etc.
  APP_SETTINGS_UPDATE: "app:settings_update",

  // Real-time Catalog Updates
  // Broadcast when admin adds/edits/deletes a catalog (gifts, banners, rewards,
  // level config, …). Carries { resource }. Listeners refetch / invalidate the
  // matching query so open screens update instantly without a re-open.
  DATA_CHANGED: "data:changed",
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
