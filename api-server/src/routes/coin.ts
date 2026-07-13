import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { USD_TO_FOREIGN, currencyForCountry, convertCurrency, convertFromUSD, detectCountryFromRequest } from '../lib/currency';
import { isEmergencyOn, emergencyBlockedBody } from '../lib/emergencyFlags';
import { pushCoinUpdate, notifyUser } from '../lib/realtime';
import type { Env, JWTPayload } from '../types';

const coin = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// Currencies conventionally shown WITHOUT decimals (whole units). Plan prices
// for these read naturally as integers (₹99, ¥499) — showing "99.00" or a
// stray FP tail like 98.9999 looks broken. Everything else → 2 decimals.
const ZERO_DECIMAL_CURRENCIES = new Set(['INR', 'JPY', 'KRW', 'VND', 'IDR', 'HUF', 'CLP', 'PKR', 'LKR', 'NPR', 'BDT']);

function roundForCurrency(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  return ZERO_DECIMAL_CURRENCIES.has((currency || '').toUpperCase())
    ? Math.round(amount)
    : Math.round(amount * 100) / 100;
}

// GET /api/coins/plans — public, but the response is localized to the
// caller's currency when we can detect it. Resolution priority:
//   1. ?currency= query (explicit override — admin tools, testing)
//   2. Authenticated user's currency (set at login from CF-IPCountry)
//   3. Cloudflare's CF-IPCountry header on this request
//   4. INR fallback because the app's default/base economy is India-first
//
// Each plan now carries `price_local` and `currency` alongside the original
// base `price` so the client can display the local amount without doing FX
// itself, AND the authored/base price is preserved for analytics/admin tooling.
coin.get('/plans', async (c) => {
  const plans = await c.env.DB.prepare('SELECT * FROM coin_plans WHERE is_active = 1 ORDER BY coins ASC').all();

  // Resolve currency for this response.
  let currency = 'INR';
  const queryCurrency = c.req.query('currency')?.toUpperCase();
  if (queryCurrency && USD_TO_FOREIGN[queryCurrency]) {
    currency = queryCurrency;
  } else {
    // Try authenticated user (no auth requirement on this route, so verify token if present)
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyToken } = await import('../lib/jwt');
        const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET);
        const u = await c.env.DB.prepare('SELECT currency FROM users WHERE id = ?').bind(payload.sub).first<{ currency: string | null }>();
        if (u?.currency && USD_TO_FOREIGN[u.currency]) {
          currency = u.currency;
        }
      } catch (e: any) {
        // Expected: token expired/invalid → fall through to geo detection.
        // Log unexpected errors (e.g. DB connectivity) so they don't silently vanish.
        const msg = String(e?.message || '');
        if (!msg.includes('expired') && !msg.includes('invalid') && !msg.includes('JWS')) {
          console.warn('[coins/plans] Unexpected error resolving user currency:', e);
        }
      }
    }
    if (currency === 'INR') {
      const country = detectCountryFromRequest(c.req.raw);
      if (country) currency = currencyForCountry(country);
    }
  }

  // FIX #12: prefer cron-refreshed live FX rates (cached in app_settings) over
  // the static fallback table. A missing/old cache simply falls through to the
  // static rates inside convertFromUSD.
  //
  // Load the overrides ALWAYS (even for INR viewers): price_local for an INR
  // viewer needs no conversion, but `price_usd` is still computed for every
  // response — loading live rates here keeps it consistent instead of using
  // the stale static table (₹49 → $0.59 static vs $0.52 live) only on the
  // INR path.
  let fxOverrides: Record<string, number> | null = null;
  try {
    const fxRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'fx_rates_usd'").first<{ value: string }>();
    if (fxRow?.value) fxOverrides = JSON.parse(fxRow.value);
  } catch (e) {
    console.warn('[coins/plans] Failed to load FX overrides, using static rates:', e);
  }

  // Item 6 — regional coin-price cards. A { CURRENCY: multiplier } map applied
  // ON TOP of the FX-converted price for purchasing-power adjustment (e.g. show
  // US/EU users a 1.3× price, SE-Asia 0.8×). Pure FX (multiplier 1) when unset,
  // {}, malformed, or no entry for the viewer's currency. The base ₹ price and
  // price_usd stay unmarked so admin analytics see true authored values.
  let regionalMultiplier = 1;
  try {
    const rmRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'regional_price_multiplier'").first<{ value: string }>();
    if (rmRow?.value) {
      const map = JSON.parse(rmRow.value) as Record<string, number>;
      const m = Number(map?.[currency]);
      if (Number.isFinite(m) && m > 0) regionalMultiplier = m;
    }
  } catch (e) {
    console.warn('[coins/plans] Failed to parse regional_price_multiplier:', e);
  }

  const localized = (plans.results as any[]).map((p) => {
    // Plan prices are authored in the plan's OWN currency (coin_plans.currency,
    // INR for this India-first product; older rows may be 'USD'). Convert from
    // that base to the viewer's currency — NOT assuming USD, which double-
    // converted INR-priced plans (₹99 → ₹8217) for Indian users.
    const planCurrency = (p.currency || 'INR').toUpperCase();
    const planPrice = Number(p.price ?? 0);
    // FX-convert, then apply the regional PPP multiplier for the viewer's currency.
    const priceLocal = roundForCurrency(
      convertCurrency(planPrice, planCurrency, currency, fxOverrides) * regionalMultiplier,
      currency,
    );
    return {
      ...p,
      // Original authored amount + its currency, preserved for admin/analytics.
      price_usd: Math.round(convertCurrency(planPrice, planCurrency, 'USD', fxOverrides) * 100) / 100,
      price_base: planPrice,
      base_currency: planCurrency,
      // What the client should actually show (FX + regional multiplier applied).
      price_local: priceLocal,
      regional_multiplier: regionalMultiplier,
      currency,
    };
  });

  return c.json(localized);
});

// POST /api/coins/apply-promo — validate a promo code (requires auth to prevent brute-force)
coin.post('/apply-promo', authMiddleware, async (c) => {
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

// GET /api/coins/offer — personalized smart-discount offer for the current user
// Auth required (offer depends on the user's lifecycle segment). Drives the
// checkout offer banner. The SAME engine grants the bonus at credit time, so
// what's shown here is exactly what the user receives.
coin.get('/offer', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const { computeSmartOffer } = await import('../lib/smartDiscount');
  const offer = await computeSmartOffer(c.env.DB, sub);
  return c.json(offer);
});

// GET /api/coins/recommendation — smart "best pack for you" based on the user's
// coin burn-rate + balance runway. Drives the "⭐ Best for you" badge + usage
// hint on the checkout screen. Best-effort; disabled by default (admin opt-in).
coin.get('/recommendation', authMiddleware, async (c) => {
  const { sub } = c.get('user');
  const { computeRechargeRecommendation } = await import('../lib/smartRecommend');
  const rec = await computeRechargeRecommendation(c.env.DB, sub);
  return c.json(rec);
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

// POST /api/coins/purchase — coin purchase with payment verification
// SECURITY: payment_ref required for all non-manual methods to prevent free coin abuse
coin.post('/purchase', async (c) => {
  const { sub } = c.get('user');
  const { plan_id, payment_method, payment_ref, utr_id, gateway_id, promo_code } = await c.req.json();
  const db = c.env.DB;

  if (!plan_id) return c.json({ error: 'plan_id is required' }, 400);
  const plan = await db.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);

  const method = payment_method || 'unknown';
  // SECURITY FIX (Critical #7): /api/coins/purchase no longer accepts arbitrary
  // payment_method values. Self-service crediting from this route is the wrong
  // primitive — there is no payment-gateway verification here, so any caller
  // could supply a payment_ref and credit themselves coins.
  //
  // Real flows:
  //   - Manual UPI / QR  → POST /api/coins/manual-deposit (creates `pending`
  //                        purchase, admin approves via /api/admin/deposits)
  //   - Online gateways  → POST /api/payment/* (initiate) and the verified
  //                        webhook (Stripe / Razorpay / PhonePe) credits coins.
  //   - Admin grant      → /api/admin/* with admin auth.
  //
  // Allowlist is intentionally empty: there is no payment_method that should
  // be accepted here. Kept the route mounted to return a clear 400 instead of
  // 404 so older clients get an actionable error message.
  const PURCHASE_PAYMENT_METHOD_ALLOWLIST: string[] = [];
  if (!PURCHASE_PAYMENT_METHOD_ALLOWLIST.includes(method)) {
    return c.json(
      { error: 'Use /api/payment/* for online payments or /api/coins/manual-deposit for UPI/QR' },
      400
    );
  }
  // Require payment_ref for all payment methods (prevents free coin abuse)
  if (!payment_ref) {
    return c.json({ error: 'payment_ref is required to verify payment' }, 400);
  }
  // Prevent duplicate payment processing
  if (payment_ref) {
    const dup = await db.prepare(
      "SELECT id FROM coin_purchases WHERE payment_ref = ? AND status = 'success' LIMIT 1"
    ).bind(String(payment_ref)).first<any>();
    if (dup) return c.json({ error: 'This payment has already been processed' }, 409);
  }

  // Bug fix: look up promo code and apply bonus_coins if valid
  let promoBonus = 0;
  let promoRow: any = null;
  if (promo_code) {
    promoRow = await db.prepare(
      'SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1'
    ).bind(promo_code.trim()).first<any>();
    if (promoRow) {
      const expired = promoRow.expires_at && new Date(promoRow.expires_at * 1000) < new Date();
      const maxed = promoRow.max_uses && promoRow.used_count >= promoRow.max_uses;
      if (!expired && !maxed && promoRow.type === 'bonus') {
        promoBonus = promoRow.bonus_coins ?? 0;
      }
    }
  }

  const total = plan.coins + (plan.bonus_coins || 0) + promoBonus;
  const purchaseId = crypto.randomUUID();
  let gatewayName = payment_method || 'unknown';
  if (gateway_id) {
    try {
      const gw = await db.prepare('SELECT name FROM payment_gateways WHERE id = ?').bind(gateway_id).first<any>();
      if (gw?.name) gatewayName = gw.name;
    } catch {}
  }
  const batchOps: any[] = [
    db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(total, sub),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), sub, 'purchase', total, `Purchased ${plan.name} — ${total} coins`, plan_id),
    db.prepare(`INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, gateway_id, gateway_name, payment_ref, utr_id, promo_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')`)
      .bind(purchaseId, sub, plan_id, plan.name, plan.coins, (plan.bonus_coins || 0) + promoBonus, plan.price, plan.currency || 'INR', payment_method || 'unknown', gateway_id || null, gatewayName, payment_ref || null, utr_id || null, promo_code || null),
  ];
  // Bug fix: increment promo used_count so max_uses limit works correctly
  if (promoRow) {
    batchOps.push(
      db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?').bind(promoRow.id)
    );
  }
  await db.batch(batchOps);
  const user = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  return c.json({ success: true, coins_added: total, new_balance: user?.coins, purchase_id: purchaseId });
});

// POST /api/coins/manual-deposit — user submits manual UPI/QR payment, creates pending deposit
coin.post('/manual-deposit', async (c) => {
  const { sub } = c.get('user');
  const { plan_id, utr_id, screenshot_url, qr_code_id, promo_code } = await c.req.json();
  const db = c.env.DB;
  if (!plan_id) return c.json({ error: 'plan_id is required' }, 400);
  if (!utr_id || !String(utr_id).trim()) return c.json({ error: 'UTR / transaction reference is required' }, 400);
  const plan = await db.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  // Duplicate UTR check (advisory). The unique partial index added in
  // migration 0024 (idx_coin_purchases_manual_utr) is what actually closes
  // the race window — two concurrent calls with the same UTR will both pass
  // this SELECT but only one of them will succeed at INSERT time.
  const existing = await db.prepare("SELECT id FROM coin_purchases WHERE utr_id = ? AND payment_method = 'manual'").bind(String(utr_id).trim()).first<any>();
  if (existing) return c.json({ error: 'This UTR / transaction ID has already been submitted' }, 409);

  let promoBonus = 0;
  if (promo_code) {
    const promo = await db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1').bind(promo_code.trim()).first<any>();
    if (promo && promo.type === 'bonus' && !(promo.expires_at && new Date(promo.expires_at * 1000) < new Date()) && !(promo.max_uses && promo.used_count >= promo.max_uses)) {
      promoBonus = promo.bonus_coins ?? 0;
    }
  }

  let qrName = 'Manual UPI';
  if (qr_code_id) {
    const qr = await db.prepare('SELECT name FROM manual_qr_codes WHERE id = ?').bind(qr_code_id).first<any>();
    if (qr?.name) qrName = qr.name;
  }

  const purchaseId = crypto.randomUUID();
  // RACE FIX: previously this was a bare INSERT after the existing-UTR
  // SELECT above, but the SELECT/INSERT pair is TOCTOU — two concurrent
  // submissions with the same UTR could both pass the SELECT and both
  // INSERT a `pending` row. Once admin approved both, the user got 2×
  // the coin credit.
  //
  // Migration 0024 adds a partial unique index on (utr_id) where
  // payment_method='manual', which makes the second INSERT raise a
  // SQLite UNIQUE constraint error. Catch it here and convert to a clean
  // 409 response so the user UI shows the right message instead of a
  // generic 500.
  try {
    await db.prepare(
      `INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, gateway_id, gateway_name, utr_id, promo_code, status, screenshot_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, 'pending', ?)`
    ).bind(purchaseId, sub, plan_id, plan.name, plan.coins, (plan.bonus_coins || 0) + promoBonus, plan.price, plan.currency || 'INR', qr_code_id || null, qrName, String(utr_id).trim(), promo_code || null, screenshot_url || null).run();
  } catch (e: any) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint')) {
      return c.json({ error: 'This UTR / transaction ID has already been submitted' }, 409);
    }
    console.error('[/manual-deposit] insert failed:', e);
    return c.json({ error: 'Could not submit deposit. Please try again.' }, 500);
  }

  // SECURITY FIX (Critical #8): Auto-approve removed. Even with a small amount
  // threshold, trusting any client-supplied UTR meant a malicious user could
  // get coins by submitting a fake/random transaction reference. All manual
  // deposits MUST go through admin verification via /api/admin/deposits.
  //
  // The `auto_approve_manual` and `auto_approve_manual_max_amount` settings
  // are intentionally ignored here. They can stay in app_settings (other code
  // may surface them in the admin UI) but they no longer credit coins.

  // NOTIFICATION: Immediately confirm to the user that their payment was
  // received and is under review — so recharge always produces feedback
  // (in-app notification + FCM push), not just a silent success response.
  const totalCoins = plan.coins + (plan.bonus_coins || 0) + promoBonus;
  c.executionCtx?.waitUntil?.(notifyUser(
    c.env, sub, 'Payment received 🕐',
    `Your payment for ${totalCoins} coins is under review. Coins will be added to your wallet once verified (usually within a few minutes).`,
    'deposit',
    { data: { status: 'pending', purchase_id: purchaseId } },
  ));

  return c.json({
    success: true,
    purchase_id: purchaseId,
    status: 'pending',
    message: 'Payment submitted for admin review. Coins will be added once approved.',
  });
});

// POST /api/coins/withdraw — host withdrawal request
// Coins are frozen (not deducted) until admin approves.
// Admin approve → deduct + transfer. Admin reject → unfreeze.
coin.post('/withdraw', async (c) => {
  const { sub } = c.get('user');
  const { coins_requested, method, account_info } = await c.req.json();
  const db = c.env.DB;

  const h = await db.prepare('SELECT id FROM hosts WHERE user_id = ?').bind(sub).first<any>();
  if (!h) return c.json({ error: 'Not a host account' }, 403);

  if (!coins_requested || isNaN(Number(coins_requested)) || Number(coins_requested) <= 0) {
    return c.json({ error: 'Invalid coins amount' }, 400);
  }
  const coinsReq = Math.floor(Number(coins_requested));

  // Emergency kill switch — admin can freeze all payouts from the dashboard
  // (Settings → Emergency Switches). Returns 503 so mobile clients treat it
  // as a temporary outage, not a permanent error. Fails OPEN on DB blip.
  if (await isEmergencyOn(db, 'payouts_frozen')) {
    return c.json(emergencyBlockedBody('payouts_frozen'), 503);
  }

  const settings = await db.prepare("SELECT value FROM app_settings WHERE key = 'min_withdrawal_coins'").first<any>();
  const minCoins = parseInt(settings?.value ?? '100');
  if (coinsReq < minCoins) return c.json({ error: `Minimum withdrawal is ${minCoins} coins` }, 400);

  const rateRow = await db.prepare("SELECT value FROM app_settings WHERE key = 'coin_to_usd_rate'").first<any>();
  let rate = parseFloat(rateRow?.value ?? '');
  if (!Number.isFinite(rate) || rate <= 0) {
    // SAFETY: never fall back to the legacy '0.01' (≈ ₹0.83/coin at ₹83/USD)
    // — that is ~16× the production payout rate and would massively overpay.
    // Default to the RECOMMENDED payout ₹0.085/coin ÷ 83 ≈ 0.001024 USD/coin
    // (host keeps ~30% of user spend — competitive with FRND/RealU-class apps).
    // NOTE: this fallback only applies when coin_to_usd_rate is UNSET; on an
    // existing deployment the admin-set coin_value_inr drives the live rate, so
    // to actually raise payout to ₹0.085 set coin_value_inr = 0.085 in Settings.
    rate = 0.001024;
  }
  const usdAmount = coinsReq * rate;

  // Store the payout in the HOST'S local currency (+ currency code) instead of
  // raw USD. This matches what the host sees in their wallet and tells the
  // admin exactly how much to pay in which currency. Falls back to the host's
  // country currency, then the platform default INR. Uses the same static FX
  // table the client wallet uses, so the stored figure == the displayed figure.
  const hostAcc = await db
    .prepare('SELECT currency, country FROM users WHERE id = ?')
    .bind(sub)
    .first<{ currency: string | null; country: string | null }>();
  const payoutCurrency = (hostAcc?.currency && USD_TO_FOREIGN[hostAcc.currency])
    ? hostAcc.currency
    : currencyForCountry(hostAcc?.country);
  const localAmount = convertFromUSD(usdAmount, payoutCurrency);
  const withdrawId = crypto.randomUUID();

  // RACE FIX (concurrent withdrawal → 2× payout):
  //
  // The previous code did three separate operations:
  //   1. SELECT user's coins
  //   2. SELECT existing pending withdrawal
  //   3. db.batch([ INSERT withdrawal_requests, UPDATE users, INSERT tx ])
  //
  // Two concurrent /withdraw requests from the same host could both pass
  // steps 1 and 2 (TOCTOU). In step 3 both INSERTs into withdrawal_requests
  // succeed unconditionally, but only ONE conditional UPDATE actually
  // deducts coins (the second sees `coins < coinsReq` and silently does
  // nothing because D1 batches do NOT abort on a 0-row UPDATE). Net
  // outcome: TWO pending withdrawal_requests rows, ONE coin debit, TWO
  // coin_transactions ledger entries. When the admin approves both, the
  // host receives 2× the payout.
  //
  // Fix is in two layered guards:
  //   (a) The INSERT into withdrawal_requests is now an INSERT…SELECT…
  //       WHERE NOT EXISTS / EXISTS, executed as a single SQLite statement.
  //       Either the row goes in (changes === 1) or no row matches and
  //       changes === 0. SQLite serializes writes per-database, so two
  //       concurrent INSERT…SELECT statements cannot both succeed for the
  //       same host_id.
  //   (b) The follow-up UPDATE keeps its `WHERE coins >= ?` guard. If a
  //       different transaction (e.g. a call ending and charging coins)
  //       drains the host's balance between (a) and (b), the UPDATE
  //       returns 0 rows changed and we DELETE the just-inserted
  //       withdrawal_requests row — leaving the system in a clean state.
  const insertResult = await db.prepare(
    `INSERT INTO withdrawal_requests
       (id, host_id, coins, amount, currency, payment_method, account_details, status)
     SELECT ?1, ?2, ?3, ?4, ?8, ?5, ?6, 'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM withdrawal_requests WHERE host_id = ?2 AND status = 'pending'
     )
     AND EXISTS (
       SELECT 1 FROM users WHERE id = ?7 AND (coins - COALESCE(coins_held, 0)) >= ?3
     )`
  ).bind(
    withdrawId,
    h.id,
    coinsReq,
    localAmount,
    method ?? 'bank',
    account_info ?? '',
    sub,
    payoutCurrency
  ).run();

  if (!insertResult.meta?.changes) {
    // Conditional INSERT was a no-op. Disambiguate the reason for the user.
    const pending = await db.prepare(
      "SELECT 1 as ok FROM withdrawal_requests WHERE host_id = ? AND status = 'pending' LIMIT 1"
    ).bind(h.id).first<{ ok: number }>();
    if (pending) {
      return c.json(
        { error: 'You already have a pending withdrawal request. Please wait for it to be processed.' },
        409
      );
    }
    return c.json({ error: 'Insufficient coin balance' }, 400);
  }

  // Atomic debit. If this fails the request body racing with us drained the
  // wallet — roll back the withdrawal_requests INSERT so we don't leak a
  // ghost pending row (which would block the host from withdrawing again
  // until an admin manually intervenes).
  // Debit guarded on SPENDABLE balance (coins - coins_held). coins_held holds
  // both active-call reservations AND referral payout holds, so held referral
  // rewards are correctly excluded from withdrawal until their hold is released.
  const debit = await db.prepare(
    'UPDATE users SET coins = coins - ?, updated_at = unixepoch() WHERE id = ? AND (coins - COALESCE(coins_held, 0)) >= ?'
  ).bind(coinsReq, sub, coinsReq).run();

  if (!debit.meta?.changes) {
    try {
      await db.prepare('DELETE FROM withdrawal_requests WHERE id = ?').bind(withdrawId).run();
    } catch (e) {
      console.warn('[/withdraw] failed to roll back withdrawal_requests row after debit race:', e);
    }
    return c.json({ error: 'Insufficient coin balance' }, 400);
  }

  // Bookkeeping ledger entry — money has already moved at this point so a
  // failure here is non-fatal for the user's balance. We still log loudly.
  try {
    await db.prepare(
      'INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      sub,
      'withdrawal_pending',
      -coinsReq,
      `Withdrawal request frozen — ${coinsReq} coins (pending admin approval)`,
      withdrawId
    ).run();
  } catch (e) {
    console.warn('[/withdraw] failed to write coin_transactions row (state still consistent):', e);
  }

  const updated = await db.prepare('SELECT coins FROM users WHERE id = ?').bind(sub).first<any>();
  // Real-time: confirm the frozen balance + send a "withdrawal requested" note.
  c.executionCtx?.waitUntil?.(pushCoinUpdate(c.env, sub, -coinsReq));
  c.executionCtx?.waitUntil?.(notifyUser(
    c.env, sub, '💸 Withdrawal Requested',
    `Got it! Your request to withdraw ${coinsReq} coins is in. We're reviewing it now and your payout will be on its way soon. ✅`,
    'payout',
  ));
  return c.json({
    success: true,
    amount_usd: usdAmount.toFixed(2),
    coins_requested: coinsReq,
    new_balance: updated?.coins,
    message: 'Withdrawal request submitted. Coins frozen pending admin approval.',
    withdrawal_id: withdrawId,
  });
});

export default coin;
