// VoxLink Haptics Utility
// Provides haptic feedback wrappers — safe on all platforms

import { Platform } from "react-native";

let Haptics: any = null;

try {
  Haptics = require("expo-haptics");
} catch {
  // expo-haptics not available (web)
}

function isNative() {
  return Platform.OS !== "web" && Haptics !== null;
}

export function lightImpact() {
  if (!isNative()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function mediumImpact() {
  if (!isNative()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function heavyImpact() {
  if (!isNative()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

export function successNotification() {
  if (!isNative()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningNotification() {
  if (!isNative()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function errorNotification() {
  if (!isNative()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function selectionFeedback() {
  if (!isNative()) return;
  Haptics.selectionAsync().catch(() => {});
}

const haptics = {
  light: lightImpact,
  medium: mediumImpact,
  heavy: heavyImpact,
  success: successNotification,
  warning: warningNotification,
  error: errorNotification,
  select: selectionFeedback,
};

export default haptics;
