// FIX #10: In-memory cache for rarely-changing data (app_settings, plans, FAQs, topics)
// Cloudflare Workers are stateless but a single instance can cache within its lifetime.
// TTL of 5 minutes prevents stale data while dramatically reducing D1 query load.
import { Hono } from 'hono';
import type { Env } from '../types';

interface CacheEntry<T> { data: T; expiresAt: number }
const memCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return entry.data as T;
}
function cacheSet<T>(key: string, data: T): void {
  memCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

const pub = new Hono<{ Bindings: Env }>();

// GET /api/files/:key* — public R2 file serving (avatars, KYC docs, media)
// URLs stored in DB use this path; must be unauthenticated so <img src> works in browsers
pub.get('/files/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
});

// GET /api/payment-gateways — active payment gateways ordered by priority (position ASC)
// Primary = first in list, others are automatic fallbacks
pub.get('/payment-gateways', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, name, type, icon_emoji, instruction, redirect_url, position FROM payment_gateways WHERE is_active = 1 ORDER BY position ASC, created_at ASC'
  ).all();
  return c.json(result.results);
});

// GET /api/banners?position=home|wallet — active promotional banners, optionally filtered by position
pub.get('/banners', async (c) => {
  const position = c.req.query('position');
  let query: string;
  if (position === 'home') {
    query = "SELECT * FROM banners WHERE active = 1 AND (position LIKE 'home_%' OR position IS NULL OR position = '') ORDER BY created_at DESC LIMIT 10";
  } else if (position === 'wallet') {
    query = "SELECT * FROM banners WHERE active = 1 AND position = 'wallet' ORDER BY created_at DESC LIMIT 10";
  } else {
    query = 'SELECT * FROM banners WHERE active = 1 ORDER BY created_at DESC LIMIT 10';
  }
  const result = await c.env.DB.prepare(query).all();
  return c.json(result.results);
});

// GET /api/talk-topics — public list for mobile app (FIX #10: cached 5 min)
pub.get('/talk-topics', async (c) => {
  const cached = cacheGet<any[]>('talk_topics');
  if (cached) return c.json(cached);
  const result = await c.env.DB.prepare(
    'SELECT * FROM talk_topics WHERE is_active = 1 ORDER BY name ASC'
  ).all();
  cacheSet('talk_topics', result.results);
  return c.json(result.results);
});

// GET /api/faqs — public FAQs for mobile app (FIX #10: cached 5 min)
pub.get('/faqs', async (c) => {
  const cached = cacheGet<any[]>('faqs');
  if (cached) return c.json(cached);
  const result = await c.env.DB.prepare(
    'SELECT * FROM faqs WHERE is_active = 1 ORDER BY order_index ASC, created_at ASC'
  ).all();
  cacheSet('faqs', result.results);
  return c.json(result.results);
});

// GET /api/search?q=&type=hosts|topics|all — unified search
pub.get('/search', async (c) => {
  const { q = '', type = 'all', limit = '20' } = c.req.query();
  const lim = parseInt(limit);
  const term = `%${q}%`;

  const results: { hosts?: any[]; topics?: any[] } = {};

  if (type === 'all' || type === 'hosts') {
    const hosts = await c.env.DB.prepare(
      `SELECT h.id, h.display_name, h.rating, h.coins_per_minute, h.is_online, h.specialties,
              u.name, u.avatar_url, u.gender
       FROM hosts h JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND (u.name LIKE ? OR h.display_name LIKE ? OR h.specialties LIKE ?)
       ORDER BY h.is_online DESC, h.rating DESC LIMIT ?`
    ).bind(term, term, term, lim).all();
    results.hosts = hosts.results.map((h: any) => ({
      ...h,
      specialties: JSON.parse(h.specialties || '[]'),
    }));
  }

  if (type === 'all' || type === 'topics') {
    const topics = await c.env.DB.prepare(
      'SELECT * FROM talk_topics WHERE is_active = 1 AND name LIKE ? ORDER BY id ASC LIMIT ?'
    ).bind(term, lim).all();
    results.topics = topics.results;
  }

  return c.json(results);
});

// GET /api/app-config — app configuration for mobile (FIX #10: cached 5 min)
pub.get('/app-config', async (c) => {
  const cached = cacheGet<Record<string, string>>('app_config');
  if (cached) return c.json(cached);
  const settings = await c.env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('min_coins_for_call','coin_to_usd_rate','host_revenue_share','min_withdrawal_coins','registration_bonus_coins')"
  ).all();
  const config: Record<string, string> = {};
  for (const row of settings.results as any[]) {
    config[(row as any).key] = (row as any).value;
  }
  cacheSet('app_config', config);
  return c.json(config);
});

export default pub;
