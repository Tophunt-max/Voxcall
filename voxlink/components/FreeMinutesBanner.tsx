import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform, StyleProp, ViewStyle } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { FreeMinutesCardIcon, RandomCardIcon } from "@/components/MinuteCardIcons";

// ─────────────────────────────────────────────────────────────────────────────
// FreeMinutesBanner — clear, animated (bounce + glow) banner telling the user
// they hold free-minute cards that a call will use before real coins.
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the tiny CardMinuteBadge in prominent call-entry spots (random
// screen, host "Select Call Type" sheet, home host card) so it's obvious the
// next audio call is on the house. Reads the balance from the auth user object
// (kept fresh via /api/coins/balance); renders nothing when the balance is 0.
//   type="free"   → Free Minutes card (host-call minutes, purple)
//   type="random" → Random Call card (random-call minutes, orange)
//   variant="full" → big icon + two lines + FREE tag (sheets / screens)
//   variant="slim" → single compact strip (host list cards)

interface Props {
  type: "free" | "random";
  variant?: "full" | "slim";
  /** Override the auth balance (e.g. a screen-local query value). */
  minutesOverride?: number;
  style?: StyleProp<ViewStyle>;
}

export function FreeMinutesBanner({ type, variant = "full", minutesOverride, style }: Props) {
  const { user } = useAuth();
  const isRandom = type === "random";
  const minutes =
    minutesOverride ??
    (isRandom ? (user?.free_random_minutes ?? 0) : (user?.free_call_minutes ?? 0));

  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (minutes <= 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.16, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [minutes, scale, glow]);

  if (minutes <= 0) return null;

  const accent = isRandom ? "#EA580C" : "#7C3AED";
  const accentDark = isRandom ? "#9A3412" : "#5B21B6";
  const bg = isRandom ? "rgba(249,115,22,0.10)" : "rgba(124,58,237,0.10)";
  const border = isRandom ? "rgba(249,115,22,0.35)" : "rgba(124,58,237,0.32)";
  const iconBg = isRandom ? "rgba(249,115,22,0.14)" : "rgba(124,58,237,0.14)";
  const tagBg = isRandom ? "#F97316" : "#7C3AED";
  const glowColor = isRandom ? "#F97316" : "#7C3AED";
  const Icon = isRandom ? RandomCardIcon : FreeMinutesCardIcon;

  const title = isRandom
    ? `${minutes} free random-call minute${minutes === 1 ? "" : "s"}`
    : `${minutes} free-minute card${minutes === 1 ? "" : "s"}`;
  const sub = isRandom
    ? "1 minute FREE with each new host — audio only, no coins"
    : "Free audio minutes used first — 1 min per call, no coins";

  // Native-only soft glow around the icon puck (shadow* has no web analogue in
  // Animated form; the pulsing scale carries the animation on web).
  const iconGlow =
    Platform.OS === "web"
      ? {}
      : {
          shadowColor: glowColor,
          shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] }),
          shadowRadius: glow.interpolate({ inputRange: [0, 1], outputRange: [2, 10] }),
          shadowOffset: { width: 0, height: 0 },
        };

  if (variant === "slim") {
    return (
      <View style={[styles.slim, { backgroundColor: bg, borderColor: border }, style]}>
        <Animated.View style={[styles.slimIcon, { backgroundColor: iconBg, transform: [{ scale }] }, iconGlow as any]}>
          <Icon size={20} />
        </Animated.View>
        <Text style={[styles.slimTxt, { color: accentDark }]} numberOfLines={1}>
          <Text style={{ color: accent, fontFamily: "Poppins_700Bold" }}>{minutes} free min</Text>
          {"  ·  audio call  ·  no coins"}
        </Text>
        <View style={[styles.tag, { backgroundColor: tagBg }]}>
          <Text style={styles.tagTxt}>FREE</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.full, { backgroundColor: bg, borderColor: border }, style]}>
      <Animated.View style={[styles.fullIcon, { backgroundColor: iconBg, transform: [{ scale }] }, iconGlow as any]}>
        <Icon size={30} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.fullTitle, { color: accent }]}>{title}</Text>
        <Text style={[styles.fullSub, { color: accentDark }]}>{sub}</Text>
      </View>
      <View style={[styles.tag, { backgroundColor: tagBg }]}>
        <Text style={styles.tagTxt}>FREE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // full
  full: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  fullIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  fullTitle: { fontSize: 14, fontFamily: "Poppins_700Bold" },
  fullSub: { fontSize: 11.5, fontFamily: "Poppins_500Medium", marginTop: 1 },
  // slim
  slim: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 11, borderWidth: 1 },
  slimIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  slimTxt: { flex: 1, fontSize: 11.5, fontFamily: "Poppins_500Medium" },
  // shared tag
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  tagTxt: { color: "#fff", fontSize: 11, fontFamily: "Poppins_700Bold", letterSpacing: 0.5 },
});
