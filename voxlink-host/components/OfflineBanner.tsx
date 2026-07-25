// FIX #8: Offline / No Internet detection popup
//
// IMPORTANT: `isConnected` here is the WebSocket connection state from
// SocketContext, NOT the actual device internet status. The WebSocket
// only connects after the user logs in. Showing the popup before login
// (when WS isn't even attempted) produces a false "No internet" message
// on the login screen — which scared users into thinking auth was broken.
//
// Correct behavior:
//   - Don't show before login (WS isn't expected to connect)
//   - Don't show on first launch before the very first successful connect
//     (avoids flashing during normal cold-start handshake)
//   - Show only when we've been connected at least once and then dropped
//     for >SHOW_DELAY_MS — that's the real "lost connection" signal.
//
// UI: instead of a thin top banner, this now renders a centered popup with a
// dimmed backdrop so the "no internet" state is clearly surfaced to the user.

import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Platform, Modal } from "react-native";
import { SvgIcon } from "@/components/SvgIcon";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";

const useNativeDriverValue = Platform.OS !== "web";

const SHOW_DELAY_MS = 5000;

export function OfflineBanner() {
  const { isConnected } = useSocket();
  const { isLoggedIn } = useAuth();
  const [showPopup, setShowPopup] = useState(false);
  // Only flip the popup on once we've actually been connected at least
  // once in this session — otherwise the cold-start "not yet connected"
  // window looks identical to a true network drop.
  const hasEverConnected = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (isConnected) hasEverConnected.current = true;
  }, [isConnected]);

  useEffect(() => {
    // Logged-out screens (login, splash) shouldn't see this popup — the
    // socket isn't supposed to be connected there anyway.
    if (!isLoggedIn) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowPopup(false);
      return;
    }

    if (isConnected) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowPopup(false);
      return;
    }

    // Not connected and logged in — but only show if we've previously
    // had a working connection in this session (real drop, not boot-up).
    if (!hasEverConnected.current) return;

    timerRef.current = setTimeout(() => setShowPopup(true), SHOW_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isConnected, isLoggedIn]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: showPopup ? 1 : 0,
        duration: 220,
        useNativeDriver: useNativeDriverValue,
      }),
      Animated.spring(scaleAnim, {
        toValue: showPopup ? 1 : 0.9,
        friction: 7,
        tension: 80,
        useNativeDriver: useNativeDriverValue,
      }),
    ]).start();
  }, [showPopup]);

  if (!showPopup) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.iconCircle}>
          <SvgIcon name="wifi-off" size={34} color="#EF4444" />
        </View>
        <Text style={styles.title}>No Internet Connection</Text>
        <Text style={styles.message}>
          You appear to be offline. Calls may be affected while we try to reconnect…
        </Text>
        <View style={styles.statusRow}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>Reconnecting…</Text>
        </View>
      </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    zIndex: 9999,
    ...(Platform.OS === "web" ? { position: "fixed" as any } : null),
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(239,68,68,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    color: "#111827",
    fontSize: 18,
    fontFamily: "Poppins_600SemiBold",
    textAlign: "center",
  },
  message: {
    color: "#6B7280",
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    backgroundColor: "rgba(239,68,68,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  statusText: {
    color: "#EF4444",
    fontSize: 13,
    fontFamily: "Poppins_500Medium",
  },
});
