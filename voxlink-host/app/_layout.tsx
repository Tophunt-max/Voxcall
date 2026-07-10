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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadHostSettings, getHostSettingsSync } from "@/utils/hostSettings";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { OfflineBanner } from "@/components/OfflineBanner";
import MaintenanceGate from "@/components/MaintenanceGate";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider, useSocketEvent } from "@/context/SocketContext";
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

function FCMNotificationTapBridge({ seenCallIds, activeCallRef }: { seenCallIds: React.MutableRefObject<Set<string>>; activeCallRef: React.MutableRefObject<any> }) {
  const { receiveCall } = useCall();

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
            callId
          );
          router.push("/calls/incoming");
        }
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/chat/[id]", params: { id: String(data.room_id) } });
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
            callId
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
};

function AppBridge() {
  const { receiveCall, activeCall } = useCall();
  const { user, isLoggedIn, refreshProfile, setOnlineStatus } = useAuth();
  const queryClient = useQueryClient();
  const activeCallRef = useRef(activeCall);
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

  // Polling fallback — fires every 4 s while logged in.
  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;

    const poll = async () => {
      if (activeCallRef.current) return;
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
            pending.rate_per_minute,
            pending.max_seconds
          );
          router.push("/calls/incoming");
        }
      } catch {}
    };

    const interval = setInterval(poll, 4000);
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
    </>
  );
}

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
