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

// ─── Banner cache invalidation ────────────────────────────────────────────────
// Called by the admin banner CRUD after any create/update/delete so a banner
// that's toggled off (or edited) disappears/updates in the apps immediately
// instead of lingering for the full cache TTL. The Cache API can't be
// enumerated, so we delete every known banner key (audience × position). The
// in-memory L1 is per-instance; we clear this instance's entries and the rest
// expire within the 1-minute L1 TTL — the global edge L2 is cleared here.
const BANNER_CACHE_AUDIENCES = ['user', 'host', 'all'];
const BANNER_CACHE_POSITIONS = ['home', 'wallet', 'search', 'all'];

export async function invalidateBannerCaches(): Promise<void> {
  // L1 (this instance): drop every banner entry.
  for (const key of Array.from(memCache.keys())) {
    if (key.startsWith('banners:')) memCache.delete(key);
  }
  // L2 (global edge): delete each known banner key.
  try {
    const cache = (caches as any).default;
    await Promise.all(
      BANNER_CACHE_AUDIENCES.flatMap((a) =>
        BANNER_CACHE_POSITIONS.map((p) =>
          cache.delete(new Request(`https://voxlink-cache.internal/banners:${a}:${p}`))
        )
      )
    );
  } catch {
    // dev environment (no Cache API) — L1 clear above is sufficient there
  }
}

const pub = new Hono<{ Bindings: Env }>();

// GET /api/calls-config-status — UNAUTHENTICATED diagnostic. Reports ONLY
// whether the Agora secrets are PRESENT on the Worker (booleans, never the
// values). Lets anyone quickly confirm the "Agora not configured" root cause
// without needing a JWT or `wrangler tail`. Safe to expose: it leaks no secret
// material, only configured/not-configured flags.
pub.get('/calls-config-status', (c) => {
  const present = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const agoraConfigured = present(c.env.AGORA_APP_ID) && present(c.env.AGORA_APP_CERTIFICATE);
  return c.json({
    ok: true,
    environment: c.env.ENVIRONMENT ?? 'unknown',
    rtc_provider: 'agora',
    agora: {
      configured: agoraConfigured,
      app_id_present: present(c.env.AGORA_APP_ID),
      app_certificate_present: present(c.env.AGORA_APP_CERTIFICATE),
    },
    // calling_ready = Agora (the only provider) is actually configured.
    calling_ready: agoraConfigured,
  });
});


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

// GET /api/banners?position=home|wallet|search&audience=user|host|all
// Cached: active, in-schedule promotional banners targeted at the requesting
// app. `audience` separates user-app promos from host-app campaigns; a banner
// with audience 'all' shows in both. Ordered by admin-set sort_order.
pub.get('/banners', async (c) => {
  const position = c.req.query('position') ?? 'all';
  const audRaw = (c.req.query('audience') ?? 'user').toLowerCase();
  // Default to 'user' so legacy clients that omit the param keep getting the
  // user-facing banners they always got (existing rows backfill to 'user').
  const audience = audRaw === 'host' ? 'host' : audRaw === 'all' ? 'all' : 'user';

  const KEY = `banners:${audience}:${position}`;
  const mem = memGet<any[]>(KEY);
  if (mem) return cachedJson(mem, 120, 300);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge, 120, 300); }

  // Position → SQL predicate. `home` also matches legacy rows with a null/empty
  // position so nothing is silently dropped.
  const positionClause =
    position === 'home'   ? "(position LIKE 'home_%' OR position IS NULL OR position = '')"
    : position === 'wallet' ? "position = 'wallet'"
    : position === 'search' ? "position LIKE 'search%'"
    : '1 = 1';

  const now = Math.floor(Date.now() / 1000);
  const binds: any[] = [];
  let audienceClause = '';
  if (audience !== 'all') {
    // 'all'-targeted banners always surface alongside the requested audience.
    audienceClause = "AND (audience = ? OR audience = 'all')";
    binds.push(audience);
  }
  binds.push(now, now);

  const cols = 'id, title, subtitle, image_url, bg_color, gradient_to, icon, cta_text, cta_link, link_type, position, audience, sort_order';
  const query =
    `SELECT ${cols} FROM banners
     WHERE active = 1 AND ${positionClause} ${audienceClause}
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (ends_at   IS NULL OR ends_at   >= ?)
     ORDER BY sort_order ASC, created_at DESC
     LIMIT 10`;

  let data: any[];
  try {
    const result = await c.env.DB.prepare(query).bind(...binds).all();
    data = result.results ?? [];
  } catch (e: any) {
    // Graceful fallback for a DB where migration 0052 hasn't run yet (missing
    // audience/link_type/schedule columns): serve the legacy active-by-position
    // set so banners keep working during a staged deploy.
    if (/no such column|no such table/i.test(String(e?.message || ''))) {
      const legacy = await c.env.DB.prepare(
        `SELECT * FROM banners WHERE active = 1 AND ${positionClause} ORDER BY created_at DESC LIMIT 10`
      ).all();
      data = legacy.results ?? [];
    } else {
      throw e;
    }
  }

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

// GET /api/app-config — cached: economy values + operator app settings
// (maintenance gate, support email, legal links). Short TTL (60s edge) so an
// admin flipping maintenance_mode propagates to clients within ~1 min.
pub.get('/app-config', async (c) => {
  const KEY = 'app_config';
  const mem = memGet<Record<string, string>>(KEY);
  if (mem) return cachedJson(mem, 60, 120);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge, 60, 120); }
  const settings = await c.env.DB.prepare(
    // Economy keys + operator-facing app settings that the mobile apps consume:
    //   maintenance_mode / maintenance_message → in-app maintenance gate
    //   support_email                          → Help Center / About contact CTA
    //   terms_url / privacy_url                → legal links
    //   app_name                               → display name
    //   default_audio_rate / default_video_rate → standard per-minute call rate
    //   random_call_audio_rate/random_call_video_rate → random-match fallback rate
    //   coin_value_inr                         → INR base coin value (single
    //                                            source of truth; apps convert
    //                                            from ₹ to the user's currency)
    "SELECT key, value FROM app_settings WHERE key IN ('min_coins_for_call','coin_to_usd_rate','coin_value_inr','host_revenue_share','min_withdrawal_coins','registration_bonus_coins','maintenance_mode','maintenance_message','support_email','terms_url','privacy_url','app_name','default_audio_rate','default_video_rate','random_call_audio_rate','random_call_video_rate')"
  ).all();
  const config: Record<string, string> = {};
  for (const row of settings.results as any[]) {
    config[(row as any).key] = (row as any).value;
  }
  memSet(KEY, config);
  await edgePut(KEY, config);
  return cachedJson(config, 60, 120);
});

// GET /api/payment/active-qr — returns active manual QR codes with time-based rotation (no auth)
pub.get('/payment/active-qr', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      'SELECT id, name, upi_id, qr_image_url, instructions, rotate_interval_min, position FROM manual_qr_codes WHERE is_active = 1 ORDER BY position ASC'
    ).all();
    const codes = result.results as any[];
    if (codes.length === 0) return c.json({ qr_codes: [], current: null, rotate_interval_min: 30 });
    const intervalMin = Math.max(1, Math.min(...codes.map((q: any) => q.rotate_interval_min || 30)));
    const slot = Math.floor(Math.floor(Date.now() / 1000) / 60 / intervalMin);
    const currentIdx = slot % codes.length;
    return c.json({ qr_codes: codes, current: codes[currentIdx], rotate_interval_min: intervalMin });
  } catch (e: any) {
    // Table doesn't exist yet — return empty so user app shows "unavailable" gracefully
    if (/no such table/i.test(String(e?.message || ''))) {
      return c.json({ qr_codes: [], current: null, rotate_interval_min: 30 });
    }
    console.error('[payment/active-qr] error:', e);
    return c.json({ qr_codes: [], current: null, rotate_interval_min: 30 });
  }
});

// GET /api/app/version?app=user|host — force-update gate
//
// Mobile apps call this on launch (and periodically). Response shape:
//   { minSupported, latestStable, downloadUrl, blockMessage?, recommendMessage? }
//
// If the running app build is below `minSupported` it should show a BLOCKING
// modal that only offers an Update CTA. Below `latestStable` (but >=
// `minSupported`) is a non-blocking nudge.
//
// All values come from the `app_settings` table so an operator can flip them
// in production without a Worker redeploy. Defaults are intentionally
// permissive ("0.0.0" min) so an unconfigured deployment never accidentally
// locks every user out of the app.
//
// Cache: 60s edge / 30s memory. Short enough that an emergency block
// propagates within ~1 min, long enough to absorb every-launch traffic
// without pounding D1.
pub.get('/app/version', async (c) => {
  const appKind = (c.req.query('app') ?? 'user').toLowerCase() === 'host' ? 'host' : 'user';
  const KEY = `app_version:${appKind}`;
  const mem = memGet<any>(KEY);
  if (mem) return cachedJson(mem, 60, 120);
  const edge = await edgeGet(KEY);
  if (edge) { memSet(KEY, edge); return cachedJson(edge, 60, 120); }

  // Read all version-related app_settings keys in one round-trip.
  // Per-app-kind keys override shared defaults.
  const keys = [
    `app_min_version_${appKind}`,
    `app_latest_version_${appKind}`,
    `app_download_url_${appKind}`,
    'app_update_block_message',
    'app_update_recommend_message',
  ];
  const placeholders = keys.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`
  ).bind(...keys).all();
  const settings: Record<string, string> = {};
  for (const row of (rows.results as any[]) ?? []) {
    if (row?.key && typeof row.value === 'string') settings[row.key] = row.value;
  }

  const data = {
    app: appKind,
    minSupported: settings[`app_min_version_${appKind}`] || '0.0.0',
    latestStable: settings[`app_latest_version_${appKind}`] || '0.0.0',
    downloadUrl: settings[`app_download_url_${appKind}`] || null,
    blockMessage:
      settings.app_update_block_message ||
      'Please update VoxLink to the latest version to continue.',
    recommendMessage:
      settings.app_update_recommend_message ||
      'A new version of VoxLink is available with improvements.',
  };

  memSet(KEY, data);
  await edgePut(KEY, data);
  return cachedJson(data, 60, 120);
});

export default pub;
