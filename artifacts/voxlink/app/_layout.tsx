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
        <Stack.Screen name="screens/user" />
        <Stack.Screen name="screens/host" />
        <Stack.Screen name="auth/onboarding" />
        <Stack.Screen name="auth/role-select" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/host-login" />
        <Stack.Screen name="auth/register" />
        <Stack.Screen name="auth/forgot-password" />
        <Stack.Screen name="auth/verify-otp" />
        <Stack.Screen name="auth/create-password" />
        <Stack.Screen name="auth/fill-profile" />
        <Stack.Screen name="auth/select-gender" />
        <Stack.Screen name="hosts/[id]" />
        <Stack.Screen name="hosts/all" />
        <Stack.Screen name="hosts/reviews" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="call/audio-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="call/video-call" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="call/incoming" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="call/outgoing" options={{ presentation: "fullScreenModal" }} />
        <Stack.Screen name="call/summary" />
        <Stack.Screen name="call/history" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="host/dashboard" />
        <Stack.Screen name="host/settings" />
        <Stack.Screen name="host/withdraw" />
        <Stack.Screen name="payment/checkout" />
        <Stack.Screen name="payment/success" options={{ gestureEnabled: false }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="help-center" />
        <Stack.Screen name="language" />
        <Stack.Screen name="become-host" />
        <Stack.Screen name="become-host-success" />
        <Stack.Screen name="search-hosts" />
        <Stack.Screen name="coin-history" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="about" />
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
