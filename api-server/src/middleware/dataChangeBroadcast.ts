// Data-change broadcast middleware for admin mutations.
//
// After any successful mutating (POST/PATCH/PUT/DELETE) admin request to a
// user-facing catalog, push a lightweight `data_changed` signal to connected
// clients so their open screens refetch immediately — no re-open required.
//
// Modelled on auditLogMiddleware (same /api/admin/* mount, same "wrap the
// route with await next()" pattern). The broadcast runs via ctx.waitUntil so
// it never delays the admin response, and only fires for entities that the
// user / host apps actually display. `settings` is deliberately excluded — the
// PATCH /settings handler already broadcasts its own app_settings_update.

import { createMiddleware } from 'hono/factory';
import type { Env, JWTPayload } from '../types';
import { broadcastDataChanged, type BroadcastAudience } from '../lib/realtime';

type Variables = { user: JWTPayload };

// Admin URL entity segment → { resource token clients invalidate on, audience }.
const RESOURCE_MAP: Record<string, { resource: string; audience: BroadcastAudience }> = {
  'coin-plans': { resource: 'coin_plans', audience: 'all' },
  'vip-plans': { resource: 'vip_plans', audience: 'all' },
  'gifts': { resource: 'gifts', audience: 'all' },
  'talk-topics': { resource: 'talk_topics', audience: 'user' },
  'banners': { resource: 'banners', audience: 'all' },
  'faqs': { resource: 'faqs', audience: 'all' },
  'promo-codes': { resource: 'promo_codes', audience: 'user' },
  'payment-gateways': { resource: 'payment_gateways', audience: 'user' },
  'manual-qr-codes': { resource: 'payment_gateways', audience: 'user' },
  'level-config': { resource: 'level_config', audience: 'all' },
  'app-config': { resource: 'app_config', audience: 'all' },
  'reward-tasks': { resource: 'rewards', audience: 'all' },
  'reward-spin': { resource: 'rewards', audience: 'all' },
  'reward-campaigns': { resource: 'rewards', audience: 'all' },
  'reward-coupons': { resource: 'rewards', audience: 'all' },
  'reward-achievements': { resource: 'rewards', audience: 'all' },
};

function entityFromPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean); // e.g. ['api','admin','coin-plans','123']
  const idx = parts.indexOf('admin');
  if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export const dataChangeBroadcastMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    await next();

    // Only broadcast when the mutation actually succeeded.
    if (c.res.status >= 400) return;

    const entity = entityFromPath(new URL(c.req.url).pathname);
    if (!entity) return;
    const mapping = RESOURCE_MAP[entity];
    if (!mapping) return;

    try {
      c.executionCtx.waitUntil(broadcastDataChanged(c.env, mapping.resource, mapping.audience));
    } catch {
      // executionCtx may be unavailable in some contexts (tests) — fall back to
      // fire-and-forget without blocking the response.
      void broadcastDataChanged(c.env, mapping.resource, mapping.audience);
    }
  },
);
