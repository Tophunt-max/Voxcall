const Routes = {
  // Auth (Host-specific 5-step flow)
  ONBOARDING: "/auth/onboarding",
  LOGIN: "/auth/login",
  REGISTER: "/auth/register",
  FORGOT_PASSWORD: "/auth/forgot-password",
  PROFILE_SETUP: "/auth/profile-setup",
  BECOME_HOST: "/auth/become",
  KYC: "/auth/kyc",
  HOST_STATUS: "/auth/status",

  // Main Tabs (Host Dashboard)
  HOME: "/(tabs)/",
  CHAT: "/(tabs)/chat",
  CALLS: "/(tabs)/calls",
  WALLET: "/(tabs)/wallet",
  PROFILE: "/(tabs)/profile",

  // Call Screens
  OUTGOING_CALL: "/calls/outgoing",
  INCOMING_CALL: "/calls/incoming",
  AUDIO_CALL: "/calls/audio-call",
  VIDEO_CALL: "/calls/video-call",
  CALL_SUMMARY: "/calls/summary",
  CALL_HISTORY: "/calls/history",

  // Chat
  CHAT_ROOM: (id: string) => `/chat/${id}`,

  // Profile
  EDIT_PROFILE: "/profile/edit",

  // Info / Utility
  NOTIFICATIONS: "/notifications",
  SETTINGS: "/settings",
  EARNINGS_HISTORY: "/earnings-history",
  REFERRAL: "/referral",
  HELP_CENTER: "/help-center",
  LANGUAGE: "/language",
  PRIVACY: "/privacy",
  ABOUT: "/about",
} as const;

export default Routes;
