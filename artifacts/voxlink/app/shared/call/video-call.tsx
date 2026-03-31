import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import * as Haptics from "expo-haptics";

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  useEffect(() => {
    const t1 = setTimeout(() => setStatus("ringing"), 1000);
    const t2 = setTimeout(() => setStatus("active"), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleAutoEnd = useCallback(() => { endCall(true); }, [endCall]);

  const { elapsed, remaining, showLowCoinWarning, showRechargePopup, dismissRechargePopup } = useCallTimer({
    isActive: status === "active",
    maxSeconds: activeCall?.maxSeconds,
    onAutoEnd: handleAutoEnd,
  });

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const remainingLabel = remaining != null
    ? remaining <= 60
      ? `${remaining}s left`
      : `${Math.ceil(remaining / 60)} min left`
    : null;

  return (
    <View style={styles.screen}>
      {/* Remote Video Area */}
      <View style={[styles.remoteVideo, { backgroundColor: "#1a1a2e" }]}>
        <Image
          source={{ uri: activeCall?.participant.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id}` }}
          style={styles.remoteAvatar}
        />
        {status !== "active" && (
          <View style={styles.statusOverlay}>
            <Text style={styles.statusText}>{status === "connecting" ? "Connecting..." : "Ringing..."}</Text>
          </View>
        )}
      </View>

      {/* Overlay UI */}
      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>

        {/* Low Coin Warning Banner */}
        {showLowCoinWarning && (
          <View style={styles.warningBanner}>
            <Feather name="alert-triangle" size={13} color="#FFD166" />
            <Text style={styles.warningText}>
              Low coins — {remainingLabel}
            </Text>
          </View>
        )}

        {/* Top Info */}
        <View style={styles.topInfo}>
          <Text style={styles.callerName}>{activeCall?.participant.name}</Text>
          <View style={styles.timerRow}>
            <Text style={styles.timer}>{status === "active" ? formatTime(elapsed) : ""}</Text>
            {remainingLabel && status === "active" && (
              <View style={[styles.remainingBadge, remaining != null && remaining <= 60 && styles.remainingBadgeLow]}>
                <Feather name="clock" size={11} color={remaining != null && remaining <= 60 ? "#FF6B6B" : "rgba(255,255,255,0.7)"} />
                <Text style={[styles.remainingText, remaining != null && remaining <= 60 && { color: "#FF6B6B" }]}>
                  {remainingLabel}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Self Preview */}
        <View style={styles.selfPreview}>
          <View style={[styles.selfPreviewBox, { backgroundColor: "#2d2d4e" }]}>
            <Feather name="user" size={24} color="rgba(255,255,255,0.5)" />
          </View>
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleCamera(); }}
            style={[styles.ctrlBtn, { backgroundColor: activeCall?.isCameraOn ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.8)" }]}
          >
            <Feather name={activeCall?.isCameraOn ? "camera" : "camera-off"} size={22} color={activeCall?.isCameraOn ? "#fff" : "#333"} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }}
            style={[styles.ctrlBtn, { backgroundColor: activeCall?.isMuted ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)" }]}
          >
            <Feather name={activeCall?.isMuted ? "mic-off" : "mic"} size={22} color={activeCall?.isMuted ? "#333" : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); endCall(); }}
            style={styles.endBtn}
          >
            <Feather name="phone-off" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Feather name="refresh-cw" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
            style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
          >
            <Feather name="volume-2" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Recharge Popup — Last 5 Seconds */}
      <Modal visible={showRechargePopup} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.rechargeCard}>
            <Text style={styles.rechargeEmoji}>💰</Text>
            <Text style={styles.rechargeTitle}>Coins Khatam Ho Rahe Hain!</Text>
            <Text style={styles.rechargeSubtitle}>
              {remaining != null ? `${remaining} second` : "Kuch second"}
              {remaining === 1 ? "" : "s"} mein call auto-disconnect hoga
            </Text>
            <TouchableOpacity
              style={styles.rechargeBtn}
              onPress={() => {
                dismissRechargePopup();
                endCall();
                router.push("/user/screens/user/wallet");
              }}
            >
              <Text style={styles.rechargeBtnText}>Abhi Recharge Karo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueBtn} onPress={dismissRechargePopup}>
              <Text style={styles.continueBtnText}>Continue Karo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  remoteVideo: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  remoteAvatar: { width: 160, height: 160, borderRadius: 80, opacity: 0.7 },
  statusOverlay: { position: "absolute", bottom: 100, left: 0, right: 0, alignItems: "center" },
  statusText: { color: "rgba(255,255,255,0.8)", fontSize: 16, fontFamily: "Poppins_400Regular" },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between", paddingHorizontal: 20 },

  warningBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255, 107, 107, 0.3)",
    borderWidth: 1, borderColor: "rgba(255,107,107,0.5)",
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, alignSelf: "center",
  },
  warningText: { color: "#FFD166", fontSize: 12, fontFamily: "Poppins_600SemiBold" },

  topInfo: { alignItems: "center", gap: 4, paddingTop: 8 },
  callerName: { color: "#fff", fontSize: 22, fontFamily: "Poppins_700Bold" },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timer: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontFamily: "Poppins_400Regular" },
  remainingBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12,
  },
  remainingBadgeLow: { backgroundColor: "rgba(255,107,107,0.2)", borderWidth: 1, borderColor: "rgba(255,107,107,0.4)" },
  remainingText: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "Poppins_600SemiBold" },

  selfPreview: { alignSelf: "flex-end" },
  selfPreviewBox: { width: 90, height: 130, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  bottomControls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 16 },
  ctrlBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "flex-end", paddingBottom: 40, paddingHorizontal: 20,
  },
  rechargeCard: {
    backgroundColor: "#fff", borderRadius: 24,
    padding: 28, width: "100%",
    alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  rechargeEmoji: { fontSize: 48 },
  rechargeTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#1a1a2e", textAlign: "center" },
  rechargeSubtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#666", textAlign: "center", lineHeight: 20 },
  rechargeBtn: {
    backgroundColor: "#A00EE7", borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 32,
    width: "100%", alignItems: "center", marginTop: 4,
  },
  rechargeBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  continueBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  continueBtnText: { color: "#888", fontSize: 14, fontFamily: "Poppins_400Regular" },
});
