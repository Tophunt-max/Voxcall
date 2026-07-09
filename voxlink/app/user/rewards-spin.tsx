import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Image,
  Platform,
} from "react-native";
import Svg, { Path, G, Text as SvgText, Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { API } from "@/services/api";
import { showErrorToast, showSuccessToast } from "@/components/Toast";

// ─────────────────────────────────────────────────────────────────────────────
// Lucky Spin Wheel
// ─────────────────────────────────────────────────────────────────────────────
// This is the VARIABLE-REWARD surface — the strongest single dopamine driver
// on the rewards page (spec §B). The wheel renders admin-configured segments
// with weight-proportional slices, and the server does the actual random
// selection (never trust the client for money).
//
// Flow:
//   1. Load segments + free/earned spins on mount.
//   2. User taps SPIN → POST /api/user/rewards/spin.
//   3. Server returns `segment_index` and `coins_won`.
//   4. Client animates the wheel to land on that index with a natural
//      deceleration (Easing.out(cubic)) and pops a celebration toast.
//
// The animation IS eye-candy — the coin credit is already committed before
// the wheel starts moving, so a crashed tab or force-quit doesn't lose the
// win.

const { width: SCREEN_W } = Dimensions.get("window");

// Wheel scales down when the user has no spins available. This makes room for
// the "come back tomorrow" state without pushing content off-screen, and
// visually signals to the user that the surface is temporarily inactive
// (still there — you'll be back — just smaller).
const FULL_WHEEL_SIZE = Math.min(SCREEN_W - 40, 300);
const COMPACT_WHEEL_SIZE = Math.min(SCREEN_W - 120, 200);

type Segment = { label: string; coins: number; weight: number; color: string; emoji: string };

// Seconds until the next UTC 00:00 — that's when the daily free spin resets
// (mirrors the backend's `ensureSpinState` behaviour in routes/rewards.ts).
function secondsUntilUTCMidnight(): number {
  const now = new Date();
  const nextUtcMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0,
  );
  return Math.max(0, Math.floor((nextUtcMidnightMs - Date.now()) / 1000));
}

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Compute cumulative-angle bounds for each segment so the animator can land
// the arrow exactly on the winning slice. Angles are 0..360 clockwise from
// the top (12 o'clock). We also include the segment's mid-angle for the
// text placement.
function computeSlices(segments: Segment[]) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.weight), 0) || 1;
  let acc = 0;
  return segments.map((seg) => {
    const share = (Math.max(0, seg.weight) / total) * 360;
    const start = acc;
    const end = acc + share;
    const mid = (start + end) / 2;
    acc = end;
    return { ...seg, start, end, mid, share };
  });
}

// SVG arc path helper: cuts a wedge from `start` to `end` degrees (0 = top).
function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(start));
  const y1 = cy + r * Math.sin(toRad(start));
  const x2 = cx + r * Math.cos(toRad(end));
  const y2 = cy + r * Math.sin(toRad(end));
  const largeArc = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

export default function RewardsSpinScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { updateCoins } = useAuth();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [freeSpins, setFreeSpins] = useState(0);
  const [earnedSpins, setEarnedSpins] = useState(0);
  const [totalSpins, setTotalSpins] = useState(0);
  const [totalWon, setTotalWon] = useState(0);
  const [, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState<{ label: string; coins: number; multiplier: number } | null>(null);

  const rotation = useRef(new Animated.Value(0)).current;
  const currentRotationRef = useRef(0); // total accumulated rotation in degrees

  // ── Load config + user spin state ────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await API.getRewards();
      if (!res.spin?.enabled) {
        showErrorToast("Lucky spin is disabled");
        router.back();
        return;
      }
      setSegments(res.spin.segments);
      setFreeSpins(res.spin.free_spins_remaining);
      setEarnedSpins(res.spin.earned_spins_remaining);
      setTotalSpins(res.spin.total_spins);
      setTotalWon(res.spin.total_coins_won);
    } catch (e: any) {
      showErrorToast(e?.message ?? "Could not load spin");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const slices = useMemo(() => computeSlices(segments), [segments]);
  const hasSpins = freeSpins > 0 || earnedSpins > 0;
  const canSpin = !spinning && hasSpins && segments.length > 0;

  // Wheel shrinks when the user has no spins to use — makes room for the
  // "come back tomorrow" card and visually signals inactive state.
  const wheelSize = hasSpins ? FULL_WHEEL_SIZE : COMPACT_WHEEL_SIZE;
  const radius = wheelSize / 2;
  const center = radius;

  // Live-tick every second so the "next spin in HH:MM:SS" countdown moves.
  // Only ticks in the "no spins" state — otherwise it's a no-op every render.
  const [nextSpinIn, setNextSpinIn] = useState(() => secondsUntilUTCMidnight());
  useEffect(() => {
    if (hasSpins) return;
    const t = setInterval(() => setNextSpinIn(secondsUntilUTCMidnight()), 1000);
    return () => clearInterval(t);
  }, [hasSpins]);

  // ── Spin action ──────────────────────────────────────────────────────────
  const spin = useCallback(async () => {
    if (!canSpin) return;
    setSpinning(true);
    setLastWin(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // Optimistic decrement so the UI feels snappy.
    if (freeSpins > 0) setFreeSpins((n) => n - 1);
    else setEarnedSpins((n) => n - 1);

    try {
      const res = await API.spinReward();

      // Compute where to land: we want the ARROW (fixed at top) to end up
      // pointing at `res.segment_index`'s mid-angle. Since the wheel rotates
      // clockwise, we rotate by (360 - mid) after adding N full turns.
      const targetSlice = slices[res.segment_index];
      const targetMid = targetSlice?.mid ?? 0;
      const fullTurns = 5; // 5 extra full rotations for drama
      const landing = 360 - targetMid;
      const nextRotation = currentRotationRef.current + fullTurns * 360 + landing - (currentRotationRef.current % 360);

      Animated.timing(rotation, {
        toValue: nextRotation,
        duration: 3800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        currentRotationRef.current = nextRotation;
        // Celebrate.
        setLastWin({ label: res.segment_label, coins: res.coins_won, multiplier: res.multiplier });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        updateCoins(res.new_balance);
        showSuccessToast(`+${res.coins_won} coins!`, `${res.segment_label}${res.multiplier > 1 ? ` (×${res.multiplier})` : ""}`);
        setTotalSpins((n) => n + 1);
        setTotalWon((n) => n + res.coins_won);
        setSpinning(false);
      });
    } catch (e: any) {
      // Rollback the optimistic decrement.
      await load();
      const msg = e?.message ?? "Spin failed";
      showErrorToast(msg);
      setSpinning(false);
    }
  }, [canSpin, freeSpins, slices, rotation, updateCoins, load]);

  const spinDeg = rotation.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <LinearGradient
        colors={["#F59E0B", "#EF4444"] as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBackBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerBackText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Lucky Spin</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Free spins</Text>
            <Text style={styles.summaryValue}>{freeSpins}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Earned spins</Text>
            <Text style={styles.summaryValue}>{earnedSpins}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total won</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
              <Image source={require("@/assets/icons/ic_coin.png")} style={{ width: 14, height: 14 }} resizeMode="contain" />
              <Text style={[styles.summaryValue, { marginTop: 0 }]}>{totalWon.toLocaleString()}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* Wheel — dimensions are dynamic; when the user has no spins the wheel
          shrinks to a compact size and the surrounding padding tightens. */}
      <View style={[styles.wheelWrap, !hasSpins && styles.wheelWrapCompact]}>
        {/* Arrow pointer at the top */}
        <View style={styles.pointer} pointerEvents="none">
          <View style={styles.pointerBase} />
          <View style={styles.pointerTip} />
        </View>

        <Animated.View style={[{ transform: [{ rotate: spinDeg }] }, !hasSpins && { opacity: 0.65 }]}>
          <Svg width={wheelSize} height={wheelSize} viewBox={`0 0 ${wheelSize} ${wheelSize}`}>
            <Defs>
              <RadialGradient id="wheelShadow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="rgba(0,0,0,0)" />
                <Stop offset="90%" stopColor="rgba(0,0,0,0)" />
                <Stop offset="100%" stopColor="rgba(0,0,0,0.2)" />
              </RadialGradient>
            </Defs>
            {/* Outer glow */}
            <Circle cx={center} cy={center} r={radius} fill="url(#wheelShadow)" />
            {/* Slices */}
            <G>
              {slices.map((s, i) => (
                <G key={i}>
                  <Path
                    d={arcPath(center, center, radius - 6, s.start, s.end)}
                    fill={s.color}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  {/* Label pill placed at 65% radius along the mid-angle. Font
                      scales down in compact mode so it stays readable. */}
                  {(() => {
                    const rad = ((s.mid - 90) * Math.PI) / 180;
                    const tx = center + Math.cos(rad) * (radius * 0.62);
                    const ty = center + Math.sin(rad) * (radius * 0.62);
                    return (
                      <G>
                        <SvgText
                          x={tx}
                          y={ty}
                          fill="#fff"
                          fontSize={hasSpins ? 14 : 10}
                          fontWeight="bold"
                          textAnchor="middle"
                          alignmentBaseline="middle"
                          transform={`rotate(${s.mid} ${tx} ${ty})`}
                        >
                          {s.emoji} {s.coins}
                        </SvgText>
                      </G>
                    );
                  })()}
                </G>
              ))}
            </G>
            {/* Hub — also scales with the wheel */}
            <Circle cx={center} cy={center} r={hasSpins ? 28 : 20} fill="#fff" stroke="#F59E0B" strokeWidth={hasSpins ? 4 : 3} />
            <Circle cx={center} cy={center} r={hasSpins ? 12 : 8} fill="#F59E0B" />
          </Svg>
        </Animated.View>
      </View>

      {/* No-spins-left card with a live countdown to the next free spin.
          Only visible when the user is out of spins — otherwise this space is
          taken by the (soon-to-appear) win banner. */}
      {!hasSpins && !lastWin && (
        <View style={styles.noSpinsCard}>
          <View style={styles.noSpinsCountdown}>
            <Text style={styles.noSpinsCountdownLabel}>NEXT FREE SPIN IN</Text>
            <Text style={styles.noSpinsCountdownValue}>{formatHMS(nextSpinIn)}</Text>
          </View>
          <Text style={styles.noSpinsHint}>
            Complete reward tasks to earn extra spins before the daily reset.
          </Text>
        </View>
      )}

      {/* Last-win banner */}
      {lastWin && (
        <View style={styles.winBanner}>
          <Text style={styles.winBannerEmoji}>🎉</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.winBannerTitle}>You won +{lastWin.coins} coins!</Text>
            <Text style={styles.winBannerSub}>
              {lastWin.label}
              {lastWin.multiplier > 1 ? `  ×${lastWin.multiplier} campaign bonus` : ""}
            </Text>
          </View>
        </View>
      )}

      {/* Spin button */}
      <View style={styles.actionWrap}>
        <TouchableOpacity
          onPress={spin}
          disabled={!canSpin}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Spin the wheel"
          style={styles.spinBtnWrap}
        >
          <LinearGradient
            colors={canSpin ? (["#C64BE8", "#8A2BD8"] as any) : (["#9CA3AF", "#6B7280"] as any)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.spinBtn}
          >
            <Text style={styles.spinBtnText}>
              {spinning ? "Spinning..." : freeSpins > 0 ? `SPIN (${freeSpins} free)` : earnedSpins > 0 ? `SPIN (${earnedSpins} earned)` : "No spins left today"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={[styles.hintText, { color: colors.subText }]}>
          {freeSpins === 0 && earnedSpins === 0
            ? "Your free spin resets tomorrow. Earn more spins by completing reward tasks."
            : `Total spins: ${totalSpins.toLocaleString()}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerBackBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  headerBackText: { color: "#fff", fontSize: 26, marginTop: -3 },
  headerTitle: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold" },
  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  summaryLabel: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontFamily: "Poppins_500Medium" },
  summaryValue: { color: "#fff", fontSize: 18, fontFamily: "Poppins_700Bold", marginTop: 4 },

  wheelWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 20 },
  wheelWrapCompact: { paddingVertical: 12 },  // tighter padding when the wheel is compact
  pointer: { position: "absolute", top: 6, zIndex: 10, alignItems: "center" },
  pointerBase: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#F59E0B", borderWidth: 3, borderColor: "#fff", ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 3 }, web: { boxShadow: "0 2px 6px rgba(0,0,0,0.25)" } as any }) },
  pointerTip: { width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 18, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#F59E0B", marginTop: -2 },

  winBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FDF3C4",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },

  // No-spins-left card (compact-mode companion under the shrunk wheel)
  noSpinsCard: {
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    alignItems: "center",
    gap: 8,
  },
  noSpinsCountdown: { alignItems: "center", gap: 2 },
  noSpinsCountdownLabel: {
    fontSize: 10,
    fontFamily: "Poppins_700Bold",
    color: "#B91C1C",
    letterSpacing: 1,
  },
  noSpinsCountdownValue: {
    fontSize: 32,
    fontFamily: "Poppins_700Bold",
    color: "#7F1D1D",
    letterSpacing: 2,
    // Web-safe monospace fallback so ticks don't jitter horizontally.
    fontVariant: ["tabular-nums"],
  },
  noSpinsHint: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    color: "#7F1D1D",
    textAlign: "center",
    lineHeight: 17,
  },
  winBannerEmoji: { fontSize: 30 },
  winBannerTitle: { fontSize: 15, fontFamily: "Poppins_700Bold", color: "#7A3E00" },
  winBannerSub: { fontSize: 12, fontFamily: "Poppins_500Medium", color: "#7A3E00", opacity: 0.85, marginTop: 2 },

  actionWrap: { paddingHorizontal: 24, paddingTop: 20, alignItems: "center", gap: 8 },
  spinBtnWrap: { alignSelf: "stretch", borderRadius: 32, overflow: "hidden", ...Platform.select({ ios: { shadowColor: "#8A2BD8", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 4 }, web: { boxShadow: "0 4px 12px rgba(138,43,216,0.3)" } as any }) },
  spinBtn: { height: 56, alignItems: "center", justifyContent: "center" },
  spinBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins_700Bold", letterSpacing: 1 },
  hintText: { fontSize: 12, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 4 },
});

export { ErrorBoundary } from "@/components/RouteErrorBoundary";
