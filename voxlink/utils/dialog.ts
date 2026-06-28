// ============================================================================
// Cross-platform dialogs — themed popups app-wide.
// ============================================================================
//
// confirmDialog / alertDialog are imperative helpers callable from anywhere
// (event handlers, async flows). They route to a single global <DialogHost />
// (mounted once in app/_layout.tsx) which renders a branded ConfirmModal — so
// every confirmation/alert across the app looks consistent on web AND native.
//
// If the host isn't mounted yet (very early in startup), they fall back to the
// platform default (native Alert / browser window.confirm) so nothing is lost.

import { Alert, Platform } from "react-native";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  emoji?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface DialogRequest {
  kind: "confirm" | "alert";
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  emoji?: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

// The mounted <DialogHost /> registers its setter here.
let host: ((req: DialogRequest) => void) | null = null;
export function _setDialogHost(fn: ((req: DialogRequest) => void) | null): void {
  host = fn;
}

/** Two-button confirmation. Themed popup via the host; falls back to native. */
export function confirmDialog(opts: ConfirmOptions): void {
  if (host) {
    host({ kind: "confirm", ...opts });
    return;
  }
  // Fallback (host not mounted yet)
  if (Platform.OS === "web") {
    const text = opts.message ? `${opts.title}\n\n${opts.message}` : opts.title;
    const ok = typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(text) : true;
    if (ok) void opts.onConfirm();
    else opts.onCancel?.();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancelText ?? "Cancel", style: "cancel", onPress: opts.onCancel },
    { text: opts.confirmText ?? "OK", style: opts.destructive ? "destructive" : "default", onPress: () => { void opts.onConfirm(); } },
  ]);
}

/** Single-button info alert. Themed popup via the host; falls back to native. */
export function alertDialog(title: string, message?: string, onClose?: () => void): void {
  if (host) {
    host({ kind: "alert", title, message, onConfirm: onClose });
    return;
  }
  if (Platform.OS === "web") {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(text);
    onClose?.();
    return;
  }
  Alert.alert(title, message, [{ text: "OK", onPress: onClose }]);
}
