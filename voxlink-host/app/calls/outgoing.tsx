import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Easing,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRingtone } from "@/hooks/useRingtone";
import { resolveMediaUrl } from "@/services/api";
import { useCall } from "@/context/CallContext";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";

const RING_TIMEOUT_MS = 45000;

export default function OutgoingCallScreen() {
  const insets = useSafeAreaInsets();
  const { activeCall, endCall } = useCall();
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

  const { stop: stopRing } = useRingtone("outgoing", true);

  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const ripple3 = useRef(new Animated.Value(0)).current;

  const goToCallScreen = useCallback(async () => {
    if (navigated.current) return;
    navigated.current = true;
    await stopRing();
    router.replace(callType === "video" ? "/calls/video-call" : "/calls/audio-call");
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
          Animated.timing(val, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    animateRipple(ripple1, 0);
    animateRipple(ripple2, 600);
    animateRipple(ripple3, 1200);

    const t1 = setTimeout(() => setStatus("ringing"), 1500);

    // Fix C2: no-answer timeout — end call after 45s if host doesn't respond
    const t2 = setTimeout(async () => {
      if (!navigated.current) {
        setStatus("no_answer");
        await stopRing();
        setTimeout(() => endCall(false), 1500);
      }
    }, RING_TIMEOUT_MS);

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Fix C2 + H1: listen for call_accepted / call_declined socket events
  useEffect(() => {
    const offAccept = onEvent(SocketEvents.CALL_ACCEPT, () => {
      goToCallScreen();
    });
    const offReject = onEvent(SocketEvents.CALL_REJECT, async () => {
      if (!navigated.current) {
        setStatus("declined");
        await stopRing();
        setTimeout(() => {
          if (!navigated.current) {
            navigated.current = true;
            router.back();
          }
        }, 2000);
      }
    });
    return () => { offAccept(); offReject(); };
  }, [onEvent, goToCallScreen, stopRing]);

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
});
