import { Hono } from 'hono';
import type { Env } from '../types';

const pub = new Hono<{ Bindings: Env }>();

// GET /api/talk-topics — public list for mobile app
pub.get('/talk-topics', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM talk_topics WHERE is_active = 1 ORDER BY name ASC'
  ).all();
  return c.json(result.results);
});

// GET /api/faqs — public FAQs for mobile app
pub.get('/faqs', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM faqs WHERE is_active = 1 ORDER BY order_index ASC, created_at ASC'
  ).all();
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

// GET /api/app-config — app configuration for mobile (theme, limits, etc)
pub.get('/app-config', async (c) => {
  const settings = await c.env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN ('min_coins_for_call','coin_to_usd_rate','host_revenue_share','min_withdrawal_coins','registration_bonus_coins')"
  ).all();
  const config: Record<string, string> = {};
  for (const row of settings.results as any[]) {
    config[row.key] = row.value;
  }
  return c.json(config);
});

export default pub;
