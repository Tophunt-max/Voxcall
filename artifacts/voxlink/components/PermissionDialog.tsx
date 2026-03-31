import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type PermissionDialogConfig = {
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  allowText?: string;
  settingsText?: string;
  isBlocked?: boolean;
};

interface PermissionDialogProps {
  visible: boolean;
  config: PermissionDialogConfig;
  onAllow: () => void;
  onDeny: () => void;
}

export const PERMISSION_CONFIGS: Record<string, PermissionDialogConfig> = {
  camera: {
    icon: "camera",
    iconColor: "#A00EE7",
    iconBg: "#F3E6FF",
    title: "Camera Access",
    description:
      "VoxLink needs your camera for video calls so the other person can see you. Your video is only active during calls.",
    allowText: "Allow Camera",
    settingsText: "Open Settings",
  },
  microphone: {
    icon: "mic",
    iconColor: "#0BAF23",
    iconBg: "#E6F9EA",
    title: "Microphone Access",
    description:
      "VoxLink needs your microphone for audio & video calls. Your audio is only transmitted during active calls.",
    allowText: "Allow Microphone",
    settingsText: "Open Settings",
  },
  mediaLibrary: {
    icon: "image",
    iconColor: "#F39C12",
    iconBg: "#FEF3E0",
    title: "Photo Library Access",
    description:
      "VoxLink needs access to your photos to upload profile pictures and KYC documents.",
    allowText: "Allow Photos",
    settingsText: "Open Settings",
  },
  notifications: {
    icon: "bell",
    iconColor: "#E74C3C",
    iconBg: "#FDEDED",
    title: "Enable Notifications",
    description:
      "Stay updated with incoming call alerts, new messages, and coin rewards. You can change this anytime in Settings.",
    allowText: "Enable Notifications",
    settingsText: "Open Settings",
  },
};

export function PermissionDialog({
  visible,
  config,
  onAllow,
  onDeny,
}: PermissionDialogProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          {/* Icon */}
          <View
            style={[styles.iconCircle, { backgroundColor: config.iconBg }]}
          >
            <Feather
              name={config.icon as any}
              size={32}
              color={config.iconColor}
            />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {config.title}
          </Text>

          {/* Description */}
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            {config.description}
          </Text>

          {/* Divider */}
          <View
            style={[styles.divider, { backgroundColor: colors.border }]}
          />

          {/* Buttons */}
          <TouchableOpacity
            onPress={onAllow}
            style={[styles.allowBtn, { backgroundColor: config.iconColor }]}
            activeOpacity={0.85}
          >
            <Feather name={config.icon as any} size={18} color="#fff" />
            <Text style={styles.allowBtnText}>
              {config.isBlocked
                ? config.settingsText ?? "Open Settings"
                : config.allowText ?? "Allow"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onDeny}
            style={[styles.denyBtn, { borderColor: colors.border }]}
            activeOpacity={0.75}
          >
            <Text style={[styles.denyBtnText, { color: colors.mutedForeground }]}>
              {config.isBlocked ? "Not Now" : "Not Now"}
            </Text>
          </TouchableOpacity>

          {/* Privacy note */}
          <View style={styles.privacyRow}>
            <Feather name="shield" size={12} color={colors.mutedForeground} />
            <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
              Your privacy is important. We never share your data.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: Platform.OS === "ios" ? 44 : 28,
    alignItems: "center",
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: "Poppins_700Bold",
    textAlign: "center",
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  divider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  allowBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  allowBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Poppins_600SemiBold",
  },
  denyBtn: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  denyBtnText: {
    fontSize: 14,
    fontFamily: "Poppins_500Medium",
  },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  privacyText: {
    fontSize: 11,
    fontFamily: "Poppins_400Regular",
  },
});
