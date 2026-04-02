import { useState, useEffect, useCallback } from "react";
import { Platform, Linking } from "react-native";
import { registerForPushNotifications } from "@/services/NotificationService";
import { apiRequest } from "@/services/api";

// Lazy-load native-only modules
let useCameraPermissionsNative: (() => any) | null = null;
let ImagePicker: any = null;
let Audio: any = null;
let NotificationsNative: any = null;

if (Platform.OS !== "web") {
  try { useCameraPermissionsNative = require("expo-camera").useCameraPermissions; } catch {}
  try { ImagePicker = require("expo-image-picker"); } catch {}
  try { Audio = require("expo-av").Audio; } catch {}
  try { NotificationsNative = require("expo-notifications"); } catch {}
}

export type PermissionType = "camera" | "microphone" | "mediaLibrary" | "notifications";
export type PermissionStatus = "granted" | "denied" | "undetermined" | "blocked";

export interface PermissionInfo {
  status: PermissionStatus;
  canAskAgain: boolean;
}

export interface AllPermissions {
  camera: PermissionInfo;
  microphone: PermissionInfo;
  mediaLibrary: PermissionInfo;
  notifications: PermissionInfo;
}

const DEFAULT: PermissionInfo = { status: "undetermined", canAskAgain: true };

// ─── Web helpers using navigator APIs ───────────────────────────────────────

async function queryWebPermission(name: PermissionName): Promise<PermissionStatus> {
  try {
    const result = await (navigator as any).permissions.query({ name });
    if (result.state === "granted") return "granted";
    if (result.state === "denied") return "denied";
    return "undetermined";
  } catch {
    return "undetermined";
  }
}

async function requestWebMediaPermission(kind: "video" | "audio"): Promise<boolean> {
  try {
    const constraints = kind === "video" ? { video: true } : { audio: true };
    const stream = await (navigator as any).mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((t: any) => t.stop());
    return true;
  } catch {
    return false;
  }
}

async function requestWebNotificationPermission(): Promise<boolean> {
  try {
    if (!("Notification" in window)) return false;
    const result = await (window as any).Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePermissions() {
  const [permissions, setPermissions] = useState<AllPermissions>({
    camera: DEFAULT,
    microphone: DEFAULT,
    mediaLibrary: DEFAULT,
    notifications: DEFAULT,
  });

  // Native camera hook — only active on non-web
  const nativeCameraHook = useCameraPermissionsNative ? useCameraPermissionsNative() : [null, null];
  const cameraPermission = nativeCameraHook[0];
  const requestCameraPermissionNative = nativeCameraHook[1];

  // Sync expo-camera native hook into our state
  useEffect(() => {
    if (Platform.OS !== "web" && cameraPermission) {
      setPermissions((p) => ({
        ...p,
        camera: {
          status: cameraPermission.granted
            ? "granted"
            : cameraPermission.canAskAgain
            ? "undetermined"
            : "blocked",
          canAskAgain: cameraPermission.canAskAgain ?? true,
        },
      }));
    }
  }, [cameraPermission]);

  const checkAll = useCallback(async () => {
    if (Platform.OS === "web") {
      // Web: use navigator.permissions
      const [cam, mic, notif] = await Promise.all([
        queryWebPermission("camera" as PermissionName),
        queryWebPermission("microphone" as PermissionName),
        (typeof window !== "undefined" && "Notification" in window)
          ? Promise.resolve(
              ((window as any).Notification.permission === "granted"
                ? "granted"
                : (window as any).Notification.permission === "denied"
                ? "denied"
                : "undetermined") as PermissionStatus
            )
          : Promise.resolve("undetermined" as PermissionStatus),
      ]);
      setPermissions({
        camera: { status: cam, canAskAgain: cam !== "denied" },
        microphone: { status: mic, canAskAgain: mic !== "denied" },
        mediaLibrary: { status: "granted", canAskAgain: false }, // web: always accessible
        notifications: { status: notif, canAskAgain: notif !== "denied" },
      });
      return;
    }

    // Microphone (native)
    try {
      if (Audio) {
        const mic = await Audio.getPermissionsAsync();
        setPermissions((p) => ({
          ...p,
          microphone: {
            status: mic.granted ? "granted" : mic.canAskAgain ? "undetermined" : "blocked",
            canAskAgain: mic.canAskAgain ?? true,
          },
        }));
      }
    } catch {}

    // Media Library (native)
    try {
      if (ImagePicker) {
        const media = await ImagePicker.getMediaLibraryPermissionsAsync();
        setPermissions((p) => ({
          ...p,
          mediaLibrary: {
            status: media.granted ? "granted" : media.canAskAgain ? "undetermined" : "blocked",
            canAskAgain: media.canAskAgain ?? true,
          },
        }));
      }
    } catch {}

    // Notifications (native)
    try {
      if (NotificationsNative) {
        const notif = await NotificationsNative.getPermissionsAsync();
        setPermissions((p) => ({
          ...p,
          notifications: {
            status: notif.granted ? "granted" : notif.canAskAgain ? "undetermined" : "blocked",
            canAskAgain: notif.canAskAgain ?? true,
          },
        }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    checkAll();
  }, [checkAll]);

  const requestCamera = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") {
      const granted = await requestWebMediaPermission("video");
      setPermissions((p) => ({
        ...p,
        camera: { status: granted ? "granted" : "denied", canAskAgain: false },
      }));
      return granted;
    }
    try {
      const result = await requestCameraPermissionNative?.();
      return result?.granted ?? false;
    } catch {
      return false;
    }
  }, [requestCameraPermissionNative]);

  const requestMicrophone = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") {
      const granted = await requestWebMediaPermission("audio");
      setPermissions((p) => ({
        ...p,
        microphone: { status: granted ? "granted" : "denied", canAskAgain: false },
      }));
      return granted;
    }
    try {
      if (!Audio) return false;
      const result = await Audio.requestPermissionsAsync();
      setPermissions((p) => ({
        ...p,
        microphone: {
          status: result.granted ? "granted" : result.canAskAgain ? "denied" : "blocked",
          canAskAgain: result.canAskAgain ?? false,
        },
      }));
      return result.granted;
    } catch {
      return false;
    }
  }, []);

  const requestMediaLibrary = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return true; // web: file access via <input type="file">
    try {
      if (!ImagePicker) return false;
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setPermissions((p) => ({
        ...p,
        mediaLibrary: {
          status: result.granted ? "granted" : result.canAskAgain ? "denied" : "blocked",
          canAskAgain: result.canAskAgain ?? false,
        },
      }));
      return result.granted;
    } catch {
      return false;
    }
  }, []);

  const requestNotifications = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") {
      const granted = await requestWebNotificationPermission();
      setPermissions((p) => ({
        ...p,
        notifications: { status: granted ? "granted" : "denied", canAskAgain: false },
      }));
      return granted;
    }
    try {
      if (!NotificationsNative) return false;
      const result = await NotificationsNative.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      const granted = result.granted;
      setPermissions((p) => ({
        ...p,
        notifications: {
          status: granted ? "granted" : result.canAskAgain ? "denied" : "blocked",
          canAskAgain: result.canAskAgain ?? false,
        },
      }));
      if (granted) {
        const token = await registerForPushNotifications();
        if (token) {
          try { await apiRequest("PATCH", "/api/user/me", { fcm_token: token }); } catch {}
        }
      }
      return granted;
    } catch {
      return false;
    }
  }, []);

  const openSettings = useCallback(() => {
    if (Platform.OS === "web") {
      // Browser has no programmatic settings opener
      return;
    }
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  }, []);

  const isGranted = useCallback(
    (type: PermissionType) => permissions[type].status === "granted",
    [permissions]
  );

  const isBlocked = useCallback(
    (type: PermissionType) =>
      permissions[type].status === "blocked" || permissions[type].status === "denied",
    [permissions]
  );

  return {
    permissions,
    isGranted,
    isBlocked,
    requestCamera,
    requestMicrophone,
    requestMediaLibrary,
    requestNotifications,
    openSettings,
    refresh: checkAll,
  };
}
