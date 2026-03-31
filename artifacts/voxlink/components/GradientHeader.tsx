import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface Props {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
  compact?: boolean;
}

export function GradientHeader({ title, subtitle, right, left, compact = false }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = insets.top;

  return (
    <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <View style={styles.row}>
        {left && <View style={styles.side}>{left}</View>}
        {title && (
          <View style={styles.center}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            {subtitle && <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>}
          </View>
        )}
        {right && <View style={[styles.side, styles.rightSide]}>{right}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center" },
  center: { flex: 1 },
  side: { minWidth: 48 },
  rightSide: { alignItems: "flex-end" },
  title: { fontSize: 24, fontFamily: "Poppins_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Poppins_400Regular", marginTop: 2 },
});
