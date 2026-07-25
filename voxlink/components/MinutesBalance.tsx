import React from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { FreeMinutesCardIcon, RandomCardIcon } from "@/components/MinuteCardIcons";

// ─────────────────────────────────────────────────────────────────────────────
// MinutesBalance — wallet-style display of the user's free-minute card balances.
// ─────────────────────────────────────────────────────────────────────────────
// Shows the two card types (Free Minutes / Random Call) with their current
// minute balances, meant to sit alongside the coin balance everywhere it's
// shown. Reads straight from the auth user object (kept fresh via
// /api/coins/balance), so it needs no props to work.

interface Props {
  /** Icon pixel size. */
  size?: number;
  /** Text color — use white on gradient headers, dark on light screens. */
  color?: string;
  /** Pill background. */
  pillBg?: string;
  style?: StyleProp<ViewStyle>;
}

export function MinutesBalance({ size = 16, color = "#4B5563", pillBg = "rgba(124,58,237,0.10)", style }: Props) {
  const { user } = useAuth();
  const callMin = user?.free_call_minutes ?? 0;
  const randMin = user?.free_random_minutes ?? 0;

  return (
    <View style={[styles.row, style]}>
      <View style={[styles.pill, { backgroundColor: pillBg }]}>
        <FreeMinutesCardIcon size={size} />
        <Text style={[styles.val, { color }]}>{callMin}m</Text>
      </View>
      <View style={[styles.pill, { backgroundColor: pillBg }]}>
        <RandomCardIcon size={size} />
        <Text style={[styles.val, { color }]}>{randMin}m</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  val: { fontSize: 12.5, fontFamily: "Poppins_700Bold" },
});
