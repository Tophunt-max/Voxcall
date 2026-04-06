import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Animated, Easing, Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import * as Haptics from "expo-haptics";

export default function AudioCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleSpeaker, markCallActive } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");
  const [showMicDialog, setShowMicDialog] = useState(false);
  const [micChecked, setMicChecked] = useState(false);

  const { permissions, requestMicrophone, openSettings, refresh } = usePermissions();
  const { onEvent } = useSocket();
  const pulse = useRef(new Animated.Value(1)).current;

  const [webrtcReady, setWebrtcReady] = useState(false);
  const webrtc = useWebRTC({
    sessionId: activeCall?.sessionId,
    isVideo: false,
    enabled: webrtcReady && !!activeCall?.sessionId,
  });

  useEffect(() => {
    if (webrtc.isConnected && status !== "active") {
      setStatus("active");
      markCallActive();
    }
  }, [webrtc.isConnected, status, markCallActive]);

  useEffect(() => {
    const checkMic = async () => {
      await refresh();
      setMicChecked(true);
    };
    checkMic();
  }, []);

  useEffect(() => {
    if (micChecked && permissions.microphone.status !== "granted") {
      setShowMicDialog(true);
    } else if (micChecked && permissions.microphone.status === "granted") {
      setWebrtcReady(true);
    }
  }, [micChecked, permissions.microphone.status]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    anim.start();
    const t1 = setTimeout(() => {
      if (status === "connecting") setStatus("ringing");
    }, 2000);
    return () => { anim.stop(); clearTimeout(t1); };
  }, []);

  useEffect(() => {
    if (activeCall?.isMuted !== undefined) {
      webrtc.toggleMute(activeCall.isMuted);
    }
  }, [activeCall?.isMuted]);

  useEffect(() => {
    if (webrtc.error) {
      const isPermissionError =
        /permission/i.test(webrtc.error) ||
        /NotAllowed/i.test(webrtc.error) ||
        /not allowed/i.test(webrtc.error);
      if (isPermissionError) {
        webrtc.clearError();
        setWebrtcReady(false);
        setShowMicDialog(true);
      }
    }
  }, [webrtc.error, webrtc.clearError]);

  useEffect(() => {
    const off = onEvent(SocketEvents.PEER_TRACKS_READY, () => {
      webrtc.triggerPull();
    });
    return off;
  }, [onEvent, webrtc.triggerPull]);

  // FIX: Handle remote party ending the call — clean up and show call summary
  useEffect(() => {
    const off = onEvent(SocketEvents.CALL_END, () => {
      webrtc.cleanup();
      endCall(true);
    });
    return off;
  }, [onEvent, webrtc.cleanup, endCall]);

  const handleEndCall = useCallback(() => {
    webrtc.cleanup();
    endCall();
  }, [endCall, webrtc.cleanup]);

  const handleAutoEnd = useCallback(() => {
    webrtc.cleanup();
    endCall(true);
  }, [endCall, webrtc.cleanup]);

  const { elapsed, remaining, showLowCoinWarning, showRechargePopup, dismissRechargePopup } = useCallTimer({
    isActive: status === "active",
    maxSeconds: activeCall?.maxSeconds,
    startTimeMs: activeCall?.startTime,
    onAutoEnd: handleAutoEnd,
  });

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const statusLabel = status === "active" ? fmt(elapsed) : status === "ringing" ? "Ringing..." : "Connecting...";

  const remainingLabel = remaining != null
    ? remaining <= 60
      ? `${remaining}s remaining`
      : `${Math.ceil(remaining / 60)} min left`
    : null;

  const isBlocked = permissions.microphone.status === "blocked" ||
    (permissions.microphone.status === "denied" && !permissions.microphone.canAskAgain);

  const handleMicAllow = async () => {
    if (isBlocked) {
      openSettings();
      setShowMicDialog(false);
    } else {
      const granted = await requestMicrophone();
      setShowMicDialog(false);
      if (granted) {
        setWebrtcReady(true);
      } else {
        handleEndCall();
        router.back();
      }
    }
  };

  const handleMicDeny = () => {
    setShowMicDialog(false);
    handleEndCall();
    router.back();
  };

  return (
    <LinearGradient
      colors={["#200060", "#4B0082", "#1A0040"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
    >
      <PermissionDialog
        visible={showMicDialog}
        config={{ ...PERMISSION_CONFIGS.microphone, isBlocked }}
        onAllow={handleMicAllow}
        onDeny={handleMicDeny}
      />

      {micChecked && permissions.microphone.status !== "granted" && !showMicDialog && (
        <TouchableOpacity onPress={() => setShowMicDialog(true)} style={styles.permBanner}>
          <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 14, height: 14, tintColor: "#FFD166" }} resizeMode="contain" />
          <Text style={styles.permBannerText}>Microphone access needed — Tap to fix</Text>
        </TouchableOpacity>
      )}

      {showLowCoinWarning && (
        <View style={styles.warningBanner}>
          <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 14, height: 14, tintColor: "#FFD166" }} resizeMode="contain" />
          <Text style={styles.warningText}>
            Coins running low — {remainingLabel}
          </Text>
        </View>
      )}

      {webrtc.error && (
        <View style={styles.warningBanner}>
          <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 14, height: 14, tintColor: "#FF6B6B" }} resizeMode="contain" />
          <Text style={styles.warningText} numberOfLines={2}>{webrtc.error}</Text>
        </View>
      )}

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

        <View style={styles.badgeRow}>
          {activeCall?.coinsPerMinute ? (
            <View style={styles.costBadge}>
              <Text style={styles.coinEmoji}>🪙</Text>
              <Text style={styles.costText}>{activeCall.coinsPerMinute} coins / min</Text>
            </View>
          ) : null}
          {remainingLabel && status === "active" && (
            <View style={[styles.costBadge, remaining != null && remaining <= 60 ? styles.warningBadge : {}]}>
              <Image source={require("@/assets/icons/ic_calendar.png")} style={{ width: 12, height: 12, tintColor: remaining != null && remaining <= 60 ? "#FF6B6B" : "rgba(255,255,255,0.7)" }} resizeMode="contain" />
              <Text style={[styles.costText, remaining != null && remaining <= 60 && { color: "#FF6B6B" }]}>
                {remainingLabel}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.controlsSection}>
        <View style={styles.controlRow}>
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }}
              style={[styles.ctrlBtn, activeCall?.isMuted && styles.ctrlBtnActive]}
            >
              <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 26, height: 26, tintColor: "#fff", opacity: activeCall?.isMuted ? 0.4 : 1 }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); handleEndCall(); }}
            style={styles.endBtn}
          >
            <Image source={require("@/assets/icons/ic_call_end.png")} style={{ width: 30, height: 30, tintColor: "#fff" }} resizeMode="contain" />
          </TouchableOpacity>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
            >
              <Image source={activeCall?.isSpeakerOn ? require("@/assets/icons/ic_speaker_on.png") : require("@/assets/icons/ic_speaker_off.png")} style={{ width: 26, height: 26, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isSpeakerOn ? "Speaker On" : "Speaker"}</Text>
          </View>
        </View>
      </View>

      <Modal visible={showRechargePopup} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.rechargeCard}>
            <Text style={styles.rechargeEmoji}>💰</Text>
            <Text style={styles.rechargeTitle}>Running Out of Coins!</Text>
            <Text style={styles.rechargeSubtitle}>
              Call will auto-disconnect in {remaining != null ? `${remaining} second${remaining === 1 ? "" : "s"}` : "a few seconds"}
            </Text>
            <TouchableOpacity
              style={styles.rechargeBtn}
              onPress={() => {
                dismissRechargePopup();
                handleEndCall();
                router.push("/user/screens/home/wallet");
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
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between" },

  permBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 165, 0, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(255, 165, 0, 0.5)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    marginHorizontal: 20,
  },
  permBannerText: { color: "#FFD166", fontSize: 12, fontFamily: "Poppins_500Medium", flex: 1 },

  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 107, 107, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(255, 107, 107, 0.5)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    marginHorizontal: 20,
  },
  warningText: { color: "#FFD166", fontSize: 13, fontFamily: "Poppins_600SemiBold", flex: 1 },

  callerSection: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  callTypeLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular", letterSpacing: 1, textTransform: "uppercase" },
  avatarRing: {
    width: 148, height: 148, borderRadius: 74,
    borderWidth: 2.5, borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatarInner: {
    width: 120, height: 120, borderRadius: 60,
    overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.4)",
  },
  avatar: { width: "100%", height: "100%" },
  callerName: { fontSize: 28, fontFamily: "Poppins_700Bold", color: "#fff", marginTop: 8 },
  statusLabel: { fontSize: 16, fontFamily: "Poppins_400Regular", color: "rgba(255,255,255,0.75)" },

  badgeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  costBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  warningBadge: { backgroundColor: "rgba(255, 107, 107, 0.2)", borderWidth: 1, borderColor: "rgba(255,107,107,0.4)" },
  coinEmoji: { fontSize: 14 },
  costText: { color: "#FFD166", fontSize: 12, fontFamily: "Poppins_600SemiBold" },

  controlsSection: { paddingHorizontal: 32, paddingBottom: 16, width: "100%" },
  controlRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ctrlItem: { alignItems: "center", gap: 8 },
  ctrlBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  ctrlBtnActive: { backgroundColor: "rgba(255,255,255,0.35)" },
  ctrlLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Poppins_400Regular" },
  endBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "#E84855",
    alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#E84855",
    shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 24,
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
    width: "100%", alignItems: "center",
    marginTop: 4,
  },
  rechargeBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold" },
  continueBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  continueBtnText: { color: "#888", fontSize: 14, fontFamily: "Poppins_400Regular" },
});
