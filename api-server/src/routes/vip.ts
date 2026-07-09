import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { getVipStatus } from '../lib/vip';
import type { Env, JWTPayload } from '../types';

const vip = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();
vip.use('*', authMiddleware);

const DAILY_COOLDOWN_SEC = 20 * 60 * 60; // 20h — once/day without timezone edge cases

function parsePerks(raw: any): string[] {
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function serializePlan(p: any) {
  return {
    id: p.id,
    tier: p.tier,
    name: p.name,
    price_coins: Number(p.price_coins) || 0,
    duration_days: Number(p.duration_days) || 30,
    call_discount_pct: Number(p.call_discount_pct) || 0,
    daily_bonus_coins: Number(p.daily_bonus_coins) || 0,
    chat_unlock: !!Number(p.chat_unlock),
    badge: p.badge ?? null,
    color: p.color ?? null,
    perks: parsePerks(p.perks),
    sort_order: Number(p.sort_order) || 0,
  };
}

// GET /api/vip/plans — active VIP plans
vip.get('/plans', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM vip_plans WHERE is_active = 1 ORDER BY sort_order ASC, price_coins ASC'
  ).all<any>();
  return c.json((rows.results ?? []).map(serializePlan));
});

// GET /api/vip/status — current user's VIP status + daily-bonus availability
vip.get('/status', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  const status = await getVipStatus(db, sub);
  const u = await db.prepare('SELECT coins, vip_daily_claim_at FROM users WHERE id = ?')
    .bind(sub).first<{ coins: number; vip_daily_claim_at: number | null }>();
  const lastClaim = Number(u?.vip_daily_claim_at) || 0;

  const dailyAvailable = status.isVip && status.dailyBonusCoins > 0 && now - lastClaim >= DAILY_COOLDOWN_SEC;

  return c.json({
    is_vip: status.isVip,
    tier: status.tier,
    plan_name: status.planName,
    expires_at: status.expiresAt,
    days_left: status.isVip && status.expiresAt ? Math.max(0, Math.ceil((status.expiresAt - now) / 86400)) : 0,
    call_discount_pct: status.callDiscountPct,
    daily_bonus_coins: status.dailyBonusCoins,
    chat_unlock: status.chatUnlock,
    daily_available: dailyAvailable,
    next_daily_at: status.dailyBonusCoins > 0 ? lastClaim + DAILY_COOLDOWN_SEC : null,
    coins: Number(u?.coins) || 0,
  });
});

// POST /api/vip/subscribe { plan_id } — buy/extend VIP with coins
vip.post('/subscribe', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as { plan_id?: string };
  if (!body.plan_id) return c.json({ error: 'plan_id is required' }, 400);

  const plan = await db.prepare('SELECT * FROM vip_plans WHERE id = ? AND is_active = 1')
    .bind(body.plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found or unavailable' }, 404);

  const price = Number(plan.price_coins) || 0;
  const durationDays = Number(plan.duration_days) || 30;
  const now = Math.floor(Date.now() / 1000);

  // Extend from the current expiry if still active; otherwise start now.
  const cur = await db.prepare('SELECT vip_expires_at FROM users WHERE id = ?')
    .bind(sub).first<{ vip_expires_at: number | null }>();
  const base = cur?.vip_expires_at && Number(cur.vip_expires_at) > now ? Number(cur.vip_expires_at) : now;
  const newExpiry = base + durationDays * 86400;

  // Atomic debit + activation: only succeeds if the user can afford it. The
  // `WHERE coins >= ?` guard makes concurrent double-clicks safe (no negative
  // balance, no double charge beyond the balance).
  const upd = await db.prepare(
    'UPDATE users SET coins = coins - ?, vip_tier = ?, vip_expires_at = ?, updated_at = unixepoch() WHERE id = ? AND coins >= ?'
  ).bind(price, plan.tier, newExpiry, sub, price).run();

  if (!upd.meta?.changes) {
    return c.json({ error: `Not enough coins. This plan costs ${price} coins.`, code: 'INSUFFICIENT_COINS' }, 402);
  }

  const subId = crypto.randomUUID();
  // Ledger + audit (non-fatal — the purchase already succeeded above).
  await db.batch([
    db.prepare('INSERT INTO vip_subscriptions (id, user_id, tier, price_coins, duration_days, started_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(subId, sub, plan.tier, price, durationDays, now, newExpiry),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'spend', -price, `${plan.name} (${durationDays} days)`, subId),
  ]).catch((e) => console.warn('[vip/subscribe] ledger write failed (non-fatal):', e));

  const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  return c.json({
    success: true,
    tier: plan.tier,
    plan_name: plan.name,
    expires_at: newExpiry,
    days_left: Math.max(0, Math.ceil((newExpiry - now) / 86400)),
    coins: Number(after?.coins) || 0,
  });
});

// POST /api/vip/claim-daily — claim the daily VIP bonus coins (once/day)
vip.post('/claim-daily', async (c) => {
  const { sub } = c.get('user');
  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  const status = await getVipStatus(db, sub);
  if (!status.isVip) return c.json({ error: 'VIP membership required', code: 'NOT_VIP' }, 403);
  if (status.dailyBonusCoins <= 0) return c.json({ error: 'Your plan has no daily bonus' }, 400);

  const bonus = status.dailyBonusCoins;
  const threshold = now - DAILY_COOLDOWN_SEC;
  // Atomic, race-safe claim: only grants if the last claim is older than the
  // cooldown (or never claimed). Two concurrent taps → only one succeeds.
  const upd = await db.prepare(
    `UPDATE users SET coins = coins + ?, vip_daily_claim_at = ?, updated_at = unixepoch()
     WHERE id = ? AND (vip_daily_claim_at IS NULL OR vip_daily_claim_at <= ?)`
  ).bind(bonus, now, sub, threshold).run();

  if (!upd.meta?.changes) {
    const u = await db.prepare('SELECT vip_daily_claim_at FROM users WHERE id = ?').bind(sub).first<{ vip_daily_claim_at: number }>();
    return c.json({
      error: 'Daily bonus already claimed. Come back later.',
      code: 'ALREADY_CLAIMED',
      next_daily_at: (Number(u?.vip_daily_claim_at) || now) + DAILY_COOLDOWN_SEC,
    }, 429);
  }

  await db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), sub, 'bonus', bonus, 'VIP daily bonus')
    .run()
    .catch(() => {});

  const after = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<{ coins: number }>();
  return c.json({ success: true, granted: bonus, coins: Number(after?.coins) || 0, next_daily_at: now + DAILY_COOLDOWN_SEC });
});

export default vip;
