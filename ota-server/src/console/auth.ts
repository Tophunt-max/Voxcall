// ============================================================================
// Console authentication — a single bearer token (the CONSOLE_PASSWORD secret).
// When the secret is unset the console is disabled entirely (503) so the worker
// never exposes an open control surface.
// ============================================================================

import { type Env } from '../shared';

// Constant-time string compare — avoids leaking the token length/prefix via
// response-time differences.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/**
 * Full console access — the human login (CONSOLE_PASSWORD). Required for every
 * management action (promote / rollback / force / rollout / delete / read).
 */
export function authorizeConsole(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!env.CONSOLE_PASSWORD) {
    return { ok: false, status: 503, error: 'Console disabled — set the CONSOLE_PASSWORD secret to enable it.' };
  }
  const token = bearer(request);
  if (!token || !timingSafeEqual(token, env.CONSOLE_PASSWORD)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

/**
 * Write access to the BUILD endpoints only. Accepts either the full console
 * token OR the scoped PUBLISH_TOKEN (for CI / scripts). A leaked publish token
 * can add builds but never touch the OTA rollout controls.
 */
export function authorizePublish(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  const token = bearer(request);
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };
  if (env.CONSOLE_PASSWORD && timingSafeEqual(token, env.CONSOLE_PASSWORD)) return { ok: true };
  if (env.PUBLISH_TOKEN && timingSafeEqual(token, env.PUBLISH_TOKEN)) return { ok: true };
  if (!env.CONSOLE_PASSWORD && !env.PUBLISH_TOKEN) {
    return { ok: false, status: 503, error: 'Console disabled — set CONSOLE_PASSWORD or PUBLISH_TOKEN.' };
  }
  return { ok: false, status: 401, error: 'Unauthorized' };
}
