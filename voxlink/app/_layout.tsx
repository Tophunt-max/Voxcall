import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from "@expo-google-fonts/poppins";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { AuthProvider } from "@/context/AuthContext";
import { CallProvider } from "@/context/CallContext";
import { ChatProvider } from "@/context/ChatContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { SocketProvider } from "@/context/SocketContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <>
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
