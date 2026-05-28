// FIX #8: Offline / No Internet detection banner
//
// IMPORTANT: `isConnected` here is the WebSocket connection state from
// SocketContext, NOT the actual device internet status. The WebSocket
// only connects after the user logs in. Showing the banner before login
// (when WS isn't even attempted) produces a false "No internet" message
// on the login screen — which scared users into thinking auth was broken.
//
// Correct behavior:
//   - Don't show before login (WS isn't expected to connect)
//   - Don't show on first launch before the very first successful connect
//     (avoids flashing the banner during normal cold-start handshake)
//   - Show only when we've been connected at least once and then dropped
//     for >SHOW_DELAY_MS — that's the real "lost connection" signal.

import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";

const useNativeDriverValue = Platform.OS !== "web";

const SHOW_DELAY_MS = 5000;

export function OfflineBanner() {
  const { isConnected } = useSocket();
  const { isLoggedIn } = useAuth();
  const [showBanner, setShowBanner] = useState(false);
  // Only flip the banner on once we've actually been connected at least
  // once in this session — otherwise the cold-start "not yet connected"
  // window looks identical to a true network drop.
  const hasEverConnected = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideAnim = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    if (isConnected) hasEverConnected.current = true;
  }, [isConnected]);

  useEffect(() => {
    // Logged-out screens (login, splash) shouldn't see this banner — the
    // socket isn't supposed to be connected there anyway.
    if (!isLoggedIn) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowBanner(false);
      return;
    }

    if (isConnected) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowBanner(false);
      return;
    }

    // Not connected and logged in — but only show if we've previously
    // had a working connection in this session (real drop, not boot-up).
    if (!hasEverConnected.current) return;

    timerRef.current = setTimeout(() => setShowBanner(true), SHOW_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isConnected, isLoggedIn]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: showBanner ? 0 : -60,
      duration: 280,
      useNativeDriver: useNativeDriverValue,
    }).start();
  }, [showBanner]);

  if (!showBanner) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.dot} />
      <Text style={styles.text}>No internet — calls may be affected. Reconnecting…</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "#EF4444",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
    opacity: 0.8,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
  },
});
