import React from "react";
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function PrimaryButton({ title, onPress, loading, disabled, variant = "primary", size = "md", style, textStyle, icon }: Props) {
  const colors = useColors();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const bgColor = {
    primary: disabled ? colors.muted : colors.accent,
    secondary: colors.secondary,
    danger: disabled ? colors.muted : colors.destructive,
    ghost: "transparent",
  }[variant];

  const textColor = {
    primary: disabled ? colors.mutedForeground : colors.accentForeground,
    secondary: colors.secondaryForeground,
    danger: disabled ? colors.mutedForeground : colors.destructiveForeground,
    ghost: colors.accent,
  }[variant];

  const paddingV = { sm: 8, md: 14, lg: 18 }[size];
  const fontSize = { sm: 13, md: 15, lg: 17 }[size];

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      style={[styles.btn, { backgroundColor: bgColor, paddingVertical: paddingV, borderRadius: colors.radius }, style]}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, { color: textColor, fontSize }, textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" },
  text: { fontFamily: "Poppins_600SemiBold" },
});
