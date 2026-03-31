import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useCall } from "@/context/CallContext";
import * as Haptics from "expo-haptics";

export default function AudioCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleSpeaker } = useCall();
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    ).start();
    const t1 = setTimeout(() => setStatus("ringing"), 1000);
    const t2 = setTimeout(() => setStatus("active"), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (status !== "active") return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const statusLabel = status === "active" ? fmt(elapsed) : status === "ringing" ? "Ringing..." : "Connecting...";

  return (
    <LinearGradient
      colors={["#200060", "#4B0082", "#1A0040"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
    >
      {/* Caller Info */}
      <View style={styles.callerSection}>
        <Text style={styles.callTypeLabel}>Voice Call</Text>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulse }] }]}>
          <View style={styles.avatarInner}>
            <Image
              source={{ uri: activeCall?.participant.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id}` }}
              style={styles.avatar}
            />
          </View>
        </Animated.View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? "Unknown"}</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        {activeCall?.coinsPerMinute ? (
          <View style={styles.costBadge}>
            <Image source={require("@/assets/icons/ic_coin.png")} style={styles.coinIcon} resizeMode="contain" />
            <Text style={styles.costText}>{activeCall.coinsPerMinute} coins / min</Text>
          </View>
        ) : null}
      </View>

      {/* Controls */}
      <View style={styles.controlsSection}>
        <View style={styles.controlRow}>
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }}
              style={[styles.ctrlBtn, activeCall?.isMuted && styles.ctrlBtnActive]}
            >
              <Feather name={activeCall?.isMuted ? "mic-off" : "mic"} size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); endCall(); }}
            style={styles.endBtn}
          >
            <Feather name="phone-off" size={30} color="#fff" />
          </TouchableOpacity>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
            >
              <Feather name="volume-2" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isSpeakerOn ? "Speaker On" : "Speaker"}</Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between" },
  callerSection: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  callTypeLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular", letterSpacing: 1, textTransform: "uppercase" },
  avatarRing: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatarInner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
  },
  avatar: { width: "100%", height: "100%" },
  callerName: { fontSize: 28, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 8 },
  statusLabel: { fontSize: 16, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)" },
  costBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  coinIcon: { width: 16, height: 16 },
  costText: { color: "#FFD166", fontSize: 13, fontFamily: "Poppins_600SemiBold" },

  controlsSection: { paddingHorizontal: 32, paddingBottom: 16, width: "100%" },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ctrlItem: { alignItems: "center", gap: 8 },
  ctrlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlBtnActive: { backgroundColor: "rgba(255,255,255,0.35)" },
  ctrlLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Poppins_400Regular" },
  endBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#E84855",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#E84855",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
