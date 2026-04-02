const Routes = {
  // Auth (Host-specific 5-step flow)
  LOGIN: "/auth/login",
  REGISTER: "/auth/register",
  BECOME_HOST: "/auth/become",
  PROFILE_SETUP: "/auth/profile-setup",
  KYC: "/auth/kyc",
  HOST_STATUS: "/auth/status",

  // Main Tabs (Host Dashboard)
  HOME: "/(tabs)/",
  CHAT: "/(tabs)/chat",
  CALLS: "/(tabs)/calls",
  WALLET: "/(tabs)/wallet",
  PROFILE: "/(tabs)/profile",

  // Call Screens
  INCOMING_CALL: "/calls/incoming",
  AUDIO_CALL: "/calls/audio-call",
  VIDEO_CALL: "/calls/video-call",
  CALL_SUMMARY: "/calls/summary",
  CALL_HISTORY: "/calls/history",

  // Chat
  CHAT_ROOM: (id: string) => `/chat/${id}`,

  // Other Screens
  NOTIFICATIONS: "/notifications",
  SETTINGS: "/settings",
} as const;

export default Routes;
