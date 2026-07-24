import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { configurePushNotifications } from "@/services/NotificationService";
import { onForegroundMessage, setupBackgroundMessageHandler } from "@/services/fcm";
import { setupGlobalErrorHandler } from "@/services/ErrorReporter";
import { OtaUpdateGate } from "@/components/OtaUpdateGate";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadHostSettings, getHostSettingsSync } from "@/utils/hostSettings";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer, showSuccessToast } from "@/components/Toast";
import { OfflineBanner } from "@/components/OfflineBanner";
import MaintenanceGate from "@/components/MaintenanceGate";
import { BanGate } from "@/components/BanGate";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider, useSocketEvent, useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { useCall } from "@/context/CallContext";
import { useAuth } from "@/context/AuthContext";
import { API } from "@/services/api";
import { useAppVersionGate } from "@/hooks/useAppVersionGate";

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
      networkMode: "offlineFirst",
    },
  },
});

// Deep-link map: notification `data.type` → the host screen to open on tap.
const HOST_NOTIF_ROUTE: Record<string, string> = {
  support: "/help-center",
  host_application: "/notifications",
  payout: "/notifications",
  tip: "/notifications",
  review: "/notifications",
  favorite: "/notifications",
  system: "/notifications",
};

function FCMNotificationTapBridge({ seenCallIds, activeCallRef }: { seenCallIds: React.MutableRefObject<Set<string>>; activeCallRef: React.MutableRefObject<any> }) {
  const { receiveCall } = useCall();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!RNMessaging) return;

    function handleNotificationData(data: Record<string, any>) {
      if (!data) return;
      if (data.type === "incoming_call") {
        const callId = String(data.session_id ?? "");
        if (!activeCallRef.current && callId && !seenCallIds.current.has(callId)) {
          seenCallIds.current.add(callId);
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "user" },
            (data.call_type as "audio" | "video") ?? "audio",
            callId,
            // FIX: forward the host's per-minute rate + max_seconds so a call
            // opened via a push-notification tap gets a working balance-cap
            // auto-end and cost badge (parity with the socket/polling paths,
            // which pass host_earn_per_minute ?? rate_per_minute + max_seconds).
            data.host_earn_per_minute != null ? Number(data.host_earn_per_minute)
              : data.rate_per_minute != null ? Number(data.rate_per_minute) : undefined,
            data.max_seconds != null ? Number(data.max_seconds) : undefined
          );
          router.push("/calls/incoming");
        }
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/chat/[id]", params: { id: String(data.room_id) } });
      } else {
        const route = HOST_NOTIF_ROUTE[String(data.type ?? "")] ?? "/notifications";
        router.push(route as any);
      }
    }

    const unsubBackground = RNMessaging().onNotificationOpenedApp((msg: any) => {
      handleNotificationData(msg?.data ?? {});
    });

    RNMessaging().getInitialNotification().then((msg: any) => {
      if (msg) handleNotificationData(msg?.data ?? {});
    });

    const unsubForeground = onForegroundMessage(({ title, body, data }) => {
      // Don't log notification content in production (privacy + perf).
      if (__DEV__) console.log("[FCM Foreground]", title, body, data);
      // In-app toast is shown by AppBridge's NOTIFICATION_NEW (WebSocket); here
      // we only refresh the unread bell badge as a fallback. No toast (avoids
      // double toast when both channels deliver).
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    });

    setupBackgroundMessageHandler();

    return () => {
      unsubBackground();
      if (typeof unsubForeground === "function") unsubForeground();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function WebNotificationBridge({ seenCallIds, activeCallRef }: { seenCallIds: React.MutableRefObject<Set<string>>; activeCallRef: React.MutableRefObject<any> }) {
  const { receiveCall } = useCall();

  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;

    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== "NOTIFICATION_CLICK") return;
      const data = event.data?.data ?? {};
      if (data.type === "incoming_call") {
        const callId = String(data.session_id ?? "");
        if (!activeCallRef.current && callId && !seenCallIds.current.has(callId)) {
          seenCallIds.current.add(callId);
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "user" },
            (data.call_type as "audio" | "video") ?? "audio",
            callId,
            // FIX: forward the host's per-minute rate + max_seconds so a call
            // opened via a push-notification tap gets a working balance-cap
            // auto-end and cost badge (parity with the socket/polling paths,
            // which pass host_earn_per_minute ?? rate_per_minute + max_seconds).
            data.host_earn_per_minute != null ? Number(data.host_earn_per_minute)
              : data.rate_per_minute != null ? Number(data.rate_per_minute) : undefined,
            data.max_seconds != null ? Number(data.max_seconds) : undefined
          );
          router.push("/calls/incoming");
        }
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/chat/[id]", params: { id: String(data.room_id) } });
      }
    }

    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Maps a broadcasted `resource` to the react-query keys that cache it in the
// host app, so an admin catalog change invalidates the matching screens
// instantly (react-query prefix matching: ["host-banners"] also matches
// ["host-banners","home"]).
const HOST_CATALOG_QUERY_KEYS: Record<string, (string | number)[][]> = {
  banners: [["host-banners"]],
  level_config: [["host-level"]],
  // Admin edited this host (rates / level / active) — refresh the host's own
  // profile and level cards so the changes show without a re-open.
  hosts: [["host-me"], ["host-level"]],
};

function AppBridge() {
  const { receiveCall, activeCall } = useCall();
  const { user, isLoggedIn, refreshProfile, setOnlineStatus } = useAuth();
  const { isConnected: socketConnected } = useSocket();
  const queryClient = useQueryClient();
  const activeCallRef = useRef(activeCall);
  // Track WS connectivity in a ref so the polling-fallback interval closure can
  // read the latest value WITHOUT restarting the interval on every reconnect.
  const socketConnectedRef = useRef(socketConnected);
  const seenCallIds = useRef(new Set<string>());

  // Real-time catalog updates — admin add/edit/delete reflects immediately.
  useSocketEvent(
    SocketEvents.DATA_CHANGED,
    (data: any) => {
      const keys = HOST_CATALOG_QUERY_KEYS[data?.resource ?? ""];
      if (keys) keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
    [queryClient]
  );
  // FIX (Auto Go Online): track whether we've already auto-flipped online for
  // this login session so we don't fight the user if they manually toggle off.
  const autoOnlineRunRef = useRef(false);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { socketConnectedRef.current = socketConnected; }, [socketConnected]);

  // seenCallIds logout pe clear karo
  useEffect(() => {
    if (!isLoggedIn) {
      seenCallIds.current.clear();
      autoOnlineRunRef.current = false; // Reset so next login can auto-online again
    }
  }, [isLoggedIn]);

  // FIX (Auto Go Online on App Open):
  // The Settings toggle persisted to AsyncStorage but no code ever consulted
  // it on app start. Now: once on first login of a session, if the host has
  // autoOnline=true and is currently offline, flip them online. The
  // autoOnlineRunRef guard prevents re-flipping on every render and respects
  // a manual offline toggle within the same session.
  useEffect(() => {
    if (!isLoggedIn || !user?.id || user.role !== "host") return;
    if (autoOnlineRunRef.current) return;
    const settings = getHostSettingsSync();
    if (!settings.autoOnline) return;
    if (user.isOnline) return; // Already online — nothing to do.
    autoOnlineRunRef.current = true;
    setOnlineStatus(true).catch((e) => {
      console.warn("[AppBridge] Auto Go Online failed:", e);
      // Revert the run-once flag so a network blip doesn't permanently disable
      // auto-online for this session — user can re-foreground to retry.
      autoOnlineRunRef.current = false;
    });
  }, [isLoggedIn, user?.id, user?.role, user?.isOnline, setOnlineStatus]);

  // Polling fallback for incoming calls — ONLY runs when the notification
  // WebSocket is down. The WS (SocketEvents.CALL_INCOMING below) is the primary,
  // instant delivery path; when it's connected this poll is pure redundant load
  // (every online host hitting GET /api/calls/pending-for-host on a tight loop),
  // so we skip it. When the WS drops, this poll takes over at a relaxed cadence
  // so incoming calls are still delivered until the socket reconnects.
  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;

    const poll = async () => {
      if (activeCallRef.current) return;
      // Skip while the WS is connected — it already delivers incoming calls.
      if (socketConnectedRef.current) return;
      try {
        const pending = await API.getPendingCall();
        if (pending?.id && !seenCallIds.current.has(pending.id)) {
          if (seenCallIds.current.size > 500) seenCallIds.current.clear();
          seenCallIds.current.add(pending.id);
          receiveCall(
            {
              id: pending.caller_id,
              name: pending.caller_name ?? "Caller",
              avatar: pending.caller_avatar,
              role: "user",
            },
            (pending.call_type as "audio" | "video") ?? "audio",
            pending.id,
            // Host's NET earning/min (level-based share) — falls back to the
            // gross rate for older servers that don't send host_earn_per_minute.
            pending.host_earn_per_minute ?? pending.rate_per_minute,
            pending.max_seconds
          );
          router.push("/calls/incoming");
        }
      } catch {}
    };

    // 15s cadence: this is a fallback (WS is primary + instant), so it doesn't
    // need a tight 4s loop. Cuts backend load massively at scale while keeping
    // a reasonable worst-case delivery latency when the socket is down.
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [isLoggedIn, user?.id]);

  useSocketEvent(
    SocketEvents.CALL_INCOMING,
    (data: any) => {
      if (activeCallRef.current) return;
      const callId = data.callId ?? data.sessionId ?? data.session_id ?? "";
      if (callId && seenCallIds.current.has(callId)) return;
      if (seenCallIds.current.size > 500) seenCallIds.current.clear();
      if (callId) seenCallIds.current.add(callId);
      receiveCall(
        {
          id: data.callerId ?? data.caller_id ?? "",
          name: data.callerName ?? data.caller_name ?? "Caller",
          avatar: data.callerAvatar,
          role: "user",
        },
        data.type ?? data.call_type ?? "audio",
        callId,
        data.coinsPerMinute,
        data.maxSeconds
      );
      router.push("/calls/incoming");
    },
    []
  );

  // FIX: coin_update event pe host ka balance + earnings update karo
  useSocketEvent(
    SocketEvents.COIN_DEDUCTED,
    (_data: any) => {
      // Profile refresh karo — coins aur earnings dono update honge
      refreshProfile().catch(() => {});
    },
    [refreshProfile]
  );

  // Real-time: someone tipped this host — live toast + refresh earnings/balance.
  useSocketEvent(
    SocketEvents.TIP_RECEIVED,
    (data: any) => {
      const amt = Number(data?.amount) || 0;
      const who = data?.senderName || "Someone";
      showSuccessToast(`💝 ${who} sent you ${amt} coins${data?.message ? `: ${data.message}` : ""}`);
      refreshProfile().catch(() => {});
      queryClient.refetchQueries({ queryKey: ["host-earnings"] });
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    },
    [refreshProfile, queryClient]
  );

  // Real-time: new rating/review — live toast + refresh rating (host-me).
  useSocketEvent(
    SocketEvents.REVIEW_RECEIVED,
    (data: any) => {
      const stars = Number(data?.stars) || 0;
      showSuccessToast(`⭐ You received a new ${stars}-star review!`);
      refreshProfile().catch(() => {});
      queryClient.refetchQueries({ queryKey: ["host-me"] });
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    },
    [refreshProfile, queryClient]
  );

  // Real-time: a user favorited this host.
  useSocketEvent(
    SocketEvents.FAVORITED,
    (data: any) => {
      showSuccessToast(`❤️ ${data?.byName || "Someone"} added you to favorites`);
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    },
    [queryClient]
  );

  // Real-time in-app notification — toast + bump the unread bell badge live.
  useSocketEvent(
    SocketEvents.NOTIFICATION_NEW,
    (data: any) => {
      const n = data?.notification;
      if (n?.title) showSuccessToast(n.body ? `${n.title} — ${n.body}` : n.title);
      queryClient.invalidateQueries({ queryKey: ["host-notif-unread"] });
    },
    [queryClient]
  );

  // NOTE: CALL_END intentionally NOT handled here.

  return (
    <>
      {Platform.OS !== "web" && <FCMNotificationTapBridge seenCallIds={seenCallIds} activeCallRef={activeCallRef} />}
      {Platform.OS === "web" && <WebNotificationBridge seenCallIds={seenCallIds} activeCallRef={activeCallRef} />}
    </>
  );
}

function RootLayoutNav() {
  // Force-update gate. Fires once on app launch and shows a blocking
  // Alert if the running build is below the server-configured min version.
  useAppVersionGate('host');
  return (
    <>
      <AppBridge />
      <OtaUpdateGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/register" />
        <Stack.Screen name="auth/profile-setup" />
        <Stack.Screen name="auth/become" />
        <Stack.Screen name="auth/kyc" />
        <Stack.Screen name="auth/status" />
        <Stack.Screen name="auth/onboarding" />
        <Stack.Screen name="calls/incoming" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="calls/audio-call" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="calls/video-call" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="calls/outgoing" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
        <Stack.Screen name="calls/summary" />
        <Stack.Screen name="calls/history" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="auth/forgot-password" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="help-center" />
        <Stack.Screen name="language" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="about" />
        <Stack.Screen name="referral" />
        <Stack.Screen name="earnings-history" />
        <Stack.Screen name="payout-method" />
        <Stack.Screen name="availability" />
        <Stack.Screen name="call-rates" />
        <Stack.Screen name="manage-topics" />
        <Stack.Screen name="gallery" />
        <Stack.Screen name="level-benefits" />
        <Stack.Screen name="leaderboard" />
      </Stack>
      <ToastContainer />
      <OfflineBanner />
      {/* Admin maintenance gate — renders LAST so it overlays everything when
          maintenance_mode is ON in the admin panel. */}
      <MaintenanceGate />
      {/* Blocking ban popup — non-dismissable; no logout. */}
      <BanGate />
    </>
  );
}

function MaybeKeyboardProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "web" || !KeyboardProvider) return <>{children}</>;
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    // Preload the Feather glyph font so the profile page's vector icons render
    // reliably (the host app hadn't used @expo/vector-icons before, so the
    // font was never registered → icons showed blank).
    ...Feather.font,
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
    // FIX: load persisted host settings into the in-memory cache before any
    // service tries to consult them (NotificationService.shouldShowNotification,
    // AppBridge auto-online check). Fire-and-forget — load is fast and
    // consumers fall back to defaults until it completes.
    loadHostSettings();
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


// ─── CodePush (OTA) — native only ────────────────────────────────────────────
// The CodePush native module isn't available on web, and `expo export --platform
// web` must not import it, so we require it lazily on native and wrap the root.
// On app resume CodePush checks the server, downloads a new JS bundle, and
// applies it on the next restart. Web falls back to the plain root component.
let codePush: any = null;
if (Platform.OS !== "web") {
  try {
    codePush = require("@code-push-next/react-native-code-push").default;
  } catch {}
}

const RootWithCodePush = codePush
  ? codePush({ checkFrequency: codePush.CheckFrequency.ON_APP_RESUME })(RootLayout)
  : RootLayout;

export default RootWithCodePush;
