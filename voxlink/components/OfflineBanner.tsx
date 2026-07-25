// FIX #8: Offline / No Internet detection banner
//
// IMPORTANT: `isConnected` here is the WebSocket connection state from
// SocketContext, NOT the actual device internet status. The WebSocket can
// flap for reasons that have NOTHING to do with the user's internet —
// token refresh, backoff, the server hibernating an idle Durable Object,
// or simply navigating to a screen (like /payment/checkout) that fires a
// burst of requests. Treating every WS drop as "No internet" produced a
// red banner that flashed on the checkout screen "har baar" (every time),
// even on a perfectly healthy connection.
//
// FIX: Before showing the banner, we PROBE REAL REACHABILITY by pinging the
// API health endpoint. The banner only appears when BOTH the WS is down AND
// the health probe fails — i.e. the device genuinely can't reach the server.
// If the probe succeeds, the WS is just reconnecting silently in the
// background and the user sees nothing. We keep re-probing while down so the
// banner auto-clears the moment connectivity returns.
//
// Behavior:
//   - Don't show before login (WS isn't expected to connect).
//   - Don't show on first launch before the first successful connect.
//   - After a drop, wait SHOW_DELAY_MS, then probe; only show on probe FAIL.
//   - Re-probe every RECHECK_MS while shown; hide as soon as a probe succeeds.

import React, { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Animated, Platform, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSocket } from "@/context/SocketContext";
import { useAuth } from "@/context/AuthContext";

const useNativeDriverValue = Platform.OS !== "web";

const SHOW_DELAY_MS = 6000;   // grace period before the first reachability probe
const RECHECK_MS = 8000;      // re-probe cadence while the banner logic is active
const PROBE_TIMEOUT_MS = 4000;

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://voxlink-api.ssunilkumarmohanta3.workers.dev";

// Lightweight reachability probe against the public health endpoint. Returns
// true when the server is reachable (real internet is fine), false otherwise.
async function probeReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${API_BASE}/api/healthz`, {
      method: "GET",
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function OfflineBanner() {
  const { isConnected } = useSocket();
  const { isLoggedIn } = useAuth();
  const [showBanner, setShowBanner] = useState(false);
  // Only flip the banner on once we've actually been connected at least
  // once in this session — otherwise the cold-start "not yet connected"
  // window looks identical to a true network drop.
  const hasEverConnected = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (isConnected) hasEverConnected.current = true;
  }, [isConnected]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (recheckRef.current) { clearInterval(recheckRef.current); recheckRef.current = null; }
  }, []);

  useEffect(() => {
    // Logged-out screens (login, splash) shouldn't see this banner — the
    // socket isn't supposed to be connected there anyway.
    if (!isLoggedIn) {
      clearTimers();
      setShowBanner(false);
      return;
    }

    // WebSocket is up → definitely online. Hide immediately.
    if (isConnected) {
      clearTimers();
      setShowBanner(false);
      return;
    }

    // WS is down and we're logged in — but a WS drop alone is NOT proof of an
    // internet outage. Only show if we've previously connected this session
    // (real drop, not boot-up) AND a real reachability probe fails.
    if (!hasEverConnected.current) return;

    const evaluate = async () => {
      // If the WS reconnected while we were waiting, bail — the other effect
      // run will have already hidden the banner.
      const reachable = await probeReachable();
      setShowBanner(!reachable);
    };

    // First evaluation after a grace period, then keep re-checking so the
    // banner auto-clears the instant the network comes back (even if the WS
    // itself is still mid-backoff).
    timerRef.current = setTimeout(() => {
      evaluate();
      recheckRef.current = setInterval(evaluate, RECHECK_MS);
    }, SHOW_DELAY_MS);

    return () => clearTimers();
  }, [isConnected, isLoggedIn, clearTimers]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: showBanner ? 1 : 0,
        duration: 220,
        useNativeDriver: useNativeDriverValue,
      }),
      Animated.spring(scaleAnim, {
        toValue: showBanner ? 1 : 0.9,
        friction: 7,
        tension: 80,
        useNativeDriver: useNativeDriverValue,
      }),
    ]).start();
  }, [showBanner]);

  if (!showBanner) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.iconCircle}>
          <Feather name="wifi-off" size={32} color="#EF4444" />
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
