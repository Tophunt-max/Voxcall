import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  ImageSourcePropType,
} from "react-native";
import { useColors } from "@/hooks/useColors";

export type PermissionDialogConfig = {
  icon: string;
  iconImage: ImageSourcePropType;
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
    iconImage: require("@/assets/icons/ic_video.png"),
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
    iconImage: require("@/assets/icons/ic_mic.png"),
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
    iconImage: require("@/assets/icons/ic_photo.png"),
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
    iconImage: require("@/assets/icons/ic_notify.png"),
    iconColor: "#E74C3C",
    iconBg: "#FDEDED",
    title: "Enable Notifications",
    description:
      "Stay updated with incoming call alerts, new messages, and coin rewards. You can change this anytime in Settings.",
    allowText: "Enable Notifications",
    settingsText: "Enable in Browser",
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
            <Image
              source={config.iconImage}
              style={[styles.iconImg, { tintColor: config.iconColor }]}
              resizeMode="contain"
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

          {/* Web blocked hint */}
          {config.isBlocked && Platform.OS === "web" && (
            <View style={[styles.hintBox, { backgroundColor: colors.surface }]}>
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Tap the lock icon in your browser address bar → Site settings → Notifications → Allow
              </Text>
            </View>
          )}

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
            <Image
              source={config.iconImage}
              style={[styles.btnIcon, { tintColor: "#fff" }]}
              resizeMode="contain"
            />
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
              Not Now
            </Text>
          </TouchableOpacity>

          {/* Privacy note */}
          <View style={styles.privacyRow}>
            <Text style={[styles.shieldChar, { color: colors.mutedForeground }]}>🔒</Text>
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
  iconImg: {
    width: 34,
    height: 34,
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
    marginBottom: 16,
  },
  hintBox: {
    width: "100%",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  hintText: {
    fontSize: 12,
    fontFamily: "Poppins_400Regular",
    textAlign: "center",
    lineHeight: 18,
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
  btnIcon: {
    width: 18,
    height: 18,
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
  shieldChar: {
    fontSize: 12,
  },
  privacyText: {
    fontSize: 11,
    fontFamily: "Poppins_400Regular",
  },
});
