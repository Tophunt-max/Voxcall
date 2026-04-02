import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { configurePushNotifications } from "@/services/NotificationService";
import { onForegroundMessage, setupBackgroundMessageHandler } from "@/services/fcm";
import { setupGlobalErrorHandler } from "@/services/ErrorReporter";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider, useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { useCall } from "@/context/CallContext";

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

const queryClient = new QueryClient();

// ─── FCM Notification Tap Bridge (Native only) ───────────────────────────────
// Handles push notification taps using @react-native-firebase/messaging
function FCMNotificationTapBridge() {
  const { receiveCall, activeCall } = useCall();

  useEffect(() => {
    if (!RNMessaging) return;

    function handleNotificationData(data: Record<string, any>) {
      if (!data) return;
      if (data.type === "incoming_call") {
        if (!activeCall) {
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "host" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
        router.push("/shared/call/incoming");
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/shared/chat/[id]", params: { id: String(data.room_id) } });
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

    // Foreground message → show local alert / in-app toast handled by AppBridge
    const unsubForeground = onForegroundMessage(({ title, body, data }) => {
      // Foreground call notifications are handled via WebSocket (AppBridge)
      // Chat messages — could show in-app toast here if needed
      console.log("[FCM Foreground]", title, body, data);
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
        if (!activeCall) {
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "host" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
        router.push("/shared/call/incoming");
      } else if (data.type === "chat_message" && data.room_id) {
        router.push({ pathname: "/shared/chat/[id]", params: { id: String(data.room_id) } });
      }
    }

    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ─── AppBridge ───────────────────────────────────────────────────────────────
// WebSocket CALL_INCOMING → CallContext (all platforms)
// FCM tap handlers (native + web)
function AppBridge() {
  const { receiveCall, activeCall } = useCall();

  useSocketEvent(
    SocketEvents.CALL_INCOMING,
    (data: any) => {
      if (activeCall) return;
      receiveCall(
        {
          id: data.callerId ?? data.caller_id ?? "",
          name: data.hostName ?? data.callerName ?? "Incoming Call",
          avatar: data.hostAvatar ?? data.callerAvatar,
          role: "host",
        },
        data.type ?? data.call_type ?? "audio",
        data.callId ?? data.sessionId ?? data.session_id ?? ""
      );
    },
    [activeCall]
  );

  return (
    <>
      {Platform.OS !== "web" && <FCMNotificationTapBridge />}
      {Platform.OS === "web" && <WebNotificationBridge />}
    </>
  );
}

function RootLayoutNav() {
  return (
    <>
      <AppBridge />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />

        {/* User screens */}
        <Stack.Screen name="user/screens/home" />
        <Stack.Screen name="user/auth/login" />
        <Stack.Screen name="user/auth/register" />
        <Stack.Screen name="user/auth/forgot-password" />
        <Stack.Screen name="user/auth/verify-otp" />
        <Stack.Screen name="user/auth/create-password" />
        <Stack.Screen name="user/auth/fill-profile" />
        <Stack.Screen name="user/auth/select-gender" />
        <Stack.Screen name="user/hosts/[id]" />
        <Stack.Screen name="user/hosts/all" />
        <Stack.Screen name="user/hosts/reviews" />
        <Stack.Screen name="user/payment/checkout" />
        <Stack.Screen name="user/payment/success" options={{ gestureEnabled: false }} />
        <Stack.Screen name="user/profile/edit" />

        {/* Host screens */}
        <Stack.Screen name="host/screens/host" />
        <Stack.Screen name="host/auth/host-login" />
        <Stack.Screen name="host/auth/host-register" />
        <Stack.Screen name="host/auth/host-profile-setup" />
        <Stack.Screen name="host/auth/host-become" />
        <Stack.Screen name="host/auth/host-kyc" />
        <Stack.Screen name="host/auth/host-status" />
        <Stack.Screen name="host/host/dashboard" />
        <Stack.Screen name="host/host/settings" />
        <Stack.Screen name="host/host/withdraw" />

        {/* Shared screens */}
        <Stack.Screen name="shared/auth/onboarding" />
        <Stack.Screen name="shared/auth/role-select" />
        <Stack.Screen name="shared/chat/[id]" />
        <Stack.Screen name="shared/call/audio-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="shared/call/video-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="shared/call/incoming" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="shared/call/outgoing" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="shared/call/summary" />
        <Stack.Screen name="shared/call/history" />
        <Stack.Screen name="shared/notifications" />
        <Stack.Screen name="shared/settings" />
        <Stack.Screen name="shared/help-center" />
        <Stack.Screen name="shared/language" />
        <Stack.Screen name="shared/become-host" />
        <Stack.Screen name="shared/become-host-success" />
        <Stack.Screen name="shared/search-hosts" />
        <Stack.Screen name="shared/coin-history" />
        <Stack.Screen name="shared/privacy" />
        <Stack.Screen name="shared/about" />
      </Stack>
      <ToastContainer />
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    configurePushNotifications();
    setupGlobalErrorHandler();
  }, []);

  if (!fontsLoaded && !fontError) return null;

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
