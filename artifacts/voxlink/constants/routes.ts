// VoxLink Route Constants
// Use these instead of raw string paths throughout the app

const Routes = {
  // Auth
  ONBOARDING: "/shared/auth/onboarding",
  LOGIN: "/user/auth/login",
  REGISTER: "/user/auth/register",
  VERIFY_OTP: "/user/auth/verify-otp",
  FILL_PROFILE: "/user/auth/fill-profile",
  SELECT_GENDER: "/user/auth/select-gender",
  FORGOT_PASSWORD: "/user/auth/forgot-password",
  CREATE_PASSWORD: "/user/auth/create-password",

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
  OUTGOING_CALL: "/shared/call/outgoing",
  INCOMING_CALL: "/shared/call/incoming",
  AUDIO_CALL: "/shared/call/audio-call",
  VIDEO_CALL: "/shared/call/video-call",
  CALL_SUMMARY: "/shared/call/summary",
  CALL_HISTORY: "/shared/call/history",

  // Chat
  CHAT_ROOM: (id: string) => `/shared/chat/${id}`,

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
  SEARCH_HOSTS: "/shared/search-hosts",
  COIN_HISTORY: "/shared/coin-history",
  NOTIFICATIONS: "/shared/notifications",
  SETTINGS: "/shared/settings",
  HELP_CENTER: "/shared/help-center",
  LANGUAGE: "/shared/language",
  PRIVACY: "/shared/privacy",
  ABOUT: "/shared/about",
  BECOME_HOST: "/shared/become-host",
  BECOME_HOST_SUCCESS: "/shared/become-host-success",
} as const;

export default Routes;
