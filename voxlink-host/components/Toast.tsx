// VoxLink Host Toast Component — centered animated POPUP notifications.
// Previously these rendered as thin banners sliding down from the top; they
// now surface as a proper centered popup card over a dimmed backdrop, with a
// spring/scale/fade entrance, a gradient icon badge, an auto-dismiss progress
// bar, and haptic feedback. The public API (showSuccessToast, showErrorToast,
// showWarningToast, showInfoToast, showToast, ToastContainer) is unchanged so
// every existing call-site keeps working.

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  Easing,
  Modal,
  useColorScheme,
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
  const isDark = useColorScheme() === "dark";
  const anim = useRef(new Animated.Value(0)).current;        // entrance (0→1)
  const progress = useRef(new Animated.Value(1)).current;    // countdown bar (1→0)
  const iconPulse = useRef(new Animated.Value(0)).current;   // icon pop
  const dismissedRef = useRef(false);

  const style = TYPE_STYLE[toast.type];
  const duration = toast.duration ?? 4000;

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.timing(anim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: useNativeDriverValue,
    }).start(() => onDismiss(toast.id));
  }, [anim, onDismiss, toast.id]);

  useEffect(() => {
    if (toast.type === "success") successNotification();
    else if (toast.type === "error") errorNotification();
    else if (toast.type === "warning") warningNotification();

    // Pop the card in from center + bounce the icon a touch after.
    Animated.parallel([
      Animated.spring(anim, { toValue: 1, useNativeDriver: useNativeDriverValue, tension: 120, friction: 12 }),
      Animated.sequence([
        Animated.delay(120),
        Animated.spring(iconPulse, { toValue: 1, useNativeDriver: useNativeDriverValue, tension: 140, friction: 6 }),
      ]),
    ]).start();

    Animated.timing(progress, {
      toValue: 0,
      duration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const timer = setTimeout(() => dismiss(), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = toast.title ?? style.defaultTitle;
  const surface = isDark ? (colors.surface ?? "#1C1C2E") : "#FFFFFF";

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: surface,
          shadowColor: style.glow,
          opacity: anim,
          transform: [
            { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
          ],
        },
      ]}
    >
      <Animated.View
        style={{
          transform: [{ scale: iconPulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }}
      >
        <LinearGradient colors={style.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconBadge}>
          <Feather name={style.icon} size={30} color="#FFFFFF" />
        </LinearGradient>
      </Animated.View>

      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{title}</Text>
      <Text style={[styles.message, { color: colors.mutedForeground ?? colors.subText }]} numberOfLines={5}>
        {toast.message}
      </Text>

      <TouchableOpacity onPress={dismiss} activeOpacity={0.85} style={[styles.dismissBtn, { backgroundColor: style.accent }]}>
        <Text style={styles.dismissText}>Got it</Text>
      </TouchableOpacity>

      <Animated.View
        style={[
          styles.progressBar,
          { backgroundColor: style.accent, width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) },
        ]}
      />
    </Animated.View>
  );
}

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

function Backdrop() {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: useNativeDriverValue,
    }).start();
  }, [fade]);
  return <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: fade }]} />;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const show = useCallback((params: Omit<ToastMessage, "id">) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [{ id, ...params }, ...prev].slice(0, 3));
  }, []);

  useEffect(() => {
    _showToast = show;
    return () => { _showToast = null; };
  }, [show]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  // Render inside a transparent RN Modal so the popup is ALWAYS top-most —
  // above tab bars, screen content, and even full-screen call modals. A plain
  // absolute View could get painted behind other stacking contexts (this is
  // why toasts weren't visible on some screens like the wallet tab).
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
      <View style={styles.overlay} pointerEvents="box-none">
        <Backdrop />
        <View style={styles.stack} pointerEvents="box-none">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    zIndex: 9999,
    ...(Platform.OS === "web" ? { position: "fixed" as any } : null),
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  stack: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    gap: 14,
  },
  card: {
    width: "100%",
    borderRadius: 24,
    paddingTop: 26,
    paddingBottom: 24,
    paddingHorizontal: 22,
    alignItems: "center",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 14,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  title: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center", marginBottom: 8 },
  message: { fontSize: 13.5, fontFamily: "Poppins_400Regular", lineHeight: 20, textAlign: "center" },
  dismissBtn: {
    marginTop: 20,
    paddingHorizontal: 34,
    paddingVertical: 11,
    borderRadius: 14,
  },
  dismissText: { color: "#FFFFFF", fontSize: 14, fontFamily: "Poppins_600SemiBold" },
  progressBar: { position: "absolute", bottom: 0, left: 0, height: 3, opacity: 0.65, borderTopRightRadius: 3 },
});
