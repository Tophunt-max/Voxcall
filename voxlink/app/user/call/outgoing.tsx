import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image,
  Animated, Easing, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRingtone } from "@/hooks/useRingtone";
import { resolveMediaUrl, API } from "@/services/api";
import { showErrorToast } from "@/components/Toast";
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
  const { activeCall, endCall, syncServerStartTime, initiateCall } = useCall();
  const { onEvent } = useSocket();
  const { t } = useLanguage();
  const params = useLocalSearchParams<{
    hostId: string;
    callType: string;
    hostName: string;
    hostAvatar: string;
    specialty: string;
    isRandom: string;
    gender: string;
    minRating: string;
  }>();

  const callType  = params.callType ?? "audio";
  // Random calls turn this screen into an auto-dialer: on decline / no-answer
  // (or when the user taps Skip) we ring the NEXT matched host in place instead
  // of bailing back to the search screen. Direct calls (isRandom false) keep
  // their original one-shot behaviour untouched.
  const isRandom = params.isRandom === "1";
  const matchFilters = useRef<{ gender?: "male" | "female"; min_rating?: number }>({
    gender: params.gender === "male" || params.gender === "female" ? params.gender : undefined,
    min_rating: Number(params.minRating) > 0 ? Number(params.minRating) : undefined,
  }).current;

  // Currently-dialed host. State (not derived from params) so the auto-dialer
  // can swap in the next host without navigating away.
  const [host, setHost] = useState(() => {
    const id = params.hostId ?? "host";
    return {
      id,
      name: params.hostName ?? t.hosts.host,
      avatar: resolveMediaUrl(params.hostAvatar) ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${id}`,
      specialty: params.specialty ?? "",
    };
  });

  const [status, setStatus] = useState<"connecting" | "ringing" | "declined" | "no_answer">("connecting");
  const navigated = useRef(false);
  // FIX: track every nested setTimeout so they can be cancelled if the
  // component unmounts before they fire. Previously the chain
  //   setTimeout → setStatus → setTimeout → endCall
  // would fire endCall(false) on a dead component, throwing a state-update
  // warning and (worse) cancelling the call AFTER the user had already
  // navigated to the call screen via the CALL_ACCEPT path.
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // ─── Random auto-dialer state ───────────────────────────────────────────
  // Guards a scan in progress so overlapping triggers (socket + poll + timer)
  // can't fire two matchFind calls at once.
  const scanningRef = useRef(false);
  // Ring-cycle timers (connecting→ringing→no-answer), reset on every host.
  const ringTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Latest closures reached without re-triggering effects / circular deps.
  const scanNextRef = useRef<() => void>(() => {});
  const armRingCycleRef = useRef<() => void>(() => {});
  // Live copies of the current session/host so scanNext (a stable callback)
  // always ends the RIGHT pending session before dialing the next host.
  const sessionIdRef = useRef<string | undefined>(undefined);
  const hostIdRef = useRef<string>(host.id);
  useEffect(() => { sessionIdRef.current = activeCall?.sessionId; }, [activeCall?.sessionId]);
  useEffect(() => { hostIdRef.current = host.id; }, [host.id]);

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
    // Random dialer: relay a decline for the current host so the cooldown
    // guard counts it (best-effort, non-blocking).
    if (isRandom) { const hid = hostIdRef.current; if (hid) API.matchDecline(hid).catch(() => {}); }
    await stopRing();
    // Fix M1: end call on backend when user cancels
    endCall(false);
  }, [stopRing, endCall, isRandom]);

  // (Random auto-dialer) Start / restart the "connecting → ringing → 45s
  // no-answer" cycle for the currently-dialed host. Called on mount and after
  // every auto-scan. Direct calls run the same cycle but the no-answer branch
  // ends the call instead of scanning.
  const armRingCycle = useCallback(() => {
    ringTimersRef.current.forEach((id) => clearTimeout(id));
    ringTimersRef.current.clear();
    setStatus("connecting");
    const r1 = setTimeout(() => { if (!navigated.current) setStatus("ringing"); }, 1500);
    ringTimersRef.current.add(r1);
    const r2 = setTimeout(() => {
      ringTimersRef.current.delete(r2);
      if (navigated.current) return;
      if (isRandom) {
        scanNextRef.current(); // auto-advance to the next host on no-answer
      } else {
        (async () => {
          setStatus("no_answer");
          await stopRing();
          scheduleTimeout(() => endCall(false), 1500);
        })();
      }
    }, RING_TIMEOUT_MS);
    ringTimersRef.current.add(r2);
  }, [isRandom, stopRing, endCall, scheduleTimeout]);

  // (Random auto-dialer) Ring the NEXT matched host in place: end the current
  // pending session quietly, fetch the next match, place the new call, and
  // re-arm the ring cycle. Stops the dialer with a toast if no host is
  // available or a limit is hit.
  const scanNext = useCallback(async () => {
    if (navigated.current || scanningRef.current) return;
    scanningRef.current = true;
    const prevSession = sessionIdRef.current;
    const prevHostId = hostIdRef.current;
    // End the previous pending session (stops the old host's ring) and mark
    // the match declined. We do NOT clear the call context — initiateCall
    // replaces it below, so the "activeCall === null" safety net never trips.
    try { if (prevSession) await API.endCall(prevSession, 0); } catch { /* best-effort */ }
    if (prevHostId) API.matchDecline(prevHostId).catch(() => {});
    if (navigated.current) { scanningRef.current = false; return; }

    setStatus("connecting");
    try {
      const res = await API.matchFind(callType as "audio" | "video", matchFilters);
      if (navigated.current) { scanningRef.current = false; return; }
      if (!res.matched || !res.host) {
        await stopRing();
        showErrorToast(res.code === "INSUFFICIENT_COINS" ? t.random.statusInsufficientCoins : t.random.statusGiveUp);
        navigated.current = true;
        try { router.back(); } catch { /* nav gone */ }
        return;
      }
      const nextRate = res.coins_per_minute ?? res.host?.coins_per_minute ?? 25;
      const nextId = String(res.host.id);
      const nextAvatar = resolveMediaUrl(res.host.avatar_url) || `https://api.dicebear.com/7.x/avataaars/png?seed=${nextId}`;
      setHost({ id: nextId, name: res.host.name, avatar: nextAvatar, specialty: res.host.specialties?.[0] ?? "" });
      // Place the new outgoing call (replaces the call-context session).
      initiateCall({ id: nextId, name: res.host.name, avatar: nextAvatar, role: "host" }, callType as "audio" | "video", nextRate);
      armRingCycleRef.current(); // reset the ring / no-answer timer for the new host
    } catch {
      if (!navigated.current) {
        await stopRing();
        showErrorToast(t.random.statusNetworkError);
        navigated.current = true;
        try { router.back(); } catch { /* nav gone */ }
      }
    } finally {
      scanningRef.current = false;
    }
  }, [callType, matchFilters, initiateCall, stopRing, t]);

  // Keep refs pointing at the latest closures (breaks the scanNext ⇄
  // armRingCycle circular dependency).
  useEffect(() => { scanNextRef.current = scanNext; armRingCycleRef.current = armRingCycle; }, [scanNext, armRingCycle]);

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

    // Kick off the ring cycle for the first host. The auto-dialer re-arms this
    // per host via armRingCycleRef; the no-answer branch delegates through
    // refs, so calling the mount-time closure once here is safe.
    armRingCycle();

    // FIX (cleanup): clear ALL pending timeouts on unmount, including the
    // nested ones queued via scheduleTimeout and the per-host ring timers.
    return () => {
      pendingTimeouts.current.forEach((id) => clearTimeout(id));
      pendingTimeouts.current.clear();
      ringTimersRef.current.forEach((id) => clearTimeout(id));
      ringTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (navigated.current) return;
      if (isRandom) {
        // Host declined — flash "declined" briefly, then dial the next host.
        setStatus("declined");
        scheduleTimeout(() => { if (!navigated.current) scanNextRef.current(); }, 900);
        return;
      }
      setStatus("declined");
      await stopRing();
      // FIX: tracked timeout — see scheduleTimeout for rationale.
      scheduleTimeout(() => {
        if (!navigated.current) {
          navigated.current = true;
          router.back();
        }
      }, 2000);
    });
    // FIX: If server forcefully ends the pending call (cron cleanup / host crash),
    // dismiss the outgoing screen instead of staying stuck on "Ringing..."
    const offEnd = onEvent(SocketEvents.CALL_END, async () => {
      if (navigated.current || scanningRef.current) return;
      if (isRandom) {
        scanNextRef.current(); // remote/pending end → advance to next host
        return;
      }
      setStatus("no_answer");
      await stopRing();
      scheduleTimeout(() => {
        if (!navigated.current) {
          navigated.current = true;
          endCall(false);
        }
      }, 1500);
    });
    return () => { offAccept(); offReject(); offEnd(); };
  }, [onEvent, goToCallScreen, stopRing, syncServerStartTime, endCall, scheduleTimeout, isRandom]);

  // FIX (stuck-screen safety net): if activeCall goes null while we're still
  // showing this screen (logout, network issue cleared the context, or user
  // double-tapped Cancel and CallContext flushed), dismiss without billing.
  // navigated.current guards against the legitimate accept-then-clear path
  // where activeCall is replaced with the active session shape.
  useEffect(() => {
    if (navigated.current) return;
    if (activeCall === null && status !== "declined" && status !== "no_answer" && !scanningRef.current) {
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
          // Host declined / cron-reaped / 410.
          if (isRandom && !scanningRef.current) { scanNextRef.current(); return; }
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
  }, [activeCall?.sessionId, goToCallScreen, stopRing, endCall, syncServerStartTime, scheduleTimeout, isRandom]);

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
            <Image source={{ uri: host.avatar }} style={s.avatar} />
          </View>
        </View>

        <Text style={s.hostName} numberOfLines={1}>{host.name}</Text>
        {!!host.specialty && <Text style={s.hostMeta} numberOfLines={1}>{host.specialty}</Text>}

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

      {/* Bottom: cancel + (random) skip-to-next */}
      <View style={[s.bottomControls, { paddingBottom: insets.bottom + 36 }]}>
        <View style={s.controlsRow}>
          <View style={s.controlItem}>
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

          {isRandom && (
            <View style={s.controlItem}>
              <TouchableOpacity
                style={s.skipBtn}
                onPress={() => scanNextRef.current()}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Skip to next host"
              >
                <Image source={require("@/assets/icons/ic_shuffle.png")} style={s.skipIcon} resizeMode="contain" />
              </TouchableOpacity>
              <Text style={s.endLabel}>{t.random.skipNext}</Text>
            </View>
          )}
        </View>
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
  controlsRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 44 },
  controlItem: { alignItems: "center", gap: 10 },
  skipBtn: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  skipIcon: { width: 26, height: 26, tintColor: "#fff" },
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
