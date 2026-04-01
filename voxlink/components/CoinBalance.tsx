import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  balance: number;
  onPress?: () => void;
  size?: "sm" | "md" | "lg";
}

export function CoinBalance({ balance, onPress, size = "md" }: Props) {
  const colors = useColors();
  const sizes = { sm: { icon: 12, text: 14, pad: 6 }, md: { icon: 14, text: 16, pad: 8 }, lg: { icon: 18, text: 20, pad: 10 } };
  const s = sizes[size];

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} style={[styles.container, { backgroundColor: colors.coinGold + "20", paddingHorizontal: s.pad, paddingVertical: s.pad / 2 }]} activeOpacity={0.7}>
      <Text style={{ fontSize: s.icon }}>🪙</Text>
      <Text style={[styles.text, { color: colors.coinGold, fontSize: s.text }]}>{balance.toLocaleString()}</Text>
      {onPress && <Feather name="plus" size={s.icon} color={colors.coinGold} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20 },
  text: { fontFamily: "Poppins_700Bold" },
});
