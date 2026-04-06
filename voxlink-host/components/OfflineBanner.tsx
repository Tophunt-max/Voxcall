// FIX #8: Offline / No Internet detection banner for Host App
// Uses SocketContext connection state as proxy for network connectivity.
// Shows a prominent banner after 5s of disconnection.

import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";
import { useSocket } from "@/context/SocketContext";

const useNativeDriverValue = Platform.OS !== "web";

const SHOW_DELAY_MS = 5000;

export function OfflineBanner() {
  const { isConnected } = useSocket();
  const [showBanner, setShowBanner] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideAnim = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    if (isConnected) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowBanner(false);
    } else {
      timerRef.current = setTimeout(() => setShowBanner(true), SHOW_DELAY_MS);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isConnected]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: showBanner ? 0 : -60,
      duration: 280,
      useNativeDriver: useNativeDriverValue,
    }).start();
  }, [showBanner]);

  if (!showBanner && !isConnected) return null;

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
    fontFamily: "Poppins_600SemiBold",
  },
});
