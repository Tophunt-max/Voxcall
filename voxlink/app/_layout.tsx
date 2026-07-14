import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { configurePushNotifications } from "@/services/NotificationService";
import { onForegroundMessage } from "@/services/fcm";
import { logEngagement } from "@/services/engagement";
import { setupGlobalErrorHandler } from "@/services/ErrorReporter";
import { OtaUpdateGate } from "@/components/OtaUpdateGate";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer, showSuccessToast, showErrorToast, showInfoToast } from "@/components/Toast";
import { DialogHost } from "@/components/DialogHost";
import { OfflineBanner } from "@/components/OfflineBanner";
import MaintenanceGate from "@/components/MaintenanceGate";
import { BanGate } from "@/components/BanGate";
import DailyRewardModal from "@/components/DailyRewardModal";
import { useDailyStreak } from "@/hooks/useDailyStreak";
import { AuthProvider } from "@/context/AuthContext";
import { useAuth } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider, useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { useCall } from "@/context/CallContext";
import { useAppVersionGate } from "@/hooks/useAppVersionGate";

// RNFirebase messaging (native only) — lazy loaded to avoid web crash
let RNMessaging: any = null;
if (Platform.OS !== "web") {
  try { RNMessaging = require("@react-native-firebase/messaging").default; } catch {}
}

let KeyboardProvider: React.ComponentType<{ children: React.ReactNode }> | null = null;
if (Platform.OS !== "web") {
  try { KeyboardProvider = require("react-native-keyboard-controller").KeyboardProvider; } catch {}
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
      // Offline pe cached data dikhao — network nahi hai to request mat karo
      networkMode: "offlineFirst",
    },
  },
});

// ─── FCM Notification Tap Bridge (Native only) ───────────────────────────────
// Handles push notification taps using @react-native-firebase/messaging
// Deep-link map: notification `data.type` → the screen to open on tap.
const USER_NOTIF_ROUTE: Record<string, string> = {
  deposit: "/user/coin-history",
  payout: "/user/coin-history",
  referral: "/user/referral",
  support: "/user/help-center",
  vip_expiring: "/user/vip",
  host_application: "/user/notifications",
  system: "/user/notifications",
  free_spin: "/user/rewards-spin",
  profile_completion: "/user/profile/edit",
  reward: "/user/rewards",
  happy_hour: "/user/payment/checkout",
  promo_bonus: "/user/coin-history",
  comeback: "/user/screens/home",
  online_hosts: "/user/screens/home",
};

function FCMNotificationTapBridge() {
  const { receiveCall, activeCall } = useCall();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!RNMessaging) return;

    function handleNotificationData(data: Record<string, any>) {
      if (!data) return;
      const ntype = String(data.type ?? "");
      // CTR metric — a tapped push is an "open" (skip live call pushes which
      // aren't really "notifications" the user browses).
      if (ntype && ntype !== "incoming_call") {
        try { logEngagement({ type: "notif_open", surface: ntype }); } catch {}
      }
      if (data.type === "incoming_call") {
        // receiveCall in user's CallContext already calls router.push("/user/call/incoming")
        // internally — do NOT push separately or the screen gets pushed twice onto the stack.
        // If there is already an active call, ignore the tap entirely (cannot accept two calls).
        if (!activeCall) {
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "host" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/user/chat/[id]", params: { id: String(data.room_id) } });
      } else if (ntype === "favorite_online" && data.host_id) {
        // Favorite host is online → open their profile so the user can call.
        router.push({ pathname: "/user/hosts/[id]", params: { id: String(data.host_id) } });
      } else {
        // All other notification types → deep-link to the relevant screen
        // (falls back to the notifications list for unknown types).
        const route = USER_NOTIF_ROUTE[ntype] ?? "/user/notifications";
        router.push(route as any);
      }
    }

    // App in background → tapped notification
    const unsubBackground = RNMessaging().onNotificationOpenedApp((msg: any) => {
      handleNotificationData(msg?.data ?? {});
    });

    // App was quit → opened via notification
    RNMessaging().getInitialNotification().then((msg: any) => {
      if (msg) handleNotificationData(msg?.data ?? {});
    });

    // Foreground message → the in-app TOAST is shown by AppBridge's
    // NOTIFICATION_NEW handler (WebSocket), so here we only refresh the unread
    // badge as a fallback when the socket is momentarily disconnected. No toast
    // here on purpose — avoids a double toast when both channels deliver.
    const unsubForeground = onForegroundMessage(({ title, body, data }) => {
      if (__DEV__) console.log("[FCM Foreground]", title, body, data);
      queryClient.invalidateQueries({ queryKey: ["notif-unread"] });
    });

    return () => {
      unsubBackground();
      if (typeof unsubForeground === "function") unsubForeground();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ─── Web FCM Notification Click Bridge ──────────────────────────────────────
// Listens for notification clicks forwarded from the Service Worker
function WebNotificationBridge() {
  const { receiveCall, activeCall } = useCall();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "NOTIFICATION_CLICK") return;
      const data = event.data?.data ?? {};
      if (data.type === "incoming_call") {
        // receiveCall in user's CallContext already navigates to /user/call/incoming
        // internally. Do NOT push separately — that would create a duplicate stack entry.
        if (!activeCall) {
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "host" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/user/chat/[id]", params: { id: String(data.room_id) } });
      }
    }

    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ─── Daily Reward Gate ──────────────────────────────────────────────────────
// Auto-shows the Daily Reward modal once per app session when:
//   - the user is logged in,
//   - the streak feature is enabled by admin,
//   - can_claim_now is true (i.e. fresh IST day, not yet claimed).
//
// Tapping "Later" sets `dismissed = true` for the rest of the session so we
// don't nag. After a successful claim the modal stays open in CELEBRATE mode
// until the user taps "Awesome!" to dismiss. Foreground-resume after a fresh
// IST midnight re-runs the auto-show via the hook's AppState listener +
// fresh `can_claim_now` flip.
function DailyRewardGate() {
  const { isLoggedIn } = useAuth();
  const { status, claiming, lastClaim, claim, dismissCelebration, repairing, repair } = useDailyStreak();
  const [visible, setVisible] = React.useState(false);
  const sessionDismissed = React.useRef(false);

  // Auto-open once per session when the server says "you can claim" OR the
  // user's streak lapsed and can still be repaired (streak-saver prompt).
  React.useEffect(() => {
    if (!isLoggedIn) return;
    if (!status?.enabled) return;
    if (sessionDismissed.current) return;
    if (visible) return;
    if (status.can_claim_now || status.can_repair) setVisible(true);
  }, [isLoggedIn, status?.enabled, status?.can_claim_now, status?.can_repair, visible]);

  // Reset session-dismissed when the user logs out so the next account that
  // logs in on the same device gets its own auto-prompt.
  React.useEffect(() => {
    if (!isLoggedIn) {
      sessionDismissed.current = false;
      setVisible(false);
    }
  }, [isLoggedIn]);

  const handleClose = React.useCallback(() => {
    sessionDismissed.current = true;
    setVisible(false);
    // Clearing the celebration state ensures next open (rare same-session
    // open via a future "show daily reward" deep-link) starts on the
    // claimable view, not still showing the previous celebration.
    dismissCelebration();
  }, [dismissCelebration]);

  const handleClaim = React.useCallback(async () => {
    await claim();
    // Modal stays open in CELEBRATE mode (driven by lastClaim). User
    // taps "Awesome!" to close — handled by handleClose above.
  }, [claim]);

  const handleRepair = React.useCallback(async () => {
    await repair();
    // After a successful repair the hook refreshes status (can_repair → false,
    // streak restored), so the modal flips to the normal claimable view.
  }, [repair]);

  if (!status) return null;
  return (
    <DailyRewardModal
      visible={visible}
      status={status}
      lastClaim={lastClaim}
      claiming={claiming}
      onClaim={handleClaim}
      onClose={handleClose}
      repairing={repairing}
      onRepair={handleRepair}
    />
  );
}

// ─── AppBridge ───────────────────────────────────────────────────────────────
// WebSocket CALL_INCOMING → CallContext (all platforms)
// NOTE: CALL_END is intentionally NOT handled here — audio-call.tsx and
// video-call.tsx already handle it with webrtc.cleanup(). Handling it here
// too causes a double-endCall race where the summary screen gets immediately
// popped by the second router.back().
// FCM tap handlers (native + web)
// Maps a broadcasted `resource` to the react-query keys that cache it, so an
// admin catalog change instantly invalidates the matching screens. Keys use
// react-query prefix matching (e.g. ["banners"] also invalidates
// ["banners","home"]). Resources not backed by react-query (coin plans, gifts,
// payment methods) are refreshed on-screen via their own DATA_CHANGED listeners
// / focus-refetch, and also emit the DATA_CHANGED app event handled below.
const CATALOG_QUERY_KEYS: Record<string, (string | number)[][]> = {
  talk_topics: [["talk-topics"]],
  banners: [["banners"]],
  level_config: [["host-level"]],
  // Admin edited a host (rates / active / verified / level) — refresh the
  // browse lists and any open host detail. ["host"] prefix also matches
  // ["host", id]; ["hosts"] matches the paged browse query.
  hosts: [["hosts"], ["host"], ["recommended-hosts"], ["favorite-hosts"]],
};

function AppBridge() {
  const { receiveCall, activeCall } = useCall();
  const { updateCoins } = useAuth();
  const queryClient = useQueryClient();

  // Real-time catalog updates — admin add/edit/delete reflects immediately.
  useSocketEvent(
    SocketEvents.DATA_CHANGED,
    (data: any) => {
      const resource: string = data?.resource ?? "";
      // Host application approved — the host experience lives in the separate
      // Host app, so surface a live celebratory toast pointing them there.
      if (resource === "role") {
        showSuccessToast("🎉 Your host application is approved! Open the VoxLink Host app to go online and start earning.");
        return;
      }
      const keys = CATALOG_QUERY_KEYS[resource];
      if (keys) {
        keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      }
    },
    [queryClient]
  );

  // Real-time in-app notification — show a toast + bump the unread badge live.
  // Pick the toast style from the notification content so a FAILED recharge /
  // rejected deposit shows a RED error toast (not a green success one), and a
  // "pending / under review" shows a neutral info toast.
  useSocketEvent(
    SocketEvents.NOTIFICATION_NEW,
    (data: any) => {
      const n = data?.notification;
      if (n?.title) {
        const msg = n.body ? `${n.title} — ${n.body}` : n.title;
        const status = n?.data?.status;
        const failed = status === 'rejected' || status === 'failed' || status === 'cancelled' ||
          /failed|cancelled|could not|not credited|rejected/i.test(String(n.body ?? '') + String(n.title ?? ''));
        const pending = status === 'pending' || status === 'verifying' ||
          /under review|pending|being verified/i.test(String(n.body ?? ''));
        if (failed) showErrorToast(msg);
        else if (pending) showInfoToast(msg);
        else showSuccessToast(msg);
      }
      queryClient.invalidateQueries({ queryKey: ["notif-unread"] });
      // Also refresh wallet balance in case a deposit just credited coins.
      queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    [queryClient]
  );

  useSocketEvent(
    SocketEvents.CALL_INCOMING,
    (data: any) => {
      if (activeCall) return;
      receiveCall(
        {
          id: data.callerId ?? data.caller_id ?? "",
          name: data.callerName ?? data.hostName ?? data.caller_name ?? "Caller",
          avatar: data.callerAvatar ?? data.hostAvatar,
          role: "user",
        },
        data.type ?? data.call_type ?? "audio",
        data.callId ?? data.sessionId ?? data.session_id ?? ""
      );
    },
    [activeCall]
  );

  // FIX: coin_update socket event aane par balance turant update karo
  // Backend /end endpoint ke baad coin_update bhejta hai
  useSocketEvent(
    SocketEvents.COIN_DEDUCTED,
    (data: any) => {
      if (data?.newBalance != null) {
        updateCoins(data.newBalance);
      }
    },
    [updateCoins]
  );

  return (
    <>
      {Platform.OS !== "web" && <FCMNotificationTapBridge />}
      {Platform.OS === "web" && <WebNotificationBridge />}
    </>
  );
}

function RootLayoutNav() {
  // Force-update gate. Fires once on app launch and shows a blocking
  // Alert if the running build is below the server-configured min version.
  useAppVersionGate('user');
  return (
    <>
      <AppBridge />
      <OtaUpdateGate />
      <DailyRewardGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />

        {/* User screens */}
        <Stack.Screen name="user/screens/home" />
        <Stack.Screen name="user/auth/login" />
        <Stack.Screen name="user/hosts/[id]" />
        <Stack.Screen name="user/hosts/all" />
        <Stack.Screen name="user/hosts/reviews" />
        <Stack.Screen name="user/payment/checkout" />
        <Stack.Screen name="user/payment/manual-qr" />
        <Stack.Screen name="user/payment/success" options={{ gestureEnabled: false }} />
        <Stack.Screen name="user/profile/edit" />

        {/* User utility screens */}
        <Stack.Screen name="user/auth/onboarding" />
        <Stack.Screen name="user/chat/[id]" />
        <Stack.Screen name="user/call/audio-call" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="user/call/video-call" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="user/call/incoming" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="user/call/outgoing" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="user/call/summary" />
        <Stack.Screen name="user/call/history" />
        <Stack.Screen name="user/notifications" />
        <Stack.Screen name="user/settings" />
        <Stack.Screen name="user/help-center" />
        <Stack.Screen name="user/language" />
        <Stack.Screen name="user/search-hosts" />
        <Stack.Screen name="user/coin-history" />
        <Stack.Screen name="user/privacy" />
        <Stack.Screen name="user/about" />
        <Stack.Screen name="user/referral" />
      </Stack>
      <ToastContainer />
      <OfflineBanner />
      <DialogHost />
      {/* Admin maintenance gate — renders LAST so it overlays everything when
          maintenance_mode is ON in the admin panel. */}
      <MaintenanceGate />
      {/* Blocking ban popup — overlays everything when the account is
          banned/suspended. Non-dismissable; no logout. */}
      <BanGate />
    </>
  );
}

// KeyboardProvider wrapper — skips on web to avoid native module crash
function MaybeKeyboardProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "web" || !KeyboardProvider) return <>{children}</>;
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  // On web skip the font-loading gate entirely — system fallback fonts render
  // immediately. Waiting can cause a permanent blank screen in a static export.
  const fontsReady = Platform.OS === "web" ? true : (fontsLoaded || !!fontError);

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  useEffect(() => {
    configurePushNotifications();
    setupGlobalErrorHandler();
  }, []);

  if (!fontsReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <MaybeKeyboardProvider>
              <LanguageProvider>
                <AuthProvider>
                  <SocketProvider>
                    <CallProvider>
                      <ChatProvider>
                        <RootLayoutNav />
                      </ChatProvider>
                    </CallProvider>
                  </SocketProvider>
                </AuthProvider>
              </LanguageProvider>
            </MaybeKeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
