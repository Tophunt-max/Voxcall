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
import { configurePushNotifications } from "@/services/NotificationService";
import { setupGlobalErrorHandler } from "@/services/ErrorReporter";
import * as Notifications from "expo-notifications";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
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

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ─── AppBridge ───────────────────────────────────────────────────────────────
// Handles all real-time → UI bridging. Must be inside all providers.
// 1. CALL_INCOMING via WebSocket (foreground)
// 2. Notification taps (background / killed app)
// 3. Notification received in foreground (incoming call only)
function AppBridge() {
  const { receiveCall, activeCall } = useCall();

  // Bridge: WebSocket CALL_INCOMING → CallContext.receiveCall
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

  // Bridge: Push notification tap → navigate + set up CallContext
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    const data = lastResponse.notification.request.content.data as Record<string, unknown>;
    if (!data) return;

    if (data.type === "incoming_call") {
      if (!activeCall) {
        // Extract caller info from notification body: "<name> is calling you"
        const body = lastResponse.notification.request.content.body ?? "";
        const callerName = body.replace(" is calling you", "").trim() || "Caller";
        receiveCall(
          {
            id: String(data.caller_id ?? ""),
            name: callerName,
            role: "host",
          },
          (data.call_type as "audio" | "video") ?? "audio",
          String(data.session_id ?? "")
        );
      }
      router.push("/shared/call/incoming");
    } else if (data.type === "chat_message" && data.room_id) {
      router.push({ pathname: "/shared/chat/[id]", params: { id: String(data.room_id) } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResponse]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <AppBridge />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />

        {/* User screens */}
        <Stack.Screen name="user/screens/user" />
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
            <KeyboardProvider>
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
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
