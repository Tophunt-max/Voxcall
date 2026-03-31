import React, { useState, forwardRef } from "react";
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  ViewStyle,
  Platform,
} from "react-native";

const ACCENT = "#A00EE7";

export type AppInputVariant = "light" | "dark" | "custom";

interface AppInputProps extends TextInputProps {
  icon?: React.ReactNode;
  right?: React.ReactNode;
  wrapStyle?: ViewStyle;
  variant?: AppInputVariant;
  // Only used when variant="custom"
  inactiveBorder?: string;
  activeBorder?: string;
  bgColor?: string;
  textColor?: string;
}

const VARIANTS = {
  light: {
    inactive: "#E8EAF0",
    active: ACCENT,
    bg: "#F8F9FC",
    text: "#111329",
    placeholder: "#84889F",
  },
  dark: {
    inactive: "rgba(255,255,255,0.18)",
    active: ACCENT,
    bg: "rgba(255,255,255,0.08)",
    text: "#fff",
    placeholder: "rgba(255,255,255,0.5)",
  },
};

const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  {
    icon,
    right,
    wrapStyle,
    variant = "light",
    inactiveBorder,
    activeBorder,
    bgColor,
    textColor,
    style,
    onFocus,
    onBlur,
    placeholderTextColor,
    ...rest
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  const v = variant !== "custom" ? VARIANTS[variant] : null;
  const inactiveColor = inactiveBorder ?? v?.inactive ?? "#E8EAF0";
  const activeColor = activeBorder ?? v?.active ?? ACCENT;
  const bg = bgColor ?? v?.bg ?? "#F8F9FC";
  const txtColor = textColor ?? v?.text ?? "#111329";
  const phColor = placeholderTextColor ?? v?.placeholder ?? "#84889F";

  const isMultiline = !!rest.multiline;

  return (
    <View
      style={[
        styles.wrap,
        {
          borderColor: focused ? activeColor : inactiveColor,
          backgroundColor: bg,
          alignItems: isMultiline ? "flex-start" : "center",
          ...(focused && styles.focused),
        },
        wrapStyle,
      ]}
    >
      {icon && (
        <View style={[styles.iconWrap, isMultiline && { paddingTop: 2 }]}>
          {icon}
        </View>
      )}
      <TextInput
        ref={ref}
        style={[styles.input, { color: txtColor }, style]}
        placeholderTextColor={phColor}
        selectionColor={ACCENT}
        underlineColorAndroid="transparent"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {right && <View style={styles.rightWrap}>{right}</View>}
    </View>
  );
});

export default AppInput;

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 14 : 10,
    gap: 12,
  },
  focused: {
    // subtle shadow on focus to reinforce the purple outline
    ...Platform.select({
      ios: { shadowColor: ACCENT, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
      android: { elevation: 2 },
    }),
  },
  iconWrap: { justifyContent: "center" },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Poppins_400Regular",
    padding: 0,
    margin: 0,
    backgroundColor: "transparent",
  },
  rightWrap: { justifyContent: "center" },
});
