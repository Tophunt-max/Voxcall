import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getVipStatus } from '../lib/vip';
import {
  passMonthKey,
  passMonthEndUnix,
  parsePassTiers,
  type PassTier,
} from '../lib/pass';
import type { Env, JWTPayload } from '../types';

// ============================================================================
// Monthly Pass — user-facing routes (mounted at /api/user/pass)
// ============================================================================
// A monthly "battle pass". Pass Points are earned by claiming reward tasks
// (see routes/rewards.ts → addPassPoints). Crossing a tier's point threshold
// unlocks a reward on two tracks:
//   • Common  — free, for everyone.
//   • Premium — EXCLUSIVELY for active VIP members. There is no coin purchase;
//               the only way to unlock the Premium track is an active VIP
//               subscription (see routes/vip.ts).
// Points / claims reset at the UTC month boundary because they are keyed by
// period_key ('YYYY-MM'). Premium access follows VIP status live.
// ============================================================================

const pass = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
pass.use('*', authMiddleware);

const CONFIG_ID = 'default';

interface PassConfigRow {
  id: string;
  enabled: number;
  title: string;
  description: string;
  price_coins: number;
  vip_auto_unlock: number;
  tiers: string;
}

async function loadConfig(db: D1Database): Promise<PassConfigRow | null> {
  try {
    return await db.prepare('SELECT * FROM reward_pass WHERE id = ?').bind(CONFIG_ID).first<PassConfigRow>();
  } catch {
    return null;
  }
}

// ── GET /api/user/pass ──────────────────────────────────────────────────────
// Full pass state for the current month: config, this user's points, whether
// the premium track is unlocked, and per-tier claim status for both tracks.
pass.get('/', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const period = passMonthKey(now);
  const monthEnd = passMonthEndUnix(now);

  const cfg = await loadConfig(db);
  if (!cfg || !Number(cfg.enabled)) {
    return c.json({ enabled: false, server_time: now, month_end: monthEnd });
  }

  const tiers = parsePassTiers(cfg.tiers);

  // User's month points. Premium unlock is a VIP-only perk — coins cannot buy it.
  let points = 0;
  try {
    const st = await db
      .prepare('SELECT points FROM user_pass_state WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .first<{ points: number }>();
    points = Number(st?.points) || 0;
  } catch { /* un-migrated DB → defaults */ }

  const vip = await getVipStatus(db, sub);
  // Premium track is unlocked ONLY for active VIP members.
  const premiumUnlocked = vip.isVip;

  // Claim ledger for this month → "level:track" set.
  const claimed = new Set<string>();
  try {
    const rows = await db
      .prepare('SELECT tier_level, track FROM user_pass_claims WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .all<{ tier_level: number; track: string }>();
    for (const r of rows.results ?? []) claimed.add(`${r.tier_level}:${r.track}`);
  } catch { /* un-migrated DB → no claims */ }

  const tierView = tiers.map((t) => {
    const reached = points >= t.points;
    const freeClaimed = claimed.has(`${t.level}:common`);
    const premiumClaimed = claimed.has(`${t.level}:premium`);
    const freeHas = t.free_minutes > 0 || t.free_random_minutes > 0;
    const premiumHas = t.premium_minutes > 0 || t.premium_random_minutes > 0;
    return {
      level: t.level,
      points: t.points,
      label: t.label,
      reached,
      // Free (Common) track — free-minute cards.
      free_minutes: t.free_minutes,
      free_random_minutes: t.free_random_minutes,
      free_claimed: freeClaimed,
      free_claimable: reached && !freeClaimed && freeHas,
      // Premium (VIP) track.
      premium_minutes: t.premium_minutes,
      premium_random_minutes: t.premium_random_minutes,
      premium_claimed: premiumClaimed,
      premium_claimable: reached && !premiumClaimed && premiumHas && premiumUnlocked,
    };
  });

  const maxPoints = tiers.length ? tiers[tiers.length - 1].points : 0;

  return c.json({
    enabled: true,
    title: cfg.title,
    description: cfg.description,
    is_vip: vip.isVip,
    premium_unlocked: premiumUnlocked,
    premium_via_vip: premiumUnlocked,
    premium_requires_vip: true,
    points,
    max_points: maxPoints,
    period_key: period,
    month_end: monthEnd,
    server_time: now,
    tiers: tierView,
  });
});

// ── POST /api/user/pass/purchase ──────────────────────────────────────────
// Premium is a VIP-only perk — it cannot be bought with coins. This endpoint
// is kept for backward compatibility with older clients: VIP members get a
// success response (already unlocked); everyone else is told to subscribe.
pass.post('/purchase', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;

  const cfg = await loadConfig(db);
  if (!cfg || !Number(cfg.enabled)) return c.json({ error: 'Monthly Pass is unavailable', code: 'PASS_DISABLED' }, 403);

  const vip = await getVipStatus(db, sub);
  if (vip.isVip) {
    return c.json({ success: true, already_unlocked: true, via: 'vip', premium_unlocked: true });
  }
  return c.json({
    error: 'Premium rewards are a VIP perk. Subscribe to VIP to unlock them.',
    code: 'VIP_REQUIRED',
    premium_unlocked: false,
  }, 403);
});

// ── POST /api/user/pass/claim { tier_level, track } ────────────────────────
// Claim a tier reward on the common (free) or premium track.
pass.post('/claim', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const period = passMonthKey(now);

  const body = (await c.req.json().catch(() => ({}))) as { tier_level?: number; track?: string };
  const tierLevel = Math.floor(Number(body.tier_level));
  const track = body.track === 'premium' ? 'premium' : body.track === 'common' ? 'common' : null;
  if (!Number.isFinite(tierLevel) || tierLevel < 1 || !track) {
    return c.json({ error: 'tier_level and a valid track (common|premium) are required' }, 400);
  }

  const cfg = await loadConfig(db);
  if (!cfg || !Number(cfg.enabled)) return c.json({ error: 'Monthly Pass is unavailable', code: 'PASS_DISABLED' }, 403);

  const tier: PassTier | undefined = parsePassTiers(cfg.tiers).find((t) => t.level === tierLevel);
  if (!tier) return c.json({ error: 'Tier not found' }, 404);

  // Current-month points.
  let points = 0;
  try {
    const st = await db
      .prepare('SELECT points FROM user_pass_state WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .first<{ points: number }>();
    points = Number(st?.points) || 0;
  } catch { /* defaults */ }

  if (points < tier.points) {
    return c.json({ error: 'You have not reached this tier yet', code: 'TIER_LOCKED' }, 403);
  }

  // Rewards are FREE-MINUTE cards, not coins:
  //   hostMin → host-call free minutes (free_call_minutes)
  //   randMin → random-call free minutes (free_random_minutes)
  const hostMin = track === 'premium' ? tier.premium_minutes : tier.free_minutes;
  const randMin = track === 'premium' ? tier.premium_random_minutes : tier.free_random_minutes;
  const totalMin = hostMin + randMin;
  if (totalMin <= 0) return c.json({ error: 'No reward on this track for this tier', code: 'NO_REWARD' }, 400);

  // Premium rewards are exclusively for active VIP members.
  if (track === 'premium') {
    const vip = await getVipStatus(db, sub);
    if (!vip.isVip) {
      return c.json({ error: 'Premium rewards are a VIP perk. Subscribe to VIP to claim them.', code: 'VIP_REQUIRED' }, 403);
    }
  }

  // Atomic double-claim guard: the composite PK means the INSERT succeeds
  // (changes=1) only the first time this (user, month, tier, track) is claimed.
  // We record the total minutes granted in coins_awarded (repurposed as a
  // generic "amount awarded" column).
  let inserted = false;
  try {
    const ins = await db
      .prepare(
        `INSERT OR IGNORE INTO user_pass_claims (user_id, period_key, tier_level, track, coins_awarded, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(sub, period, tierLevel, track, totalMin, now)
      .run();
    inserted = !!ins.meta?.changes;
  } catch (e) {
    console.warn('[pass/claim] claim insert failed:', e);
    return c.json({ error: 'Could not claim reward' }, 500);
  }
  if (!inserted) {
    return c.json({ error: 'Reward already claimed', code: 'ALREADY_CLAIMED' }, 409);
  }

  // Credit the free-minute pools. On failure, roll the claim back so the
  // reward isn't silently lost. Host + random pools are strictly separate.
  try {
    await db
      .prepare(
        `UPDATE users
            SET free_call_minutes   = COALESCE(free_call_minutes, 0) + ?,
                free_random_minutes = COALESCE(free_random_minutes, 0) + ?,
                updated_at = unixepoch()
          WHERE id = ?`,
      )
      .bind(hostMin, randMin, sub)
      .run();
  } catch (e) {
    console.warn('[pass/claim] minute credit failed, rolling back claim:', e);
    await db
      .prepare('DELETE FROM user_pass_claims WHERE user_id = ? AND period_key = ? AND tier_level = ? AND track = ?')
      .bind(sub, period, tierLevel, track)
      .run()
      .catch(() => {});
    return c.json({ error: 'Could not credit reward, please retry' }, 500);
  }

  const after = await db
    .prepare('SELECT COALESCE(free_call_minutes,0) AS fm, COALESCE(free_random_minutes,0) AS frm FROM users WHERE id = ?')
    .bind(sub)
    .first<{ fm: number; frm: number }>();
  return c.json({
    success: true,
    tier_level: tierLevel,
    track,
    host_minutes: hostMin,
    random_minutes: randMin,
    free_call_minutes: Number(after?.fm) || 0,
    free_random_minutes: Number(after?.frm) || 0,
  });
});

export default pass;
