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
import { OfflineBanner } from "@/components/OfflineBanner";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider, useSocketEvent } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { useCall } from "@/context/CallContext";

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
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      refetchOnWindowFocus: false,
    },
  },
});

function FCMNotificationTapBridge() {
  const { receiveCall, activeCall } = useCall();

  useEffect(() => {
    if (!RNMessaging) return;

    function handleNotificationData(data: Record<string, any>) {
      if (!data) return;
      if (data.type === "incoming_call") {
        if (!activeCall) {
          receiveCall(
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "user" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
        router.push("/calls/incoming");
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
      console.log("[FCM Foreground]", title, body, data);
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
            { id: String(data.caller_id ?? ""), name: data.caller_name ?? "Caller", role: "user" },
            (data.call_type as "audio" | "video") ?? "audio",
            String(data.session_id ?? "")
          );
        }
        router.push("/calls/incoming");
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

function AppBridge() {
  const { receiveCall, endCall, activeCall } = useCall();

  useSocketEvent(
    SocketEvents.CALL_INCOMING,
    (data: any) => {
      if (activeCall) return;
      receiveCall(
        {
          id: data.callerId ?? data.caller_id ?? "",
          name: data.callerName ?? data.caller_name ?? "Caller",
          avatar: data.callerAvatar,
          role: "user",
        },
        data.type ?? data.call_type ?? "audio",
        data.callId ?? data.sessionId ?? data.session_id ?? ""
      );
      router.push("/calls/incoming");
    },
    [activeCall]
  );

  useSocketEvent(
    SocketEvents.CALL_END,
    (data: any) => {
      const sid = data?.sessionId ?? data?.session_id;
      if (activeCall && (!sid || activeCall.sessionId === sid)) {
        endCall(true);
      }
    },
    [activeCall, endCall]
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
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/register" />
        <Stack.Screen name="auth/profile-setup" />
        <Stack.Screen name="auth/become" />
        <Stack.Screen name="auth/kyc" />
        <Stack.Screen name="auth/status" />
        <Stack.Screen name="auth/onboarding" />
        <Stack.Screen name="calls/incoming" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="calls/audio-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="calls/video-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="calls/outgoing" options={{ presentation: "fullScreenModal" }} />
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
      </Stack>
      <ToastContainer />
      <OfflineBanner />
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
