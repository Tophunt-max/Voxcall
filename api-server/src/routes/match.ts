import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getLevelConfig, buildLevelInfo, rankBoostCaseSql, type LevelDef } from '../lib/levels';
import type { Env, JWTPayload } from '../types';

const match = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
match.use('*', authMiddleware);

// Level badge/name/color come from the admin-configured ladder (single source
// of truth via buildLevelInfo) — no more hardcoded map that ignores admin edits.
function enrichHost(h: any, config: LevelDef[]) {
  return {
    ...h,
    specialties: JSON.parse(h.specialties || '[]'),
    languages: JSON.parse(h.languages || '[]'),
    level: h.level ?? 1,
    level_info: buildLevelInfo(config, h.level ?? 1),
    audio_coins_per_minute: h.audio_coins_per_minute ?? h.coins_per_minute ?? 5,
    video_coins_per_minute: h.video_coins_per_minute ?? (h.coins_per_minute ?? 5) + 5,
  };
}

// POST /api/match/find — find a random online host for matchmaking
match.post('/find', async (c) => {
  const { sub } = c.get('user');
  const body = await c.req.json<{ call_type?: string }>().catch(() => ({} as { call_type?: string }));
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

  // FIX #19: Replace ORDER BY RANDOM() — which does a full table sort — with
  // a fast offset-based random pick. Gets count first, then picks a random row by offset.
  // This is O(log N) on indexed columns vs O(N log N) for RANDOM().
  // NOTE (#32): There is a small race window between the COUNT and the SELECT —
  // if a host goes offline in between, the offset SELECT can return zero rows.
  // The race is transient and self-healing; the client should retry on no-result.
  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM hosts WHERE is_active = 1 AND is_online = 1 AND user_id != ?`)
    .bind(sub)
    .first<{ cnt: number }>();
  const totalOnline = countRow?.cnt ?? 0;

  let host: any = null;
  if (totalOnline > 0) {
    const offset = Math.floor(Math.random() * totalOnline);
    host = await db
      .prepare(
        `SELECT h.*, u.name, u.avatar_url, u.gender, u.bio
         FROM hosts h
         JOIN users u ON u.id = h.user_id
         WHERE h.is_active = 1
           AND h.is_online = 1
           AND h.user_id != ?
         LIMIT 1 OFFSET ?`
      )
      .bind(sub, offset)
      .first<any>();
  }

  if (!host) {
    return c.json({ matched: false, message: 'Abhi koi host available nahi hai, thodi der baad try karo' });
  }

  const levelCfg = await getLevelConfig(db);
  const enriched = enrichHost(host, levelCfg);

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

  // FIX #19: Use rating-based ordering instead of RANDOM() for online hosts list
  // This is deterministic but provides good variety since online hosts rotate frequently
  // LEVEL PERK: rank_boost is the primary signal so higher-level hosts surface first.
  const config = await getLevelConfig(db);
  const result = await db
    .prepare(
      `SELECT h.id, h.display_name, h.specialties, h.rating, h.level, h.audio_coins_per_minute,
              u.name, u.avatar_url
       FROM hosts h
       JOIN users u ON u.id = h.user_id
       WHERE h.is_active = 1 AND h.is_online = 1 AND h.user_id != ?
       ORDER BY ${rankBoostCaseSql(config)} DESC, h.rating DESC, h.review_count DESC
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
      level: h.level ?? 1,
      level_info: buildLevelInfo(config, h.level ?? 1),
    }))
  );
});

export default match;
