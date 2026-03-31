import { useState, useEffect, useCallback } from "react";
import { Platform, Linking } from "react-native";
import { useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import * as Notifications from "expo-notifications";

export type PermissionType =
  | "camera"
  | "microphone"
  | "mediaLibrary"
  | "notifications";

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

export function usePermissions() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [permissions, setPermissions] = useState<AllPermissions>({
    camera: DEFAULT,
    microphone: DEFAULT,
    mediaLibrary: DEFAULT,
    notifications: DEFAULT,
  });

  // Sync expo-camera hook into our state
  useEffect(() => {
    if (cameraPermission) {
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
    // Microphone
    try {
      const mic = await Audio.getPermissionsAsync();
      setPermissions((p) => ({
        ...p,
        microphone: {
          status: mic.granted ? "granted" : mic.canAskAgain ? "undetermined" : "blocked",
          canAskAgain: mic.canAskAgain ?? true,
        },
      }));
    } catch {}

    // Media Library
    try {
      const media = await ImagePicker.getMediaLibraryPermissionsAsync();
      setPermissions((p) => ({
        ...p,
        mediaLibrary: {
          status: media.granted ? "granted" : media.canAskAgain ? "undetermined" : "blocked",
          canAskAgain: media.canAskAgain ?? true,
        },
      }));
    } catch {}

    // Notifications
    try {
      const notif = await Notifications.getPermissionsAsync();
      setPermissions((p) => ({
        ...p,
        notifications: {
          status: notif.granted ? "granted" : notif.canAskAgain ? "undetermined" : "blocked",
          canAskAgain: notif.canAskAgain ?? true,
        },
      }));
    } catch {}
  }, []);

  useEffect(() => {
    checkAll();
  }, [checkAll]);

  const requestCamera = useCallback(async (): Promise<boolean> => {
    try {
      const result = await requestCameraPermission();
      return result?.granted ?? false;
    } catch {
      return false;
    }
  }, [requestCameraPermission]);

  const requestMicrophone = useCallback(async (): Promise<boolean> => {
    try {
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
    try {
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
    try {
      const result = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      const granted = result.granted;
      setPermissions((p) => ({
        ...p,
        notifications: {
          status: granted ? "granted" : result.canAskAgain ? "denied" : "blocked",
          canAskAgain: result.canAskAgain ?? false,
        },
      }));
      return granted;
    } catch {
      return false;
    }
  }, []);

  const openSettings = useCallback(() => {
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
