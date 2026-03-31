// VoxLink Route Constants
// Use these instead of raw string paths throughout the app

const Routes = {
  // Auth
  ONBOARDING: "/auth/onboarding",
  LOGIN: "/auth/login",
  REGISTER: "/auth/register",
  VERIFY_OTP: "/auth/verify-otp",
  FILL_PROFILE: "/auth/fill-profile",
  SELECT_GENDER: "/auth/select-gender",
  FORGOT_PASSWORD: "/auth/forgot-password",
  CREATE_PASSWORD: "/auth/create-password",

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
  OUTGOING_CALL: "/call/outgoing",
  INCOMING_CALL: "/call/incoming",
  AUDIO_CALL: "/call/audio-call",
  VIDEO_CALL: "/call/video-call",
  CALL_SUMMARY: "/call/summary",
  CALL_HISTORY: "/call/history",

  // Chat
  CHAT_ROOM: (id: string) => `/chat/${id}`,

  // Hosts
  HOST_PROFILE_PAGE: (id: string) => `/hosts/${id}`,
  ALL_HOSTS: "/hosts/all",
  HOST_REVIEWS: "/hosts/reviews",

  // Host Management
  HOST_DASHBOARD: "/host/dashboard",
  HOST_SETTINGS: "/host/settings",
  HOST_WITHDRAW: "/host/withdraw",

  // Payments
  PAYMENT_CHECKOUT: "/payment/checkout",
  PAYMENT_SUCCESS: "/payment/success",

  // Profile
  EDIT_PROFILE: "/profile/edit",

  // Info
  SEARCH_HOSTS: "/search-hosts",
  COIN_HISTORY: "/coin-history",
  NOTIFICATIONS: "/notifications",
  SETTINGS: "/settings",
  HELP_CENTER: "/help-center",
  LANGUAGE: "/language",
  PRIVACY: "/privacy",
  ABOUT: "/about",
  BECOME_HOST: "/become-host",
  BECOME_HOST_SUCCESS: "/become-host-success",
} as const;

export default Routes;
