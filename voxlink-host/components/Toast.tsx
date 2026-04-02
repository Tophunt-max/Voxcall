// VoxLink Toast Component
// In-app toast notifications with auto-dismiss and slide animation

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/useColors";

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

function ToastItem({ toast, onDismiss }: ToastProps) {
  const colors = useColors();
  const anim = useRef(new Animated.Value(0)).current;

  const typeColors: Record<ToastType, { bg: string; border: string }> = {
    success: { bg: "#E8FAF0", border: colors.green },
    error: { bg: "#FFE8EF", border: colors.red },
    warning: { bg: "#FFF8E8", border: colors.orange },
    info: { bg: "#E8F4FF", border: colors.blue },
  };

  const typeIcons: Record<ToastType, string> = {
    success: "Success",
    error: "Error",
    warning: "Warning",
    info: "Info",
  };

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();

    const timer = setTimeout(() => {
      dismiss();
    }, toast.duration ?? 3500);

    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    Animated.timing(anim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onDismiss(toast.id));
  }

  const { bg, border } = typeColors[toast.type];

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: bg,
          borderLeftColor: border,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-20, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.toastContent}>
        {toast.title && (
          <Text style={[styles.toastTitle, { color: colors.text }]}>
            {toast.title}
          </Text>
        )}
        <Text style={[styles.toastMessage, { color: colors.mutedForeground }]}>
          {toast.message}
        </Text>
      </View>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[styles.closeBtn, { color: colors.mutedForeground }]}>X</Text>
      </TouchableOpacity>
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
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  toastContent: {
    flex: 1,
    gap: 2,
  },
  toastTitle: {
    fontSize: 13,
    fontFamily: "Poppins_600SemiBold",
  },
  toastMessage: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    lineHeight: 18,
  },
  closeBtn: {
    fontSize: 11,
    fontFamily: "Poppins_600SemiBold",
  },
});
