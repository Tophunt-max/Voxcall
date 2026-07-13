import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Animated, Easing, Modal, BackHandler, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import { useLanguage } from "@/context/LanguageContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { API } from "@/services/api";
import * as Haptics from "expo-haptics";

// FIX (no-audio bug): on web, the remote audio track will not play unless
// it is attached to an <audio>/<video> element. Mount a hidden
// <audio srcObject={remoteStream}/> so audio calls actually have audio on
// web. On native, the Agora engine routes audio automatically — no element needed.
function RemoteAudioMount({ stream }: { stream: any }) {
  const ref = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch {}
    try { el.muted = false; el.volume = 1; } catch {}

    let settled = false;
    let attempts = 0;
    let intervalId: any = null;
    let gestureBound = false;

    const cleanupGesture = () => {
      try { window.removeEventListener("click", onGesture); } catch {}
      try { window.removeEventListener("touchend", onGesture); } catch {}
      try { document.removeEventListener("visibilitychange", onVisible); } catch {}
      gestureBound = false;
    };
    const stopInterval = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };

    const attempt = () => {
      if (settled || !ref.current) return;
      const p = ref.current.play?.();
      if (p && typeof p.catch === "function") {
        p.then(() => { settled = true; stopInterval(); cleanupGesture(); })
          .catch((err: any) => {
            if (attempts <= 1) console.warn("[audio-call] remote audio play() rejected:", err?.message ?? err);
            // Autoplay blocked — bind a one-shot gesture retry AND keep the
            // periodic retry running for a bit (a late user tap OR the browser
            // relaxing its policy will unblock it).
            if (!gestureBound) {
              gestureBound = true;
              try {
                window.addEventListener("click", onGesture, { once: true } as any);
                window.addEventListener("touchend", onGesture, { once: true } as any);
                document.addEventListener("visibilitychange", onVisible);
              } catch {}
            }
          });
      } else {
        settled = true;
        stopInterval();
      }
    };
    function onGesture() { attempt(); }
    function onVisible() { if (document.visibilityState === "visible") attempt(); }

    attempt();
    // Bounded periodic retry (every 1s, ~15 tries) so audio starts as soon as
    // the browser allows it, without waiting only on a user tap that may never
    // come during a hands-free call.
    intervalId = setInterval(() => {
      attempts++;
      if (settled || attempts > 15) { stopInterval(); return; }
      attempt();
    }, 1000);

    return () => { stopInterval(); cleanupGesture(); };
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
  const { t } = useLanguage();
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

  // FIX (host/user "Connecting..." desync): the call is "active" the moment
  // the SERVER marks it active. started_at is stamped at host-accept and reaches
  // BOTH apps (call_accepted WS event / answer response) BEFORE we navigate to
  // this screen, so activeCall.startTime is already set on mount. Previously
  // each side waited for its OWN webrtc.isConnected to flip "active", so the
  // caller — which only begins negotiating after navigating in from the ringing
  // screen — sat on "Connecting..." for several seconds (while being billed)
  // even though the host's timer was already running. Driving "active" off the
  // shared server startTime makes both timers start from the SAME anchor, in
  // lock-step. webrtc.isConnected stays as a fallback for any path that reaches
  // this screen without a server startTime.
  useEffect(() => {
    if (status === "active") return;
    if (activeCall?.startTime || webrtc.isConnected) {
      setStatus("active");
      markCallActive();
    }
  }, [activeCall?.startTime, webrtc.isConnected, status, markCallActive]);

  // FIX (permission flash bug): see voxlink/hooks/usePermissions.ts. We now
  // wait for the hook's `loaded` flag instead of running a second redundant
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
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    anim.start();
    // FIX BUG-3: Never show "Ringing..." on the in-call screen — the host has already
    // accepted before we navigate here. Showing "Connecting..." until WebRTC is ready
    // is accurate and avoids user confusion.
    return () => { anim.stop(); };
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
      // FIX BUG-4: If any fatal RTC error occurs, auto-end the call with a
      // user-friendly message instead of staying stuck on "Connecting..."
      const isFatalError =
        /session_error/i.test(webrtc.error) ||
        /410/i.test(webrtc.error) ||
        /session.*expired/i.test(webrtc.error);
      if (isFatalError) {
        webrtc.cleanup();
        endCall(true, "connection");
      }
    }
  }, [webrtc.error, webrtc.clearError, webrtc.cleanup, endCall, permissions.microphone.status]);

  // FIX: Handle remote party ending the call — clean up and show call summary
  useEffect(() => {
    const off = onEvent(SocketEvents.CALL_END, () => {
      webrtc.cleanup();
      endCall(true, "remote");
    });
    return off;
  }, [onEvent, webrtc.cleanup, endCall]);

  // FIX (call-disconnect propagation safety net): if WebRTC stays in
  // 'disconnected' or 'failed' for longer than 20 s, the remote party most
  // likely hung up and the WS-driven CALL_END notification was missed
  // (offline at the moment of /end, FCM also dropped). Auto-end so the user
  // is not stuck on the call screen and the server stops billing.
  // The window covers transient cellular blips that ICE restart can
  // recover from — do NOT shorten this without testing on real bad networks.
  useEffect(() => {
    if (status !== "active") return;
    const s = webrtc.connectionState;
    if (s !== "disconnected" && s !== "failed") return;
    const t = setTimeout(() => {
      // If media resumed (ICE restart recovered), don't kill the call.
      if (webrtc.isConnected) return;
      console.warn("[audio-call] Connection stayed", s, "for 20s — auto-ending");
      webrtc.cleanup();
      endCall(true, "connection");
    }, 20000);
    return () => clearTimeout(t);
  }, [webrtc.connectionState, status, webrtc.isConnected, webrtc.cleanup, endCall]);

  // FIX (connecting timeout — media-aware): if WebRTC media never reaches a
  // usable state within the window, the call is stalled (Agora join failed,
  // the network blocked media, etc.). Auto-end
  // gracefully with a CONNECTION reason (not "out of coins").
  //
  // IMPORTANT: we treat the call as connected if EITHER the aggregate
  // connectionState reports 'connected' OR a remote media stream has actually
  // arrived. On web/mobile browsers `connectionState` sometimes lags behind
  // real media (stays 'connecting' while audio already flows through Agora),
  // so gating purely on `isConnected` was force-ending calls that were in fact
  // working. Requiring BOTH signals to be absent before ending fixes the
  // "call auto-ends after ~30s even though it connected" bug. Window extended
  // to 45s to tolerate slow cellular negotiation.
  useEffect(() => {
    if (webrtc.isConnected || webrtc.remoteStream) return;
    if (!webrtcReady) return;
    const t = setTimeout(() => {
      if (!webrtc.isConnected && !webrtc.remoteStream) {
        console.warn("[audio-call] Media did not connect within 45s — auto-ending");
        webrtc.cleanup();
        endCall(true, "connection");
      }
    }, 45000);
    return () => clearTimeout(t);
  }, [webrtcReady, webrtc.isConnected, webrtc.remoteStream, webrtc.cleanup, endCall]);

  // FIX (call-disconnect propagation safety net #2): poll the server every 10 s
  // while the call is active. If the session is reported as ended/missed/
  // declined server-side (e.g. cron reaper, or /end fired with both WS and FCM
  // notifications lost), clean up locally so the screen does not stay stuck.
  // 404 (session pruned) is also treated as ended.
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
          console.warn("[audio-call] Server reports session", sess.status, "— cleaning up");
          webrtc.cleanup();
          endCall(true, "remote");
        }
      } catch (e: any) {
        // 404 = session pruned; treat as ended so the screen unblocks.
        // Other errors (network blip, 5xx) are transient — ignore and try again next tick.
        if (/not found|404/i.test(String(e?.message ?? ""))) {
          if (!cancelled) {
            webrtc.cleanup();
            endCall(true, "remote");
          }
        }
      }
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status, activeCall?.sessionId, webrtc.cleanup, endCall]);

  // FIX (back-navigation: double-call guard) — see voxlink-host/app/calls/
  // video-call.tsx for full rationale. The user side has the same vulnerability:
  // rapid back-press while endCall is awaiting API.endCall could fire a
  // second handleEndCall on top of the first, racing router navigation.
  const isEndingRef = useRef(false);
  const handleEndCall = useCallback(() => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    webrtc.cleanup();
    endCall();
  }, [endCall, webrtc.cleanup]);

  // Phase 2 Fix: Block Android hardware back button during an active call.
  // Without this, pressing back navigates away while the call keeps running on
  // the server — the caller keeps getting billed with no UI to end the call.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleEndCall();
      return true; // prevent default back navigation
    });
    return () => sub.remove();
  }, [handleEndCall]);

  // FIX (back-navigation, web beforeunload): closing the tab / pressing
  // browser-back during a call left the session 'active' on the server,
  // billing the caller until the 30-min cron reaper. Now we
  //   1. fire API.endCall via navigator.sendBeacon (survives unload), and
  //   2. ask the browser to confirm before leaving.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => {
      const sid = activeCall?.sessionId;
      if (sid && status === 'active') {
        try {
          const url = `${(process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '')}/api/calls/${sid}/end`;
          const blob = new Blob([JSON.stringify({ duration_seconds: 0 })], { type: 'application/json' });
          (navigator as any).sendBeacon?.(url, blob);
        } catch { /* best-effort — cron reaper will catch */ }
        e.preventDefault();
        e.returnValue = 'A call is in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeCall?.sessionId, status]);

  // FIX (back-navigation, stuck-screen safety net): if activeCall flips to
  // null externally — e.g. logout while in a call, or another part of the
  // app clears the context — dismiss the screen instead of letting the
  // user stare at a stale UI. The isEndingRef guard distinguishes our own
  // legitimate end from external clears.
  useEffect(() => {
    if (activeCall === null && !isEndingRef.current) {
      try {
        webrtc.cleanup();
        router.back();
      } catch {
        try { router.replace('/user/screens/home'); } catch { /* navigation gone */ }
      }
    }
  }, [activeCall, webrtc.cleanup]);

  // FIX #1: Mid-call heartbeat — call server every 25s to enforce balance cap.
  // Server force-ends the call when balance is exhausted, preventing callers
  // from talking past their coin balance (overrun abuse). The heartbeat also
  // pushes a low-balance warning when remaining_seconds <= low_balance_warn_seconds.
  useEffect(() => {
    if (status !== "active" || !activeCall?.sessionId) return;
    const sid = activeCall.sessionId;
    let cancelled = false;
    const heartbeatInterval = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await API.heartbeat(sid);
        if (cancelled) return;
        if (res.ended) {
          console.log("[audio-call] Heartbeat reports call ended:", res.reason);
          webrtc.cleanup();
          // Heartbeat only force-ends on balance exhaustion → real out-of-coins.
          endCall(true, "balance");
        }
      } catch (e) {
        console.warn("[audio-call] Heartbeat failed:", e);
      }
    }, 25000); // 25 seconds
    return () => {
      cancelled = true;
      clearInterval(heartbeatInterval);
    };
  }, [status, activeCall?.sessionId, webrtc.cleanup, endCall]);

  const handleAutoEnd = useCallback(() => {
    webrtc.cleanup();
    // Client-side timer hit the affordable cap → caller ran out of coins.
    endCall(true, "balance");
  }, [endCall, webrtc.cleanup]);

  const { elapsed, remaining, showLowCoinWarning, showRechargePopup, dismissRechargePopup } = useCallTimer({
    isActive: status === "active",
    maxSeconds: activeCall?.maxSeconds,
    startTimeMs: activeCall?.startTime,
    onAutoEnd: handleAutoEnd,
  });

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const connectionStateLabel = (() => {
    if (status === "active") return fmt(elapsed);
    if (status === "ringing") return t.calls.ringingDots;
    // WebRTC connection state se detailed feedback
    switch (webrtc.connectionState) {
      case "checking":   return t.calls.connectingDots;
      case "connected":  return t.calls.connected;
      case "disconnected": return t.calls.networkDrop;
      case "failed":     return t.calls.connectionFailed;
      case "closed":     return t.calls.callEndedShort;
      default:           return t.calls.connectingDots;
    }
  })();

  const statusLabel = connectionStateLabel;

  const remainingLabel = remaining != null
    ? remaining <= 60
      ? t.calls.secondsRemaining.replace("{count}", String(remaining))
      : t.calls.minLeft.replace("{count}", String(Math.ceil(remaining / 60)))
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
          <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 14, height: 14, tintColor: "#FFD166" }} resizeMode="contain" />
          <Text style={styles.permBannerText}>{t.calls.micAccessNeeded}</Text>
        </TouchableOpacity>
      )}

      {showLowCoinWarning && (
        <View style={styles.warningBanner}>
          <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 14, height: 14, tintColor: "#FFD166" }} resizeMode="contain" />
          <Text style={styles.warningText}>
            {t.calls.coinsRunningLow} — {remainingLabel}
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
        <Text style={styles.callTypeLabel}>{t.calls.voiceCall}</Text>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulse }] }]}>
          <View style={styles.avatarInner}>
            <Image
              source={{ uri: activeCall?.participant.avatar ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${activeCall?.participant.id}` }}
              style={styles.avatar}
            />
          </View>
        </Animated.View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? t.calls.unknown}</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        {webrtc.remoteMuted && status === "active" && (
          <Text style={styles.mutedHint}>{t.calls.mutedHint}</Text>
        )}

        <View style={styles.badgeRow}>
          {/* Free-minutes chip: while the call is covered by the free-trial
              pool, show remaining free time — coins aren't charged until it
              runs out. */}
          {status === "active" && activeCall?.freeSeconds != null && activeCall.freeSeconds > 0 && elapsed < activeCall.freeSeconds && (
            <View style={styles.freeBadge}>
              <Text style={styles.coinEmoji}>🎁</Text>
              <Text style={styles.freeText}>
                {Math.ceil((activeCall.freeSeconds - elapsed) / 60)} free min left
              </Text>
            </View>
          )}
          {activeCall?.coinsPerMinute ? (
            <View style={styles.costBadge}>
              <Text style={styles.coinEmoji}>🪙</Text>
              <Text style={styles.costText}>{activeCall.coinsPerMinute} {t.calls.coinsPerMin}</Text>
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
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 26, height: 26, tintColor: "#fff", opacity: activeCall?.isMuted ? 0.4 : 1 }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isMuted ? t.calls.unmute : t.calls.mute}</Text>
          </View>

          <TouchableOpacity
            onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); handleEndCall(); }}
            style={styles.endBtn}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <Image source={require("@/assets/icons/ic_call_end.png")} style={{ width: 30, height: 30, tintColor: "#fff" }} resizeMode="contain" />
          </TouchableOpacity>

          <View style={styles.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleSpeaker(); }}
              style={[styles.ctrlBtn, activeCall?.isSpeakerOn && styles.ctrlBtnActive]}
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isSpeakerOn ? "Turn off speaker" : "Turn on speaker"}
            >
              <Image source={activeCall?.isSpeakerOn ? require("@/assets/icons/ic_speaker_on.png") : require("@/assets/icons/ic_speaker_off.png")} style={{ width: 26, height: 26, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.ctrlLabel}>{activeCall?.isSpeakerOn ? t.calls.speakerOn : t.calls.speaker}</Text>
          </View>
        </View>
      </View>

      <Modal visible={showRechargePopup} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.rechargeCard}>
            <Text style={styles.rechargeEmoji}>💰</Text>
            <Text style={styles.rechargeTitle}>{t.calls.runningOutCoins}</Text>
            <Text style={styles.rechargeSubtitle}>
              {t.calls.autoDisconnectIn.replace("{time}", remaining != null ? `${remaining} ${remaining === 1 ? t.calls.second : t.calls.seconds}` : t.calls.fewSeconds)}
            </Text>
            <TouchableOpacity
              style={styles.rechargeBtn}
              onPress={() => {
                dismissRechargePopup();
                handleEndCall();
                router.push("/user/screens/home/wallet");
              }}
            >
              <Text style={styles.rechargeBtnText}>{t.calls.rechargeNow}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueBtn} onPress={dismissRechargePopup}>
              <Text style={styles.continueBtnText}>{t.calls.continueCall}</Text>
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
  mutedHint: { fontSize: 13, fontFamily: "Poppins_500Medium", color: "#FFB4B4", marginTop: 2 },

  badgeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  costBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  warningBadge: { backgroundColor: "rgba(255, 107, 107, 0.2)", borderWidth: 1, borderColor: "rgba(255,107,107,0.4)" },
  freeBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(11,175,35,0.22)",
    borderWidth: 1, borderColor: "rgba(11,175,35,0.5)",
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  freeText: { color: "#8EF5A0", fontSize: 12, fontFamily: "Poppins_700Bold" },
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


// Per-screen error boundary — contains a mid-call render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
