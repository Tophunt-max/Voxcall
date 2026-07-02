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
  const { t } = useLanguage();
  const { activeCall, acceptCall, declineCall, endCall } = useCall();
  const { onEvent } = useSocket();
  const topPad = insets.top;
  const bottomPad = insets.bottom;

  const { stop: stopRing } = useRingtone("incoming", true);

  // Sirf tab back lo jab activeCall null ho jaye (call cancel/decline/end hua)
  // Agar status "active" ho gaya (accept hua) to back mat lo — audio/video screen open ho raha hai
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
      // Accept hone ke baad status "active" hota hai — yahan kuch mat karo
      return;
    }
    // activeCall null hua — call cancel/decline/end hua
    if (hadCall.current) {
      try { router.back(); } catch (e) { console.warn('[IncomingCall] router.back failed:', e); }
    }
  }, [activeCall]);

  const handleAccept = useCallback(async () => {
    await stopRing();
    acceptCall();
  }, [acceptCall, stopRing]);

  const handleDecline = useCallback(async () => {
    await stopRing();
    declineCall();
  }, [declineCall, stopRing]);

  // FIX (phantom incoming): a stale / replayed `incoming_call` — e.g. a WS
  // reconnect replay, a late FCM/notification, or the 4s getPendingCall poll
  // firing right as a previous call ends — could pop this screen for a call
  // that is no longer ringing. Validate against the server: if the session
  // isn't 'pending' anymore, stop the ringtone and dismiss instead of showing
  // a phantom incoming. Runs immediately on mount and every 3s.
  useEffect(() => {
    const sid = activeCall?.sessionId;
    if (!sid) return;
    let cancelled = false;
    const validate = async () => {
      try {
        const sess: any = await API.getCallSession(sid);
        if (cancelled) return;
        // Dismiss ONLY on terminal states. Crucially do NOT dismiss on
        // 'active' — that is the NORMAL transition when THIS host accepts the
        // call, and dismissing there was cancelling the call right as it
        // connected (host's video screen vanished). 'pending' = still ringing.
        const TERMINAL = ["ended", "declined", "missed", "cancelled", "rejected", "no_answer", "timeout"];
        if (sess?.status && TERMINAL.includes(String(sess.status))) {
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

  // FIX (call-disconnect propagation parity): the user's incoming screen has
  // had CALL_END + CALL_REJECT listeners; the host's did not. Result: when the
  // caller cancelled before the host accepted, the host's incoming screen
  // could stay ringing indefinitely (or until the 45 s timeout) because the
  // CallContext's `activeCall` watcher only triggers when the OPTIMISTIC local
  // state is cleared — the server's call_ended/call_rejected events were
  // arriving but had no listener wired to the CallContext.
  //
  // We dedupe by sessionId so a stale event for an unrelated session does not
  // dismiss the current incoming call.
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

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timeout = setTimeout(async () => {
      await stopRing();
      declineCall();
    }, 45000);
    return () => clearTimeout(timeout);
  }, [stopRing, declineCall]);

  return (
    <View style={[styles.screen, { backgroundColor: "#1A1A2E", paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.top}>
        <Text style={styles.incomingLabel}>{activeCall?.type === "video" ? t.incomingCallScreen.incomingVideo : t.incomingCallScreen.incomingAudio}</Text>
        <View style={styles.avatarRing}>
          <Image
            source={{ uri: resolveMediaUrl(activeCall?.participant.avatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${activeCall?.participant.id}` }}
            style={styles.avatar}
          />
        </View>
        <Text style={styles.callerName}>{activeCall?.participant.name ?? t.incomingCallScreen.unknown}</Text>
        <Text style={styles.callerRole}>{activeCall?.participant.role === "host" ? t.incomingCallScreen.voxlinkHost : t.incomingCallScreen.voxlinkUser}</Text>
      </View>

      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleDecline} style={styles.declineBtn} accessibilityRole="button" accessibilityLabel="Decline call" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Image source={require("@/assets/icons/ic_call_end.png")} style={styles.actionIcon} tintColor="#fff" resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>{t.incomingCallScreen.decline}</Text>
          </View>
          <View style={styles.actionItem}>
            <TouchableOpacity onPress={handleAccept} style={styles.acceptBtn} accessibilityRole="button" accessibilityLabel="Accept call" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Image source={require("@/assets/icons/ic_call.png")} style={styles.actionIcon} tintColor="#fff" resizeMode="contain" />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>{t.incomingCallScreen.accept}</Text>
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
  actionIcon: { width: 28, height: 28 },
  actionLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontFamily: "Poppins_400Regular" },
});


// Per-screen error boundary — contains a render crash to this screen
// (retry / go back) instead of blanking the whole app. See components/RouteErrorBoundary.
export { ErrorBoundary } from "@/components/RouteErrorBoundary";
