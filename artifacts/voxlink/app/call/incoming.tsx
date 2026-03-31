import React, { useEffect, useCallback } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCall } from "@/context/CallContext";
import * as Haptics from "expo-haptics";
import { useRingtone } from "@/hooks/useRingtone";

export default function IncomingCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeCall, acceptCall, declineCall } = useCall();
  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const { stop: stopRing } = useRingtone("incoming", true);

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
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: "#1A1A2E", paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.top}>
        <Text style={styles.incomingLabel}>Incoming {activeCall?.type === "video" ? "Video" : "Audio"} Call</Text>
        <View style={styles.avatarRing}>
          <Image source={{ uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id}` }} style={styles.avatar} />
        </View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? "Unknown"}</Text>
        <Text style={styles.callerRole}>VoxLink Host</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleDecline} style={styles.declineBtn}>
              <Feather name="phone-off" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Decline</Text>
          </View>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleAccept} style={styles.acceptBtn}>
              <Feather name="phone" size={28} color="#fff" />
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
