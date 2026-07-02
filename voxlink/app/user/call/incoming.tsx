import React, { useEffect, useCallback, useRef } from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useCall } from "@/context/CallContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSocket } from "@/context/SocketContext";
import { SocketEvents } from "@/constants/events";
import { resolveMediaUrl, API } from "@/services/api";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useRingtone } from "@/hooks/useRingtone";

export default function IncomingCallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeCall, acceptCall, declineCall, endCall } = useCall();
  const { onEvent } = useSocket();
  const { t } = useLanguage();
  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const { stop: stopRing } = useRingtone("incoming", true);

  // Watch for activeCall going null (remote caller cancelled, server ended call)
  const hasMounted = useRef(false);
  const hadCall = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      if (activeCall) hadCall.current = true;
      return;
    }
    if (activeCall) {
      hadCall.current = true;
      return;
    }
    if (hadCall.current) {
      stopRing().catch((e) => console.warn("[IncomingCall] stopRing on activeCall null failed:", e));
      try { router.back(); } catch (e) { console.warn("[IncomingCall] router.back on activeCall null failed:", e); }
    }
  }, [activeCall, stopRing]);

  // FIX: CALL_END + CALL_REJECT listeners — jab caller (host) cancel kare
  // AppBridge se CALL_END remove kiya tha (audio/video double endCall fix ke liye)
  // Lekin incoming screen pe koi listener nahi tha → screen stuck rehti thi
  useEffect(() => {
    const offEnd = onEvent(SocketEvents.CALL_END, async (data: any) => {
      const sid = data?.sessionId ?? data?.session_id;
      if (activeCall && sid && activeCall.sessionId !== sid) return;
      await stopRing().catch(() => {});
      endCall(true);
    });
    const offReject = onEvent(SocketEvents.CALL_REJECT, async (data: any) => {
      const sid = data?.sessionId ?? data?.session_id;
      if (activeCall && sid && activeCall.sessionId !== sid) return;
      await stopRing().catch(() => {});
      endCall(true);
    });
    return () => { offEnd(); offReject(); };
  }, [onEvent, activeCall, stopRing, endCall]);

  const handleAccept = useCallback(async () => {
    await stopRing();
    acceptCall();
  }, [acceptCall, stopRing]);

  // FIX (phantom incoming): a stale / replayed `incoming_call` event — e.g. a
  // WebSocket reconnect replay, a late FCM tap, or the polling fallback firing
  // right as a call ends — could pop this screen for a call that is no longer
  // ringing. Validate against the server: if the session is not 'pending'
  // anymore (ended / declined / missed / active elsewhere), stop the ringtone
  // and dismiss instead of showing a phantom incoming call. Runs immediately
  // on mount and every 3s while the screen is up.
  useEffect(() => {
    const sid = activeCall?.sessionId;
    if (!sid) return;
    let cancelled = false;
    const validate = async () => {
      try {
        const sess: any = await API.getCallSession(sid);
        if (cancelled) return;
        if (sess?.status && sess.status !== "pending") {
          await stopRing().catch(() => {});
          declineCall();
        }
      } catch (e: any) {
        if (/not found|404/i.test(String(e?.message ?? ""))) {
          if (!cancelled) { await stopRing().catch(() => {}); declineCall(); }
        }
      }
    };
    validate();
    const interval = setInterval(validate, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeCall?.sessionId, stopRing, declineCall]);

  const handleDecline = useCallback(async () => {
    await stopRing();
    declineCall();
  }, [declineCall, stopRing]);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // FIX: caller-side ringback uses RING_TIMEOUT_MS = 45000 (see outgoing.tsx).
    // Receiver MUST match that to avoid a race where receiver auto-declines while
    // caller still sees "ringing".
    const timeout = setTimeout(async () => {
      await stopRing();
      declineCall();
    }, 45000);
    return () => clearTimeout(timeout);
  }, [stopRing, declineCall]);

  return (
    <View style={[styles.screen, { backgroundColor: "#1A1A2E", paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.top}>
        <Text style={styles.incomingLabel}>{activeCall?.type === "video" ? t.calls.incomingVideo : t.calls.incomingAudio}</Text>
        <View style={styles.avatarRing}>
          <Image
            source={{ uri: resolveMediaUrl(activeCall?.participant.avatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${activeCall?.participant.id}` }}
            style={styles.avatar}
          />
        </View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? t.calls.unknown}</Text>
        {/* Fix M2: show correct role — "user" callers are Users, not Hosts */}
        <Text style={styles.callerRole}>{activeCall?.participant.role === "host" ? t.calls.voxlinkHost : t.calls.voxlinkUser}</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleDecline} style={styles.declineBtn}>
              <Image source={require("@/assets/icons/ic_call_end.png")} style={{ width: 28, height: 28, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>{t.calls.decline}</Text>
          </View>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleAccept} style={styles.acceptBtn}>
              <Image source={require("@/assets/icons/ic_call.png")} style={{ width: 28, height: 28, tintColor: "#fff" }} resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>{t.calls.accept}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "space-between", paddingHorizontal: 32 },
  top: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  incomingLabel: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular" },
  avatarRing: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  callerName: { color: "#fff", fontSize: 28, fontFamily: "Poppins_700Bold", marginTop: 12 },
  callerRole: { color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "Poppins_400Regular" },
  actions: { paddingBottom: 40 },
  actionRow: { flexDirection: "row", gap: 64, alignItems: "center" },
  actionItem: { alignItems: "center", gap: 10 },
  declineBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E84855", alignItems: "center", justifyContent: "center" },
  acceptBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center" },
  actionLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Poppins_400Regular" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
