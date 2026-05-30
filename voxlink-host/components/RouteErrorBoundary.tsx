import { Feather } from "@expo/vector-icons";
import { ErrorBoundaryProps, router } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { reportError } from "@/services/ErrorReporter";

/**
 * Per-route (per-screen) error boundary for Expo Router.
 *
 * Usage — add this single re-export to any route file:
 *
 *   export { ErrorBoundary } from "@/components/RouteErrorBoundary";
 *
 * Expo Router renders this in place of the crashed screen, so a render error
 * on ONE screen (e.g. a call screen failing mid-call) is contained to that
 * screen instead of bubbling to the app-wide ErrorBoundary in _layout.tsx,
 * which would blank the whole app and force a full reload. Here the user can
 * retry just this screen, or back out to safety, without losing their session
 * or any active call/chat context held in providers above the screen.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    reportError(error, "RouteErrorBoundary").catch(() => {});
  }, [error]);

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.card }]}>
          <Feather name="alert-triangle" size={32} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          This screen ran into a problem
        </Text>

        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          You can try again, or go back and keep using the app.
        </Text>

        <Pressable
          onPress={() => {
            retry().catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            Try again
          </Text>
        </Pressable>

        <Pressable
          onPress={handleGoBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [
            styles.buttonSecondary,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.buttonSecondaryText, { color: colors.foreground }]}>
            Go back
          </Text>
        </Pressable>

        {__DEV__ ? (
          <Text
            selectable
            style={[styles.devError, { color: colors.mutedForeground }]}
          >
            {error.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    width: "100%",
    maxWidth: 480,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 30,
  },
  message: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 200,
    alignItems: "center",
  },
  buttonText: {
    fontWeight: "600",
    fontSize: 16,
  },
  buttonSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    minWidth: 200,
    alignItems: "center",
    borderWidth: 1,
  },
  buttonSecondaryText: {
    fontWeight: "600",
    fontSize: 15,
  },
  devError: {
    marginTop: 12,
    fontSize: 12,
    textAlign: "center",
  },
});
