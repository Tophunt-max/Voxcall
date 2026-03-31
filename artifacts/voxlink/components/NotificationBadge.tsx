import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props { count: number }

export function NotificationBadge({ count }: Props) {
  const colors = useColors();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
      <Text style={styles.text}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  text: { color: "#fff", fontSize: 10, fontFamily: "Poppins_700Bold" },
});
