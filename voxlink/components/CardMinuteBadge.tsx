import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Platform, StyleProp, ViewStyle } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { FreeMinutesCardIcon, RandomCardIcon } from "@/components/MinuteCardIcons";

// ─────────────────────────────────────────────────────────────────────────────
// CardMinuteBadge — animated (bounce + glow) badge showing how many free-minute
// cards the user holds. Reads the balance from the auth user object, so it
// needs no props beyond the card type. Renders nothing when the balance is 0.
//   type="free"   → Free Minutes card (host-call minutes)
//   type="random" → Random Call card (random-call minutes)

interface Props {
  type: "free" | "random";
  size?: number;
  /** Compact = icon + "Nm"; full = icon + "N free min". */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function CardMinuteBadge({ type, size = 18, compact = false, style }: Props) {
  const { user } = useAuth();
  const minutes = type === "random" ? (user?.free_random_minutes ?? 0) : (user?.free_call_minutes ?? 0);

  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (minutes <= 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.22, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 620, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [minutes, scale, glow]);

  if (minutes <= 0) return null;

  const isRandom = type === "random";
  const accent = isRandom ? "#EA580C" : "#7C3AED";
  const bg = isRandom ? "rgba(249,115,22,0.12)" : "rgba(124,58,237,0.12)";
  const glowColor = isRandom ? "#F97316" : "#7C3AED";
  const Icon = isRandom ? RandomCardIcon : FreeMinutesCardIcon;

  const animatedGlow = {
    shadowColor: glowColor,
    shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.6] }),
    shadowRadius: glow.interpolate({ inputRange: [0, 1], outputRange: [2, 8] }),
    shadowOffset: { width: 0, height: 0 },
  };

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: bg },
        Platform.OS === "web" ? {} : animatedGlow,
        style,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon size={size} />
      </Animated.View>
      <Text style={[styles.txt, { color: accent }]}>
        {minutes}{compact ? "m" : ` free min`}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: 11, alignSelf: "flex-start" },
  txt: { fontSize: 11.5, fontFamily: "Poppins_700Bold" },
});
