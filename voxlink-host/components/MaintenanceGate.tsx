// MaintenanceGate — full-screen blocking overlay shown when the admin flips
// `maintenance_mode` ON in the admin panel (App Configuration page).
//
// Mounted high in the navigation tree (_layout RootLayoutNav) as the LAST
// sibling so it renders on top of everything. It polls GET /api/app-config on
// mount, on every app foreground, and every 60s while active — so turning
// maintenance on/off propagates to live host clients within ~1 min (matches
// the server's 60s cache on the endpoint).
//
// Before this, the admin maintenance toggle had NO effect in the host app.
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, AppState, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgIcon } from "@/components/SvgIcon";
import { fetchAppConfig } from "@/hooks/useAppConfig";

const POLL_MS = 60_000;

export default function MaintenanceGate() {
  const insets = useSafeAreaInsets();
  const [on, setOn] = useState(false);
  const [message, setMessage] = useState<string>(
    "We are performing scheduled maintenance. Please check back shortly."
  );
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const cfg = await fetchAppConfig(true);
      const isOn = String(cfg?.maintenance_mode ?? "false").toLowerCase() === "true";
      setOn(isOn);
      if (cfg?.maintenance_message) setMessage(cfg.maintenance_message);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") refresh();
    }, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refresh]);

  if (!on) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <SvgIcon name="alert-triangle" size={40} color="#FFD166" />
        </View>
        <Text style={styles.title}>Under Maintenance</Text>
        <Text style={styles.message}>{message}</Text>

        <TouchableOpacity style={styles.retryBtn} onPress={refresh} disabled={checking} activeOpacity={0.85}>
          <Text style={styles.retryText}>{checking ? "Checking…" : "Try Again"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1A0040",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    zIndex: 9999,
    ...(Platform.OS === "web" ? { position: "fixed" as any } : null),
  },
  content: { alignItems: "center", gap: 14, maxWidth: 420 },
  iconCircle: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 2, borderColor: "rgba(255,209,102,0.4)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  title: { color: "#fff", fontSize: 24, fontFamily: "Poppins_700Bold", textAlign: "center" },
  message: { color: "rgba(255,255,255,0.78)", fontSize: 15, fontFamily: "Poppins_400Regular", textAlign: "center", lineHeight: 22 },
  retryBtn: {
    marginTop: 12, backgroundColor: "#A00EE7",
    paddingHorizontal: 36, paddingVertical: 14, borderRadius: 16,
  },
  retryText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
