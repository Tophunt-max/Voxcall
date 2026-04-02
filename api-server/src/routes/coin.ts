import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const coin = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// GET /api/coins/plans — public
coin.get('/plans', async (c) => {
  const plans = await c.env.DB.prepare('SELECT * FROM coin_plans WHERE is_active = 1 ORDER BY coins ASC').all();
  return c.json(plans.results);
});

// POST /api/coins/apply-promo — validate a promo code (public, no auth needed)
coin.post('/apply-promo', async (c) => {
  const { code, plan_id } = await c.req.json();
  if (!code) return c.json({ error: 'code is required' }, 400);
  const db = c.env.DB;
  const promo = await db.prepare(
    'SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1'
  ).bind(code.trim()).first<any>();
  if (!promo) return c.json({ error: 'Invalid or expired promo code' }, 404);
  if (promo.expires_at && new Date(promo.expires_at * 1000) < new Date()) return c.json({ error: 'Promo code has expired' }, 400);
  if (promo.max_uses && promo.used_count >= promo.max_uses) return c.json({ error: 'Promo code has reached its usage limit' }, 400);
  let discount = 0;
  let bonus_coins = 0;
  if (plan_id) {
    const plan = await db.prepare('SELECT * FROM coin_plans WHERE id = ?').bind(plan_id).first<any>();
    if (plan && promo.type === 'percent') discount = Math.round((plan.price * promo.discount_pct) / 100 * 100) / 100;
  }
  if (promo.type === 'bonus') bonus_coins = promo.bonus_coins ?? 0;
  return c.json({ valid: true, type: promo.type, discount, bonus_coins, discount_pct: promo.discount_pct ?? 0, code: promo.code });
});

// All routes below require auth
coin.use('*', authMiddleware);

// GET /api/coins/balance
coin.get('/balance', async (c) => {
  const { sub } = c.get('user');
  const u = await c.env.DB.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  return c.json({ coins: u?.coins ?? 0 });
});

// GET /api/coins/history
coin.get('/history', async (c) => {
  const { sub } = c.get('user');
  const result = await c.env.DB.prepare(
    'SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(sub).all();
  return c.json(result.results);
});

// POST /api/coins/purchase — coin purchase with deposit tracking
coin.post('/purchase', async (c) => {
  const { sub } = c.get('user');
  const { plan_id, payment_method, payment_ref, utr_id, gateway_id, promo_code } = await c.req.json();
  const db = c.env.DB;
  const plan = await db.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  const total = plan.coins + (plan.bonus_coins || 0);
  const purchaseId = crypto.randomUUID();
  let gatewayName = payment_method || 'unknown';
  if (gateway_id) {
    try {
      const gw = await db.prepare('SELECT name FROM payment_gateways WHERE id = ?').bind(gateway_id).first<any>();
      if (gw?.name) gatewayName = gw.name;
    } catch {}
  }
  await db.batch([
    db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(total, sub),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'purchase', total, `Purchased ${plan.name} — ${total} coins`, plan_id),
    db.prepare(`INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, gateway_id, gateway_name, payment_ref, utr_id, promo_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')`)
      .bind(purchaseId, sub, plan_id, plan.name, plan.coins, plan.bonus_coins || 0, plan.price, plan.currency || 'USD', payment_method || 'unknown', gateway_id || null, gatewayName, payment_ref || null, utr_id || null, promo_code || null),
  ]);
  const user = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  return c.json({ success: true, coins_added: total, new_balance: user?.coins, purchase_id: purchaseId });
});

// POST /api/coins/withdraw — host withdrawal request
coin.post('/withdraw', async (c) => {
  const { sub } = c.get('user');
  const { coins_requested, method, account_info } = await c.req.json();
  const db = c.env.DB;

  // Check host
  const h = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host account' }, 403);

  // Get settings
  const settings = await db.prepare("SELECT value FROM app_settings WHERE key = 'min_withdrawal_coins'").first<any>();
  const minCoins = parseInt(settings?.value ?? '100');
  if (!coins_requested || coins_requested < minCoins) return c.json({ error: `Minimum withdrawal is ${minCoins} coins` }, 400);

  // Check user has enough coins
  const userRow = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  if (!userRow || userRow.coins < coins_requested) return c.json({ error: 'Insufficient coin balance' }, 400);

  const rateRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'coin_to_usd_rate'").first<any>();
  const rate = parseFloat(rateRow?.value ?? '0.01');
  const usdAmount = coins_requested * rate;
  const withdrawId = crypto.randomUUID();

  await db.batch([
    db.prepare('INSERT INTO withdrawal_requests (id, host_id, coins, amount, payment_method, account_details) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(withdrawId, h.id, coins_requested, usdAmount, method ?? 'bank', account_info ?? ''),
    db.prepare('UPDATE users SET coins = coins - ?, updated_at = unixepoch() WHERE id = ? AND coins >= ?').bind(coins_requested, sub, coins_requested),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'withdrawal', -coins_requested, `Withdrawal request — ${coins_requested} coins`, withdrawId),
  ]);

  const updated = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  return c.json({ success: true, amount_usd: usdAmount.toFixed(2), coins_requested, new_balance: updated?.coins });
});

export default coin;
