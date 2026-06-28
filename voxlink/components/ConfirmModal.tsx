import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button red (e.g. logout, delete). */
  destructive?: boolean;
  /** Hide the cancel button (info/alert mode — single OK button). */
  singleButton?: boolean;
  /** Optional emoji shown above the title. */
  emoji?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Simple, themed confirmation popup that works on web + native (react-native
 * Modal). Use this instead of the browser's window.confirm for a branded look.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  destructive = false,
  singleButton = false,
  emoji,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {message ? <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text> : null}
          <View style={styles.btnRow}>
            {!singleButton && (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.muted }]}
                onPress={onCancel}
                activeOpacity={0.8}
                disabled={loading}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>{cancelText}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: destructive ? "#E24C4B" : colors.primary, opacity: loading ? 0.6 : 1 }]}
              onPress={onConfirm}
              activeOpacity={0.85}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: "#fff" }]}>{loading ? "Please wait…" : confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  emoji: { fontSize: 40, marginBottom: 8 },
  title: { fontSize: 18, fontFamily: "Poppins_700Bold", textAlign: "center" },
  message: { fontSize: 14, fontFamily: "Poppins_400Regular", textAlign: "center", marginTop: 8, lineHeight: 20 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 22, width: "100%" },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 15, fontFamily: "Poppins_600SemiBold" },
});
