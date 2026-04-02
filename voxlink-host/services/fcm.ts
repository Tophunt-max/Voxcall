// VoxLink FCM Service — Cross-platform Firebase Cloud Messaging
// Native (Android/iOS): @react-native-firebase/messaging
// Web: Firebase Web SDK messaging + Service Worker

import { Platform } from 'react-native';
import { setItem, getItem, StorageKeys } from '@/utils/storage';

// ─── Native FCM (Android / iOS) ────────────────────────────────────────────

let RNFirebaseMessaging: any = null;
if (Platform.OS !== 'web') {
  try { RNFirebaseMessaging = require('@react-native-firebase/messaging').default; } catch {}
}

// ─── Web FCM ────────────────────────────────────────────────────────────────

let webMessaging: any = null;

async function initWebMessaging(): Promise<any> {
  if (Platform.OS !== 'web') return null;
  if (webMessaging) return webMessaging;
  try {
    const { getMessaging, isSupported } = await import('firebase/messaging');
    const { default: firebaseApp } = await import('./firebase');
    const supported = await isSupported();
    if (!supported) return null;
    webMessaging = getMessaging(firebaseApp);
    return webMessaging;
  } catch (e) {
    console.warn('[FCM] Web messaging init failed:', e);
    return null;
  }
}

// ─── Service Worker Registration (Web) ────────────────────────────────────

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
    return reg;
  } catch (e) {
    console.warn('[FCM] Service worker registration failed:', e);
    return null;
  }
}

// ─── Permission Request ─────────────────────────────────────────────────────

export async function requestFCMPermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    try {
      const permission = await (window as any).Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }
  if (!RNFirebaseMessaging) return false;
  try {
    const authStatus = await RNFirebaseMessaging().requestPermission();
    // AuthorizationStatus: NOT_DETERMINED=0, DENIED=1, AUTHORIZED=2, PROVISIONAL=3
    // On Android, returns AUTHORIZED(2) if granted
    return authStatus >= 2;
  } catch (e) {
    console.warn('[FCM] Native permission request failed:', e);
    return false;
  }
}

// ─── Token Registration ─────────────────────────────────────────────────────

export async function getFCMToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      await registerServiceWorker();
      const messaging = await initWebMessaging();
      if (!messaging) return null;

      const vapidKey = process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        console.warn('[FCM] EXPO_PUBLIC_FIREBASE_VAPID_KEY not set — web push disabled');
        return null;
      }

      const { getToken } = await import('firebase/messaging');
      const swReg = await navigator.serviceWorker.ready;
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
      return token || null;
    }

    if (!RNFirebaseMessaging) return null;
    const token = await RNFirebaseMessaging().getToken();
    return token || null;
  } catch (e) {
    console.warn('[FCM] getToken failed:', e);
    return null;
  }
}

// ─── Register token to backend ─────────────────────────────────────────────

export async function registerFCMTokenToBackend(
  apiBase: string,
  authToken: string
): Promise<void> {
  try {
    const token = await getFCMToken();
    if (!token) return;

    const stored = await getItem<string>(StorageKeys.PUSH_TOKEN);
    if (stored === token) return;

    const res = await fetch(`${apiBase}/api/user/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ fcm_token: token }),
    });

    if (res.ok) {
      await setItem(StorageKeys.PUSH_TOKEN, token);
      console.log('[FCM] Token registered to backend');
    }
  } catch (e) {
    console.warn('[FCM] Backend token registration failed:', e);
  }
}

// ─── Foreground Message Handler ─────────────────────────────────────────────

export function onForegroundMessage(
  callback: (payload: { title?: string; body?: string; data?: Record<string, any> }) => void
): () => void {
  if (Platform.OS === 'web') {
    initWebMessaging().then(async (messaging) => {
      if (!messaging) return;
      const { onMessage } = await import('firebase/messaging');
      onMessage(messaging, (payload: any) => {
        callback({
          title: payload.notification?.title,
          body: payload.notification?.body,
          data: payload.data,
        });
      });
    });
    return () => {};
  }

  if (!RNFirebaseMessaging) return () => {};
  const unsubscribe = RNFirebaseMessaging().onMessage(async (remoteMessage: any) => {
    callback({
      title: remoteMessage.notification?.title,
      body: remoteMessage.notification?.body,
      data: remoteMessage.data,
    });
  });
  return unsubscribe;
}

// ─── Background / Quit Message Handler (Native only) ───────────────────────

export function setupBackgroundMessageHandler(): void {
  if (Platform.OS === 'web' || !RNFirebaseMessaging) return;
  try {
    RNFirebaseMessaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
      console.log('[FCM] Background message:', remoteMessage);
    });
  } catch (e) {
    console.warn('[FCM] setBackgroundMessageHandler failed:', e);
  }
}

// ─── Token Refresh Listener ─────────────────────────────────────────────────

export function onTokenRefresh(
  apiBase: string,
  getAuthToken: () => string | null
): () => void {
  if (Platform.OS === 'web' || !RNFirebaseMessaging) return () => {};
  try {
    return RNFirebaseMessaging().onTokenRefresh(async (token: string) => {
      const authToken = getAuthToken();
      if (!authToken) return;
      await fetch(`${apiBase}/api/user/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ fcm_token: token }),
      });
      await setItem(StorageKeys.PUSH_TOKEN, token);
      console.log('[FCM] Token refreshed and updated');
    });
  } catch {
    return () => {};
  }
}
