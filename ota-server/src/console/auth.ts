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

export function authorizeConsole(
  request: Request,
  env: Env,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!env.CONSOLE_PASSWORD) {
    return { ok: false, status: 503, error: 'Console disabled — set the CONSOLE_PASSWORD secret to enable it.' };
  }
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, env.CONSOLE_PASSWORD)) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}
