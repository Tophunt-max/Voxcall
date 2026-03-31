import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useCall } from "@/context/CallContext";
import * as Haptics from "expo-haptics";

export default function VideoCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker } = useCall();
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    const t1 = setTimeout(() => setStatus("ringing"), 1000);
    const t2 = setTimeout(() => setStatus("active"), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (status !== "active") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <View style={styles.screen}>
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

      <View style={[styles.overlay, { paddingTop: topPad + 16, paddingBottom: bottomPad + 20 }]}>
        <View style={styles.topInfo}>
          <Text style={styles.callerName}>{activeCall?.participant.name}</Text>
          <Text style={styles.timer}>{status === "active" ? formatTime(elapsed) : ""}</Text>
        </View>

        <View style={styles.selfPreview}>
          <View style={[styles.selfPreviewBox, { backgroundColor: "#2d2d4e" }]}>
            <Feather name="user" size={24} color="rgba(255,255,255,0.5)" />
          </View>
        </View>

        <View style={styles.bottomControls}>
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleCamera(); }} style={[styles.ctrlBtn, { backgroundColor: activeCall?.isCameraOn ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.8)" }]}>
            <Feather name={activeCall?.isCameraOn ? "camera" : "camera-off"} size={22} color={activeCall?.isCameraOn ? "#fff" : "#333"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMute(); }} style={[styles.ctrlBtn, { backgroundColor: activeCall?.isMuted ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.2)" }]}>
            <Feather name={activeCall?.isMuted ? "mic-off" : "mic"} size={22} color={activeCall?.isMuted ? "#333" : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); endCall(); }} style={styles.endBtn}>
            <Feather name="phone-off" size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Feather name="refresh-cw" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }} style={[styles.ctrlBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
            <Feather name="volume-2" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
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
  topInfo: { alignItems: "center", gap: 4 },
  callerName: { color: "#fff", fontSize: 22, fontFamily: "Poppins_700Bold" },
  timer: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontFamily: "Poppins_400Regular" },
  selfPreview: { alignSelf: "flex-end" },
  selfPreviewBox: { width: 90, height: 130, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bottomControls: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 16 },
  ctrlBtn: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },
});
