import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { Env, JWTPayload } from '../types';

const coin = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// GET /api/coins/plans — public
coin.get('/plans', async (c) => {
  const plans = await c.env.DB.prepare('SELECT * FROM coin_plans WHERE is_active = 1 ORDER BY coins ASC').all();
  return c.json(plans.results);
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

// POST /api/coins/purchase — simulate coin purchase
coin.post('/purchase', async (c) => {
  const { sub } = c.get('user');
  const { plan_id, payment_method } = await c.req.json();
  const db = c.env.DB;
  const plan = await db.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  const total = plan.coins + (plan.bonus_coins || 0);
  await db.batch([
    db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(total, sub),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'purchase', total, `Purchased ${plan.name} — ${total} coins`, plan_id),
  ]);
  const user = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  return c.json({ success: true, coins_added: total, new_balance: user?.coins });
});

// POST /api/coins/withdraw — host withdrawal request
coin.post('/withdraw', async (c) => {
  const { sub } = c.get('user');
  const { coins_requested, method, account_info } = await c.req.json();
  const db = c.env.DB;
  const settings = await db.prepare("SELECT value FROM app_settings WHERE key = 'min_withdrawal_coins'").first<any>();
  const minCoins = parseInt(settings?.value ?? '100');
  if (!coins_requested || coins_requested < minCoins) return c.json({ error: `Minimum withdrawal is ${minCoins} coins` }, 400);
  const h = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host account' }, 403);
  const rateRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'coin_to_usd_rate'").first<any>();
  const shareRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'host_revenue_share'").first<any>();
  const rate = parseFloat(rateRow?.value ?? '0.01');
  const share = parseFloat(shareRow?.value ?? '0.70');
  const usdAmount = coins_requested * rate * share;
  await db.batch([
    db.prepare('INSERT INTO withdrawal_requests (id, host_id, coins, amount, payment_method, account_details) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), h.id, coins_requested, usdAmount, method ?? 'bank', account_info ?? ''),
  ]);
  return c.json({ success: true, amount_usd: usdAmount.toFixed(2), coins_requested });
});

export default coin;
