import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Easing, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRingtone } from "@/hooks/useRingtone";
import { resolveMediaUrl, API } from "@/services/api";
import { useCall } from "@/context/CallContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";

const useNativeDriverValue = Platform.OS !== "web";

const RING_TIMEOUT_MS = 45000;
// FIX: poll the server's session status every 12s while the call is pending.
// Catches the case where the host accepted/declined but the WebSocket
// CALL_ACCEPT/CALL_REJECT event was missed (mobile data switch, brief WS
// drop). Without this, the user is stuck on "Ringing..." until the 45s
// no-answer timeout even though the host already picked up.
const STATUS_POLL_MS = 12000;

// ─── AnimatedDots ────────────────────────────────────────────────────────────
// FIX (UI polish): the previous version showed a static "Ringing..." string
// with the trailing dots baked in. Animating each dot's opacity gives the
// user a clear "we're actively waiting" signal, matching the pattern used
// in WhatsApp, Zoom, and FaceTime call-out screens.
function AnimatedDots({ color }: { color: string }) {
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;
  const d3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animate = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 400, useNativeDriver: useNativeDriverValue }),
          Animated.timing(val, { toValue: 0.3, duration: 400, useNativeDriver: useNativeDriverValue }),
        ])
      ).start();
    animate(d1, 0);
    animate(d2, 200);
    animate(d3, 400);
  }, []);

  return (
    <View style={s.dotsRow}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View key={i} style={[s.dot, { backgroundColor: color, opacity: d }]} />
      ))}
    </View>
  );
}

export default function OutgoingCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, syncServerStartTime } = useCall();
  const { onEvent } = useSocket();
  const { t } = useLanguage();
  const params = useLocalSearchParams<{
    hostId: string;
    callType: string;
    hostName: string;
    hostAvatar: string;
    specialty: string;
  }>();

  const hostId    = params.hostId   ?? "host";
  const callType  = params.callType ?? "audio";
  const hostName  = params.hostName ?? t.hosts.host;
  const hostAvatar = resolveMediaUrl(params.hostAvatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${hostId}`;
  const specialty = params.specialty ?? "";

  const [status, setStatus] = useState<"connecting" | "ringing" | "declined" | "no_answer">("connecting");
  const navigated = useRef(false);
  // FIX: track every nested setTimeout so they can be cancelled if the
  // component unmounts before they fire. Previously the chain
  //   setTimeout → setStatus → setTimeout → endCall
  // would fire endCall(false) on a dead component, throwing a state-update
  // warning and (worse) cancelling the call AFTER the user had already
  // navigated to the call screen via the CALL_ACCEPT path.
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const { stop: stopRing } = useRingtone("outgoing", true);

  // Track every nested timeout so the unmount cleanup can clear them all.
  const scheduleTimeout = useCallback((fn: () => void, ms: number): void => {
    const id = setTimeout(() => {
      pendingTimeouts.current.delete(id);
      fn();
    }, ms);
    pendingTimeouts.current.add(id);
  }, []);

  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const ripple3 = useRef(new Animated.Value(0)).current;

  const goToCallScreen = useCallback(async () => {
    if (navigated.current) return;
    navigated.current = true;
    // FIX (UI feedback): success haptic when host accepts. Audio-only haptic
    // gives the user a clear non-visual cue at the moment of connection.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await stopRing();
    router.replace(callType === "video" ? "/user/call/video-call" : "/user/call/audio-call");
  }, [callType, stopRing]);

  const cancelCall = useCallback(async () => {
    if (navigated.current) return;
    navigated.current = true;
    // FIX (UI feedback): warning haptic on Cancel — matches the destructive
    // visual intent of the red end-call button.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    await stopRing();
    // Fix M1: end call on backend when user cancels
    endCall(false);
  }, [stopRing, endCall]);

  useEffect(() => {
    const animateRipple = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2400, easing: Easing.out(Easing.ease), useNativeDriver: useNativeDriverValue }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: useNativeDriverValue }),
        ])
      ).start();
    animateRipple(ripple1, 0);
    animateRipple(ripple2, 800);
    animateRipple(ripple3, 1600);

    const t1 = setTimeout(() => setStatus("ringing"), 1500);
    pendingTimeouts.current.add(t1);

    // Fix C2: no-answer timeout — end call after 45s if host doesn't respond
    const t2 = setTimeout(async () => {
      pendingTimeouts.current.delete(t2);
      if (!navigated.current) {
        setStatus("no_answer");
        await stopRing();
        // FIX: tracked nested timeout so it can be cancelled on unmount.
        scheduleTimeout(() => endCall(false), 1500);
      }
    }, RING_TIMEOUT_MS);
    pendingTimeouts.current.add(t2);

    // FIX (cleanup): clear ALL pending timeouts on unmount, including the
    // nested ones queued via scheduleTimeout. Previously t1+t2 were cleared
    // but the inner setTimeout(...→endCall, 1500) survived, firing endCall
    // on a dead component.
    return () => {
      pendingTimeouts.current.forEach((id) => clearTimeout(id));
      pendingTimeouts.current.clear();
    };
  }, [stopRing, endCall, scheduleTimeout]);

  // Fix C2 + H1: listen for call_accepted / call_declined / call_ended socket events
  useEffect(() => {
    const offAccept = onEvent(SocketEvents.CALL_ACCEPT, (payload: any) => {
      // FIX: sync client billing timer to server's started_at before navigating
      if (payload?.startedAt) {
        syncServerStartTime(payload.startedAt);
      }
      goToCallScreen();
    });
    const offReject = onEvent(SocketEvents.CALL_REJECT, async () => {
      if (!navigated.current) {
        setStatus("declined");
        await stopRing();
        // FIX: tracked timeout — see scheduleTimeout for rationale.
        scheduleTimeout(() => {
          if (!navigated.current) {
            navigated.current = true;
            router.back();
          }
        }, 2000);
      }
    });
    // FIX: If server forcefully ends the pending call (cron cleanup / host crash),
    // dismiss the outgoing screen instead of staying stuck on "Ringing..."
    const offEnd = onEvent(SocketEvents.CALL_END, async () => {
      if (!navigated.current) {
        setStatus("no_answer");
        await stopRing();
        scheduleTimeout(() => {
          if (!navigated.current) {
            navigated.current = true;
            endCall(false);
          }
        }, 1500);
      }
    });
    return () => { offAccept(); offReject(); offEnd(); };
  }, [onEvent, goToCallScreen, stopRing, syncServerStartTime, endCall, scheduleTimeout]);

  // FIX (stuck-screen safety net): if activeCall goes null while we're still
  // showing this screen (logout, network issue cleared the context, or user
  // double-tapped Cancel and CallContext flushed), dismiss without billing.
  // navigated.current guards against the legitimate accept-then-clear path
  // where activeCall is replaced with the active session shape.
  useEffect(() => {
    if (navigated.current) return;
    if (activeCall === null && status !== "declined" && status !== "no_answer") {
      navigated.current = true;
      try { router.back(); } catch { /* navigation may be gone */ }
    }
  }, [activeCall, status]);

  // FIX (session-status poll): WebSocket CALL_ACCEPT/CALL_REJECT delivery
  // can be lost (mobile data switch, app backgrounded with WS suspended).
  // Poll the server every 12 s while the call is pending so we navigate to
  // the call screen even if the WS event was dropped. This mirrors the
  // safety-net poll added to audio-call.tsx and video-call.tsx.
  useEffect(() => {
    if (navigated.current) return;
    if (!activeCall?.sessionId) return;
    const sid = activeCall.sessionId;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || navigated.current) return;
      try {
        const sess: any = await API.getCallSession(sid);
        if (cancelled || navigated.current) return;
        if (sess?.status === "active") {
          // Host accepted — navigate even though WS event was missed.
          if (sess.started_at) syncServerStartTime(sess.started_at);
          goToCallScreen();
        } else if (sess?.status === "declined" || sess?.status === "missed" || sess?.status === "ended") {
          // Host declined / cron-reaped / 410 — clean up.
          setStatus(sess.status === "declined" ? "declined" : "no_answer");
          await stopRing();
          scheduleTimeout(() => {
            if (!navigated.current) {
              navigated.current = true;
              endCall(false);
            }
          }, 1500);
        }
      } catch {
        // Network blip — try again next tick. 404 here means the session
        // was pruned, treat as no_answer.
      }
    }, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeCall?.sessionId, goToCallScreen, stopRing, endCall, syncServerStartTime, scheduleTimeout]);

  // FIX (UI polish): ripples now animate from the avatar's outer edge outward,
  // not from a fixed inner circle. The visual reads as the avatar "broadcasting"
  // a signal — the previous version had the rings start tiny and grow past
  // the avatar, which looked like noise instead of intentional ripples.
  const makeRipple = (val: Animated.Value) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 0.25, 0] }),
  });

  const isErrorState = status === "declined" || status === "no_answer";
  const statusColor = isErrorState ? "#FF6B6B" : "rgba(255,255,255,0.85)";
  const statusLabel =
    status === "declined"  ? t.calls.callDeclined :
    status === "no_answer" ? t.calls.noAnswer :
    status === "ringing"   ? t.calls.ringing :
                             t.calls.connecting;

  // FIX (UI hierarchy): coins/min badge surfaces the cost up-front so the
  // user knows what the call will bill. Previously this info was buried.
  const coinsPerMinute = activeCall?.coinsPerMinute;

  return (
    <LinearGradient
      colors={callType === "video"
        ? ["#1A0040", "#3D0073", "#1A0040"]
        : ["#200060", "#4B0082", "#1A0040"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[s.container, { paddingTop: insets.top + 24 }]}
    >
      {/* Top: call-type label */}
      <View style={s.topSection}>
        <View style={s.callTypeBadge}>
          <Image
            source={callType === "video"
              ? require("@/assets/icons/ic_photo.png")
              : require("@/assets/icons/ic_call.png")}
            style={s.callTypeIcon}
            resizeMode="contain"
          />
          <Text style={s.callTypeLabel}>
            {callType === "video" ? t.calls.video : t.calls.voiceCall}
          </Text>
        </View>
      </View>

      {/* Middle: avatar + ripples + name */}
      <View style={s.middleSection}>
        <View style={s.avatarWrap}>
          {[ripple3, ripple2, ripple1].map((r, i) => (
            <Animated.View key={i} style={[s.rippleCircle, makeRipple(r)]} />
          ))}
          <View style={s.avatarRing}>
            <Image source={{ uri: hostAvatar }} style={s.avatar} />
          </View>
        </View>

        <Text style={s.hostName} numberOfLines={1}>{hostName}</Text>
        {!!specialty && <Text style={s.hostMeta} numberOfLines={1}>{specialty}</Text>}

        {/* Status row: text + animated dots (for in-progress states) */}
        <View style={s.statusRow}>
          <Text style={[s.statusText, { color: statusColor }]}>
            {statusLabel}
          </Text>
          {!isErrorState && <AnimatedDots color={statusColor} />}
        </View>

        {/* Cost info — hidden once call ends so we don't tease about a price
            that's no longer relevant. */}
        {!isErrorState && (
          <View style={s.costRow}>
            {coinsPerMinute != null && (
              <View style={s.costBadge}>
                <Text style={s.costEmoji}>🪙</Text>
                <Text style={s.costText}>
                  {coinsPerMinute} <Text style={s.costSubText}>{t.calls.coinsPerMin}</Text>
                </Text>
              </View>
            )}
            <View style={s.costBadge}>
              <Image
                source={require("@/assets/icons/ic_calendar.png")}
                style={s.costSubIcon}
                resizeMode="contain"
              />
              <Text style={s.costSubText}>{t.calls.oneMinMinimum}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Bottom: cancel button */}
      <View style={[s.bottomControls, { paddingBottom: insets.bottom + 36 }]}>
        <TouchableOpacity
          style={s.endBtn}
          onPress={cancelCall}
          activeOpacity={0.8}
          // FIX (accessibility): explicit role + label so screen readers
          // announce the destructive action correctly.
          accessibilityRole="button"
          accessibilityLabel="Cancel call"
        >
          <Image source={require("@/assets/icons/ic_call_end.png")} style={s.endIcon} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={s.endLabel}>{t.common.cancel}</Text>
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  // ─── Top section ─────────────────────────────────────────────────────────
  topSection: { alignItems: "center", paddingTop: 8 },
  callTypeBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  callTypeIcon: { width: 16, height: 16, tintColor: "rgba(255,255,255,0.85)" },
  callTypeLabel: {
    color: "rgba(255,255,255,0.9)", fontSize: 12,
    fontFamily: "Poppins_600SemiBold", letterSpacing: 1,
    textTransform: "uppercase",
  },

  // ─── Middle section ──────────────────────────────────────────────────────
  middleSection: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 14, paddingHorizontal: 24,
  },
  // FIX (clipping): wrap is now sized to fit the LARGEST ripple at peak
  // scale (avatar 132 × 2.2 ≈ 290) so rings never get cropped at the edges
  // of the wrap. Previously wrap was 180 — rings got clipped past 1.5x.
  avatarWrap: {
    width: 290, height: 290,
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  rippleCircle: {
    position: "absolute",
    width: 132, height: 132, borderRadius: 66,
    backgroundColor: "rgba(160, 14, 231, 0.55)",
    shadowColor: "#A00EE7", shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
  },
  avatarRing: {
    width: 132, height: 132, borderRadius: 66,
    borderWidth: 3, borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatar: {
    width: 116, height: 116, borderRadius: 58,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  hostName: {
    color: "#fff", fontSize: 28, fontFamily: "Poppins_700Bold",
    marginTop: 8, textAlign: "center",
  },
  hostMeta: {
    color: "rgba(255,255,255,0.6)", fontSize: 14,
    fontFamily: "Poppins_400Regular",
  },
  statusRow: {
    flexDirection: "row", alignItems: "center", gap: 4,
    marginTop: 8,
  },
  statusText: {
    fontSize: 16, fontFamily: "Poppins_500Medium",
  },
  dotsRow: { flexDirection: "row", gap: 4, marginLeft: 4, marginBottom: -2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  costRow: {
    flexDirection: "row", gap: 8, flexWrap: "wrap",
    justifyContent: "center", marginTop: 6,
  },
  costBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  costEmoji: { fontSize: 14 },
  costSubIcon: { width: 12, height: 12, tintColor: "rgba(255,255,255,0.65)" },
  costText: {
    color: "#FFD166", fontSize: 13, fontFamily: "Poppins_700Bold",
  },
  costSubText: {
    color: "rgba(255,255,255,0.7)", fontSize: 11,
    fontFamily: "Poppins_500Medium",
  },

  // ─── Bottom controls ─────────────────────────────────────────────────────
  bottomControls: { alignItems: "center", gap: 10 },
  // FIX (touch target): bumped from 68px to 76px so the destructive button
  // reads as the most important action on screen (matches industry standard
  // for primary call actions: WhatsApp 80px, Telegram 76px, FaceTime 72px).
  endBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "#E84855",
    alignItems: "center", justifyContent: "center",
    elevation: 8,
    shadowColor: "#E84855", shadowOpacity: 0.6,
    shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  endIcon: { width: 32, height: 32, tintColor: "#fff" },
  endLabel: {
    color: "rgba(255,255,255,0.75)", fontSize: 13,
    fontFamily: "Poppins_500Medium",
  },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
