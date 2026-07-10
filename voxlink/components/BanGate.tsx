import React, { useEffect, useState } from "react";
import { Modal, View, Text, ActivityIndicator, StyleSheet, BackHandler, AppState } from "react-native";
import { subscribeBanState, getBanState, checkBanStatus, type BanInfo } from "@/services/banState";

// Format a ban expiry (stored as a YYYY-MM-DD date string) into a friendly line.
function expiryLine(expires_at?: string | null): string {
  if (!expires_at) return "This is a permanent suspension.";
  try {
    const d = new Date(expires_at);
    if (isNaN(d.getTime())) return `Suspended until ${expires_at}.`;
    return `Suspended until ${d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`;
  } catch {
    return `Suspended until ${expires_at}.`;
  }
}

/**
 * Blocking ban popup. When the account is banned/suspended this renders a
 * full-screen, NON-DISMISSABLE modal on top of everything — the user cannot
 * close it, navigate away, or use any other part of the app until the ban is
 * lifted or expires. We never log them out; the popup simply persists.
 *
 * Sources that set the ban state:
 *  - SocketService  → real-time `account_banned` / `account_unbanned`
 *  - api.ts         → any 403 with code `account_banned`
 *  - checkBanStatus → server poll (mount, foreground, every 20s while banned)
 */
export function BanGate() {
  const [ban, setBan] = useState<BanInfo | null>(getBanState());

  // Subscribe to the module-level ban store.
  useEffect(() => subscribeBanState(setBan), []);

  // Verify with the server on mount + whenever the app returns to foreground,
  // so the popup shows even after a fresh app launch and clears on unban.
  useEffect(() => {
    checkBanStatus();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") checkBanStatus();
    });
    return () => sub.remove();
  }, []);

  // While banned: poll so an admin unban / expiry lifts the popup automatically,
  // and swallow the Android hardware back button so it can't be escaped.
  const isBanned = !!ban;
  useEffect(() => {
    if (!isBanned) return;
    const t = setInterval(() => { checkBanStatus(); }, 20000);
    const back = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => { clearInterval(t); back.remove(); };
  }, [isBanned]);

  if (!ban) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { /* not dismissable */ }}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🚫</Text>
          <Text style={styles.title}>Account Suspended</Text>
          <Text style={styles.reason}>
            {ban.reason || "Your account has been suspended by the platform."}
          </Text>
          <Text style={styles.expiry}>{expiryLine(ban.expires_at)}</Text>
          <Text style={styles.hint}>
            You can’t use the app until this is lifted. If you believe this is a
            mistake, please contact support.
          </Text>
          <ActivityIndicator style={{ marginTop: 18 }} color="#ffffff" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(10,10,15,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#1c1c26",
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.35)",
  },
  emoji: { fontSize: 52, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: "800", color: "#ffffff", marginBottom: 10, textAlign: "center" },
  reason: { fontSize: 15, color: "#ffd6d6", textAlign: "center", lineHeight: 21, marginBottom: 10 },
  expiry: { fontSize: 13, fontWeight: "700", color: "#ff9d9d", textAlign: "center", marginBottom: 14 },
  hint: { fontSize: 13, color: "#a9a9b8", textAlign: "center", lineHeight: 19 },
});
