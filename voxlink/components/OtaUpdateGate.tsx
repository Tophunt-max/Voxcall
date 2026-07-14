import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, View, Text, ActivityIndicator, StyleSheet } from "react-native";
import * as Updates from "expo-updates";

// Self-hosted OTA gate. Checks the update server on launch + whenever the app
// returns to the foreground.
//   • Normal update  → downloads silently, applies on the next natural restart.
//   • Forced update  → published with `--force` (manifest.extra.forceUpdate);
//                       we show a blocking screen, download it, and reload NOW.
// No-op in dev / Expo Go (Updates.isEnabled is false there).
export function OtaUpdateGate() {
  const [forcing, setForcing] = useState(false);
  const [status, setStatus] = useState("A required update is downloading…");
  const checkingRef = useRef(false);
  const lastCheckRef = useRef(0);

  const runCheck = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) return;
    if (checkingRef.current) return;
    const now = Date.now();
    if (now - lastCheckRef.current < 30_000) return; // throttle to ≤ once / 30s
    lastCheckRef.current = now;
    checkingRef.current = true;
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) return;
      const force = !!(res.manifest as any)?.extra?.forceUpdate;
      if (force) {
        setStatus("A required update is downloading…");
        setForcing(true);
      }
      await Updates.fetchUpdateAsync();
      if (force) {
        setStatus("Restarting…");
        await Updates.reloadAsync(); // hard-apply immediately
      }
      // Non-forced updates apply automatically on the next cold start.
    } catch {
      setForcing(false); // never block the app on a failed check
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    runCheck();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") runCheck();
    });
    return () => sub.remove();
  }, [runCheck]);

  if (!forcing) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <Text style={styles.emoji}>🚀</Text>
        <Text style={styles.title}>Updating the app</Text>
        <Text style={styles.msg}>{status}</Text>
        <ActivityIndicator size="large" color="#A00EE7" style={{ marginTop: 18 }} />
        <Text style={styles.hint}>Please keep the app open — this only takes a moment.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(10,10,20,0.94)", alignItems: "center", justifyContent: "center", padding: 32 },
  emoji: { fontSize: 52 },
  title: { color: "#fff", fontSize: 20, fontFamily: "Poppins_700Bold", marginTop: 10 },
  msg: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 4 },
  hint: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 20 },
});
