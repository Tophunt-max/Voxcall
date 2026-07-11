// ============================================================================
// Growth / promotions engine.
// ============================================================================
//
// Money-path bonuses + win-back rewards, all admin-configurable via app_settings
// (Growth page). Everything is best-effort and idempotent by construction:
//
//   • Purchase bonuses run ONLY from approveDeposit's CAS winner (exactly once
//     per successful purchase), so no double-credit.
//   • Comeback reward dedups via a cooldown check on the notifications table.
//
// All coin grants go through a single ledgered batch so the wallet + audit
// trail stay consistent.
// ============================================================================

import type { Env } from '../types';
import { notifyUser, pushCoinUpdate } from './realtime';

async function readInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
async function readBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value == null) return fallback;
    return row.value !== '0' && row.value.toLowerCase() !== 'false';
  } catch { return fallback; }
}
async function readStr(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  } catch { return null; }
}

const istHour = () => new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).getUTCHours();
function inHappyHour(startH: number, endH: number): boolean {
  if (startH === endH) return false;
  const h = istHour();
  return startH < endH ? (h >= startH && h < endH) : (h >= startH || h < endH);
}

/**
 * Apply first-recharge / happy-hour / spend-milestone bonuses on top of a
 * freshly-credited purchase. Called from approveDeposit AFTER the base coins
 * are credited (so pushCoinUpdate there reflects the total). Grants all bonuses
 * in one ledgered batch, then notifies per bonus.
 */
export async function applyPurchaseBonuses(
  env: Env,
  purchase: { id: string; user_id: string; coins: number; bonus_coins: number },
): Promise<number> {
  const db = env.DB;
  const uid = purchase.user_id;
  const base = (Number(purchase.coins) || 0) + (Number(purchase.bonus_coins) || 0);
  if (base <= 0) return 0;

  let bonusTotal = 0;
  const notes: string[] = [];
  const toasts: { title: string; body: string }[] = [];

  try {
    // 1. First-recharge bonus (default OFF).
    if (await readBool(db, 'first_recharge_bonus_enabled', false)) {
      const prior = await db.prepare("SELECT COUNT(*) AS n FROM coin_purchases WHERE user_id = ? AND status = 'success' AND id != ?").bind(uid, purchase.id).first<{ n: number }>();
      if ((Number(prior?.n) || 0) === 0) {
        const pct = await readInt(db, 'first_recharge_bonus_pct', 100);
        const cap = await readInt(db, 'first_recharge_bonus_max_coins', 500);
        const b = Math.min(cap, Math.round((base * pct) / 100));
        if (b > 0) { bonusTotal += b; notes.push(`first-recharge +${b}`); toasts.push({ title: '🎁 First Recharge Bonus!', body: `Amazing! You just scored ${b} FREE bonus coins on your very first recharge. Welcome aboard! 🚀` }); }
      }
    }

    // 2. Happy Hour bonus (default OFF).
    if (await readBool(db, 'happy_hour_enabled', false)) {
      const startH = await readInt(db, 'happy_hour_start_ist', 20);
      const endH = await readInt(db, 'happy_hour_end_ist', 23);
      const pct = await readInt(db, 'happy_hour_bonus_pct', 0);
      if (pct > 0 && inHappyHour(startH, endH)) {
        const cap = await readInt(db, 'happy_hour_max_coins', 1000);
        const b = Math.min(cap, Math.round((base * pct) / 100));
        if (b > 0) { bonusTotal += b; notes.push(`happy-hour +${b}`); toasts.push({ title: '⚡ Happy Hour Bonus!', body: `Lucky you! ${b} extra coins added because Happy Hour is LIVE. Grab more while it lasts! 🎉` }); }
      }
    }

    // 3. Spend-milestone cashback (default OFF). Grants when lifetime purchased
    //    coins cross a configured tier for the first time (natural dedup).
    if (await readBool(db, 'spend_cashback_enabled', false)) {
      let tiers: Record<string, number> = {};
      try { tiers = JSON.parse((await readStr(db, 'spend_milestones')) ?? '{}'); } catch { tiers = {}; }
      const row = await db.prepare("SELECT COALESCE(SUM(coins + COALESCE(bonus_coins,0)),0) AS s FROM coin_purchases WHERE user_id = ? AND status = 'success'").bind(uid).first<{ s: number }>();
      const lifetimeAfter = Number(row?.s) || 0;
      const lifetimeBefore = lifetimeAfter - base;
      let cashback = 0;
      for (const [mStr, reward] of Object.entries(tiers)) {
        const m = parseInt(mStr, 10);
        const rw = Number(reward) || 0;
        if (Number.isFinite(m) && m > 0 && rw > 0 && lifetimeBefore < m && lifetimeAfter >= m) cashback += rw;
      }
      if (cashback > 0) { bonusTotal += cashback; notes.push(`milestone +${cashback}`); toasts.push({ title: '🏆 Milestone Unlocked!', body: `You're a star! ${cashback} cashback coins are yours for hitting a spending milestone. Keep shining! ✨` }); }
    }

    if (bonusTotal > 0) {
      await db.batch([
        db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(bonusTotal, uid),
        db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), uid, 'bonus', bonusTotal, `Promo bonus: ${notes.join(', ')}`, purchase.id),
      ]);
      for (const t of toasts) await notifyUser(env, uid, t.title, t.body, 'promo_bonus');
    }
    return bonusTotal;
  } catch (e) {
    console.warn('[promotions] applyPurchaseBonuses failed for', uid, e);
    return 0;
  }
}

/**
 * Grant a one-time comeback reward to a returning lapsed user. `priorActivityTs`
 * is the user's last-seen timestamp BEFORE this login. Dedups via a cooldown on
 * the comeback notification. Returns the coins granted (0 if none).
 */
export async function maybeGrantComebackReward(env: Env, userId: string, priorActivityTs: number | null | undefined): Promise<number> {
  try {
    if (!(await readBool(env.DB, 'comeback_reward_enabled', false))) return 0;
    const bonus = await readInt(env.DB, 'comeback_bonus_coins', 50);
    if (bonus <= 0) return 0;
    const idleDays = await readInt(env.DB, 'comeback_idle_days', 7);
    const cooldownDays = await readInt(env.DB, 'comeback_cooldown_days', 30);
    const now = Math.floor(Date.now() / 1000);
    if (!priorActivityTs || now - priorActivityTs < idleDays * 86400) return 0;
    const recent = await env.DB.prepare("SELECT 1 AS ok FROM notifications WHERE user_id = ? AND type = 'comeback' AND created_at >= ? LIMIT 1").bind(userId, now - cooldownDays * 86400).first<{ ok: number }>();
    if (recent) return 0;
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(bonus, userId),
      env.DB.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, 'bonus', bonus, 'Comeback reward', null),
    ]);
    await notifyUser(env, userId, '🎉 Welcome Back — We Missed You!', `So good to see you again! Here's ${bonus} bonus coins as a little welcome-back gift. Let's pick up where you left off! 💛`, 'comeback');
    await pushCoinUpdate(env, userId, bonus);
    return bonus;
  } catch (e) {
    console.warn('[promotions] maybeGrantComebackReward failed for', userId, e);
    return 0;
  }
}
