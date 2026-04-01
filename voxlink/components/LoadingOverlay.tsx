// VoxLink LoadingOverlay Component
// Full-screen or partial loading spinner with optional message

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useColors } from "@/hooks/useColors";

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  fullScreen?: boolean;
  transparent?: boolean;
}

export default function LoadingOverlay({
  visible,
  message,
  fullScreen = true,
  transparent = true,
}: LoadingOverlayProps) {
  const colors = useColors();

  if (!visible) return null;

  if (fullScreen) {
    return (
      <Modal
        visible={visible}
        transparent={transparent}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.45)" }]}>
          <View style={[styles.box, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.accent} />
            {message && (
              <Text style={[styles.message, { color: colors.text }]}>
                {message}
              </Text>
            )}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View style={styles.inline}>
      <ActivityIndicator size="small" color={colors.accent} />
      {message && (
        <Text style={[styles.inlineMessage, { color: colors.mutedForeground }]}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    paddingHorizontal: 40,
    paddingVertical: 28,
    borderRadius: 16,
    alignItems: "center",
    minWidth: 140,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  message: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
    textAlign: "center",
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  inlineMessage: {
    fontSize: 13,
    fontFamily: "Poppins_400Regular",
  },
});
