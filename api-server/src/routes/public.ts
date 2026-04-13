// OPTIMIZATIONS: (#1) Cloudflare Cache API (distributed L2 edge cache) + (#5) stale-while-revalidate
// Two-tier caching:
//   L1 = in-memory Map (single Worker instance, ~0ms)
//   L2 = caches.default (Cloudflare CDN edge cache, shared across all instances, ~1ms)
// Cache-Control headers instruct downstream CDN/browser layers (stale-while-revalidate=600 means
// clients can show stale data for 10 minutes while a background refresh happens silently).
import { Hono } from 'hono';
import type { Env } from '../types';

interface CacheEntry<T> { data: T; expiresAt: number }
const memCache = new Map<string, CacheEntry<any>>();
const MEM_TTL_MS  = 60  * 1000;  // L1: 1 min (per-instance)
const EDGE_TTL_S  = 300;          // L2: 5 min (Cloudflare edge)
const SWR_TTL_S   = 600;          // stale-while-revalidate window: 10 min

function memGet<T>(key: string): T | null {
  const e = memCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { memCache.delete(key); return null; }
  return e.data as T;
}
function memSet<T>(key: string, data: T): void {
  memCache.set(key, { data, expiresAt: Date.now() + MEM_TTL_MS });
}

// Build a JSON response with correct Cache-Control for CDN layers
function cachedJson(data: unknown, ttl = EDGE_TTL_S, swr = SWR_TTL_S): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${swr}`,
    },
  });
}

// L2 helper: try the Cloudflare Cache API (only works in production Workers, not wrangler dev)
async function edgeGet(cacheKey: string): Promise<any | null> {
  try {
    const cache = (caches as any).default;
    const req = new Request(`https://voxlink-cache.internal/${cacheKey}`);
    const res: Response | undefined = await cache.match(req);
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function edgePut(cacheKey: string, data: unknown): Promise<void> {
  try {
    const cache = (caches as any).default;
    const req = new Request(`https://voxlink-cache.internal/${cacheKey}`);
    const res = cachedJson(data, EDGE_TTL_S, SWR_TTL_S);
    await cache.put(req, res);
  } catch {
    // silently ignore — dev environment or network issue
  }
}

const pub = new Hono<{ Bindings: Env }>();

// GET /api/files/:key* — public R2 file serving (avatars, media ONLY)
// SECURITY FIX: Block access to KYC documents (aadhar, verification, kyc paths).
// KYC docs should only be accessible via authenticated admin endpoints.
pub.get('/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  // Block path traversal and sensitive file access
  if (key.includes('..') || /\b(kyc|aadhar|aadhaar|verification|identity|document|id[-_]?proof)\b/i.test(key)) {
    return c.json({ error: 'Access denied' }, 403);
  }
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
});

// GET /api/payment-gateways — cached: active payment gateways ordered by priority
pub.get('/payment-gateways', async (c) => {
  const KEY = 'payment_gateways';
  const mem = memGet<any[]>(KEY);
  if (mem) return cachedJson(mem);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge); }
  const result = await c.env.DB.prepare(
    'SELECT id, name, type, icon_emoji, instruction, redirect_url, position FROM payment_gateways WHERE is_active = 1 ORDER BY position ASC, created_at ASC'
  ).all();
  const data = result.results;
  memSet(KEY, data);
  await edgePut(KEY, data);
  return cachedJson(data);
});

// GET /api/banners?position=home|wallet — cached: active promotional banners
pub.get('/banners', async (c) => {
  const position = c.req.query('position') ?? 'all';
  const KEY = `banners:${position}`;
  const mem = memGet<any[]>(KEY);
  if (mem) return cachedJson(mem, 120, 300);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge, 120, 300); }
  let query: string;
  if (position === 'home') {
    query = "SELECT * FROM banners WHERE active = 1 AND (position LIKE 'home_%' OR position IS NULL OR position = '') ORDER BY created_at DESC LIMIT 10";
  } else if (position === 'wallet') {
    query = "SELECT * FROM banners WHERE active = 1 AND position = 'wallet' ORDER BY created_at DESC LIMIT 10";
  } else {
    query = 'SELECT * FROM banners WHERE active = 1 ORDER BY created_at DESC LIMIT 10';
  }
  const result = await c.env.DB.prepare(query).all();
  const data = result.results;
  memSet(KEY, data);
  await edgePut(KEY, data);
  return cachedJson(data, 120, 300);
});

// GET /api/talk-topics — cached 5 min (FIX #10 + UPGRADE: Cloudflare edge cache)
pub.get('/talk-topics', async (c) => {
  const KEY = 'talk_topics';
  const mem = memGet<any[]>(KEY);
  if (mem) return cachedJson(mem);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge); }
  const result = await c.env.DB.prepare(
    'SELECT * FROM talk_topics WHERE is_active = 1 ORDER BY name ASC'
  ).all();
  const data = result.results;
  memSet(KEY, data);
  await edgePut(KEY, data);
  return cachedJson(data);
});

// GET /api/faqs — cached 5 min (FIX #10 + UPGRADE: Cloudflare edge cache)
pub.get('/faqs', async (c) => {
  const KEY = 'faqs';
  const mem = memGet<any[]>(KEY);
  if (mem) return cachedJson(mem);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge); }
  const result = await c.env.DB.prepare(
    'SELECT * FROM faqs WHERE is_active = 1 ORDER BY order_index ASC, created_at ASC'
  ).all();
  const data = result.results;
  memSet(KEY, data);
  await edgePut(KEY, data);
  return cachedJson(data);
});

// GET /api/search?q=&type=hosts|topics|all — unified search
// (#4) Batch: both host+topic queries fired in parallel via Promise.all
pub.get('/search', async (c) => {
  const { q = '', type = 'all', limit = '20' } = c.req.query();
  const lim = parseInt(limit);
  const term = `%${q}%`;

  const [hostsResult, topicsResult] = await Promise.all([
    (type === 'all' || type === 'hosts')
      ? c.env.DB.prepare(
          `SELECT h.id, h.display_name, h.rating, h.coins_per_minute, h.is_online, h.specialties,
                  u.name, u.avatar_url, u.gender
           FROM hosts h JOIN users u ON u.id = h.user_id
           WHERE h.is_active = 1 AND (u.name LIKE ? OR h.display_name LIKE ? OR h.specialties LIKE ?)
           ORDER BY h.is_online DESC, h.rating DESC LIMIT ?`
        ).bind(term, term, term, lim).all()
      : Promise.resolve({ results: [] }),

    (type === 'all' || type === 'topics')
      ? c.env.DB.prepare(
          'SELECT * FROM talk_topics WHERE is_active = 1 AND name LIKE ? ORDER BY id ASC LIMIT ?'
        ).bind(term, lim).all()
      : Promise.resolve({ results: [] }),
  ]);

  const results: { hosts?: any[]; topics?: any[] } = {};
  if (type === 'all' || type === 'hosts') {
    results.hosts = hostsResult.results.map((h: any) => ({
      ...h,
      specialties: JSON.parse(h.specialties || '[]'),
    }));
  }
  if (type === 'all' || type === 'topics') {
    results.topics = topicsResult.results;
  }

  return c.json(results);
});

// GET /api/app-config — cached 5 min (FIX #10 + UPGRADE: Cloudflare edge cache)
pub.get('/app-config', async (c) => {
  const KEY = 'app_config';
  const mem = memGet<Record<string, string>>(KEY);
  if (mem) return cachedJson(mem);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge); }
  const settings = await c.env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('min_coins_for_call','coin_to_usd_rate','host_revenue_share','min_withdrawal_coins','registration_bonus_coins')"
  ).all();
  const config: Record<string, string> = {};
  for (const row of settings.results as any[]) {
    config[(row as any).key] = (row as any).value;
  }
  memSet(KEY, config);
  await edgePut(KEY, config);
  return cachedJson(config);
});

// GET /api/payment/active-qr — returns active manual QR codes with time-based rotation (no auth)
pub.get('/payment/active-qr', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, name, upi_id, qr_image_url, instructions, rotate_interval_min, position FROM manual_qr_codes WHERE is_active = 1 ORDER BY position ASC'
  ).all();
  const codes = result.results as any[];
  if (codes.length === 0) return c.json({ qr_codes: [], current: null, rotate_interval_min: 30 });
  const intervalMin = Math.max(1, Math.min(...codes.map((q: any) => q.rotate_interval_min || 30)));
  const slot = Math.floor(Math.floor(Date.now() / 1000) / 60 / intervalMin);
  const currentIdx = slot % codes.length;
  return c.json({ qr_codes: codes, current: codes[currentIdx], rotate_interval_min: intervalMin });
});

export default pub;
