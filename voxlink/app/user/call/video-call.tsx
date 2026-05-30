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
import { useCallTimer } from "@/hooks/useCallTimer";
import { usePermissions } from "@/hooks/usePermissions";
import { PermissionDialog, PERMISSION_CONFIGS } from "@/components/PermissionDialog";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { API } from "@/services/api";

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
function ConnectionBars({ state }: { state: string }) {
  const level = state === "connected" ? 3 : state === "checking" || state === "new" ? 2 : 1;
  const color = level === 3 ? "#22C55E" : level === 2 ? "#FBBF24" : "#EF4444";
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

let RTCView: any = null;
// FIX: CameraView placeholder removed — was causing camera-in-use crashes on
// Android when WebRTC's getUserMedia tried to acquire the same camera. The
// require remains for backward compat in case any future code references it.
let CameraView: any = null;
let Haptics: any = null;
try {
  if (Platform.OS !== 'web') {
    // Cloudflare's react-native-webrtc fork — same RTCView component as upstream.
    RTCView = require('@cloudflare/react-native-webrtc').RTCView;
    CameraView = require('expo-camera').CameraView;
  } else {
    CameraView = require('expo-camera').CameraView; // has web support
  }
  Haptics = require('expo-haptics');
} catch {}

// ─── StreamView ──────────────────────────────────────────────────────────────
// Renders a MediaStream as video. Native: RTCView; Web: <video> srcObject.
// FIX (no-audio bug): on web we MUST attach the MediaStream to a <video> /
// <audio> element for the remote audio track to actually play. Browsers do
// not auto-play tracks just because they're in an RTCPeerConnection. We also
// explicitly call .play() because some mobile browsers (esp. iOS Safari)
// ignore the `autoPlay` attribute even after a user gesture.
function StreamView({ stream, style, mirror = false, audioOnly = false }: { stream: any; style?: any; mirror?: boolean; audioOnly?: boolean }) {
  const videoRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = videoRef.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch {}
    // Explicit play() — autoPlay alone is unreliable on iOS Safari / Chrome
    // mobile when the page is in the background or the track was added late.
    const tryPlay = () => {
      const p = el.play?.();
      if (p && typeof p.catch === 'function') {
        p.catch((err: any) => {
          // Most common reason: autoplay policy. We re-try on the next user
          // tap/click so the call doesn't stay silent forever.
          console.warn('[StreamView] play() rejected:', err?.message ?? err);
          const retry = () => {
            el.play?.().catch(() => {});
            window.removeEventListener('click', retry);
            window.removeEventListener('touchend', retry);
          };
          try {
            window.addEventListener('click', retry, { once: true });
            window.addEventListener('touchend', retry, { once: true });
          } catch {}
        });
      }
    };
    tryPlay();
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
        // For audio-only mounts, render a 1x1 invisible element. We can't
        // use display:none because some browsers pause playback when the
        // element is fully removed from layout.
        ...(audioOnly ? { width: 1, height: 1, opacity: 0, position: 'absolute', pointerEvents: 'none' } : {}),
      },
    });
  }

  // On native, react-native-webrtc routes audio through the audio session
  // automatically — we only need RTCView for the video portion.
  if (audioOnly) return null;
  if (!RTCView || !stream?.toURL) return null;
  return <RTCView streamURL={stream.toURL()} style={style} objectFit="cover" mirror={mirror} zOrder={mirror ? 1 : 0} />;
}

type PermStep = "camera" | "microphone" | "done";

export default function VideoCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, toggleMute, toggleCamera, toggleSpeaker, markCallActive } = useCall();
  const [status, setStatus] = useState<"connecting" | "ringing" | "active">("connecting");

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

  useEffect(() => {
    if (webrtc.isConnected && status !== "active") {
      setStatus("active");
      markCallActive();
    }
  }, [webrtc.isConnected, status, markCallActive]);

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
  }, [webrtc.error, webrtc.clearError, webrtc.cleanup, endCall, permissions.camera.status, permissions.microphone.status]);

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

  // FIX (connecting timeout): if WebRTC never reaches `connected` state within
  // 30 s of mount, the call is stalled (CF Calls negotiation hung, ICE timed
  // out, etc.). Auto-end gracefully so the user is not stuck on "Connecting...".
  useEffect(() => {
    if (status === "active") return;
    if (!webrtcReady) return;
    const t = setTimeout(() => {
      if (!webrtc.isConnected) {
        console.warn("[video-call] Did not connect within 30s — auto-ending");
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
          console.warn("[video-call] Server reports session", sess.status, "— cleaning up");
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
    endCall(true);
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
    ? remaining <= 60 ? `${remaining}s left` : `${Math.ceil(remaining / 60)} min left`
    : null;

  const connectingLabel = (() => {
    switch (webrtc.connectionState) {
      case "checking":     return "Connecting...";
      case "connected":    return "Connected";
      case "disconnected": return "Network drop — reconnecting...";
      case "failed":       return "Connection failed — retrying...";
      default:             return "Connecting...";
    }
  })();

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
  const selfPan = useRef(new Animated.ValueXY({ x: SCREEN_W - SELF_W - 16, y: insets.top + 12 })).current;
  const selfPosition = useRef({ x: SCREEN_W - SELF_W - 16, y: insets.top + 12 });

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
        {webrtc.remoteStream && (
          <StreamView stream={webrtc.remoteStream} style={styles.remoteVideo} mirror={false} />
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
                  <Text style={styles.remoteCameraOffText}>Camera off</Text>
                </View>
              )}
            </View>
          </>
        )}
        {status !== "active" && (
          <View style={styles.connectingBadge}>
            <Text style={styles.connectingText}>
              {status === "connecting" ? connectingLabel : "Ringing..."}
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
          webrtc.localStream ? (
            <StreamView stream={webrtc.localStream} style={styles.selfCameraView} mirror={true} />
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
              <Text style={styles.selfCameraOffText}>Starting camera…</Text>
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
              {!cameraGranted ? "No Permission" : "Camera Off"}
            </Text>
          </View>
        )}
        <View style={styles.selfLabel}>
          <Text style={styles.selfLabelText}>You</Text>
        </View>
        {/* FIX (UI redesign): persistent muted indicator. Without this the
            user could leave their mic muted and forget — only knowing when
            the other side asked "you there?". A small red pill anchored
            at the top of the self-preview makes the muted state obvious. */}
        {activeCall?.isMuted && (
          <View style={uiS.mutedBadge}>
            <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 10, height: 10, tintColor: "#fff" }} resizeMode="contain" />
            <Text style={uiS.mutedBadgeText}>Muted</Text>
          </View>
        )}
      </Animated.View>

      {permStep === "done" && (!cameraGranted || !micGranted) && (
        <View style={[styles.permMissingBar, { top: insets.top + 8 }]}>
          {!cameraGranted && (
            <TouchableOpacity onPress={() => setPermStep("camera")} style={styles.permChip}>
              <Image source={require("@/assets/icons/ic_cancel_video.png")} style={{ width: 12, height: 12, tintColor: "#FFD166" }} resizeMode="contain" />
              <Text style={styles.permChipText}>Camera off</Text>
            </TouchableOpacity>
          )}
          {!micGranted && (
            <TouchableOpacity onPress={() => setPermStep("microphone")} style={styles.permChip}>
              <Image source={require("@/assets/icons/ic_mic.png")} style={{ width: 12, height: 12, tintColor: "#FFD166", opacity: 0.5 }} resizeMode="contain" />
              <Text style={styles.permChipText}>No mic</Text>
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
              <Text style={styles.warningText}>Low coins — {remainingLabel}</Text>
            </View>
          )}

          {webrtc.error && !showLowCoinWarning && (
            <View style={styles.warningBanner}>
              <Image source={require("@/assets/icons/ic_close.png")} style={{ width: 13, height: 13, tintColor: "#FF6B6B" }} resizeMode="contain" />
              <Text style={styles.warningText}>Connection issue</Text>
            </View>
          )}

          {/* FIX (UI redesign): glassmorphism header card.
              BlurView on native gives a true frosted-glass effect; on web the
              tint+intensity props degrade to a translucent dark pill which
              still reads correctly over bright remote video. ConnectionBars
              on the right give an at-a-glance signal indicator (3 green/2
              yellow/1 red) so the user knows the call quality without reading
              text. The right-aligned remaining-time pill stacks under the
              timer instead of fighting it for horizontal space. */}
          <BlurView intensity={Platform.OS === "ios" ? 50 : 80} tint="dark" style={uiS.headerCard}>
            <View style={uiS.headerLeft}>
              <Text style={uiS.headerName} numberOfLines={1}>
                {activeCall?.participant.name ?? "Connecting..."}
              </Text>
              {status === "active" ? (
                <View style={uiS.headerMetaRow}>
                  <View style={uiS.liveBadge}>
                    <View style={uiS.liveDot} />
                    <Text style={uiS.liveText}>LIVE</Text>
                  </View>
                  <Text style={uiS.timer}>{formatTime(elapsed)}</Text>
                  {remainingLabel && (
                    <View style={[uiS.remainPill, remaining != null && remaining <= 60 && uiS.remainPillLow]}>
                      <Text
                        style={[
                          uiS.remainText,
                          remaining != null && remaining <= 60 && { color: "#FF6B6B" },
                        ]}
                      >
                        {remainingLabel}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <Text style={uiS.headerSub}>
                  {status === "connecting" ? "Setting up secure connection..." : "Waiting for response..."}
                </Text>
              )}
            </View>
            <ConnectionBars state={webrtc.connectionState} />
          </BlurView>
        </View>

        {/* FIX (UI redesign): bottom control bar is now a single pill-shaped
            BlurView (frosted glass). Visually groups the controls and
            separates them from the video — much cleaner than free-floating
            buttons. End button retains its red accent and slightly larger
            size for the dominant-action pattern (FaceTime / WhatsApp style).
            Active-state colors:
              • Mute / Cam off → red ring (destructive-style toggle)
              • Speaker on    → blue ring (informational toggle) */}
        <BlurView intensity={Platform.OS === "ios" ? 60 : 90} tint="dark" style={uiS.controlBar}>
          <View style={uiS.ctrlItem}>
            <TouchableOpacity
              onPress={() => { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); toggleCamera(); }}
              style={[uiS.ctrlBtn, !activeCall?.isCameraOn && uiS.ctrlBtnDanger]}
              accessibilityRole="button"
              accessibilityLabel={activeCall?.isCameraOn ? "Turn off camera" : "Turn on camera"}
            >
              <Image source={activeCall?.isCameraOn ? require("@/assets/icons/ic_photo.png") : require("@/assets/icons/ic_cancel_video.png")} style={uiS.ctrlIcon} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={uiS.ctrlLabel}>{activeCall?.isCameraOn ? "Camera" : "Cam Off"}</Text>
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
            <Text style={uiS.ctrlLabel}>{activeCall?.isMuted ? "Unmute" : "Mute"}</Text>
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
            <Text style={uiS.ctrlLabel}>End</Text>
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
            <Text style={uiS.ctrlLabel}>Flip</Text>
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
            <Text style={uiS.ctrlLabel}>{activeCall?.isSpeakerOn ? "Speaker" : "Earpiece"}</Text>
          </View>
        </BlurView>
      </Animated.View>

      <Modal visible={showRechargePopup} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.rechargeCard}>
            <Text style={styles.rechargeEmoji}>💰</Text>
            <Text style={styles.rechargeTitle}>Running Out of Coins!</Text>
            <Text style={styles.rechargeSubtitle}>
              Call will auto-disconnect in {remaining != null ? `${remaining} second${remaining === 1 ? "" : "s"}` : "a few seconds"}
            </Text>
            <TouchableOpacity
              style={styles.rechargeBtn}
              onPress={() => { dismissRechargePopup(); handleEndCall(); router.push("/user/screens/home/wallet"); }}
            >
              <Text style={styles.rechargeBtnText}>Recharge Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueBtn} onPress={dismissRechargePopup}>
              <Text style={styles.continueBtnText}>Continue Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  controlBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: 36, overflow: "hidden",
    backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.3)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    alignSelf: "center",
    minWidth: 320, maxWidth: 460,
    width: "92%",
  },
  ctrlItem: { alignItems: "center", gap: 5, flex: 1 },
  // 52x52 base — exceeds WCAG AAA 48px touch target with comfortable padding.
  ctrlBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "transparent",
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
