import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const match = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
match.use('*', authMiddleware);

const LEVELS: Record<number, { name: string; badge: string; color: string }> = {
  1: { name: 'Newcomer', badge: '🌱', color: '#6B7280' },
  2: { name: 'Rising',   badge: '⭐', color: '#F59E0B' },
  3: { name: 'Expert',   badge: '🔥', color: '#EF4444' },
  4: { name: 'Pro',      badge: '💎', color: '#8B5CF6' },
  5: { name: 'Elite',    badge: '👑', color: '#D97706' },
};

function enrichHost(h: any) {
  const lvl = h.level ?? 1;
  return {
    ...h,
    specialties: JSON.parse(h.specialties || '[]'),
    languages: JSON.parse(h.languages || '[]'),
    level_info: LEVELS[lvl] ?? LEVELS[1],
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? 5,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ?? 5) + 5,
  };
}

// POST /api/match/find — find a random online host for matchmaking
match.post('/find', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ call_type?: string }>().catch(() => ({}));
  const callType = body.call_type ?? 'audio';
  const db = c.env.DB;

  // Read admin-configured random call rates from app_settings
  const audioRateRow = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'random_call_audio_rate'")
    .first<{ value: string }>();
  const videoRateRow = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'random_call_video_rate'")
    .first<{ value: string }>();

  const adminAudioRate = audioRateRow ? parseFloat(audioRateRow.value) : 5;
  const adminVideoRate = videoRateRow ? parseFloat(videoRateRow.value) : 8;
  const adminRate      = callType === 'video' ? adminVideoRate : adminAudioRate;

  // Pick a random online host (excluding the requester themselves if they are a host)
  const host = await db
    .prepare(
      `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1
         AND h.is_online = 1
         AND h.user_id != ?
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .bind(sub)
    .first<any>();

  if (!host) {
    return c.json({ matched: false, message: 'Abhi koi host available nahi hai, thodi der baad try karo' });
  }

  const enriched = enrichHost(host);

  return c.json({
    matched: true,
    admin_audio_rate: adminAudioRate,
    admin_video_rate: adminVideoRate,
    coins_per_minute: adminRate,         // ← admin-set rate (used for deduction)
    host: {
      id: enriched.id,
      user_id: enriched.user_id,
      name: enriched.display_name || enriched.name,
      avatar_url: enriched.avatar_url,
      rating: enriched.rating ?? 0,
      review_count: enriched.review_count ?? 0,
      specialties: enriched.specialties,
      languages: enriched.languages,
      bio: enriched.bio,
      level: enriched.level ?? 1,
      level_info: enriched.level_info,
      audio_coins_per_minute: adminAudioRate,
      video_coins_per_minute: adminVideoRate,
      coins_per_minute: adminRate,
    },
  });
});

// GET /api/match/online-hosts — get online hosts for the floating cards UI
match.get('/online-hosts', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  const result = await db
    .prepare(
      `SELECT h.id, h.display_name, h.specialties, h.rating, h.audio_coins_per_minute,
              u.name, u.avatar_url
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
       ORDER BY RANDOM()
       LIMIT 12`
    )
    .bind(sub)
    .all<any>();

  return c.json(
    result.results.map((h) => ({
      id: h.id,
      name: h.display_name || h.name,
      avatar_url: h.avatar_url,
      rating: h.rating ?? 0,
      coins_per_minute: h.audio_coins_per_minute ?? 5,
      specialties: JSON.parse(h.specialties || '[]'),
    }))
  );
});

export default match;
