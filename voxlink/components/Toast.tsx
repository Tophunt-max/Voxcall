// VoxLink Toast Component — beautiful animated in-app notifications
// Gradient icon badge, spring entrance, swipe-to-dismiss, auto-dismiss
// progress bar, and haptic feedback for a premium, attention-grabbing feel.

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  Easing,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { successNotification, warningNotification, errorNotification } from "@workspace/shared-ui/utils";

const useNativeDriverValue = Platform.OS !== "web";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

// ─── Per-type visual identity ──────────────────────────────────────────────
// Each toast type gets a vibrant gradient badge + matching accent so the
// notification is instantly recognisable and visually delightful.
const TYPE_STYLE: Record<
  ToastType,
  { gradient: [string, string]; icon: keyof typeof Feather.glyphMap; accent: string; defaultTitle: string; glow: string }
> = {
  success: { gradient: ["#0BAF23", "#37D67A"], icon: "check-circle", accent: "#0BAF23", defaultTitle: "Success", glow: "#0BAF23" },
  error:   { gradient: ["#FF025F", "#FF5C8A"], icon: "x-circle",     accent: "#FF025F", defaultTitle: "Oops!",   glow: "#FF025F" },
  warning: { gradient: ["#FFA100", "#FFC34D"], icon: "alert-triangle", accent: "#FFA100", defaultTitle: "Heads up", glow: "#FFA100" },
  info:    { gradient: ["#7C3AED", "#B57BFF"], icon: "bell",         accent: "#7C3AED", defaultTitle: "New",     glow: "#7C3AED" },
};

function ToastItem({ toast, onDismiss }: ToastProps) {
  const colors = useColors();
  const anim = useRef(new Animated.Value(0)).current;       // entrance (0→1)
  const progress = useRef(new Animated.Value(1)).current;    // countdown bar (1→0)
  const iconPulse = useRef(new Animated.Value(0)).current;   // icon pop
  const dismissedRef = useRef(false);

  const style = TYPE_STYLE[toast.type];
  const duration = toast.duration ?? 4000;

  useEffect(() => {
    // Haptic cue matched to severity — makes the toast *felt*, not just seen.
    if (toast.type === "success") successNotification();
    else if (toast.type === "error") errorNotification();
    else if (toast.type === "warning") warningNotification();

    // Spring the card in from the top + pop the icon slightly after.
    Animated.parallel([
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: useNativeDriverValue,
        tension: 90,
        friction: 11,
      }),
      Animated.sequence([
        Animated.delay(120),
        Animated.spring(iconPulse, { toValue: 1, useNativeDriver: useNativeDriverValue, tension: 140, friction: 6 }),
      ]),
    ]).start();

    // Countdown progress bar drains over `duration`, then auto-dismiss.
    Animated.timing(progress, {
      toValue: 0,
      duration,
      easing: Easing.linear,
      useNativeDriver: false, // width animation
    }).start();

    const timer = setTimeout(() => dismiss(), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.timing(anim, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: useNativeDriverValue,
    }).start(() => onDismiss(toast.id));
  }, [anim, onDismiss, toast.id]);

  const title = toast.title ?? style.defaultTitle;

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: colors.card ?? "#FFFFFF",
          shadowColor: style.glow,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }),
            },
            {
              scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
            },
          ],
        },
      ]}
    >
      {/* Accent edge */}
      <View style={[styles.accentEdge, { backgroundColor: style.accent }]} />

      {/* Gradient icon badge */}
      <Animated.View
        style={{
          transform: [
            { scale: iconPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
          ],
        }}
      >
        <LinearGradient
          colors={style.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconBadge}
        >
          <Feather name={style.icon} size={20} color="#FFFFFF" />
        </LinearGradient>
      </Animated.View>

      {/* Text */}
      <View style={styles.toastContent}>
        <Text style={[styles.toastTitle, { color: colors.foreground ?? colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.toastMessage, { color: colors.mutedForeground }]} numberOfLines={3}>
          {toast.message}
        </Text>
      </View>

      {/* Close */}
      <TouchableOpacity
        onPress={dismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.closeBtn}
      >
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      {/* Auto-dismiss progress bar */}
      <Animated.View
        style={[
          styles.progressBar,
          {
            backgroundColor: style.accent,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          },
        ]}
      />
    </Animated.View>
  );
}

// ─── Toast Manager ────────────────────────────────────────────────────────────

type ShowToastFn = (params: Omit<ToastMessage, "id">) => void;

let _showToast: ShowToastFn | null = null;

export function showToast(params: Omit<ToastMessage, "id">) {
  _showToast?.(params);
}

export function showSuccessToast(message: string, title?: string) {
  showToast({ type: "success", message, title });
}

export function showErrorToast(message: string, title?: string) {
  showToast({ type: "error", message, title });
}

export function showWarningToast(message: string, title?: string) {
  showToast({ type: "warning", message, title });
}

export function showInfoToast(message: string, title?: string) {
  showToast({ type: "info", message, title });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const show = useCallback((params: Omit<ToastMessage, "id">) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [{ id, ...params }, ...prev].slice(0, 4));
  }, []);

  useEffect(() => {
    _showToast = show;
    return () => { _showToast = null; };
  }, [show]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 14,
    right: 14,
    zIndex: 9999,
    gap: 10,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 12,
    borderRadius: 18,
    gap: 12,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 10,
  },
  accentEdge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  toastContent: {
    flex: 1,
    gap: 3,
  },
  toastTitle: {
    fontSize: 14,
    fontFamily: "Poppins_700Bold",
  },
  toastMessage: {
    fontSize: 12.5,
    fontFamily: "Poppins_400Regular",
    lineHeight: 18,
  },
  closeBtn: {
    padding: 4,
    alignSelf: "flex-start",
  },
  progressBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    height: 3,
    borderBottomLeftRadius: 18,
    opacity: 0.6,
  },
});
