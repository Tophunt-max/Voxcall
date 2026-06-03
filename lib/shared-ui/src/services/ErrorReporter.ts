// VoxLink Error Reporter — lightweight production crash/error logging
// Captures JS errors and sends them to the backend for monitoring
// No external service required — all data stored in your own D1 database

import { Platform } from 'react-native';
import Constants from 'expo-constants';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://voxlink-api.ssunilkumarmohanta3.workers.dev';
const IS_PROD = !__DEV__;

export interface ErrorReport {
  message: string;
  stack?: string;
  context?: string;
  extra?: Record<string, unknown>;
}

let _token: string | null = null;

export function setErrorReporterToken(token: string | null) {
  _token = token;
}

export async function reportError(error: Error | string, context?: string, extra?: Record<string, unknown>): Promise<void> {
  const message = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'string' ? undefined : error.stack;

  if (__DEV__) {
    console.warn('[ErrorReporter]', context || 'Error', message, stack);
    return;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;

    await fetch(`${BASE_URL}/api/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        stack,
        context,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? 'unknown',
        extra,
      } satisfies ErrorReport & { platform: string; app_version: string }),
    });
  } catch {
    // Silently fail — error reporting must never crash the app
  }
}

// Global JS error handler — catches unhandled promise rejections and native errors
export function setupGlobalErrorHandler() {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    reportError(error, isFatal ? 'FATAL' : 'unhandled').catch(() => {});
    originalHandler(error, isFatal);
  });

  // Unhandled promise rejections
  const promiseRejectionHandler = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));
    reportError(error, 'unhandledRejection').catch(() => {});
  };

  if (typeof globalThis !== 'undefined' && 'addEventListener' in globalThis) {
    (globalThis as any).addEventListener?.('unhandledrejection', promiseRejectionHandler);
  }
}
