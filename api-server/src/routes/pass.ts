import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getVipStatus } from '../lib/vip';
import { pushCoinUpdate, notifyUser } from '../lib/realtime';
import {
  passMonthKey,
  passMonthEndUnix,
  parsePassTiers,
  passWouldExceedBudget,
  passBudgetIncrementStmt,
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
//   • Premium — for active VIP members (auto), or anyone who buys the pass with
//               coins for the current month.
// Points / premium-unlock / claims all reset at the UTC month boundary because
// they are keyed by period_key ('YYYY-MM').
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

  // User's month state (points + coin-purchased premium unlock).
  let points = 0;
  let purchased = false;
  try {
    const st = await db
      .prepare('SELECT points, premium_unlocked FROM user_pass_state WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .first<{ points: number; premium_unlocked: number }>();
    points = Number(st?.points) || 0;
    purchased = !!Number(st?.premium_unlocked);
  } catch { /* un-migrated DB → defaults */ }

  const vip = await getVipStatus(db, sub);
  const vipUnlock = !!Number(cfg.vip_auto_unlock) && vip.isVip;
  const premiumUnlocked = purchased || vipUnlock;

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
    return {
      level: t.level,
      points: t.points,
      label: t.label,
      reached,
      free_coins: t.free_coins,
      free_claimed: freeClaimed,
      free_claimable: reached && !freeClaimed && t.free_coins > 0,
      premium_coins: t.premium_coins,
      premium_claimed: premiumClaimed,
      premium_claimable: reached && !premiumClaimed && t.premium_coins > 0 && premiumUnlocked,
    };
  });

  const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  const maxPoints = tiers.length ? tiers[tiers.length - 1].points : 0;

  return c.json({
    enabled: true,
    title: cfg.title,
    description: cfg.description,
    price_coins: Number(cfg.price_coins) || 0,
    vip_auto_unlock: !!Number(cfg.vip_auto_unlock),
    is_vip: vip.isVip,
    premium_unlocked: premiumUnlocked,
    premium_via_vip: vipUnlock,
    purchased,
    points,
    max_points: maxPoints,
    period_key: period,
    month_end: monthEnd,
    server_time: now,
    coins: Number(u?.coins) || 0,
    tiers: tierView,
  });
});

// ── POST /api/user/pass/purchase ──────────────────────────────────────────
// Unlock the Premium track for the CURRENT month by spending coins. VIP members
// (when vip_auto_unlock is on) already have it and are never charged.
pass.post('/purchase', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  const period = passMonthKey(now);

  const cfg = await loadConfig(db);
  if (!cfg || !Number(cfg.enabled)) return c.json({ error: 'Monthly Pass is unavailable', code: 'PASS_DISABLED' }, 403);

  // VIP members get the premium track for free.
  const vip = await getVipStatus(db, sub);
  if (!!Number(cfg.vip_auto_unlock) && vip.isVip) {
    return c.json({ success: true, already_unlocked: true, via: 'vip', premium_unlocked: true });
  }

  // Already bought this month?
  try {
    const st = await db
      .prepare('SELECT premium_unlocked FROM user_pass_state WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .first<{ premium_unlocked: number }>();
    if (st && Number(st.premium_unlocked)) {
      const u = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
      return c.json({ success: true, already_unlocked: true, via: 'coins', premium_unlocked: true, coins: Number(u?.coins) || 0 });
    }
  } catch { /* fall through to purchase */ }

  const price = Math.max(0, Number(cfg.price_coins) || 0);

  // Atomic debit — the WHERE coins >= ? guard makes double-clicks safe.
  if (price > 0) {
    const upd = await db
      .prepare('UPDATE users SET coins = coins - ?, updated_at = unixepoch() WHERE id = ? AND coins >= ?')
      .bind(price, sub, price)
      .run();
    if (!upd.meta?.changes) {
      return c.json({ error: `Not enough coins. The Monthly Pass costs ${price} coins.`, code: 'INSUFFICIENT_COINS' }, 402);
    }
  }

  // Record the unlock for this month.
  await db
    .prepare(
      `INSERT INTO user_pass_state (user_id, period_key, points, premium_unlocked, updated_at)
       VALUES (?, ?, 0, 1, ?)
       ON CONFLICT(user_id, period_key) DO UPDATE SET premium_unlocked = 1, updated_at = ?`,
    )
    .bind(sub, period, now, now)
    .run();

  if (price > 0) {
    await db
      .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'spend', -price, `Monthly Pass (${period})`, `monthly_pass_${period}`)
      .run()
      .catch((e) => console.warn('[pass/purchase] ledger write failed (non-fatal):', e));
  }

  const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  c.executionCtx?.waitUntil?.(pushCoinUpdate(c.env, sub));
  c.executionCtx?.waitUntil?.(notifyUser(c.env, sub, 'Monthly Pass unlocked 🎟️', 'Premium rewards are now yours to claim this month. Complete tasks to level up!', 'reward'));
  return c.json({ success: true, premium_unlocked: true, via: 'coins', price_coins: price, coins: Number(after?.coins) || 0 });
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

  // Current-month points + unlock state.
  let points = 0;
  let purchased = false;
  try {
    const st = await db
      .prepare('SELECT points, premium_unlocked FROM user_pass_state WHERE user_id = ? AND period_key = ?')
      .bind(sub, period)
      .first<{ points: number; premium_unlocked: number }>();
    points = Number(st?.points) || 0;
    purchased = !!Number(st?.premium_unlocked);
  } catch { /* defaults */ }

  if (points < tier.points) {
    return c.json({ error: 'You have not reached this tier yet', code: 'TIER_LOCKED' }, 403);
  }

  const coins = track === 'premium' ? tier.premium_coins : tier.free_coins;
  if (coins <= 0) return c.json({ error: 'No reward on this track for this tier', code: 'NO_REWARD' }, 400);

  if (track === 'premium') {
    const vip = await getVipStatus(db, sub);
    const premiumUnlocked = purchased || (!!Number(cfg.vip_auto_unlock) && vip.isVip);
    if (!premiumUnlocked) {
      return c.json({ error: 'Unlock the Monthly Pass (or go VIP) to claim Premium rewards', code: 'PREMIUM_LOCKED' }, 403);
    }
  }

  // Shared daily reward budget cap (mirrors reward-task claims).
  const budget = await passWouldExceedBudget(db, coins);
  if (budget.exceeded) {
    return c.json({ error: "Today's reward budget is exhausted. Try again tomorrow.", code: 'BUDGET_EXCEEDED' }, 429);
  }

  // Atomic double-claim guard: the composite PK means the INSERT succeeds
  // (changes=1) only the first time this (user, month, tier, track) is claimed.
  let inserted = false;
  try {
    const ins = await db
      .prepare(
        `INSERT OR IGNORE INTO user_pass_claims (user_id, period_key, tier_level, track, coins_awarded, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(sub, period, tierLevel, track, coins, now)
      .run();
    inserted = !!ins.meta?.changes;
  } catch (e) {
    console.warn('[pass/claim] claim insert failed:', e);
    return c.json({ error: 'Could not claim reward' }, 500);
  }
  if (!inserted) {
    return c.json({ error: 'Reward already claimed', code: 'ALREADY_CLAIMED' }, 409);
  }

  // Credit coins + ledger + budget in one batch. On failure, roll the claim
  // back so the reward isn't silently lost.
  try {
    await db.batch([
      db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(coins, sub),
      db
        .prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), sub, 'bonus', coins, `Monthly Pass ${track} reward — ${tier.label}`, `monthly_pass_${period}_${tierLevel}_${track}`),
      passBudgetIncrementStmt(db, coins),
    ]);
  } catch (e) {
    console.warn('[pass/claim] credit batch failed, rolling back claim:', e);
    await db
      .prepare('DELETE FROM user_pass_claims WHERE user_id = ? AND period_key = ? AND tier_level = ? AND track = ?')
      .bind(sub, period, tierLevel, track)
      .run()
      .catch(() => {});
    return c.json({ error: 'Could not credit reward, please retry' }, 500);
  }

  const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  c.executionCtx?.waitUntil?.(pushCoinUpdate(c.env, sub));
  return c.json({
    success: true,
    tier_level: tierLevel,
    track,
    coins_awarded: coins,
    coins: Number(after?.coins) || 0,
  });
});

export default pass;
