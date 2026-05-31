import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity,
  Animated, Easing, Platform, BackHandler } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgIcon } from "@/components/SvgIcon";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { API } from "@/services/api";
import * as Haptics from "expo-haptics";

const useNativeDriverValue = Platform.OS !== "web";

// FIX (no-audio bug): on web, the remote audio track will not play unless
// it is attached to an <audio>/<video> element. The peer connection alone
// does not produce sound. Mount a hidden <audio srcObject={remoteStream}/>
// so audio calls actually have audio on web. On native, react-native-webrtc
// routes audio through the audio session automatically — no element needed.
function RemoteAudioMount({ stream }: { stream: any }) {
  const ref = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch {}
    const tryPlay = () => {
      const p = el.play?.();
      if (p && typeof p.catch === "function") {
        p.catch((err: any) => {
          console.warn("[audio-call] remote audio play() rejected:", err?.message ?? err);
          const retry = () => {
            el.play?.().catch(() => {});
            try { window.removeEventListener("click", retry); } catch {}
            try { window.removeEventListener("touchend", retry); } catch {}
          };
          try {
            window.addEventListener("click", retry, { once: true } as any);
            window.addEventListener("touchend", retry, { once: true } as any);
          } catch {}
        });
      }
    };
    tryPlay();
  }, [stream]);
  if (Platform.OS !== "web" || !stream) return null;
  return React.createElement("audio", {
    ref,
    autoPlay: true,
    playsInline: true,
    style: { width: 1, height: 1, opacity: 0, position: "absolute", pointerEvents: "none" },
  });
}

export default function AudioCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleSpeaker, markCallActive } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");
  const [showMicDialog, setShowMicDialog] = useState(false);

  const { permissions, requestMicrophone, openSettings, loaded } = usePermissions();
  const { onEvent } = useSocket();
  const pulse = useRef(new Animated.Value(1)).current;

  const [webrtcReady, setWebrtcReady] = useState(false);
  // FIX (repeated permission popup): one-shot guards — see video-call.tsx.
  // permGateDoneRef stops the initial mic gate from re-firing; permRepromptedRef
  // stops the WebRTC error handler from reopening the mic dialog in a loop.
  const permGateDoneRef = useRef(false);
  const permRepromptedRef = useRef(false);
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

  // FIX (permission flash bug): see voxlink-host/hooks/usePermissions.ts.
  // Wait for the hook's `loaded` flag instead of running a redundant
  // refresh() and flipping a local `micChecked` state. Without this, the
  // mic dialog flashed open even when the OS had granted the permission.
  useEffect(() => {
    if (!loaded) return;
    // FIX (repeated permission popup): run the initial mic gate only once.
    if (permGateDoneRef.current) return;
    if (permissions.microphone.status !== "granted") {
      setShowMicDialog(true);
    } else {
      permGateDoneRef.current = true;
      setWebrtcReady(true);
    }
  }, [loaded, permissions.microphone.status]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
      ])
    ).start();
    // FIX BUG-3: Host navigates to audio-call AFTER accepting — no point showing "Ringing..."
    return () => {};
  }, []);

  useEffect(() => {
    if (activeCall?.isMuted !== undefined) {
      webrtc.toggleMute(activeCall.isMuted);
    }
  }, [activeCall?.isMuted]);

  // FIX (#1): apply speaker/earpiece routing when the Speaker button toggles
  // isSpeakerOn. Drives InCallManager on native; no-op on web.
  useEffect(() => {
    if (activeCall?.isSpeakerOn !== undefined) {
      webrtc.setSpeaker(activeCall.isSpeakerOn);
    }
  }, [activeCall?.isSpeakerOn]);

  useEffect(() => {
    if (webrtc.error) {
      const isPermissionError =
        /permission/i.test(webrtc.error) ||
        /NotAllowed/i.test(webrtc.error) ||
        /not allowed/i.test(webrtc.error);
      // FIX (repeated permission popup): re-prompt ONLY when the OS still
      // reports the mic as missing AND we haven't re-prompted already this
      // call. Otherwise clear the error without reopening the dialog so a
      // non-permission getUserMedia failure can't loop the popup.
      const micMissing = permissions.microphone.status !== "granted";
      if (isPermissionError && micMissing && !permRepromptedRef.current) {
        permRepromptedRef.current = true;
        webrtc.clearError();
        setWebrtcReady(false);
        setShowMicDialog(true);
        return;
      }
      if (isPermissionError) {
        webrtc.clearError();
        return;
      }
      // FIX BUG-4: Fatal WebRTC/CF session error — auto-end call
      const isFatalError =
        /session_error/i.test(webrtc.error) ||
        /410/i.test(webrtc.error) ||
        /session.*expired/i.test(webrtc.error);
      if (isFatalError) {
        webrtc.cleanup();
        endCall(false);
      }
    }
  }, [webrtc.error, webrtc.clearError, webrtc.cleanup, endCall, permissions.microphone.status]);

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

  // FIX (call-disconnect propagation safety net): if WebRTC stays in
  // 'disconnected' or 'failed' for longer than 15 s, the user most likely
  // hung up and the WS-driven CALL_END was missed (host's WS offline). Auto-
  // end so the host is not stuck on the call screen and billing stops.
  useEffect(() => {
    if (status !== "active") return;
    const s = webrtc.connectionState;
    if (s !== "disconnected" && s !== "failed") return;
    const t = setTimeout(() => {
      console.warn("[host audio-call] Connection stayed", s, "for 15s — auto-ending");
      webrtc.cleanup();
      endCall(true);
    }, 15000);
    return () => clearTimeout(t);
  }, [webrtc.connectionState, status, webrtc.cleanup, endCall]);

  // FIX (connecting timeout): if WebRTC never reaches `connected` state within
  // 30 s of mount, the call is stalled (CF Calls negotiation hung, ICE timed
  // out, etc.). Auto-end so the host is not stuck on "Connecting..." while
  // the server keeps the session (and the caller) alive.
  useEffect(() => {
    if (status === "active") return;
    if (!webrtcReady) return;
    const t = setTimeout(() => {
      if (!webrtc.isConnected) {
        console.warn("[host audio-call] Did not connect within 30s — auto-ending");
        webrtc.cleanup();
        endCall(true);
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [status, webrtcReady, webrtc.isConnected, webrtc.cleanup, endCall]);

  // FIX (call-disconnect propagation safety net #2): poll the server every 10s
  // while active. Catches sessions that ended server-side (cron reaper, /end
  // with both WS and FCM lost, force-quit on the other device). 404 = pruned,
  // also treated as ended.
  useEffect(() => {
    if (status !== "active" || !activeCall?.sessionId) return;
    const sid = activeCall.sessionId;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const sess: any = await API.getCallSession(sid);
        if (cancelled) return;
        if (sess?.status === "ended" || sess?.status === "missed" || sess?.status === "declined") {
          console.warn("[host audio-call] Server reports session", sess.status, "— cleaning up");
          webrtc.cleanup();
          endCall(true);
        }
      } catch (e: any) {
        if (/not found|404/i.test(String(e?.message ?? ""))) {
          if (!cancelled) {
            webrtc.cleanup();
            endCall(true);
          }
        }
      }
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status, activeCall?.sessionId, webrtc.cleanup, endCall]);

  // FIX (back-navigation: double-call guard) — see voxlink-host/app/calls/
  // video-call.tsx for full rationale. Prevents rapid back-press from racing
  // a second handleEndCall on top of the first one's router.replace.
  const isEndingRef = useRef(false);
  const handleEndCall = useCallback(() => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    webrtc.cleanup();
    endCall();
  }, [endCall, webrtc.cleanup]);

  // Phase 3 Fix: Block Android hardware back button during an active host call.
  // A host pressing back would leave the call orphaned on the server — user still
  // billed, host earning coins with no way to end the session from the UI.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleEndCall();
      return true;
    });
    return () => sub.remove();
  }, [handleEndCall]);

  // FIX (back-navigation, web beforeunload) — see video-call.tsx for full
  // rationale. Without this, closing the tab during a call leaves the
  // session in 'active' until the 30-min cron reaper, billing the caller
  // for every passing minute.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      const sid = activeCall?.sessionId;
      if (sid && status === 'active') {
        try {
          const url = `${(process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '')}/api/calls/${sid}/end`;
          const blob = new Blob([JSON.stringify({ duration_seconds: 0 })], { type: 'application/json' });
          (navigator as any).sendBeacon?.(url, blob);
        } catch { /* best-effort */ }
        e.preventDefault();
        e.returnValue = 'A call is in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeCall?.sessionId, status]);

  // FIX (back-navigation, stuck-screen safety net): see video-call.tsx for
  // full rationale. Dismiss the call screen if activeCall is cleared
  // externally without going through our handleEndCall path.
  useEffect(() => {
    if (activeCall === null && !isEndingRef.current) {
      try {
        webrtc.cleanup();
        router.back();
      } catch {
        try { router.replace('/(tabs)'); } catch { /* navigation gone */ }
      }
    }
  }, [activeCall, webrtc.cleanup]);

  const handleAutoEnd = useCallback(() => {
    webrtc.cleanup();
    endCall(true);
  }, [endCall, webrtc.cleanup]);

  const { elapsed, remaining, showLowCoinWarning } = useCallTimer({
    isActive: status === "active",
    maxSeconds: activeCall?.maxSeconds,
    startTimeMs: activeCall?.startTime,
    onAutoEnd: handleAutoEnd,
  });

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const connectionStateLabel = (() => {
    if (status === "active") return fmt(elapsed);
    if (status === "ringing") return "Ringing...";
    switch (webrtc.connectionState) {
      case "checking":     return "Connecting...";
      case "connected":    return "Connected";
      case "disconnected": return "Network drop — reconnecting...";
      case "failed":       return "Connection failed — retrying...";
      case "closed":       return "Call ended";
      default:             return "Connecting...";
    }
  })();

  const statusLabel = connectionStateLabel;

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
      <RemoteAudioMount stream={webrtc.remoteStream} />

      <PermissionDialog
        visible={showMicDialog}
        config={{ ...PERMISSION_CONFIGS.microphone, isBlocked }}
        onAllow={handleMicAllow}
        onDeny={handleMicDeny}
      />

      {loaded && permissions.microphone.status !== "granted" && !showMicDialog && (
        <TouchableOpacity onPress={() => setShowMicDialog(true)} style={styles.permBanner}>
          <SvgIcon name="mic-off" size={14} color="#FFD166" />
          <Text style={styles.permBannerText}>Microphone access needed — Tap to fix</Text>
        </TouchableOpacity>
      )}

      {showLowCoinWarning && (
        <View style={styles.warningBanner}>
          <SvgIcon name="alert-triangle" size={14} color="#FFD166" />
          <Text style={styles.warningText}>
            Call ending soon — {remainingLabel}
          </Text>
        </View>
      )}

      {webrtc.error && (
        <View style={styles.warningBanner}>
          <SvgIcon name="wifi-off" size={14} color="#FF6B6B" />
          <Text style={styles.warningText} numberOfLines={2}>{webrtc.error}</Text>
        </View>
      )}

      <View style={styles.callerSection}>
        <Text style={styles.callTypeLabel}>Voice Call</Text>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulse }] }]}>
          <View style={styles.avatarInner}>
            <Image
              source={{ uri: activeCall?.participant.avatar ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${activeCall?.participant.id}` }}
              style={styles.avatar}
            />
          </View>
        </Animated.View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? "Unknown"}</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>

        <View style={styles.badgeRow}>
          {activeCall?.coinsPerMinute ? (
            <View style={styles.costBadge}>
              <Text style={styles.coinEmoji}>💰</Text>
              <Text style={styles.costText}>+{activeCall.coinsPerMinute} coins / min</Text>
            </View>
          ) : null}
          {remainingLabel && status === "active" && (
            <View style={[styles.costBadge, remaining != null && remaining <= 60 ? styles.warningBadge : {}]}>
              <SvgIcon name="clock" size={12} color={remaining != null && remaining <= 60 ? "#FF6B6B" : "rgba(255,255,255,0.7)"} />
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
              accessibilityRole="button"
              accessibilityState={{ selected: !!activeCall?.isMuted }}
              accessibilityLabel={activeCall?.isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <Image source={require("@/assets/icons/ic_mic.png")} style={styles.ctrlIcon} tintColor={activeCall?.isMuted ? "#FFD166" : "#fff"} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); handleEndCall(); }}
            style={styles.endBtn}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <Image source={require("@/assets/icons/ic_call_end.png")} style={styles.endIcon} tintColor="#fff" resizeMode="contain" />
          </TouchableOpacity>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: !!activeCall?.isSpeakerOn }}
              accessibilityLabel={activeCall?.isSpeakerOn ? "Turn speaker off" : "Turn speaker on"}
            >
              <Image
                source={activeCall?.isSpeakerOn ? require("@/assets/icons/ic_speaker_on.png") : require("@/assets/icons/ic_speaker_off.png")}
                style={styles.ctrlIcon}
                tintColor="#fff"
                resizeMode="contain"
              />
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
  ctrlIcon: { width: 26, height: 26 },
  ctrlLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Poppins_400Regular" },
  endIcon: { width: 30, height: 30 },
  endBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "#E84855",
    alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#E84855",
    shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },

});


// Per-screen error boundary — contains a mid-call render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
