// VoxLink Route Constants
// Use these instead of raw string paths throughout the app

const Routes = {
  // Auth
  ONBOARDING: "/user/auth/onboarding",
  LOGIN: "/user/auth/login",

  // User Tabs
  HOME: "/(tabs)/",
  SEARCH: "/(tabs)/search",
  MESSAGES: "/(tabs)/messages",
  WALLET: "/(tabs)/wallet",
  PROFILE: "/(tabs)/profile",

  // Host Tabs
  HOST_HOME: "/(host-tabs)/",
  HOST_CHAT: "/(host-tabs)/chat",
  HOST_NOTIFICATIONS: "/(host-tabs)/notifications",
  HOST_WALLET: "/(host-tabs)/wallet",
  HOST_PROFILE: "/(host-tabs)/profile",

  // Call
  OUTGOING_CALL: "/user/call/outgoing",
  INCOMING_CALL: "/user/call/incoming",
  AUDIO_CALL: "/user/call/audio-call",
  VIDEO_CALL: "/user/call/video-call",
  CALL_SUMMARY: "/user/call/summary",
  CALL_HISTORY: "/user/call/history",

  // Chat
  CHAT_ROOM: (id: string) => `/user/chat/${id}`,

  // Hosts
  HOST_PROFILE_PAGE: (id: string) => `/hosts/${id}`,
  ALL_HOSTS: "/user/hosts/all",
  HOST_REVIEWS: "/user/hosts/reviews",

  // Host Management
  HOST_DASHBOARD: "/host/host/dashboard",
  HOST_SETTINGS: "/host/host/settings",
  HOST_WITHDRAW: "/host/host/withdraw",

  // Payments
  PAYMENT_CHECKOUT: "/user/payment/checkout",
  PAYMENT_SUCCESS: "/user/payment/success",

  // Profile
  EDIT_PROFILE: "/user/profile/edit",

  // Info
  SEARCH_HOSTS: "/user/search-hosts",
  COIN_HISTORY: "/user/coin-history",
  NOTIFICATIONS: "/user/notifications",
  SETTINGS: "/user/settings",
  HELP_CENTER: "/user/help-center",
  LANGUAGE: "/user/language",
  PRIVACY: "/user/privacy",
  ABOUT: "/user/about",
  BECOME_HOST: "/user/become-host",
  BECOME_HOST_SUCCESS: "/user/become-host-success",
} as const;

export default Routes;
