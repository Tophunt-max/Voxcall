import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Pressable,
  Modal, Animated, Easing, Platform, BackHandler, PanResponder, Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useCall } from "@/context/CallContext";
import { useAuth } from "@/context/AuthContext";
import { useCallTimer } from "@/hooks/useCallTimer";
import { useLanguage } from "@/context/LanguageContext";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { API, resolveMediaUrl } from "@/services/api";
import { RtcVideoView } from "@/components/RtcVideoView";
import { showErrorToast } from "@/components/Toast";
import { GiftPickerSheet, type GiftCatalogItem } from "@/components/GiftPickerSheet";
import { GiftAnimation, type GiftAnim } from "@/components/GiftAnimation";

// FIX (UI: draggable self-preview): pre-compute screen dims so the drag
// handler can clamp to viewport edges. Falls back to reasonable defaults
// during SSR / web hydration where Dimensions returns 0.
const SCREEN_W = Dimensions.get("window").width || 360;
const SCREEN_H = Dimensions.get("window").height || 720;
const SELF_W = 110;
const SELF_H = 160;
// Auto-hide controls after this idle period during an active call so the
// remote video has the full screen. Tap anywhere to bring them back.
const CONTROLS_HIDE_DELAY = 4000;

// ─── ConnectionBars (signal-strength indicator) ──────────────────────────────
// Three vertical bars whose count + color indicate WebRTC connection state.
// 'connected' → 3 green bars, 'checking' / 'new' → 2 yellow, 'disconnected'
// or 'failed' → 1 red. Anchored visually in the glass header card so the
// user gets at-a-glance feedback without a separate banner.
function ConnectionBars({ state, quality }: { state: string; quality?: string }) {
  // Prefer the getStats-derived call quality (excellent/good/poor/lost) when
  // available — it reflects real packet loss / RTT / jitter. Fall back to the
  // raw connection state until the first quality sample arrives (or if the
  // platform doesn't support getStats).
  let level: number;
  let color: string;
  switch (quality) {
    case "excellent": level = 3; color = "#22C55E"; break; // 3 green
    case "good":      level = 2; color = "#22C55E"; break; // 2 green
    case "poor":      level = 1; color = "#FBBF24"; break; // 1 amber
    case "lost":      level = 1; color = "#EF4444"; break; // 1 red
    default:
      level = state === "connected" ? 3 : state === "checking" || state === "new" ? 2 : 1;
      color = level === 3 ? "#22C55E" : level === 2 ? "#FBBF24" : "#EF4444";
  }
  return (
    <View style={uiS.bars}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            uiS.bar,
            {
              height: 6 + i * 4,
              backgroundColor: i <= level ? color : "rgba(255,255,255,0.18)",
            },
          ]}
        />
      ))}
    </View>
  );
}

const useNativeDriverValue = Platform.OS !== "web";

// Native video is rendered by <RtcVideoView> (Agora's RtcSurfaceView). The
// web-only StreamView helper below renders the Agora web MediaStream in a
// <video> element. CameraView (expo-camera) is only a self-preview fallback.
let CameraView: any = null;
let Haptics: any = null;
try {
  CameraView = require('expo-camera').CameraView; // has web support
  Haptics = require('expo-haptics');
} catch {}

// ─── StreamView ──────────────────────────────────────────────────────────────
// Web-only helper: renders the Agora web MediaStream in a <video> element.
// FIX (no-audio bug): on web we MUST attach the MediaStream to a <video> /
// <audio> element for the remote audio track to actually play. Browsers do
// not auto-play a track just because it exists. We also explicitly call
// .play() because some mobile browsers (esp. iOS Safari) ignore the
// `autoPlay` attribute even after a user gesture. On native, video is drawn
// by <RtcVideoView> (Agora), so StreamView is never used there.
function StreamView({ stream, style, mirror = false, audioOnly = false }: { stream: any; style?: any; mirror?: boolean; audioOnly?: boolean }) {
  const videoRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = videoRef.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch {}

    // Explicit play() with a bounded retry — autoPlay alone is unreliable on
    // iOS Safari / Chrome mobile when the track is added late or the tab was
    // backgrounded. We retry on a short interval AND on the next user gesture /
    // visibility change so the call doesn't stay silent/black forever.
    let settled = false;
    let attempts = 0;
    let intervalId: any = null;
    let gestureBound = false;

    const cleanupGesture = () => {
      try { window.removeEventListener('click', onGesture); } catch {}
      try { window.removeEventListener('touchend', onGesture); } catch {}
      try { document.removeEventListener('visibilitychange', onVisible); } catch {}
      gestureBound = false;
    };
    const stopInterval = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };

    const attempt = () => {
      if (settled || !videoRef.current) return;
      const p = videoRef.current.play?.();
      if (p && typeof p.catch === 'function') {
        p.then(() => { settled = true; stopInterval(); cleanupGesture(); })
          .catch((err: any) => {
            if (attempts <= 1) console.warn('[StreamView] play() rejected:', err?.message ?? err);
            if (!gestureBound) {
              gestureBound = true;
              try {
                window.addEventListener('click', onGesture, { once: true } as any);
                window.addEventListener('touchend', onGesture, { once: true } as any);
                document.addEventListener('visibilitychange', onVisible);
              } catch {}
            }
          });
      } else {
        settled = true;
        stopInterval();
      }
    };
    function onGesture() { attempt(); }
    function onVisible() { if (document.visibilityState === 'visible') attempt(); }

    attempt();
    intervalId = setInterval(() => {
      attempts++;
      if (settled || attempts > 15) { stopInterval(); return; }
      attempt();
    }, 1000);

    return () => { stopInterval(); cleanupGesture(); };
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
        // FIX (video showed only "aadha photo", not full screen): an
        // absolutely-positioned <video> is a REPLACED element — with
        // width/height:auto it renders at the intrinsic video resolution and
        // IGNORES the right/bottom insets from absoluteFillObject, so it only
        // filled part of the screen. Force 100% so it fills its container and
        // object-fit can crop to cover.
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : undefined,
        // For audio-only mounts, render a 1x1 invisible element. We can't
        // use display:none because some browsers pause playback when the
        // element is fully removed from layout.
        ...(audioOnly ? { width: 1, height: 1, opacity: 0, position: 'absolute', pointerEvents: 'none' } : {}),
      },
    });
  }

  // Native never reaches here: video is drawn by <RtcVideoView> (Agora's
  // RtcSurfaceView) and audio is routed by the Agora engine automatically.
  return null;
}

type PermStep = "camera" | "microphone" | "done";

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker, markCallActive } = useCall();
  const { user, updateCoins } = useAuth();
  const { t } = useLanguage();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

  // ─── In-call gifts ─────────────────────────────────────────────────────────
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [sendingGiftId, setSendingGiftId] = useState<string | null>(null);
  const [giftAnim, setGiftAnim] = useState<GiftAnim | null>(null);
  const giftKeyRef = useRef(0);

  const openGifts = useCallback(async () => {
    setGiftOpen(true);
    if (giftCatalog.length === 0) {
      try { const list = await API.getGifts(); setGiftCatalog(Array.isArray(list) ? list : []); } catch { /* keep empty */ }
    }
  }, [giftCatalog.length]);

  const handleSendGift = useCallback(async (g: GiftCatalogItem) => {
    const hostId = activeCall?.participant?.id;
    if (!hostId || sendingGiftId) return;
    if ((user?.coins ?? 0) < (g.price_coins ?? 0)) { showErrorToast(`Not enough coins for ${g.name}.`); return; }
    setSendingGiftId(g.id);
    try { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Medium); } catch { /* haptics best-effort */ }
    try {
      const idemKey = `gift-${hostId}-${g.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await API.sendCallGift(hostId, g.id, activeCall?.sessionId, idemKey);
      if (typeof res?.new_balance === "number") updateCoins(res.new_balance);
      setGiftOpen(false);
      giftKeyRef.current += 1;
      setGiftAnim({ icon: g.icon, name: g.name, key: giftKeyRef.current });
    } catch (e: any) {
      const msg = String(e?.message || "");
      showErrorToast(/coin/i.test(msg) ? msg : "Couldn't send gift. Please try again.");
    } finally {
      setSendingGiftId(null);
    }
  }, [activeCall?.participant?.id, activeCall?.sessionId, sendingGiftId, user?.coins, updateCoins]);

  const [permStep, setPermStep] = useState<PermStep | null>(null);
  const [webrtcReady, setWebrtcReady] = useState(false);

  // FIX (repeated permission popup): two one-shot guards so we never re-open
  // the permission dialog in a loop.
  //   • permGateDoneRef — once permissions are satisfied and WebRTC is enabled,
  //     the initial gate stops reacting to permission-state churn.
  //   • permRepromptedRef — the WebRTC error handler may re-prompt for a
  //     permission AT MOST ONCE, and only when the OS actually reports it as
  //     missing. Without this, any getUserMedia failure whose message merely
  //     contained "NotAllowed"/"permission" (camera busy, unreadable source,
  //     transient web errors) re-opened the dialog forever.
  const permGateDoneRef = useRef(false);
  const permRepromptedRef = useRef(false);

  const { permissions, requestCamera, requestMicrophone, openSettings, loaded } = usePermissions();
  const { onEvent } = useSocket();

  const webrtc = useWebRTC({
    sessionId: activeCall?.sessionId,
    isVideo: true,
    enabled: webrtcReady && !!activeCall?.sessionId,
  });

  // FIX (host/user "Connecting..." desync): go "active" the moment the SERVER
  // marks the call active. started_at is stamped at host-accept and reaches
  // BOTH apps (call_accepted WS / answer response) BEFORE we navigate here, so
  // activeCall.startTime is already set on mount. Previously each side waited
  // for its OWN webrtc.isConnected, so the caller sat on "Connecting..." for
  // several seconds (while being billed) even though the host's timer was
  // already running. Anchoring "active" to the shared server startTime makes
  // both timers start in lock-step. webrtc.isConnected stays as a fallback.
  useEffect(() => {
    if (status === "active") return;
    if (activeCall?.startTime || webrtc.isConnected) {
      setStatus("active");
      markCallActive();
    }
  }, [activeCall?.startTime, webrtc.isConnected, status, markCallActive]);

  const pulse = useRef(new Animated.Value(1)).current;
  // FIX: stop the avatar pulse when the remote video stream arrives. Before
  // this, the loop kept running on the JS thread (web) / UI thread (native)
  // even though the avatar had been visually replaced by the video frame —
  // wasted CPU/GPU cycles for no user-visible benefit.
  useEffect(() => {
    if (webrtc.remoteStream) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: useNativeDriverValue }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [webrtc.remoteStream]);

  // FIX (permission flash bug): the previous version had a local `permChecked`
  // state that flipped true after `await refresh()` resolved — but on native,
  // expo-camera's `useCameraPermissions()` hook updates the camera status on
  // its own async timeline (often 100-500 ms after mount). When `permChecked`
  // turned true, camera was still 'undetermined', triggering setPermStep("camera")
  // and flashing the permission dialog even when the OS had already granted it.
  // We now gate on the hook's own `loaded` flag, which waits for the camera
  // hook AND the manual checkAll() — eliminating the race.
  useEffect(() => {
    if (!loaded) return;
    // FIX (repeated permission popup): only run the initial gate once. After
    // permissions are granted (permGateDoneRef set), later permission-state
    // updates must NOT reopen the dialog.
    if (permGateDoneRef.current) return;
    if (permissions.camera.status !== "granted") {
      setPermStep("camera");
    } else if (permissions.microphone.status !== "granted") {
      setPermStep("microphone");
    } else {
      permGateDoneRef.current = true;
      setPermStep("done");
      setWebrtcReady(true);
    }
  }, [loaded, permissions.camera.status, permissions.microphone.status]);

  // FIX BUG-8: Removed "ringing" status timeout. The user reaches this screen
  // AFTER the host accepted the call — showing "Ringing..." is misleading.
  // Status goes directly from "connecting" → "active" when WebRTC connects.

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

  // FIX (#1): apply the speaker/earpiece routing whenever the Speaker button
  // toggles isSpeakerOn. webrtc.setSpeaker drives InCallManager on native; no-op on web.
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
      // reports the permission as missing AND we haven't re-prompted already
      // this call. A getUserMedia failure whose message merely contains
      // "NotAllowed" (camera busy, unreadable source, transient web error)
      // while the permission is in fact granted must NOT reopen the dialog —
      // that was the endless "bar bar permission" loop.
      const camMissing = permissions.camera.status !== "granted";
      const micMissing = permissions.microphone.status !== "granted";
      if (isPermissionError && (camMissing || micMissing) && !permRepromptedRef.current) {
        permRepromptedRef.current = true;
        webrtc.clearError();
        setWebrtcReady(false);
        setPermStep(camMissing ? "camera" : "microphone");
        return;
      }
      // Permission-style error but either the OS says we're granted (device
      // busy / transient) or we've already re-prompted once — clear it WITHOUT
      // reopening the dialog so we never loop.
      if (isPermissionError) {
        webrtc.clearError();
        return;
      }
      // FIX BUG-4: Fatal RTC error — auto-end call
      const isFatalError =
        /session_error/i.test(webrtc.error) ||
        /410/i.test(webrtc.error) ||
        /session.*expired/i.test(webrtc.error);
      if (isFatalError) {
        webrtc.cleanup();
        endCall(true, "connection");
      }
    }
  }, [webrtc.error, webrtc.clearError, webrtc.cleanup, endCall, permissions.camera.status, permissions.microphone.status]);

  // FIX: Handle remote party ending the call — clean up and show call summary
  useEffect(() => {
    const off = onEvent(SocketEvents.CALL_END, () => {
      webrtc.cleanup();
      endCall(true);
    });
    return off;
  }, [onEvent, webrtc.cleanup, endCall]);

  // FIX (call-disconnect propagation safety net): see audio-call for rationale.
  // If WebRTC stays disconnected/failed for >15 s, auto-end the call.
  useEffect(() => {
    if (status !== "active") return;
    const s = webrtc.connectionState;
    if (s !== "disconnected" && s !== "failed") return;
    const t = setTimeout(() => {
      console.warn("[video-call] Connection stayed", s, "for 15s — auto-ending");
      webrtc.cleanup();
      endCall(true);
    }, 15000);
    return () => clearTimeout(t);
  }, [webrtc.connectionState, status, webrtc.cleanup, endCall]);

  // FIX (connecting timeout): if the media never reaches `connected` state
  // within 30 s, the call is stalled (Agora join failed, network blocked,
  // etc.). Auto-end gracefully. NOTE: gated on the REAL webrtc.isConnected, NOT
  // on `status` — `status` now flips to "active" off the server startTime before
  // media is actually up, so gating on status would disable this safety net.
  useEffect(() => {
    // FIX (parity with audio-call): treat the call as connected if EITHER the
    // aggregate connectionState is 'connected' OR a remote media stream has
    // arrived. On web/mobile browsers connectionState can lag behind real
    // media (stays 'connecting' while video already flows via Agora), so
    // gating purely on isConnected force-ended calls that were actually working.
    if (webrtc.isConnected || webrtc.remoteStream) return;
    if (!webrtcReady) return;
    const t = setTimeout(() => {
      if (!webrtc.isConnected && !webrtc.remoteStream) {
        console.warn("[video-call] Media did not connect within 30s — auto-ending");
        webrtc.cleanup();
        endCall(true, "connection");
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [webrtcReady, webrtc.isConnected, webrtc.remoteStream, webrtc.cleanup, endCall]);

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
          console.warn("[video-call] Server reports session", sess.status, "— cleaning up");
          webrtc.cleanup();
          endCall(true, "remote");
        }
      } catch (e: any) {
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
  // video-call.tsx for full rationale.
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
          console.log("[video-call] Heartbeat reports call ended:", res.reason);
          webrtc.cleanup();
          // Heartbeat only force-ends on balance exhaustion, so this is a
          // genuine "out of coins" — show the recharge banner.
          endCall(true, "balance");
        }
      } catch (e) {
        console.warn("[video-call] Heartbeat failed:", e);
      }
    }, 25000); // 25 seconds
    return () => {
      cancelled = true;
      clearInterval(heartbeatInterval);
    };
  }, [status, activeCall?.sessionId, webrtc.cleanup, endCall]);

  // FIX (back-navigation, web beforeunload) — see audio-call for rationale.
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

  // FIX (back-navigation, stuck-screen safety net) — see audio-call for rationale.
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

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const remainingLabel = remaining != null
    ? remaining <= 60 ? t.calls.secondsLeft.replace("{count}", String(remaining)) : t.calls.minLeft.replace("{count}", String(Math.ceil(remaining / 60)))
    : null;

  const connectingLabel = (() => {
    switch (webrtc.connectionState) {
      case "checking":     return t.calls.connectingDots;
      case "connected":    return t.calls.connected;
      case "disconnected": return t.calls.networkDrop;
      case "failed":       return t.calls.connectionFailed;
      default:             return t.calls.connectingDots;
    }
  })();

  const remoteAvatarUri = resolveMediaUrl(activeCall?.participant.avatar) ||
    `https://api.dicebear.com/7.x/avataaars/png?seed=${activeCall?.participant.id ?? "host"}`;

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
        // FIX (double-pop): handleEndCall() routes through CallContext.endCall
        // which itself navigates (router.replace to summary OR router.back when
        // the call never went active). Calling router.back() here too pops a
        // second route, ejecting the user from the summary screen.
        handleEndCall();
        return;
      }
      setWebrtcReady(true);
    }
  };

  const handleMicDeny = () => {
    setPermStep("done");
    // FIX (double-pop): see handleMicAllow above. handleEndCall() navigates;
    // the explicit router.back() that used to follow popped a second route.
    handleEndCall();
  };

  const cameraGranted = permissions.camera.status === "granted";
  const micGranted = permissions.microphone.status === "granted";

  // ─── UI Polish: tap-to-hide controls ─────────────────────────────────────
  // FIX (UI): controls + header used to occupy ~30% of the screen permanently,
  // so users couldn't see the remote video clearly. Now during an active call
  // they auto-hide after 4 s of inactivity (matches WhatsApp / Zoom / FaceTime)
  // and reappear on tap. While not active (connecting/ringing) controls always
  // show so the user can cancel.
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsHideTimer.current) {
      clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
    if (status !== "active") return;
    controlsHideTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, [status]);

  // Show controls whenever the call goes active, then start the auto-hide timer.
  useEffect(() => {
    if (status === "active") {
      showControls();
    } else {
      // Pre-active states must always show controls — user needs Cancel.
      setControlsVisible(true);
      if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    }
    return () => {
      if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
    };
  }, [status, showControls]);

  // Animate controls in/out smoothly.
  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: useNativeDriverValue,
    }).start();
  }, [controlsVisible]);

  // ─── UI Polish: draggable self-preview (Zoom-style) ──────────────────────
  // FIX (UI): the self-preview was pinned to top-right and overlapped with
  // the warning banner. Users now drag it anywhere on screen; we clamp to
  // 12px from each edge so it never goes off-screen on tablets / orientation
  // changes. Default position mirrors the previous static position.
  // FIX (UI overlap): default the self-preview BELOW the top header row. It used
  // to default to insets.top+12 (top-right) — exactly where the coin-balance +
  // signal-bars cluster sits — so the PiP covered them. +112 clears the header
  // (and the low-coin warning banner) while still being draggable anywhere.
  const selfPan = useRef(new Animated.ValueXY({ x: SCREEN_W - SELF_W - 16, y: insets.top + 112 })).current;
  const selfPosition = useRef({ x: SCREEN_W - SELF_W - 16, y: insets.top + 112 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          selfPan.setOffset({ x: selfPosition.current.x, y: selfPosition.current.y });
          selfPan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: selfPan.x, dy: selfPan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          const newX = Math.max(
            12,
            Math.min(SCREEN_W - SELF_W - 12, selfPosition.current.x + gesture.dx)
          );
          const newY = Math.max(
            insets.top + 12,
            Math.min(SCREEN_H - SELF_H - 100, selfPosition.current.y + gesture.dy)
          );
          selfPosition.current = { x: newX, y: newY };
          selfPan.flattenOffset();
          Animated.spring(selfPan, {
            toValue: { x: newX, y: newY },
            useNativeDriver: false,
            friction: 7,
          }).start();
        },
      }),
    [selfPan, insets.top]
  );

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

      {/* FIX (UI): tap on remote area toggles controls visibility while the
          call is active. The Pressable also acts as the dismiss target for
          when the controls are auto-hidden — single tap brings them back. */}
      <Pressable
        style={styles.remoteArea}
        onPress={() => {
          if (status !== "active") return;
          if (controlsVisible) {
            setControlsVisible(false);
            if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current);
          } else {
            showControls();
          }
        }}
      >
        {/* FIX (remote-camera-off): always render StreamView while a stream
            exists so audio keeps playing on web; overlay an avatar + label
            when the remote has no active video track. Using StreamView for
            audio-only / camera-off streams shows pure black on web, which is
            the original "blank screen" bug. */}
        {webrtc.provider === "agora" && Platform.OS !== "web" ? (
          <RtcVideoView provider="agora" agoraUid={webrtc.agoraRemoteUid} style={styles.remoteVideo} mirror={false} />
        ) : (
          webrtc.remoteStream && (
            <StreamView stream={webrtc.remoteStream} style={styles.remoteVideo} mirror={false} />
          )
        )}
        {!webrtc.remoteHasVideo && (
          <>
            <View style={styles.remoteGrad} />
            <View style={styles.remoteAvatarBox} pointerEvents="none">
              <Animated.Image
                source={{ uri: remoteAvatarUri }}
                style={[styles.remoteAvatar, { transform: [{ scale: pulse }] }]}
              />
              {webrtc.remoteStream && status === "active" && (
                <View style={styles.remoteCameraOffBadge}>
                  <Image
                    source={require("@/assets/icons/ic_cancel_video.png")}
                    style={{ width: 12, height: 12, tintColor: "rgba(255,255,255,0.85)" }}
                    resizeMode="contain"
                  />
                  <Text style={styles.remoteCameraOffText}>{t.calls.cameraOff}</Text>
                </View>
              )}
            </View>
          </>
        )}
        {status !== "active" && (
          <View style={styles.connectingBadge}>
            <Text style={styles.connectingText}>
              {status === "connecting" ? connectingLabel : t.calls.ringingDots}
            </Text>
          </View>
        )}
      </Pressable>

      {/* FIX (UI): self-preview is now draggable. Position is clamped to
          screen bounds + safe area in panResponderRelease. Touch handling
          on the View itself takes priority over the underlying Pressable
          so dragging doesn't toggle controls. */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.selfPreview,
          {
            transform: selfPan.getTranslateTransform(),
            // Reset top/right because selfPan now controls position absolutely.
            top: 0,
            right: undefined,
            left: 0,
          },
        ]}
      >
        {/* FIX (camera conflict): the previous fallback rendered a <CameraView>
            placeholder while waiting for webrtc.localStream. On Android this
            opened the camera twice — Expo's CameraView held the handle while
            WebRTC's getUserMedia tried to acquire it, throwing
            "java.lang.RuntimeException: Camera in use". Now we show a text
            placeholder until the real WebRTC stream is ready (~200-1000 ms). */}
        {activeCall?.isCameraOn && cameraGranted ? (
          webrtc.localStream && webrtc.localHasVideo ? (
            webrtc.provider === "agora" && Platform.OS !== "web" ? (
              <RtcVideoView provider="agora" agoraUid={0} isLocal style={styles.selfCameraView} mirror={true} />
            ) : (
              <StreamView stream={webrtc.localStream} style={styles.selfCameraView} mirror={true} />
            )
          ) : webrtc.localStream && !webrtc.localHasVideo ? (
            // FIX (#6): a video call fell back to audio-only (camera busy /
            // unreadable at start). Tell the user instead of showing a
            // permanently black self-preview.
            <View style={styles.selfCameraOff}>
              <Image
                source={require("@/assets/icons/ic_cancel_video.png")}
                style={{ width: 22, height: 22, tintColor: "rgba(255,255,255,0.6)" }}
                resizeMode="contain"
              />
              <Text style={styles.selfCameraOffText}>{t.calls.cameraUnavailable}</Text>
            </View>
          ) : !webrtc.isAvailable && CameraView ? (
            // FIX (camera-busy race): only render <CameraView /> when WebRTC
            // isn't available (e.g. some web fallback). On native, WebRTC's
            // getUserMedia owns the camera — rendering CameraView in parallel
            // grabs the same hardware and breaks WebRTC capture with a
            // "java.lang.RuntimeException: Camera in use" on Android.
            <CameraView
              style={styles.selfCameraView}
              facing="front"
            />
          ) : (
            <View style={styles.selfCameraOff}>
              <Image
                source={require("@/assets/icons/ic_photo.png")}
                style={{ width: 22, height: 22, tintColor: "rgba(255,255,255,0.6)" }}
                resizeMode="contain"
              />
              <Text style={styles.selfCameraOffText}>{t.calls.startingCamera}</Text>
            </View>
          )
        ) : (
          <View style={styles.selfCameraOff}>
            <Image
              source={!cameraGranted ? require("@/assets/icons/ic_close.png") : require("@/assets/icons/ic_cancel_video.png")}
              style={{ width: 22, height: 22, tintColor: "rgba(255,255,255,0.6)" }}
              resizeMode="contain"
            />
            <Text style={styles.selfCameraOffText}>
              {!cameraGranted ? t.calls.noPermission : t.calls.cameraOffShort}
            </Text>
          </View>
        )}
        <View style={styles.selfLabel}>
          <Text style={styles.selfLabelText}>{t.calls.you}</Text>
        </View>
        {/* FIX (UI redesign): persistent muted indicator. Without this the
            user could leave their mic muted and forget — only knowing when
            the other side asked "you there?". A small red pill anchored
            at the top of the self-preview makes the muted state obvious. */}
        {activeCall?.isMuted && (
          <View style={uiS.mutedBadge}>
            <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 10, height: 10, tintColor: "#fff" }} resizeMode="contain" />
            <Text style={uiS.mutedBadgeText}>{t.calls.mutedLabel}</Text>
          </View>
        )}
      </Animated.View>

      {permStep === "done" && (!cameraGranted || !micGranted) && (
        <View style={[styles.permMissingBar, { top: insets.top + 8 }]}>
          {!cameraGranted && (
            <TouchableOpacity onPress={() => setPermStep("camera")} style={styles.permChip}>
              <Image source={require("@/assets/icons/ic_cancel_video.png")} style={{ width: 12, height: 12, tintColor: "#FFD166" }} resizeMode="contain" />
              <Text style={styles.permChipText}>{t.calls.cameraOff}</Text>
            </TouchableOpacity>
          )}
          {!micGranted && (
            <TouchableOpacity onPress={() => setPermStep("microphone")} style={styles.permChip}>
              <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 12, height: 12, tintColor: "#FFD166", opacity: 0.5 }} resizeMode="contain" />
              <Text style={styles.permChipText}>{t.calls.noMic}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Animated.View
        style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20, opacity: controlsOpacity }]}
        pointerEvents={controlsVisible ? "box-none" : "none"}
      >
        {/* FIX (UI): gradient backdrop behind the bottom controls so the
            labels and timer remain readable when the remote video is bright
            (sky / window / white walls). Subtle top-down dim + heavier
            bottom-up gradient. */}
        <LinearGradient
          colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0)"]}
          style={styles.topGradient}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.7)"]}
          style={styles.bottomGradient}
          pointerEvents="none"
        />

        {/* FIX (UI): top group — warning banner + glass header card are now
            wrapped in a single container pinned to the TOP of the screen.
            Previously the header card was a standalone flex child of the
            `space-between` overlay (alongside a spacer + control bar), which
            pushed it into the vertical CENTER of the screen (covering the
            remote video). Grouping it here leaves the overlay with just two
            flex children — this top group and the control bar — so the card
            sits at the top and the controls at the bottom. */}
        <View style={uiS.topGroup} pointerEvents="box-none">
          {showLowCoinWarning && (
            <View style={styles.warningBanner}>
              <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 13, height: 13, tintColor: "#FFD166" }} resizeMode="contain" />
              <Text style={styles.warningText}>{t.calls.lowCoins} — {remainingLabel}</Text>
            </View>
          )}

          {webrtc.error && !showLowCoinWarning && (
            <View style={styles.warningBanner}>
              <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 13, height: 13, tintColor: "#FF6B6B" }} resizeMode="contain" />
              {/* FIX: surface the ACTUAL failure reason (camera busy, network
                  blocked, service unavailable, …) instead of a generic
                  "Connection issue" so users and support can tell calls apart. */}
              <Text style={styles.warningText} numberOfLines={2}>{webrtc.error || t.calls.connectionIssue}</Text>
            </View>
          )}

          {/* Non-fatal status: shown while the Agora Cloud Proxy fallback
              re-establishes a stalled connection on restrictive networks. */}
          {!webrtc.error && webrtc.notice && !showLowCoinWarning && (
            <View style={styles.warningBanner}>
              <Image source={require("@/assets/icons/ic_notify.png")} style={{ width: 13, height: 13, tintColor: "#FFD166" }} resizeMode="contain" />
              <Text style={styles.warningText} numberOfLines={2}>{webrtc.notice}</Text>
            </View>
          )}

          {/* FIX (UI: Chamet-style header): caller info anchored top-LEFT with a
              circular avatar (live-stream style), and the user's coin balance +
              signal anchored top-RIGHT. Replaces the single centered glass card
              so it reads like a modern live video-chat app. */}
          <View style={uiS.topRow} pointerEvents="box-none">
            <BlurView intensity={Platform.OS === "ios" ? 50 : 80} tint="dark" style={uiS.callerPill}>
              <Image source={{ uri: remoteAvatarUri }} style={uiS.callerAvatar} />
              <View style={uiS.callerInfo}>
                <Text style={uiS.callerName} numberOfLines={1}>
                  {activeCall?.participant.name ?? t.calls.connectingDots}
                </Text>
                {status === "active" ? (
                  <View style={uiS.callerMetaRow}>
                    <View style={uiS.liveBadge}>
                      <View style={uiS.liveDot} />
                      <Text style={uiS.liveText}>{t.calls.live}</Text>
                    </View>
                    <Text style={uiS.timer}>{formatTime(elapsed)}</Text>
                    {activeCall?.freeSeconds != null && activeCall.freeSeconds > 0 && elapsed < activeCall.freeSeconds && (
                      <Text style={uiS.freeChip}>🎁 {t.calls.freeMin.replace("{count}", String(Math.ceil((activeCall.freeSeconds - elapsed) / 60)))}</Text>
                    )}
                    {webrtc.remoteMuted && <Text style={{ fontSize: 12, marginLeft: 4 }}>🔇</Text>}
                  </View>
                ) : (
                  <Text style={uiS.headerSub} numberOfLines={1}>
                    {status === "connecting" ? t.calls.connectingDots : t.calls.waitingResponse}
                  </Text>
                )}
              </View>
            </BlurView>

            <View style={uiS.topRight} pointerEvents="box-none">
              <BlurView intensity={Platform.OS === "ios" ? 50 : 80} tint="dark" style={uiS.coinPill}>
                <Image source={require("@/assets/icons/ic_coin.png")} style={uiS.coinPillIcon} resizeMode="contain" />
                <Text style={uiS.coinPillText}>{(user?.coins ?? 0).toLocaleString()}</Text>
              </BlurView>
              <View style={uiS.signalRow}>
                {remainingLabel && (
                  <Text style={[uiS.remainInline, remaining != null && remaining <= 60 && { color: "#FF6B6B" }]}>
                    {remainingLabel}
                  </Text>
                )}
                <ConnectionBars state={webrtc.connectionState} quality={webrtc.connectionQuality} />
              </View>
            </View>
          </View>
        </View>

        {/* FIX (UI redesign): bottom control bar is now a single pill-shaped
            BlurView (frosted glass). Visually groups the controls and
            separates them from the video — much cleaner than free-floating
            buttons. End button retains its red accent and slightly larger
            size for the dominant-action pattern (FaceTime / WhatsApp style).
            Active-state colors:
              • Mute / Cam off → red ring (destructive-style toggle)
              • Speaker on    → blue ring (informational toggle) */}
        {/* FIX (UI: Chamet-style controls): individual floating frosted circles
            instead of one pill — reads more like a live video-chat app. End
            button stays red + larger (dominant action). */}
        {status === "active" && (
          <TouchableOpacity onPress={openGifts} style={styles.giftFab} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Send a gift">
            <Text style={styles.giftFabEmoji}>🎁</Text>
          </TouchableOpacity>
        )}
        <View style={uiS.controlRow} pointerEvents="box-none">
          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleCamera(); }}
              style={[uiS.ctrlBtn, !activeCall?.isCameraOn && uiS.ctrlBtnDanger]}
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isCameraOn ? "Turn off camera" : "Turn on camera"}
            >
              <Image source={activeCall?.isCameraOn ? require("@/assets/icons/ic_photo.png") : require("@/assets/icons/ic_cancel_video.png")} style={uiS.ctrlIcon} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{activeCall?.isCameraOn ? t.calls.camera : t.calls.camOff}</Text>
          </View>

          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleMute(); }}
              style={[uiS.ctrlBtn, activeCall?.isMuted && uiS.ctrlBtnDanger]}
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isMuted ? "Unmute" : "Mute"}
            >
              <Image source={require("@/assets/icons/ic_mic.png")} style={[uiS.ctrlIcon, { opacity: activeCall?.isMuted ? 0.5 : 1 }]} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{activeCall?.isMuted ? t.calls.unmute : t.calls.mute}</Text>
          </View>

          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.notificationAsync?.(Haptics?.NotificationFeedbackType?.Warning); handleEndCall(); }}
              style={uiS.endBtn}
              accessibilityRole="button"
              accessibilityLabel="End call"
            >
              <Image source={require("@/assets/icons/ic_call_end.png")} style={uiS.endIcon} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{t.calls.end}</Text>
          </View>

          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={handleFlip}
              style={[uiS.ctrlBtn, (!activeCall?.isCameraOn || !cameraGranted) && uiS.ctrlBtnDisabled]}
              disabled={!activeCall?.isCameraOn || !cameraGranted}
              accessibilityRole="button"
              accessibilityLabel="Flip camera"
            >
              <Image
                source={require("@/assets/icons/ic_cam_flip.png")}
                style={[uiS.ctrlIcon, { opacity: (!activeCall?.isCameraOn || !cameraGranted) ? 0.4 : 1 }]}
                resizeMode="contain"
              />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{t.calls.flip}</Text>
          </View>

          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleSpeaker(); }}
              style={[uiS.ctrlBtn, activeCall?.isSpeakerOn && uiS.ctrlBtnInfo]}
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isSpeakerOn ? "Turn off speaker" : "Turn on speaker"}
            >
              <Image source={activeCall?.isSpeakerOn ? require("@/assets/icons/ic_speaker_on.png") : require("@/assets/icons/ic_speaker_off.png")} style={uiS.ctrlIcon} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{activeCall?.isSpeakerOn ? t.calls.speaker : t.calls.earpiece}</Text>
          </View>
        </View>
      </Animated.View>

      <Modal visible={showRechargePopup} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.rechargeCard}>
            <Text style={styles.rechargeEmoji}>💰</Text>
            <Text style={styles.rechargeTitle}>{t.calls.runningOutCoins}</Text>
            <Text style={styles.rechargeSubtitle}>
              {t.calls.autoDisconnectIn.replace("{time}", remaining != null ? `${remaining} ${remaining === 1 ? t.calls.second : t.calls.seconds}` : t.calls.fewSeconds)}
            </Text>
            <TouchableOpacity
              style={styles.rechargeBtn}
              onPress={() => { dismissRechargePopup(); handleEndCall(); router.push("/user/payment/checkout"); }}
            >
              <Text style={styles.rechargeBtnText}>{t.calls.rechargeNow}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueBtn} onPress={dismissRechargePopup}>
              <Text style={styles.continueBtnText}>{t.calls.continueCall}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <GiftPickerSheet
        visible={giftOpen}
        onClose={() => setGiftOpen(false)}
        gifts={giftCatalog}
        coins={user?.coins ?? 0}
        sendingId={sendingGiftId}
        onPick={handleSendGift}
      />
      <GiftAnimation gift={giftAnim} onDone={() => setGiftAnim(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a14" },
  giftFab: { alignSelf: "center", alignItems: "center", justifyContent: "center", width: 50, height: 50, borderRadius: 25, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", marginBottom: 12 },
  giftFabEmoji: { fontSize: 25, lineHeight: 29 },

  remoteArea: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#12102a",
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  remoteAvatarBox: {
    position: "absolute",
    top: "22%",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 10,
  },
  remoteAvatar: {
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 3, borderColor: "rgba(160, 14, 231, 0.5)",
  },
  remoteCameraOffBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14,
  },
  remoteCameraOffText: {
    color: "rgba(255,255,255,0.85)", fontSize: 11,
    fontFamily: "Poppins_500Medium",
  },
  remoteGrad: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 10, 20, 0.55)",
  },
  connectingBadge: {
    position: "absolute", bottom: 110, alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  connectingText: { color: "#fff", fontSize: 15, fontFamily: "Poppins_500Medium" },

  selfPreview: {
    position: "absolute", width: 110, height: 160,
    // FIX (UI redesign): bigger rounded corners + white border + heavy shadow
    // makes the self-preview read as a clearly-secondary picture-in-picture
    // window (FaceTime / WhatsApp / Google Meet pattern). Was 16/2/none.
    borderRadius: 20, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "#1a1a2e", zIndex: 10,
    shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 10,
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
  // FIX (UI): gradient backdrops behind the top / bottom overlay so call info
  // and controls stay readable over bright remote video. Pointer-events:none
  // on these layers so they don't intercept the tap-to-toggle on the remote.
  topGradient: {
    position: "absolute", top: 0, left: 0, right: 0, height: 140,
  },
  bottomGradient: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 220,
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
  ctrlItem: { alignItems: "center", gap: 7, flex: 1 },
  // FIX (touch target): bumped from 52x52 to 56x56 to meet WCAG AAA 48px
  // touch target with comfortable padding.
  ctrlBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  ctrlBtnOff: { backgroundColor: "rgba(255,59,48,0.75)" },
  ctrlBtnActive: { backgroundColor: "rgba(255,255,255,0.45)" },
  // FIX: visual hint for buttons disabled by state (e.g. Flip while camera off)
  ctrlBtnDisabled: { backgroundColor: "rgba(255,255,255,0.08)" },
  // FIX (UI accessibility): label bumped from 10px to 11px + medium weight
  // for readability over video. 10px was below the WCAG-recommended 12px
  // body text minimum.
  ctrlLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Poppins_500Medium", textAlign: "center", textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  // FIX (UI hierarchy): End button is now visually the largest and brightest
  // control. 72x72 (vs 56x56 for other controls) makes it impossible to miss
  // and matches the dominant-button pattern from native phone apps.
  endBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#E84855", shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },

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

// ─── uiS — redesigned video-call UI styles ──────────────────────────────────
// Kept separate from the original `styles` block so the legacy fields above
// remain easy to compare against. New code paths use uiS exclusively.
const uiS = StyleSheet.create({
  // ─── Top group (warning banner + header card) ──────────────────────────
  // FIX (UI): keeps the call-info card anchored to the TOP of the screen
  // instead of floating in the vertical center. `gap` spaces the optional
  // warning banner above the header card; `alignItems: center` keeps both
  // horizontally centered like before.
  topGroup: { gap: 10, alignItems: "center" },

  // ─── Chamet-style top row (caller info left + coins/signal right) ──────────
  topRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    width: "100%", gap: 10,
  },
  callerPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 6, paddingLeft: 6, paddingRight: 16,
    borderRadius: 32, overflow: "hidden",
    backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.28)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    maxWidth: "64%",
  },
  callerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "#1a1a2e",
  },
  callerInfo: { flexShrink: 1, gap: 2 },
  callerName: {
    color: "#fff", fontSize: 15, fontFamily: "Poppins_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  callerMetaRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  topRight: { alignItems: "flex-end", gap: 7 },
  coinPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 30, overflow: "hidden",
    backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.28)",
    borderWidth: 1, borderColor: "rgba(255,209,102,0.4)",
  },
  coinPillIcon: { width: 16, height: 16 },
  coinPillText: { color: "#FFD166", fontSize: 13, fontFamily: "Poppins_700Bold" },
  signalRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  remainInline: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: "Poppins_600SemiBold" },

  // ─── Glass header card ─────────────────────────────────────────────────
  // Floating frosted-glass pill at the top with name, LIVE badge, timer,
  // remaining-time chip, and signal-strength bars. BlurView gives a true
  // backdrop blur on iOS / Android; web falls back to the tint color.
  headerCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.25)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    alignSelf: "center",
    minWidth: 240, maxWidth: "85%",
  },
  headerLeft: { flex: 1, gap: 4 },
  headerName: {
    color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  headerSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "Poppins_400Regular" },
  headerMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#EF4444",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 9, fontFamily: "Poppins_700Bold", letterSpacing: 0.6 },
  timer: {
    color: "#fff", fontSize: 14, fontFamily: "Poppins_600SemiBold",
    fontVariant: ["tabular-nums"],
  },
  freeChip: {
    color: "#8EF5A0", fontSize: 11, fontFamily: "Poppins_700Bold", marginLeft: 6,
  },
  remainPill: {
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
  },
  remainPillLow: { backgroundColor: "rgba(239,68,68,0.2)" },
  remainText: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: "Poppins_500Medium" },

  // Connection-strength bars (right side of header)
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 18 },
  bar: { width: 3, borderRadius: 1.5 },

  // ─── Glass control bar ─────────────────────────────────────────────────
  // Pill containing all five call controls. Items have equal flex so the
  // layout stays balanced on small phones (375px wide is the tightest
  // common case — fits 5 × ~48px buttons + gap comfortably).
  controlRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    alignSelf: "center",
    minWidth: 320, maxWidth: 460,
    width: "92%",
  },
  ctrlItem: { alignItems: "center", gap: 5, flex: 1 },
  // 56x56 floating frosted circle — dark translucent so it reads over bright
  // video; subtle border + shadow gives the "floating" Chamet look.
  ctrlBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(18,16,38,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  // Destructive-style toggle (mute on, camera off) — red ring.
  ctrlBtnDanger: {
    backgroundColor: "rgba(239,68,68,0.85)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  // Informational toggle (speaker on) — blue ring.
  ctrlBtnInfo: {
    backgroundColor: "rgba(59,130,246,0.75)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  // Disabled state (Flip while camera off).
  ctrlBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  ctrlIcon: { width: 22, height: 22, tintColor: "#fff" },
  ctrlLabel: {
    color: "rgba(255,255,255,0.85)", fontSize: 11,
    fontFamily: "Poppins_500Medium", textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  // End button — visually dominant: 64x64 (vs 52x52), red, glowing shadow.
  endBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#EF4444",
    alignItems: "center", justifyContent: "center",
    elevation: 8,
    shadowColor: "#EF4444", shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  },
  endIcon: { width: 28, height: 28, tintColor: "#fff" },

  // ─── Self-preview muted indicator ──────────────────────────────────────
  mutedBadge: {
    position: "absolute", top: -8, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#EF4444",
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.85)",
    elevation: 4,
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  mutedBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold", letterSpacing: 0.3 },
});


// Per-screen error boundary — contains a mid-call render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
