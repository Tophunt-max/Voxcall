import { Hono } from 'hono';
import type { Env, JWTPayload } from '../types';
import { authMiddleware } from '../middleware/auth';
import { timingSafeEqual } from '../lib/hash';
import {
  verifyRazorpaySignature,
  verifyStripeSignature,
  verifyPhonePeXVerify,
  verifyPhonePeAuthorization,
  verifyPaytmChecksum,
} from '../lib/gatewayVerify';

type Variables = { user: JWTPayload };

const payment = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Promo eligibility (pure, unit-tested) ────────────────────────────────────
// Single source of truth for "what does this promo grant RIGHT NOW", enforcing
// active flag + expiry + usage cap. Extracted so /initiate, and any future
// pricing path, can reuse identical rules — and so the rules are testable in
// isolation (see test/promo.test.ts). expires_at is a unix-seconds timestamp.
export interface PromoRow {
  type?: string;
  bonus_coins?: number | null;
  discount_pct?: number | null;
  max_uses?: number | null;
  used_count?: number | null;
  expires_at?: number | null;
  active?: number | null;
}

export function evaluatePromo(
  promo: PromoRow | null | undefined,
  planPrice: number,
  now: number = Math.floor(Date.now() / 1000),
): { bonus: number; discount: number } {
  if (!promo) return { bonus: 0, discount: 0 };
  if (promo.active === 0) return { bonus: 0, discount: 0 };
  const expired = promo.expires_at != null && promo.expires_at < now;
  const maxed = promo.max_uses != null && (promo.used_count ?? 0) >= promo.max_uses;
  if (expired || maxed) return { bonus: 0, discount: 0 };
  if (promo.type === 'bonus') return { bonus: promo.bonus_coins ?? 0, discount: 0 };
  if (promo.type === 'percent') {
    return { bonus: 0, discount: Math.round((planPrice * (promo.discount_pct ?? 0)) / 100) };
  }
  return { bonus: 0, discount: 0 };
}

// ─── Promo input validation (pure, unit-tested) ───────────────────────────────
// Guards the admin promo-code create/update endpoints. Without this an admin
// could persist nonsensical promos that flow straight into the money path:
//   - discount_pct: 500  → a "500% off" code (price clamps to 0 = free coins)
//   - bonus_coins: -100  → a code that DEDUCTS coins on redemption
//   - max_uses: 0 / -5   → unredeemable or undefined-behaviour caps
// On create we additionally require `code` and the value matching the type.
// On update (partial) we only range-check whatever fields are present.
export interface PromoInput {
  code?: unknown;
  type?: unknown;
  discount_pct?: unknown;
  bonus_coins?: unknown;
  max_uses?: unknown;
  expires_at?: unknown;
}

export function validatePromoInput(
  input: PromoInput,
  opts: { create?: boolean } = {},
): { ok: true } | { ok: false; error: string } {
  const create = opts.create === true;

  if (input.code !== undefined) {
    if (typeof input.code !== 'string' || !input.code.trim()) {
      return { ok: false, error: 'code must be a non-empty string' };
    }
    if (input.code.trim().length > 40) {
      return { ok: false, error: 'code must be 40 characters or fewer' };
    }
  } else if (create) {
    return { ok: false, error: 'code is required' };
  }

  let type = input.type;
  if (type === undefined && create) type = 'percent';
  if (type !== undefined && type !== 'percent' && type !== 'bonus') {
    return { ok: false, error: "type must be 'percent' or 'bonus'" };
  }

  if (input.discount_pct !== undefined && input.discount_pct !== null) {
    const pct = Number(input.discount_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: 'discount_pct must be a number between 1 and 100' };
    }
  }

  if (input.bonus_coins !== undefined && input.bonus_coins !== null) {
    const bonus = Number(input.bonus_coins);
    if (!Number.isInteger(bonus) || bonus <= 0 || bonus > 10_000_000) {
      return { ok: false, error: 'bonus_coins must be a positive integer' };
    }
  }

  if (input.max_uses !== undefined && input.max_uses !== null) {
    const mu = Number(input.max_uses);
    if (!Number.isInteger(mu) || mu <= 0) {
      return { ok: false, error: 'max_uses must be a positive integer or null (unlimited)' };
    }
  }

  if (input.expires_at !== undefined && input.expires_at !== null) {
    const exp = Number(input.expires_at);
    if (!Number.isFinite(exp) || exp <= 0) {
      return { ok: false, error: 'expires_at must be a positive unix timestamp (seconds) or null' };
    }
  }

  if (create) {
    if (type === 'percent' && (input.discount_pct === undefined || input.discount_pct === null)) {
      return { ok: false, error: 'discount_pct is required for a percent promo' };
    }
    if (type === 'bonus' && (input.bonus_coins === undefined || input.bonus_coins === null)) {
      return { ok: false, error: 'bonus_coins is required for a bonus promo' };
    }
  }

  return { ok: true };
}

// ─── Shared: Approve a pending coin_purchase and credit coins to user ──────────
//
// Promo enforcement (FIX #2): a promo's bonus is baked into coin_purchases.bonus_coins
// at creation time, but the live flows (manual-deposit, gateway initiate) never
// advanced promo_codes.used_count — so a capped `max_uses` promo could be
// redeemed unlimited times. We now consume one promo use ATOMICALLY at credit
// time (the single chokepoint all real credits pass through), and if the quota
// is already exhausted by the time this deposit is approved, we strip the promo
// bonus from the credited total instead of granting coins beyond the limit.
async function approveDeposit(db: D1Database, purchaseId: string, source: string, note?: string): Promise<{ ok: boolean; already?: boolean; notFound?: boolean; coins?: number }> {
  const purchase = await db.prepare('SELECT id, user_id, coins, bonus_coins, promo_code, status FROM coin_purchases WHERE id = ?').bind(purchaseId).first<any>();
  if (!purchase) return { ok: false, notFound: true };
  if (purchase.status === 'success') return { ok: true, already: true };
  let totalCoins = (purchase.coins || 0) + (purchase.bonus_coins || 0);
  // Atomic CAS: only update if status is still not 'success' — prevents double-credit on concurrent webhook retries.
  // The winner of this CAS is the ONLY caller that proceeds to credit + promo consumption below.
  const casUpdate = await db.prepare(
    "UPDATE coin_purchases SET status = 'success', payment_method = COALESCE(payment_method, ?), updated_at = unixepoch() WHERE id = ? AND status != 'success'"
  ).bind(source, purchaseId).run();
  if (!casUpdate.meta?.changes || casUpdate.meta.changes === 0) {
    // Another webhook already processed this purchase
    return { ok: true, already: true };
  }

  // FIX #2: consume one promo use atomically (only succeeds while quota remains).
  if (purchase.promo_code) {
    try {
      const promo = await db.prepare(
        'SELECT id, type, bonus_coins, max_uses, used_count FROM promo_codes WHERE UPPER(code) = UPPER(?)'
      ).bind(String(purchase.promo_code).trim()).first<any>();
      if (promo) {
        const inc = await db.prepare(
          'UPDATE promo_codes SET used_count = used_count + 1, updated_at = unixepoch() WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)'
        ).bind(promo.id).run();
        if (!inc.meta?.changes && promo.type === 'bonus' && (promo.bonus_coins || 0) > 0) {
          // Quota exhausted before this deposit was credited — do not grant the
          // promo bonus. Floor at the base coins so we never go below what was paid for.
          totalCoins = Math.max(purchase.coins || 0, totalCoins - (promo.bonus_coins || 0));
        }
      }
    } catch (e) {
      console.warn('[approveDeposit] promo usage enforcement failed (crediting base):', e);
    }
  }

  await db.batch([
    db.prepare('UPDATE users SET coins = coins + ?, updated_at = unixepoch() WHERE id = ?').bind(totalCoins, purchase.user_id),
    db.prepare('INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id) VALUES (?, ?, ?, ?, ?, ?)').bind(
      crypto.randomUUID(), purchase.user_id, 'purchase', totalCoins, note || `Auto-matched via ${source}`, purchaseId
    ),
  ]);
  return { ok: true, coins: totalCoins };
}

// ─── Find purchase by gateway order ID ────────────────────────────────────────
async function findPurchaseByOrderId(db: D1Database, gatewayOrderId: string): Promise<any | null> {
  return db.prepare("SELECT id, status FROM coin_purchases WHERE gateway_order_id = ? ORDER BY created_at DESC LIMIT 1").bind(gatewayOrderId).first<any>();
}

// ─── POST /api/payment/webhook/razorpay ──────────────────────────────────────
// Configure in Razorpay Dashboard → Settings → Webhooks → Secret
// Webhook URL: https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook/razorpay
payment.post('/webhook/razorpay', async (c) => {
  try {
    const body = await c.req.text();
    const sig = c.req.header('X-Razorpay-Signature') || '';
    // SECURITY FIX: Reject webhooks entirely when no secret is configured.
    // Previously, missing secret silently bypassed verification, allowing forged webhooks.
    const secret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'razorpay_webhook_secret'").first<any>();
    if (!secret?.value) {
      console.error('[Webhook] Razorpay webhook secret not configured — rejecting');
      return c.json({ error: 'Webhook secret not configured' }, 500);
    }
    if (!sig) return c.json({ error: 'Missing signature' }, 401);
    // FIX #4: constant-time signature comparison (see lib/gatewayVerify).
    if (!(await verifyRazorpaySignature(body, sig, secret.value))) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
    const payload = JSON.parse(body);
    const event = payload.event as string;
    if (!event.startsWith('payment')) return c.json({ ok: true });
    const paymentEntity = payload.payload?.payment?.entity;
    if (!paymentEntity) return c.json({ ok: true });
    const orderId = paymentEntity.order_id as string;
    const razorpayPaymentId = paymentEntity.id as string;
    const status = paymentEntity.status as string;
    if (status !== 'captured') return c.json({ ok: true });
    // Find purchase by gateway_order_id or payment_ref
    let purchase = orderId ? await findPurchaseByOrderId(c.env.DB, orderId) : null;
    if (!purchase && razorpayPaymentId) {
      purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? LIMIT 1").bind(razorpayPaymentId).first<any>();
    }
    // Also check notes.purchase_id embedded at order creation
    const notePurchaseId = paymentEntity.notes?.purchase_id || paymentEntity.notes?.voxlink_purchase_id;
    if (!purchase && notePurchaseId) {
      purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE id = ? LIMIT 1").bind(notePurchaseId).first<any>();
    }
    if (!purchase) return c.json({ ok: true, message: 'No matching purchase found' });
    const result = await approveDeposit(c.env.DB, purchase.id, 'razorpay', `Razorpay payment ${razorpayPaymentId} captured`);
    return c.json({ ok: result.ok, already: result.already, coins: result.coins });
  } catch (e: any) {
    console.error('[Webhook] Razorpay handler error:', e);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ─── POST /api/payment/webhook/stripe ────────────────────────────────────────
// Webhook URL: https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook/stripe
// Events to enable: checkout.session.completed, payment_intent.succeeded
payment.post('/webhook/stripe', async (c) => {
  try {
    const body = await c.req.text();
    const sig = c.req.header('Stripe-Signature') || '';
    // SECURITY FIX: Reject webhook entirely if no secret configured or no signature provided.
    // Previous behaviour silently accepted unsigned webhooks → attackers could forge "success" events.
    const secret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'stripe_webhook_secret'").first<any>();
    if (!secret?.value) {
      console.error('[Webhook] Stripe webhook secret not configured — rejecting');
      return c.json({ error: 'Webhook secret not configured' }, 500);
    }
    if (!sig) return c.json({ error: 'Missing signature' }, 401);
    // FIX #4 / #31: constant-time HMAC + replay window enforced in lib/gatewayVerify.
    if (!(await verifyStripeSignature(body, sig, secret.value, Math.floor(Date.now() / 1000)))) {
      return c.json({ error: 'Invalid or stale signature' }, 401);
    }
    const payload = JSON.parse(body);
    const event = payload.type as string;
    if (event !== 'checkout.session.completed' && event !== 'payment_intent.succeeded') return c.json({ ok: true });
    const obj = payload.data?.object;
    if (!obj) return c.json({ ok: true });
    const purchaseId = obj.metadata?.purchase_id || obj.metadata?.voxlink_purchase_id;
    const stripeId = obj.id;
    let purchase: any = null;
    if (purchaseId) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE id = ? LIMIT 1").bind(purchaseId).first<any>();
    if (!purchase) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? LIMIT 1").bind(stripeId).first<any>();
    if (!purchase) return c.json({ ok: true, message: 'No matching purchase found' });
    const result = await approveDeposit(c.env.DB, purchase.id, 'stripe', `Stripe ${event} — ${stripeId}`);
    return c.json({ ok: result.ok, already: result.already, coins: result.coins });
  } catch (e: any) {
    console.error('[Webhook] Stripe handler error:', e);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ─── POST /api/payment/webhook/phonepe ───────────────────────────────────────
// Supports BOTH PhonePe schemes (depends on your integration version):
//   • Legacy S2S callback — body `{ response: "<base64>" }`, header
//       `X-VERIFY: sha256(base64Response + saltKey)###saltIndex`
//     Configure the salt key as app_settings `phonepe_salt_key`
//     (or legacy `phonepe_webhook_secret`).
//   • Standard Checkout webhook — JSON body, header
//       `Authorization: sha256(username:password)`
//     Configure `phonepe_webhook_username` + `phonepe_webhook_password`.
// FIX #3/#4: correct provider schemes + constant-time comparison (lib/gatewayVerify).
payment.post('/webhook/phonepe', async (c) => {
  try {
    const body = await c.req.text();
    const xVerify = c.req.header('X-Verify') || c.req.header('X-VERIFY') || '';
    const authHeader = c.req.header('Authorization') || '';

    const saltRow = await c.env.DB.prepare(
      "SELECT value FROM app_settings WHERE key IN ('phonepe_salt_key','phonepe_webhook_secret') ORDER BY key = 'phonepe_salt_key' DESC LIMIT 1"
    ).first<any>();
    const userRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'phonepe_webhook_username'").first<any>();
    const passRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'phonepe_webhook_password'").first<any>();

    let verified = false;
    let payload: any = null;

    if (authHeader && userRow?.value && passRow?.value) {
      // Standard Checkout webhook — Authorization = sha256(username:password)
      verified = await verifyPhonePeAuthorization(authHeader, userRow.value, passRow.value);
      if (verified) payload = JSON.parse(body);
    } else if (xVerify && saltRow?.value) {
      // Legacy S2S — verify sha256(base64Response + saltKey).
      const outer = JSON.parse(body);
      const base64Response: string = outer.response || '';
      if (!base64Response) return c.json({ error: 'Missing response payload' }, 400);
      verified = await verifyPhonePeXVerify(base64Response, xVerify, saltRow.value);
      if (verified) payload = JSON.parse(atob(base64Response));
    } else {
      console.error('[Webhook] PhonePe verification credentials not configured — rejecting');
      return c.json({ error: 'Webhook verification not configured' }, 500);
    }

    if (!verified || !payload) return c.json({ error: 'Invalid signature' }, 401);

    // Success indicator + identifiers across both schemes.
    const data = payload.data || payload.payload || {};
    const txnStatus = data.state || data.code || payload.code || payload.state;
    const isSuccess = txnStatus === 'PAYMENT_SUCCESS' || txnStatus === 'SUCCESS' || txnStatus === 'COMPLETED';
    if (!isSuccess) return c.json({ ok: true });
    const merchantTxnId = data.merchantTransactionId || data.merchantOrderId || data.orderId;
    const utr = data.transactionId || data.utr;
    let purchase: any = null;
    if (merchantTxnId) purchase = await findPurchaseByOrderId(c.env.DB, merchantTxnId);
    if (!purchase && merchantTxnId) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? OR utr_id = ? LIMIT 1").bind(merchantTxnId, merchantTxnId).first<any>();
    if (!purchase && utr) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE utr_id = ? LIMIT 1").bind(utr).first<any>();
    if (!purchase) return c.json({ ok: true, message: 'No matching purchase found' });
    const result = await approveDeposit(c.env.DB, purchase.id, 'phonepe', `PhonePe payment ${utr || merchantTxnId} success`);
    return c.json({ ok: result.ok, already: result.already, coins: result.coins });
  } catch (e: any) {
    console.error('[Webhook] PhonePe handler error:', e);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ─── POST /api/payment/webhook/paytm ─────────────────────────────────────────
// FIX #3: Paytm checksum verification (AES-128-CBC + SHA256) now lives in
// lib/gatewayVerify and matches Paytm's documented PaytmChecksum algorithm.
// Accepts both JSON and form-encoded callbacks.
payment.post('/webhook/paytm', async (c) => {
  try {
    const raw = await c.req.text();
    let payload: Record<string, any>;
    const contentType = c.req.header('Content-Type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      payload = Object.fromEntries(new URLSearchParams(raw));
    } else {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = Object.fromEntries(new URLSearchParams(raw));
      }
    }

    // SECURITY FIX: Always require both the merchant key AND a CHECKSUMHASH.
    const merchantKeyRow = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'paytm_merchant_key'").first<any>();
    if (!merchantKeyRow?.value) {
      console.error('[Webhook] Paytm merchant key not configured — rejecting');
      return c.json({ error: 'Paytm merchant key not configured' }, 500);
    }
    const checksum = payload['CHECKSUMHASH'];
    if (!checksum) return c.json({ error: 'Missing CHECKSUMHASH' }, 401);
    // FIX #4: comparison is constant-time inside verifyPaytmChecksum.
    const valid = await verifyPaytmChecksum(payload, merchantKeyRow.value, String(checksum));
    if (!valid) return c.json({ error: 'Invalid checksum' }, 401);

    const orderId = payload.ORDERID as string;
    const txnStatus = payload.STATUS as string;
    const txnId = payload.TXNID as string;
    if (txnStatus !== 'TXN_SUCCESS') return c.json({ ok: true });
    let purchase: any = null;
    if (orderId) purchase = await findPurchaseByOrderId(c.env.DB, orderId);
    if (!purchase && txnId) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? LIMIT 1").bind(txnId).first<any>();
    if (!purchase) return c.json({ ok: true, message: 'No matching purchase found' });
    const result = await approveDeposit(c.env.DB, purchase.id, 'paytm', `Paytm TXN_SUCCESS — ${txnId}`);
    return c.json({ ok: result.ok, already: result.already, coins: result.coins });
  } catch (e: any) {
    console.error('[Webhook] Paytm handler error:', e);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ─── POST /api/payment/webhook/generic ───────────────────────────────────────
// Generic webhook: POST with JSON body { purchase_id, status: 'success', secret }
// Simple secret in body — for custom gateways
payment.post('/webhook/generic', async (c) => {
  try {
    const { purchase_id, status, secret, note } = await c.req.json() as any;
    if (status !== 'success') return c.json({ ok: true });
    // SECURITY FIX: Always require a configured secret AND a matching client-supplied secret.
    // Previously, when no secret was configured, ANY caller could credit coins by knowing a purchase_id.
    const storedSecret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'generic_webhook_secret'").first<any>();
    if (!storedSecret?.value) {
      console.error('[Webhook] Generic webhook secret not configured — rejecting');
      return c.json({ error: 'Generic webhook secret not configured' }, 500);
    }
    // FIX #4: constant-time secret comparison to avoid leaking the secret via timing.
    if (!secret || !timingSafeEqual(String(secret), String(storedSecret.value))) {
      return c.json({ error: 'Invalid secret' }, 401);
    }
    if (!purchase_id) return c.json({ error: 'purchase_id required' }, 400);
    const result = await approveDeposit(c.env.DB, purchase_id, 'generic', note || 'Auto-matched via generic webhook');
    return c.json({ ok: result.ok, already: result.already, coins: result.coins, notFound: result.notFound });
  } catch (e: any) {
    console.error('[Webhook] Generic handler error:', e);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ─── POST /api/payment/initiate ──────────────────────────────────────────────
// Creates a pending coin_purchase and returns gateway order details
// Called by user app before redirecting to payment gateway
// Uses authMiddleware so token_invalidated_at is checked (logout/password-change revocation)
payment.post('/initiate', authMiddleware, async (c) => {
  const userId = c.get('user').sub;
  const { plan_id, gateway_id, promo_code } = await c.req.json() as any;
  if (!plan_id) return c.json({ error: 'plan_id required' }, 400);
  const plan = await c.env.DB.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  const gateway = gateway_id ? await c.env.DB.prepare('SELECT * FROM payment_gateways WHERE id = ? AND is_active = 1').bind(gateway_id).first<any>() : null;
  let promoBonus = 0, promoDiscount = 0;
  if (promo_code) {
    // FIX: enforce active + expiry + usage cap here too (via the shared
    // evaluatePromo helper). Previously /initiate only checked `active = 1`,
    // so an EXPIRED or fully-redeemed promo still granted its bonus/discount
    // through the gateway checkout flow — inconsistent with /api/coins/*.
    const promo = await c.env.DB.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1').bind(promo_code.trim()).first<PromoRow>();
    ({ bonus: promoBonus, discount: promoDiscount } = evaluatePromo(promo, plan.price));
  }
  const purchaseId = crypto.randomUUID();
  const finalPrice = Math.max(0, plan.price - promoDiscount);
  await c.env.DB.prepare(
    `INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, gateway_id, gateway_name, promo_code, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(purchaseId, userId, plan_id, plan.name, plan.coins, (plan.bonus_coins || 0) + promoBonus, finalPrice, plan.currency || 'USD', gateway?.type || 'web', gateway?.id || null, gateway?.name || 'Web', promo_code || null).run();

  let redirectUrl: string | null = null;
  if (gateway?.redirect_url) {
    const params = new URLSearchParams({ plan_id, purchase_id: purchaseId, amount: String(finalPrice), coins: String(plan.coins + (plan.bonus_coins || 0) + promoBonus), currency: plan.currency || 'USD' });
    redirectUrl = `${gateway.redirect_url}?${params.toString()}`;
  }
  return c.json({ purchase_id: purchaseId, redirect_url: redirectUrl, amount: finalPrice, coins: plan.coins + (plan.bonus_coins || 0) + promoBonus, currency: plan.currency || 'USD' });
});

// ─── POST /api/payment/verify-google-play ─────────────────────────────────────
// Android: After Google Play billing, verify the purchase token with Google Play Developer API
// Requires GOOGLE_PLAY_SERVICE_ACCOUNT_JSON env var (base64-encoded service account JSON)
// Uses authMiddleware so token_invalidated_at is checked (logout/password-change revocation)
payment.post('/verify-google-play', authMiddleware, async (c) => {
  const userId = c.get('user').sub;

  const { purchase_token, product_id, package_name, plan_id, promo_code } = await c.req.json() as any;
  if (!purchase_token || !product_id) return c.json({ error: 'purchase_token and product_id are required' }, 400);

  // Duplicate check: ensure this purchase_token hasn't been used already
  const existing = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? AND payment_method = 'google_play' LIMIT 1").bind(purchase_token).first<any>();
  if (existing?.status === 'success') return c.json({ error: 'This purchase has already been credited' }, 409);

  // Verify with Google Play Developer API
  const serviceAccountJson = c.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON as string | undefined;
  if (!serviceAccountJson) {
    // Fallback: accept and pending for admin review if no service account configured
    const plan = plan_id ? await c.env.DB.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>() : null;
    let purchaseId = existing?.id || crypto.randomUUID();
    if (!existing) {
      if (!plan) return c.json({ error: 'plan_id required when service account not configured' }, 400);
      // RACE FIX: bare INSERT below could collide with the unique index on
      // coin_purchases.payment_ref (added in migration 0018) when two
      // concurrent /verify-google-play calls share the same purchase_token.
      // Catch the constraint failure and re-resolve to the existing row so
      // the second caller gets a coherent response instead of a 500.
      try {
        await c.env.DB.prepare(
          "INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, payment_ref, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_play', ?, 'pending')"
        ).bind(purchaseId, userId, plan_id, plan.name, plan.coins, plan.bonus_coins || 0, plan.price, plan.currency || 'USD', purchase_token).run();
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('constraint')) {
          const winner = await c.env.DB.prepare(
            "SELECT id FROM coin_purchases WHERE payment_ref = ? AND payment_method = 'google_play' LIMIT 1"
          ).bind(purchase_token).first<any>();
          if (winner) {
            purchaseId = winner.id;
          } else {
            console.error('[/verify-google-play] unique violation but row not findable:', e);
            return c.json({ error: 'Concurrent verification conflict, please retry' }, 409);
          }
        } else {
          console.error('[/verify-google-play] fallback insert failed:', e);
          return c.json({ error: 'Could not record purchase' }, 500);
        }
      }
    }
    return c.json({ success: false, pending: true, purchase_id: purchaseId, message: 'Google Play service account not configured — purchase submitted for manual review' });
  }

  try {
    // Get Google access token via JWT service account
    const sa = JSON.parse(atob(serviceAccountJson));
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const jwtPayload = btoa(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }));
    // Import RSA key for signing
    const pemKey = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
    const keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sigData = new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`);
    const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, sigData);
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const jwt = `${jwtHeader}.${jwtPayload}.${sig}`;
    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });
    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
    // Verify the purchase with Google Play Developer API
    const pkg = package_name || 'com.voxlink.app';
    const verifyRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/products/${product_id}/tokens/${purchase_token}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const verifyData = await verifyRes.json() as any;
    if (!verifyRes.ok) throw new Error(`Google Play API error: ${JSON.stringify(verifyData)}`);
    // purchaseState: 0 = purchased, 1 = cancelled, 2 = pending
    if (verifyData.purchaseState !== 0) return c.json({ error: 'Purchase not completed', state: verifyData.purchaseState }, 400);
    // Acknowledge the purchase (required within 3 days or it's refunded by Google)
    if (verifyData.acknowledgementState === 0) {
      await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/products/${product_id}/tokens/${purchase_token}:acknowledge`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: '{}' }
      );
    }
    // Find or create coin_purchase record
    let purchaseId = existing?.id;
    const plan = plan_id ? await c.env.DB.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>() : null;
    let promoBonus = 0;
    if (promo_code && plan) {
      const promo = await c.env.DB.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1').bind(promo_code.trim()).first<any>();
      if (promo?.type === 'bonus') promoBonus = promo.bonus_coins ?? 0;
    }
    if (!purchaseId) {
      if (!plan) return c.json({ error: 'plan_id required for new purchase' }, 400);
      purchaseId = crypto.randomUUID();
      // RACE FIX: same as the fallback path above — guard against the
      // payment_ref unique index (migration 0018) and gracefully resolve to
      // the row that won the race. Without this, two concurrent verify
      // calls would each see existing=null, race the INSERT, and the loser
      // would crash to 500 even though the purchase is actually progressing.
      try {
        await c.env.DB.prepare(
          "INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, payment_ref, promo_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_play', ?, ?, 'pending')"
        ).bind(purchaseId, userId, plan_id, plan.name, plan.coins, (plan.bonus_coins || 0) + promoBonus, plan.price, plan.currency || 'USD', purchase_token, promo_code || null).run();
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('unique') || msg.includes('constraint')) {
          const winner = await c.env.DB.prepare(
            "SELECT id FROM coin_purchases WHERE payment_ref = ? AND payment_method = 'google_play' LIMIT 1"
          ).bind(purchase_token).first<any>();
          if (winner) {
            purchaseId = winner.id;
          } else {
            console.error('[/verify-google-play] unique violation but row not findable:', e);
            return c.json({ error: 'Concurrent verification conflict, please retry' }, 409);
          }
        } else {
          throw e;
        }
      }
    }
    const result = await approveDeposit(c.env.DB, purchaseId, 'google_play', `Google Play product ${product_id} verified`);
    return c.json({ success: result.ok, purchase_id: purchaseId, coins_added: result.coins, already_credited: result.already });
  } catch (e: any) {
    console.error('[/verify-google-play] verification failed:', e);
    return c.json({ error: 'Google Play verification failed' }, 500);
  }
});

// ─── POST /api/payment/match-utr ─────────────────────────────────────────────
// Admin-only: manually trigger UTR matching for a pending deposit
payment.post('/match-utr', authMiddleware, async (c) => {
  const caller = c.get('user');
  if (caller.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  const { utr_id } = await c.req.json() as any;
  if (!utr_id) return c.json({ error: 'utr_id required' }, 400);
  const purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE utr_id = ? AND payment_method = 'manual' LIMIT 1").bind(utr_id.trim()).first<any>();
  if (!purchase) return c.json({ error: 'No pending manual deposit found for this UTR' }, 404);
  const result = await approveDeposit(c.env.DB, purchase.id, 'manual-admin', `UTR matched: ${utr_id}`);
  return c.json({ ok: result.ok, already: result.already, coins: result.coins });
});

export default payment;
export { approveDeposit };
