// Centralized host-app settings store.
//
// Until this module existed, voxlink-host/app/settings.tsx persisted toggles
// to AsyncStorage but no other code ever read them. Result: the UI showed
// "Incoming Call Alerts: ON" while the FCM/notification handlers ignored the
// preference, "Auto Go Online" never ran, etc.
//
// This module is the single source of truth. UI reads/writes via the hook;
// services (NotificationService, AppBridge) read via the standalone helpers.

import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SETTINGS_KEY = "host_settings_v1";

export interface HostSettings {
  /** When the app starts and the user is a logged-in host, automatically flip
   *  is_online=true on the backend so they start receiving calls without
   *  manually toggling the home-screen switch every session. */
  autoOnline: boolean;

  /** Master switch — when on, suppresses ALL local notifications regardless
   *  of the per-type prefs below, and signals to the UI to display a "DND
   *  Active" status badge. Incoming calls still arrive at the WebSocket
   *  level (the actual call screen takes over), only the push/local
   *  notification fan-out is muted. */
  dndMode: boolean;

  /** Per-type notification toggles (active only when dndMode = false). */
  callNotif: boolean;
  chatNotif: boolean;
  coinNotif: boolean;
}

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  autoOnline: false,
  dndMode: false,
  callNotif: true,
  chatNotif: true,
  coinNotif: true,
};

// In-memory cache so non-React consumers (e.g. the FCM handler) can read
// synchronously after the first load. Initialized to defaults; populated by
// loadHostSettings() on app start.
let _cache: HostSettings = { ...DEFAULT_HOST_SETTINGS };
let _loaded = false;
const _listeners = new Set<(s: HostSettings) => void>();

function notify() {
  for (const cb of _listeners) {
    try { cb(_cache); } catch { /* one bad listener must not abort the rest */ }
  }
}

/** Read the persisted settings into the in-memory cache. Idempotent — safe
 *  to call multiple times. Run this once at app startup before any consumer
 *  expects synchronous reads. */
export async function loadHostSettings(): Promise<HostSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _cache = { ...DEFAULT_HOST_SETTINGS, ...parsed };
    }
  } catch {
    // corrupt JSON or storage error — keep defaults
  }
  _loaded = true;
  notify();
  return _cache;
}

/** Synchronous read — returns cached values. Always returns a complete
 *  object; falls back to defaults if loadHostSettings() has not run yet. */
export function getHostSettingsSync(): HostSettings {
  return _cache;
}

/** Update one or more settings. Persists to AsyncStorage and notifies
 *  subscribers. Optimistically updates the cache before the disk write. */
export async function updateHostSettings(patch: Partial<HostSettings>): Promise<void> {
  _cache = { ..._cache, ...patch };
  notify();
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(_cache));
  } catch (e) {
    console.warn("[hostSettings] persist failed:", e);
  }
}

/** React hook — subscribe to settings changes. Components re-render whenever
 *  any setting changes. Lazy-loads on first mount if not already loaded. */
export function useHostSettings(): {
  settings: HostSettings;
  update: (patch: Partial<HostSettings>) => Promise<void>;
  loaded: boolean;
} {
  const [settings, setSettings] = useState<HostSettings>(_cache);
  const [loaded, setLoaded] = useState(_loaded);

  useEffect(() => {
    let cancelled = false;
    if (!_loaded) {
      loadHostSettings().then(() => {
        if (!cancelled) {
          setSettings(_cache);
          setLoaded(true);
        }
      });
    }
    const cb = (s: HostSettings) => setSettings(s);
    _listeners.add(cb);
    return () => {
      cancelled = true;
      _listeners.delete(cb);
    };
  }, []);

  const update = useCallback((patch: Partial<HostSettings>) => updateHostSettings(patch), []);
  return { settings, update, loaded };
}

/** Decide whether a given notification type should be shown based on current
 *  prefs. DND mode is the master switch and overrides per-type toggles.
 *  Used by NotificationService.scheduleLocalNotification(). */
export function shouldShowNotification(type: "call" | "chat" | "coin" | "system" | "review" | "payment"): boolean {
  const s = _cache;
  if (s.dndMode) return false;
  switch (type) {
    case "call": return s.callNotif;
    case "chat": return s.chatNotif;
    case "coin": return s.coinNotif;
    // system / review / payment notifications are not user-configurable —
    // these are operational alerts (KYC status, withdrawal status, etc.) that
    // the host needs to see regardless of preferences.
    default: return true;
  }
}
