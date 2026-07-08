// ============================================================================
// Structured API error codes
// ============================================================================
//
// Clients should branch on a STABLE machine-readable `code` rather than parsing
// human error strings (which are localized / reworded over time). Every error
// response from a route that adopts this module has the shape:
//
//   { "error": "<human message>", "code": "<STABLE_CODE>" }
//
// The `error` string stays for backward-compat (older clients read it); new
// clients switch on `code`. This is purely additive — no existing field is
// removed — so adopting it never breaks a deployed app.
//
// Usage in a Hono handler:
//   import { apiError, ErrorCode } from '../lib/errors';
//   return apiError(c, ErrorCode.INSUFFICIENT_COINS, 402,
//     'Insufficient coins. You need at least 2 minutes worth of coins.');
//
// Keep generic 500s opaque to the client (FIX #11 — never leak e.message);
// log the detail server-side and return ErrorCode.INTERNAL.

import type { Context } from 'hono';

export enum ErrorCode {
  // ─── Generic ──────────────────────────────────────────────────────────────
  INTERNAL = 'INTERNAL',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION = 'VALIDATION',
  RATE_LIMITED = 'RATE_LIMITED',
  CONFLICT = 'CONFLICT',

  // ─── Calls ──────────────────────────────────────────────────────────────
  CALL_NOT_FOUND = 'CALL_NOT_FOUND',
  CALL_ALREADY_ENDED = 'CALL_ALREADY_ENDED',
  HOST_UNAVAILABLE = 'HOST_UNAVAILABLE',
  HOST_BUSY = 'HOST_BUSY',
  ALREADY_IN_CALL = 'ALREADY_IN_CALL',
  SELF_CALL = 'SELF_CALL',
  INSUFFICIENT_COINS = 'INSUFFICIENT_COINS',
  CALL_ACCESS_DENIED = 'CALL_ACCESS_DENIED',
  HOST_DATA_MISSING = 'HOST_DATA_MISSING',
  AGORA_NOT_CONFIGURED = 'AGORA_NOT_CONFIGURED',

  // ─── Payments / coins ─────────────────────────────────────────────────────
  PAYMENT_SIGNATURE_INVALID = 'PAYMENT_SIGNATURE_INVALID',
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PROMO_INVALID = 'PROMO_INVALID',
  PROMO_EXHAUSTED = 'PROMO_EXHAUSTED',
  WITHDRAWAL_BELOW_MIN = 'WITHDRAWAL_BELOW_MIN',
}

/**
 * Emit a structured error response. `error` is the human-readable message
 * (kept for backward-compat); `code` is the stable machine-readable code.
 */
export function apiError(
  c: Context,
  code: ErrorCode,
  status: number,
  message: string,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: message, code, ...(extra ?? {}) }, status as any);
}
