// VoxLink Permissions Utility
// Camera, microphone, notification permissions with user-friendly flow

import { Platform, Alert, Linking } from "react-native";

let Camera: any = null;
let Audio: any = null;
let Notifications: any = null;

try { Camera = require("expo-camera"); } catch {}
try { Audio = require("expo-av"); } catch {}
try { Notifications = require("expo-notifications"); } catch {}

export type PermissionStatus = "granted" | "denied" | "undetermined" | "unavailable";

export async function requestCameraPermission(): Promise<PermissionStatus> {
  if (Platform.OS === "web") return "granted";
  if (!Camera) return "unavailable";
  try {
    const { status } = await Camera.Camera.requestCameraPermissionsAsync();
    return status as PermissionStatus;
  } catch {
    return "unavailable";
  }
}

export async function requestMicrophonePermission(): Promise<PermissionStatus> {
  if (Platform.OS === "web") return "granted";
  if (!Audio) return "unavailable";
  try {
    const { status } = await Audio.Audio.requestPermissionsAsync();
    return status as PermissionStatus;
  } catch {
    return "unavailable";
  }
}

export async function requestCallPermissions(): Promise<{
  camera: PermissionStatus;
  microphone: PermissionStatus;
}> {
  const [camera, microphone] = await Promise.all([
    requestCameraPermission(),
    requestMicrophonePermission(),
  ]);
  return { camera, microphone };
}

export async function requestNotificationPermission(): Promise<PermissionStatus> {
  if (!Notifications) return "unavailable";
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return "granted";
    const { status } = await Notifications.requestPermissionsAsync();
    return status as PermissionStatus;
  } catch {
    return "unavailable";
  }
}

export function showPermissionDeniedAlert(type: "camera" | "microphone" | "notifications") {
  const names: Record<string, string> = {
    camera: "Camera",
    microphone: "Microphone",
    notifications: "Notifications",
  };
  Alert.alert(
    `${names[type]} Access Required`,
    `VoxLink needs ${names[type]} access to function correctly. Please enable it in Settings.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ]
  );
}

export async function ensureCallPermissions(): Promise<boolean> {
  const { camera, microphone } = await requestCallPermissions();
  if (microphone !== "granted") {
    showPermissionDeniedAlert("microphone");
    return false;
  }
  return true;
}

export async function ensureVideoCallPermissions(): Promise<boolean> {
  const { camera, microphone } = await requestCallPermissions();
  if (camera !== "granted" || microphone !== "granted") {
    if (camera !== "granted") showPermissionDeniedAlert("camera");
    else showPermissionDeniedAlert("microphone");
    return false;
  }
  return true;
}
