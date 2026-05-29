import { useEffect, useRef } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import { API } from '@/services/api';

/**
 * Force-update gate. Runs once on mount, fetches `/api/app/version`, and
 * shows a BLOCKING `Alert.alert` when the running build is below the
 * server-configured `minSupported` version. Anything below `latestStable`
 * (but >= `minSupported`) shows a non-blocking nudge with a Skip option.
 *
 * Design notes:
 * - Failure to reach the endpoint is silently swallowed (logged). We
 *   never want a backend hiccup to lock users out of a working app.
 * - On web (Expo for web) `Application.nativeApplicationVersion` is null;
 *   the gate is a no-op there because users always run the freshest bundle.
 * - The blocking dialog deliberately offers ONE button — tapping it opens
 *   the store URL via `Linking.openURL`. There is no Cancel because the
 *   whole point is to prevent the user from continuing on a broken build.
 *   `Alert.alert` on iOS/Android cannot be dismissed by tapping outside,
 *   which is the behaviour we want here.
 */
export function useAppVersionGate(appKind: 'user' | 'host' = 'user'): void {
  // Single-fire guard: React strict-mode double-invokes effects, but we only
  // want to issue one network request and one Alert per app launch.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const current = Application.nativeApplicationVersion ?? null;
    // No native version available (web bundle) — skip the gate entirely.
    if (!current) return;

    let cancelled = false;
    (async () => {
      try {
        const cfg = await API.getAppVersion(appKind);
        if (cancelled) return;

        if (compareSemver(current, cfg.minSupported) < 0) {
          showBlockingUpdate(cfg.blockMessage, cfg.downloadUrl);
          return;
        }
        if (compareSemver(current, cfg.latestStable) < 0) {
          showSoftUpdate(cfg.recommendMessage, cfg.downloadUrl);
        }
      } catch (e) {
        // Endpoint failure: treat as "no gate". Logged so the failure shows
        // up in dev/QA error reporters but never blocks production users.
        console.warn('[version-gate] failed to fetch app version:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appKind]);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function showBlockingUpdate(message: string, downloadUrl: string | null): void {
  Alert.alert(
    'Update Required',
    message,
    [
      {
        text: 'Update Now',
        onPress: () => {
          if (downloadUrl) {
            Linking.openURL(downloadUrl).catch((e) =>
              console.warn('[version-gate] failed to open download url:', e)
            );
          }
          // Re-show the alert after a small delay so the user can't continue
          // by dismissing the URL chooser. Belt-and-suspenders: the OS will
          // typically background the app when the store opens, but on web /
          // when the URL fails to open we want the gate to remain.
          setTimeout(() => showBlockingUpdate(message, downloadUrl), 500);
        },
      },
    ],
    { cancelable: false }
  );
}

function showSoftUpdate(message: string, downloadUrl: string | null): void {
  Alert.alert(
    'Update Available',
    message,
    [
      { text: 'Later', style: 'cancel' },
      {
        text: 'Update',
        onPress: () => {
          if (downloadUrl) {
            Linking.openURL(downloadUrl).catch((e) =>
              console.warn('[version-gate] failed to open download url:', e)
            );
          }
        },
      },
    ],
    { cancelable: true }
  );
}

/**
 * Tiny semver comparator. Splits on '.', compares numerically. Pre-release
 * tags (e.g. "1.2.3-beta") are stripped — we don't ship pre-releases via the
 * version gate anyway.
 *
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareSemver(a: string, b: string): number {
  const norm = (v: string) =>
    String(v ?? '0.0.0')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const A = norm(a);
  const B = norm(b);
  const len = Math.max(A.length, B.length);
  for (let i = 0; i < len; i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Suppress "unused import" lint when Platform isn't referenced in this file
// after a refactor — leaving it imported keeps the surface explicit.
void Platform;
