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
import { View, Text, StyleSheet, Animated, Platform } from "react-native";
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
  const slideAnim = useRef(new Animated.Value(-60)).current;

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
      <Text style={styles.text}>No internet connection — reconnecting…</Text>
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
