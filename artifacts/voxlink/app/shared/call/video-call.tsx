import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Modal, Animated, Easing,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import * as Haptics from "expo-haptics";

type Facing = "front" | "back";

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker, markCallActive } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");
  const [facing, setFacing] = useState<Facing>("front");
  const [permission, requestPermission] = useCameraPermissions();

  // Pulse animation for remote avatar
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => setStatus("ringing"), 1000);
    const t2 = setTimeout(() => {
      setStatus("active");
      markCallActive();
    }, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [markCallActive]);

  const handleAutoEnd = useCallback(() => { endCall(true); }, [endCall]);

  const { elapsed, remaining, showLowCoinWarning, showRechargePopup, dismissRechargePopup } = useCallTimer({
    isActive: status === "active",
    maxSeconds: activeCall?.maxSeconds,
    onAutoEnd: handleAutoEnd,
  });

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const remainingLabel = remaining != null
    ? remaining <= 60 ? `${remaining}s left` : `${Math.ceil(remaining / 60)} min left`
    : null;

  const remoteAvatarUri = activeCall?.participant.avatar ??
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeCall?.participant.id ?? "host"}`;

  const handleFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing(f => f === "front" ? "back" : "front");
  };

  return (
    <View style={styles.screen}>

      {/* ── REMOTE VIDEO (full-screen background) ── */}
      <View style={styles.remoteArea}>
        <Animated.Image
          source={{ uri: remoteAvatarUri }}
          style={[styles.remoteAvatar, { transform: [{ scale: pulse }] }]}
        />
        <View style={styles.remoteGrad} />
        {status !== "active" && (
          <View style={styles.connectingBadge}>
            <Text style={styles.connectingText}>
              {status === "connecting" ? "Connecting..." : "Ringing..."}
            </Text>
          </View>
        )}
      </View>

      {/* ── LOCAL CAMERA (self preview, corner PiP) ── */}
      <View style={[styles.selfPreview, { top: insets.top + 12, right: 16 }]}>
        {activeCall?.isCameraOn && permission?.granted ? (
          <CameraView
            style={styles.selfCameraView}
            facing={facing}
          />
        ) : (
          <View style={styles.selfCameraOff}>
            <Feather name={permission?.granted ? "camera-off" : "slash"} size={22} color="rgba(255,255,255,0.6)" />
            <Text style={styles.selfCameraOffText}>
              {permission?.granted ? "Camera Off" : "No Permission"}
            </Text>
          </View>
        )}
        {/* Self label */}
        <View style={styles.selfLabel}>
          <Text style={styles.selfLabelText}>You</Text>
        </View>
      </View>

      {/* ── OVERLAY UI ── */}
      <View
        style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}
        pointerEvents="box-none"
      >
        {/* Low Coin Warning */}
        {showLowCoinWarning && (
          <View style={styles.warningBanner}>
            <Feather name="alert-triangle" size={13} color="#FFD166" />
            <Text style={styles.warningText}>Low coins — {remainingLabel}</Text>
          </View>
        )}

        {/* Top info (spacer when no warning) */}
        {!showLowCoinWarning && <View />}

        {/* Remote participant name + timer */}
        <View style={styles.remoteInfo}>
          <Text style={styles.remoteName}>{activeCall?.participant.name ?? "Connecting..."}</Text>
          {status === "active" && (
            <View style={styles.timerRow}>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
              <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
              {remainingLabel && (
                <View style={[styles.remainingBadge, remaining != null && remaining <= 60 && styles.remainingBadgeLow]}>
                  <Feather name="clock" size={10} color={remaining != null && remaining <= 60 ? "#FF6B6B" : "rgba(255,255,255,0.7)"} />
                  <Text style={[styles.remainingText, remaining != null && remaining <= 60 && { color: "#FF6B6B" }]}>
                    {remainingLabel}
                  </Text>
                </View>
              )}
            </View>
          )}
          {status !== "active" && (
            <Text style={styles.statusSubText}>
              {status === "connecting" ? "Setting up secure connection..." : "Waiting for response..."}
            </Text>
          )}
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          {/* Camera toggle */}
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleCamera(); }}
              style={[styles.ctrlBtn, !activeCall?.isCameraOn && styles.ctrlBtnOff]}
            >
              <Feather name={activeCall?.isCameraOn ? "camera" : "camera-off"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isCameraOn ? "Camera" : "Camera Off"}</Text>
          </View>

          {/* Mute */}
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }}
              style={[styles.ctrlBtn, activeCall?.isMuted && styles.ctrlBtnOff]}
            >
              <Feather name={activeCall?.isMuted ? "mic-off" : "mic"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
          </View>

          {/* End Call */}
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); endCall(); }}
              style={styles.endBtn}
            >
              <Feather name="phone-off" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>End</Text>
          </View>

          {/* Flip Camera */}
          <View style={styles.ctrlItem}>
            <TouchableOpacity onPress={handleFlip} style={styles.ctrlBtn}>
              <Feather name="refresh-cw" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>Flip</Text>
          </View>

          {/* Speaker */}
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
            >
              <Feather name={activeCall?.isSpeakerOn ? "volume-2" : "volume-x"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isSpeakerOn ? "Speaker" : "Earpiece"}</Text>
          </View>
        </View>
      </View>

      {/* Recharge Popup */}
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
              onPress={() => { dismissRechargePopup(); endCall(); router.push("/user/screens/user/wallet"); }}
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
  screen: { flex: 1, backgroundColor: "#0a0a14" },

  // Remote video area (full screen bg)
  remoteArea: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12102a",
  },
  remoteAvatar: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: "rgba(160, 14, 231, 0.5)",
  },
  remoteGrad: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 10, 20, 0.35)",
  },
  connectingBadge: {
    position: "absolute",
    bottom: 110,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  connectingText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_500Medium" },

  // Self preview (PiP)
  selfPreview: {
    position: "absolute",
    width: 110,
    height: 160,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "#1a1a2e",
    zIndex: 10,
  },
  selfCameraView: { flex: 1 },
  selfCameraOff: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1a1a2e",
  },
  selfCameraOffText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
  },
  selfLabel: {
    position: "absolute",
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  selfLabelText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Poppins_600SemiBold",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  warningBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255, 107, 107, 0.3)",
    borderWidth: 1, borderColor: "rgba(255,107,107,0.5)",
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, alignSelf: "center",
  },
  warningText: { color: "#FFD166", fontSize: 12, fontFamily: "Poppins_600SemiBold" },

  // Remote info (bottom of main area, above controls)
  remoteInfo: { alignItems: "center", gap: 6, paddingBottom: 8 },
  remoteName: { color: "#fff", fontSize: 24, fontFamily: "Poppins_700Bold", textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveIndicator: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,59,48,0.85)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 1 },
  timerText: { color: "rgba(255,255,255,0.9)", fontSize: 16, fontFamily: "Poppins_500Medium" },
  remainingBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  remainingBadgeLow: { backgroundColor: "rgba(255,107,107,0.2)", borderWidth: 1, borderColor: "rgba(255,107,107,0.4)" },
  remainingText: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "Poppins_600SemiBold" },
  statusSubText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: "Poppins_400Regular" },

  // Controls
  bottomControls: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 4 },
  ctrlItem: { alignItems: "center", gap: 6, flex: 1 },
  ctrlBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  ctrlBtnOff: { backgroundColor: "rgba(255,59,48,0.7)" },
  ctrlBtnActive: { backgroundColor: "rgba(255,255,255,0.4)" },
  ctrlLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#E84855", shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "flex-end", paddingBottom: 40, paddingHorizontal: 20 },
  rechargeCard: { backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", alignItems: "center", gap: 12, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 },
  rechargeEmoji: { fontSize: 48 },
  rechargeTitle: { fontSize: 20, fontFamily: "Poppins_700Bold", color: "#1a1a2e", textAlign: "center" },
  rechargeSubtitle: { fontSize: 14, fontFamily: "Poppins_400Regular", color: "#666", textAlign: "center", lineHeight: 20 },
  rechargeBtn: { backgroundColor: "#A00EE7", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32, width: "100%", alignItems: "center", marginTop: 4 },
  rechargeBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  continueBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  continueBtnText: { color: "#888", fontSize: 14, fontFamily: "Poppins_400Regular" },
});
