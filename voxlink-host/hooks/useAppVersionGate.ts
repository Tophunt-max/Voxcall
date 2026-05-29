import { useEffect, useRef } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import { API } from '@/services/api';

/**
 * Host-app force-update gate. Mirrors the user-app implementation in
 * voxlink/hooks/useAppVersionGate.ts. See that file for full design notes.
 *
 * The only difference vs the user app is the default `appKind` parameter,
 * which targets the per-app-kind keys in `app_settings`
 * (`app_min_version_host`, `app_latest_version_host`,
 * `app_download_url_host`). This lets ops force-update the host app
 * independently of the user app — for example when a host-only feature
 * has a critical bug.
 */
export function useAppVersionGate(appKind: 'user' | 'host' = 'host'): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    const current = Application.nativeApplicationVersion ?? null;
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
        console.warn('[version-gate] failed to fetch app version:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appKind]);
}

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

void Platform;
