import React, { useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCall } from "@/context/CallContext";
import { resolveMediaUrl } from "@/services/api";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useRingtone } from "@/hooks/useRingtone";

export default function IncomingCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeCall, acceptCall, declineCall } = useCall();
  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const { stop: stopRing } = useRingtone("incoming", true);

  // FIX BUG-6: Watch for activeCall going null (remote caller cancelled, server ended call,
  // or cron reaped it). Without this, the incoming screen stays stuck forever.
  // Same pattern as host incoming.tsx — only go back when activeCall becomes null,
  // NOT when status changes to "active" (that means we accepted and call screen is opening).
  const hasMounted = useRef(false);
  const hadCall = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      if (activeCall) hadCall.current = true;
      return;
    }
    if (activeCall) {
      hadCall.current = true;
      return;
    }
    // activeCall went null — call was cancelled/ended externally
    if (hadCall.current) {
      stopRing().catch(() => {});
      try { router.back(); } catch {}
    }
  }, [activeCall, stopRing]);

  const handleAccept = useCallback(async () => {
    await stopRing();
    acceptCall();
  }, [acceptCall, stopRing]);

  const handleDecline = useCallback(async () => {
    await stopRing();
    declineCall();
  }, [declineCall, stopRing]);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timeout = setTimeout(async () => {
      await stopRing();
      declineCall();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [stopRing, declineCall]);

  return (
    <View style={[styles.screen, { backgroundColor: "#1A1A2E", paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.top}>
        <Text style={styles.incomingLabel}>Incoming {activeCall?.type === "video" ? "Video" : "Audio"} Call</Text>
        <View style={styles.avatarRing}>
          <Image
            source={{ uri: resolveMediaUrl(activeCall?.participant.avatar) ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id}` }}
            style={styles.avatar}
          />
        </View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? "Unknown"}</Text>
        {/* Fix M2: show correct role — "user" callers are Users, not Hosts */}
        <Text style={styles.callerRole}>{activeCall?.participant.role === "host" ? "VoxLink Host" : "VoxLink User"}</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleDecline} style={styles.declineBtn}>
              <Image source={require("@/assets/icons/ic_call_end.png")} style={{ width: 28, height: 28, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleAccept} style={styles.acceptBtn}>
              <Image source={require("@/assets/icons/ic_call.png")} style={{ width: 28, height: 28, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Accept</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between", paddingHorizontal: 32 },
  top: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  incomingLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular" },
  avatarRing: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  callerName: { color: "#fff", fontSize: 28, fontFamily: "Poppins_700Bold", marginTop: 12 },
  callerRole: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular" },
  actions: { paddingBottom: 40 },
  actionRow: { flexDirection: "row", gap: 64, alignItems: "center" },
  actionItem: { alignItems: "center", gap: 10 },
  declineBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },
  acceptBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center" },
  actionLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Poppins_400Regular" },
});
