import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCall } from "@/context/CallContext";
import * as Haptics from "expo-haptics";

export default function AudioCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleSpeaker } = useCall();
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    const connectTimer = setTimeout(() => setStatus("ringing"), 1000);
    const ringTimer = setTimeout(() => setStatus("active"), 3000);
    return () => { clearTimeout(connectTimer); clearTimeout(ringTimer); };
  }, []);

  useEffect(() => {
    if (status !== "active") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const statusLabels = { connecting: "Connecting...", ringing: "Ringing...", active: formatTime(elapsed) };

  return (
    <View style={[styles.screen, { backgroundColor: colors.primary, paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.callerInfo}>
        <View style={styles.avatarRing}>
          <Image source={{ uri: activeCall?.participant.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id}` }} style={styles.avatar} />
        </View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? "Unknown"}</Text>
        <Text style={styles.callStatus}>{statusLabels[status]}</Text>
        {activeCall?.coinsPerMinute && (
          <View style={styles.costBadge}>
            <Text style={styles.costText}>🪙 {activeCall.coinsPerMinute} coins/min</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <View style={styles.controlRow}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }}
            style={[styles.ctrlBtn, { backgroundColor: activeCall?.isMuted ? "#fff" : "rgba(255,255,255,0.2)" }]}
          >
            <Feather name={activeCall?.isMuted ? "mic-off" : "mic"} size={24} color={activeCall?.isMuted ? colors.primary : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
            style={[styles.ctrlBtn, { backgroundColor: activeCall?.isSpeakerOn ? "#fff" : "rgba(255,255,255,0.2)" }]}
          >
            <Feather name="volume-2" size={24} color={activeCall?.isSpeakerOn ? colors.primary : "#fff"} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); endCall(); }} style={styles.endBtn}>
          <Feather name="phone-off" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between", paddingHorizontal: 32 },
  callerInfo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  avatarRing: { width: 130, height: 130, borderRadius: 65, borderWidth: 4, borderColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  avatar: { width: 110, height: 110, borderRadius: 55 },
  callerName: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff", marginTop: 20 },
  callStatus: { fontSize: 16, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  costBadge: { backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 4 },
  costText: { color: "#fff", fontSize: 13, fontFamily: "Inter_500Medium" },
  controls: { gap: 32, alignItems: "center", paddingBottom: 20 },
  controlRow: { flexDirection: "row", gap: 24 },
  ctrlBtn: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  endBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },
});
