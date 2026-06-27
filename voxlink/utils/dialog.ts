// ============================================================================
// Cross-platform dialogs — fixes Alert.alert being a NO-OP on react-native-web.
// ============================================================================
//
// `Alert.alert` from react-native is not implemented on web (react-native-web),
// so every confirmation/info dialog — logout, delete account, permission
// prompts, "chat locked", etc. — silently did nothing on voxcall.pages.dev.
// That's why "logout etc" appeared broken on the web app.
//
// These helpers route to the native Alert on iOS/Android and to the browser's
// built-in window.confirm / window.alert on web, so the same call works
// everywhere. (Browser dialogs are plain but reliable; a themed modal can
// replace them later without changing call sites.)

import { Alert, Platform } from "react-native";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm action as destructive on native (red). */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

/**
 * Two-button confirm. Native → Alert.alert with cancel/confirm; web →
 * window.confirm. `onConfirm` runs only when the user accepts.
 */
export function confirmDialog({
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmOptions): void {
  if (Platform.OS === "web") {
    const text = message ? `${title}\n\n${message}` : title;
    const accepted = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(text)
      : true; // SSR/no-window: don't block the action
    if (accepted) void onConfirm();
    else onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: "cancel", onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: () => { void onConfirm(); },
    },
  ]);
}

/**
 * Single-button info dialog. Native → Alert.alert OK; web → window.alert.
 */
export function alertDialog(title: string, message?: string, onClose?: () => void): void {
  if (Platform.OS === "web") {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(text);
    onClose?.();
    return;
  }
  Alert.alert(title, message, [{ text: "OK", onPress: onClose }]);
}
