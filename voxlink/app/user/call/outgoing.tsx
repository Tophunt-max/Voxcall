import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Easing, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRingtone } from "@/hooks/useRingtone";
import { resolveMediaUrl, API } from "@/services/api";
import { useCall } from "@/context/CallContext";
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

export default function OutgoingCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall, syncServerStartTime } = useCall();
  const { onEvent } = useSocket();
  const params = useLocalSearchParams<{
    hostId: string;
    callType: string;
    hostName: string;
    hostAvatar: string;
    specialty: string;
  }>();

  const hostId    = params.hostId   ?? "host";
  const callType  = params.callType ?? "audio";
  const hostName  = params.hostName ?? "Host";
  const hostAvatar = resolveMediaUrl(params.hostAvatar) ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${hostId}`;
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
    await stopRing();
    router.replace(callType === "video" ? "/user/call/video-call" : "/user/call/audio-call");
  }, [callType, stopRing]);

  const cancelCall = useCallback(async () => {
    if (navigated.current) return;
    navigated.current = true;
    await stopRing();
    // Fix M1: end call on backend when user cancels
    endCall(false);
  }, [stopRing, endCall]);

  useEffect(() => {
    const animateRipple = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: useNativeDriverValue }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: useNativeDriverValue }),
        ])
      ).start();
    animateRipple(ripple1, 0);
    animateRipple(ripple2, 600);
    animateRipple(ripple3, 1200);

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

  const makeRipple = (val: Animated.Value, size: number) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, size] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 0.2, 0] }),
  });

  const statusLabel =
    status === "declined"  ? "Call Declined" :
    status === "no_answer" ? "No Answer" :
    status === "ringing"   ? "Ringing..." :
                             "Connecting...";

  return (
    <View style={[s.container, { backgroundColor: "#1A1040" }]}>
      <View style={{ alignItems: "center", flex: 1, justifyContent: "center", gap: 24 }}>
        <Text style={s.callTypeLabel}>
          {callType === "video" ? "Video Call" : "Voice Call"}
        </Text>

        <View style={s.avatarWrap}>
          {[ripple3, ripple2, ripple1].map((r, i) => (
            <Animated.View key={i} style={[s.rippleCircle, makeRipple(r, 1.5 + i * 0.5)]} />
          ))}
          <Image
            source={{ uri: hostAvatar }}
            style={s.avatar}
          />
        </View>

        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={s.hostName}>{hostName}</Text>
          {!!specialty && <Text style={s.hostMeta}>{specialty}</Text>}
          <Text style={[s.statusText, (status === "declined" || status === "no_answer") && { color: "#FF6B6B" }]}>
            {statusLabel}
          </Text>
          {status !== "declined" && status !== "no_answer" && (
            <View style={s.minBillingBadge}>
              <Text style={s.minBillingText}>⏱ Minimum 1 minute billing applies</Text>
            </View>
          )}
        </View>
      </View>

      <View style={[s.bottomControls, { paddingBottom: insets.bottom + 40 }]}>
        <TouchableOpacity
          style={s.endBtn}
          onPress={cancelCall}
          activeOpacity={0.85}
        >
          <Image source={require("@/assets/icons/ic_call_end.png")} style={s.endIcon} resizeMode="contain" />
        </TouchableOpacity>
        <Text style={s.endLabel}>Cancel</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  callTypeLabel: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontFamily: "Poppins_500Medium", letterSpacing: 1, textTransform: "uppercase" },
  avatarWrap: { alignItems: "center", justifyContent: "center", width: 180, height: 180 },
  rippleCircle: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(160, 14, 231, 0.3)" },
  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: "rgba(255,255,255,0.3)" },
  hostName: { color: "#fff", fontSize: 24, fontFamily: "Poppins_700Bold" },
  hostMeta: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular" },
  statusText: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontFamily: "Poppins_400Regular", marginTop: 8 },
  bottomControls: { alignItems: "center", gap: 12 },
  endBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },
  endIcon: { width: 30, height: 30, tintColor: "#fff" },
  endLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Poppins_400Regular" },
  minBillingBadge: {
    marginTop: 6, paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  minBillingText: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "Poppins_400Regular" },
});
