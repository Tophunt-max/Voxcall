import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Modal, Animated, Easing, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgIcon } from "@/components/SvgIcon";
import { IconView } from "@/components/IconView";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";

const useNativeDriverValue = Platform.OS !== "web";

let RTCView: any = null;
let CameraView: any = null;
let Haptics: any = null;
try {
  if (Platform.OS !== 'web') {
    RTCView = require('react-native-webrtc').RTCView;
    CameraView = require('expo-camera').CameraView;
  } else {
    CameraView = require('expo-camera').CameraView; // has web support
  }
  Haptics = require('expo-haptics');
} catch {}

// ─── StreamView ──────────────────────────────────────────────────────────────
// Renders a MediaStream as video. Native: RTCView; Web: <video> srcObject.
function StreamView({ stream, style, mirror = false }: { stream: any; style?: any; mirror?: boolean }) {
  const videoRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web' && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) return null;

  if (Platform.OS === 'web') {
    return React.createElement('video', {
      ref: videoRef,
      autoPlay: true,
      playsInline: true,
      muted: mirror, // self-view is muted, remote is not
      style: {
        ...StyleSheet.flatten(style),
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
      },
    });
  }

  if (!RTCView || !stream?.toURL) return null;
  return <RTCView streamURL={stream.toURL()} style={style} objectFit="cover" mirror={mirror} zOrder={mirror ? 1 : 0} />;
}

type PermStep = "camera" | "microphone" | "done";

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker, markCallActive } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  const [permStep, setPermStep] = useState<PermStep | null>(null);
  const [permChecked, setPermChecked] = useState(false);
  const [webrtcReady, setWebrtcReady] = useState(false);

  const { permissions, requestCamera, requestMicrophone, openSettings, refresh } = usePermissions();

  const webrtc = useWebRTC({
    sessionId: activeCall?.sessionId,
    isVideo: true,
    enabled: webrtcReady && !!activeCall?.sessionId,
  });

  useEffect(() => {
    if (webrtc.isConnected && status !== "active") {
      setStatus("active");
      markCallActive();
    }
  }, [webrtc.isConnected, status, markCallActive]);

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  useEffect(() => {
    const check = async () => {
      await refresh();
      setPermChecked(true);
    };
    check();
  }, []);

  useEffect(() => {
    if (!permChecked) return;
    if (permissions.camera.status !== "granted") {
      setPermStep("camera");
    } else if (permissions.microphone.status !== "granted") {
      setPermStep("microphone");
    } else {
      setPermStep("done");
      setWebrtcReady(true);
    }
  }, [permChecked]);

  useEffect(() => {
    const t1 = setTimeout(() => {
      if (status === "connecting") setStatus("ringing");
    }, 2000);
    return () => { clearTimeout(t1); };
  }, [markCallActive]);

  useEffect(() => {
    if (activeCall?.isMuted !== undefined) {
      webrtc.toggleMute(activeCall.isMuted);
    }
  }, [activeCall?.isMuted]);

  useEffect(() => {
    if (activeCall?.isCameraOn !== undefined) {
      webrtc.toggleCamera(activeCall.isCameraOn);
    }
  }, [activeCall?.isCameraOn]);

  const handleEndCall = useCallback(() => {
    webrtc.cleanup();
    endCall();
  }, [endCall, webrtc.cleanup]);

  const handleAutoEnd = useCallback(() => {
    webrtc.cleanup();
    endCall(true);
  }, [endCall, webrtc.cleanup]);

  const { elapsed, remaining, showLowCoinWarning } = useCallTimer({
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
    Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light);
    webrtc.switchCamera();
  };

  const isCameraBlocked = permissions.camera.status === "blocked" ||
    (permissions.camera.status === "denied" && !permissions.camera.canAskAgain);

  const handleCameraAllow = async () => {
    if (isCameraBlocked) {
      openSettings();
      setPermStep("done");
      setWebrtcReady(true);
    } else {
      await requestCamera();
      if (permissions.microphone.status !== "granted") {
        setPermStep("microphone");
      } else {
        setPermStep("done");
        setWebrtcReady(true);
      }
    }
  };

  const handleCameraDeny = () => {
    if (permissions.microphone.status !== "granted") {
      setPermStep("microphone");
    } else {
      setPermStep("done");
      setWebrtcReady(true);
    }
  };

  const isMicBlocked = permissions.microphone.status === "blocked" ||
    (permissions.microphone.status === "denied" && !permissions.microphone.canAskAgain);

  const handleMicAllow = async () => {
    if (isMicBlocked) {
      openSettings();
      setPermStep("done");
      setWebrtcReady(true);
    } else {
      const granted = await requestMicrophone();
      setPermStep("done");
      if (!granted) {
        handleEndCall();
        router.back();
        return;
      }
      setWebrtcReady(true);
    }
  };

  const handleMicDeny = () => {
    setPermStep("done");
    handleEndCall();
    router.back();
  };

  const cameraGranted = permissions.camera.status === "granted";
  const micGranted = permissions.microphone.status === "granted";

  return (
    <View style={styles.screen}>
      <PermissionDialog
        visible={permStep === "camera"}
        config={{ ...PERMISSION_CONFIGS.camera, isBlocked: isCameraBlocked }}
        onAllow={handleCameraAllow}
        onDeny={handleCameraDeny}
      />

      <PermissionDialog
        visible={permStep === "microphone"}
        config={{ ...PERMISSION_CONFIGS.microphone, isBlocked: isMicBlocked }}
        onAllow={handleMicAllow}
        onDeny={handleMicDeny}
      />

      <View style={styles.remoteArea}>
        {webrtc.remoteStream ? (
          <StreamView stream={webrtc.remoteStream} style={styles.remoteVideo} mirror={false} />
        ) : (
          <>
            <Animated.Image
              source={{ uri: remoteAvatarUri }}
              style={[styles.remoteAvatar, { transform: [{ scale: pulse }] }]}
            />
            <View style={styles.remoteGrad} />
          </>
        )}
        {status !== "active" && (
          <View style={styles.connectingBadge}>
            <Text style={styles.connectingText}>
              {status === "connecting" ? "Connecting..." : "Ringing..."}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.selfPreview, { top: insets.top + 12, right: 16 }]}>
        {activeCall?.isCameraOn && cameraGranted ? (
          webrtc.localStream ? (
            <StreamView stream={webrtc.localStream} style={styles.selfCameraView} mirror={true} />
          ) : CameraView ? (
            <CameraView
              style={styles.selfCameraView}
              facing="front"
            />
          ) : null
        ) : (
          <View style={styles.selfCameraOff}>
            <SvgIcon name="camera-off" size={22} color="rgba(255,255,255,0.6)" />
            <Text style={styles.selfCameraOffText}>
              {!cameraGranted ? "No Permission" : "Camera Off"}
            </Text>
          </View>
        )}
        <View style={styles.selfLabel}>
          <Text style={styles.selfLabelText}>You</Text>
        </View>
      </View>

      {permStep === "done" && (!cameraGranted || !micGranted) && (
        <View style={[styles.permMissingBar, { top: insets.top + 8 }]}>
          {!cameraGranted && (
            <TouchableOpacity onPress={() => setPermStep("camera")} style={styles.permChip}>
              <SvgIcon name="camera-off" size={12} color="#FFD166" />
              <Text style={styles.permChipText}>Camera off</Text>
            </TouchableOpacity>
          )}
          {!micGranted && (
            <TouchableOpacity onPress={() => setPermStep("microphone")} style={styles.permChip}>
              <SvgIcon name="mic-off" size={12} color="#FFD166" />
              <Text style={styles.permChipText}>No mic</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View
        style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}
        pointerEvents="box-none"
      >
        {showLowCoinWarning && (
          <View style={styles.warningBanner}>
            <SvgIcon name="alert-triangle" size={13} color="#FFD166" />
            <Text style={styles.warningText}>Call ending soon — {remainingLabel}</Text>
          </View>
        )}

        {webrtc.error && !showLowCoinWarning && (
          <View style={styles.warningBanner}>
            <SvgIcon name="wifi-off" size={13} color="#FF6B6B" />
            <Text style={styles.warningText}>Connection issue</Text>
          </View>
        )}

        {!showLowCoinWarning && !webrtc.error && <View />}

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
                  <SvgIcon name="clock" size={10} color={remaining != null && remaining <= 60 ? "#FF6B6B" : "rgba(255,255,255,0.7)"} />
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

        <View style={styles.bottomControls}>
          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleCamera(); }}
              style={[styles.ctrlBtn, !activeCall?.isCameraOn && styles.ctrlBtnOff]}
            >
              <SvgIcon name={activeCall?.isCameraOn ? "camera" : "camera-off"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isCameraOn ? "Camera" : "Cam Off"}</Text>
          </View>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleMute(); }}
              style={[styles.ctrlBtn, activeCall?.isMuted && styles.ctrlBtnOff]}
            >
              <IconView name={activeCall?.isMuted ? "mic-off" : "mic"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
          </View>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.notificationAsync?.(Haptics?.NotificationFeedbackType?.Warning); handleEndCall(); }}
              style={styles.endBtn}
            >
              <SvgIcon name="phone-off" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>End</Text>
          </View>

          <View style={styles.ctrlItem}>
            <TouchableOpacity onPress={handleFlip} style={styles.ctrlBtn}>
              <SvgIcon name="refresh" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>Flip</Text>
          </View>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
            >
              <IconView name={activeCall?.isSpeakerOn ? "volume-2" : "volume-x"} size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isSpeakerOn ? "Speaker" : "Earpiece"}</Text>
          </View>
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a14" },

  remoteArea: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12102a",
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  remoteAvatar: {
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 3, borderColor: "rgba(160, 14, 231, 0.5)",
  },
  remoteGrad: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 10, 20, 0.35)",
  },
  connectingBadge: {
    position: "absolute", bottom: 110, alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  connectingText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_500Medium" },

  selfPreview: {
    position: "absolute", width: 110, height: 160,
    borderRadius: 16, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "#1a1a2e", zIndex: 10,
  },
  selfCameraView: { flex: 1 },
  selfCameraOff: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#1a1a2e",
  },
  selfCameraOffText: {
    color: "rgba(255,255,255,0.5)", fontSize: 10,
    fontFamily: "Poppins_400Regular", textAlign: "center",
  },
  selfLabel: {
    position: "absolute", bottom: 6, left: 0, right: 0, alignItems: "center",
  },
  selfLabelText: {
    color: "#fff", fontSize: 11, fontFamily: "Poppins_600SemiBold",
    textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  permMissingBar: {
    position: "absolute", left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 8, zIndex: 20,
  },
  permChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,165,0,0.25)", borderWidth: 1,
    borderColor: "rgba(255,165,0,0.4)", paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 20,
  },
  permChipText: { color: "#FFD166", fontSize: 11, fontFamily: "Poppins_500Medium" },

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

  bottomControls: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 4 },
  ctrlItem: { alignItems: "center", gap: 6, flex: 1 },
  ctrlBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  ctrlBtnOff: { backgroundColor: "rgba(255,59,48,0.7)" },
  ctrlBtnActive: { backgroundColor: "rgba(255,255,255,0.4)" },
  ctrlLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Poppins_400Regular", textAlign: "center" },
  endBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#E84855", shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },

});
