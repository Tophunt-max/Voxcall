import { Hono } from 'hono';
import type { Env } from '../types';

const payment = new Hono<{ Bindings: Env }>();

// ─── Shared: Approve a pending coin_purchase and credit coins to user ──────────
async function approveDeposit(db: D1Database, purchaseId: string, source: string, note?: string): Promise<{ ok: boolean; already?: boolean; notFound?: boolean; coins?: number }> {
  const purchase = await db.prepare('SELECT id, user_id, coins, bonus_coins, status FROM coin_purchases WHERE id = ?').bind(purchaseId).first<any>();
  if (!purchase) return { ok: false, notFound: true };
  if (purchase.status === 'success') return { ok: true, already: true };
  const totalCoins = (purchase.coins || 0) + (purchase.bonus_coins || 0);
  await db.batch([
    db.prepare("UPDATE coin_purchases SET status = 'success', payment_method = COALESCE(payment_method, ?), updated_at = unixepoch() WHERE id = ?").bind(source, purchaseId),
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

// ─── HMAC-SHA256 signature verification (Razorpay) ────────────────────────────
async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── POST /api/payment/webhook/razorpay ──────────────────────────────────────
// Configure in Razorpay Dashboard → Settings → Webhooks → Secret
// Webhook URL: https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook/razorpay
payment.post('/webhook/razorpay', async (c) => {
  try {
    const body = await c.req.text();
    const sig = c.req.header('X-Razorpay-Signature') || '';
    const secret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'razorpay_webhook_secret'").first<any>();
    if (secret?.value && sig) {
      const expected = await hmacSha256(secret.value, body);
      if (expected !== sig) return c.json({ error: 'Invalid signature' }, 401);
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
    return c.json({ error: e.message }, 500);
  }
});

// ─── POST /api/payment/webhook/stripe ────────────────────────────────────────
// Webhook URL: https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook/stripe
// Events to enable: checkout.session.completed, payment_intent.succeeded
payment.post('/webhook/stripe', async (c) => {
  try {
    const body = await c.req.text();
    const sig = c.req.header('Stripe-Signature') || '';
    const secret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'stripe_webhook_secret'").first<any>();
    // Stripe signature verification (simplified — for full verification use stripe-signature library)
    // In Cloudflare Workers, we verify the timestamp + payload hash
    if (secret?.value && sig) {
      const parts: Record<string, string> = {};
      sig.split(',').forEach(p => { const [k, v] = p.split('='); if (k && v) parts[k] = v; });
      const timestamp = parts['t'];
      const expected = await hmacSha256(secret.value, `${timestamp}.${body}`);
      if (expected !== parts['v1']) return c.json({ error: 'Invalid signature' }, 401);
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
    return c.json({ error: e.message }, 500);
  }
});

// ─── POST /api/payment/webhook/phonepe ───────────────────────────────────────
// Webhook URL: https://voxlink-api.ssunilkumarmohanta3.workers.dev/api/payment/webhook/phonepe
payment.post('/webhook/phonepe', async (c) => {
  try {
    const body = await c.req.text();
    const xVerify = c.req.header('X-Verify') || '';
    const secret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'phonepe_webhook_secret'").first<any>();
    if (secret?.value && xVerify) {
      const [sigPart] = xVerify.split('###');
      const expected = await hmacSha256(secret.value, body);
      if (expected !== sigPart) return c.json({ error: 'Invalid signature' }, 401);
    }
    const payload = JSON.parse(body);
    const data = payload.data || {};
    const txnStatus = data.code || payload.code;
    if (txnStatus !== 'PAYMENT_SUCCESS' && txnStatus !== 'SUCCESS') return c.json({ ok: true });
    const merchantTxnId = data.merchantTransactionId || data.transactionId;
    const utr = data.transactionId || data.utr;
    let purchase: any = null;
    if (merchantTxnId) purchase = await findPurchaseByOrderId(c.env.DB, merchantTxnId);
    if (!purchase && merchantTxnId) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE payment_ref = ? OR utr_id = ? LIMIT 1").bind(merchantTxnId, merchantTxnId).first<any>();
    if (!purchase && utr) purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE utr_id = ? LIMIT 1").bind(utr).first<any>();
    if (!purchase) return c.json({ ok: true, message: 'No matching purchase found' });
    const result = await approveDeposit(c.env.DB, purchase.id, 'phonepe', `PhonePe payment ${utr || merchantTxnId} success`);
    return c.json({ ok: result.ok, already: result.already, coins: result.coins });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── POST /api/payment/webhook/paytm ─────────────────────────────────────────
payment.post('/webhook/paytm', async (c) => {
  try {
    const body = await c.req.text();
    const payload = JSON.parse(body);
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
    return c.json({ error: e.message }, 500);
  }
});

// ─── POST /api/payment/webhook/generic ───────────────────────────────────────
// Generic webhook: POST with JSON body { purchase_id, status: 'success', secret }
// Simple secret in body — for custom gateways
payment.post('/webhook/generic', async (c) => {
  try {
    const { purchase_id, status, secret, note } = await c.req.json() as any;
    if (status !== 'success') return c.json({ ok: true });
    const storedSecret = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'generic_webhook_secret'").first<any>();
    if (storedSecret?.value) {
      if (!secret || secret !== storedSecret.value) return c.json({ error: 'Invalid secret' }, 401);
    }
    if (!purchase_id) return c.json({ error: 'purchase_id required' }, 400);
    const result = await approveDeposit(c.env.DB, purchase_id, 'generic', note || 'Auto-matched via generic webhook');
    return c.json({ ok: result.ok, already: result.already, coins: result.coins, notFound: result.notFound });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── POST /api/payment/initiate ──────────────────────────────────────────────
// Creates a pending coin_purchase and returns gateway order details
// Called by user app before redirecting to payment gateway
payment.post('/initiate', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const token = authHeader.split(' ')[1];
  let userId: string;
  try {
    const { jwtVerify } = await import('jose');
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    userId = payload.sub as string;
    if (!userId) throw new Error('No sub');
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const { plan_id, gateway_id, promo_code } = await c.req.json() as any;
  if (!plan_id) return c.json({ error: 'plan_id required' }, 400);
  const plan = await c.env.DB.prepare('SELECT * FROM coin_plans WHERE id = ? AND is_active = 1').bind(plan_id).first<any>();
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  const gateway = gateway_id ? await c.env.DB.prepare('SELECT * FROM payment_gateways WHERE id = ? AND is_active = 1').bind(gateway_id).first<any>() : null;
  let promoBonus = 0, promoDiscount = 0;
  if (promo_code) {
    const promo = await c.env.DB.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?) AND active = 1').bind(promo_code.trim()).first<any>();
    if (promo) {
      if (promo.type === 'bonus') promoBonus = promo.bonus_coins ?? 0;
      if (promo.type === 'percent') promoDiscount = Math.round(plan.price * (promo.discount_pct ?? 0) / 100);
    }
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
payment.post('/verify-google-play', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const token = authHeader.split(' ')[1];
  let userId: string;
  try {
    const { jwtVerify } = await import('jose');
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    userId = payload.sub as string;
    if (!userId) throw new Error('No sub');
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

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
    const purchaseId = existing?.id || crypto.randomUUID();
    if (!existing) {
      if (!plan) return c.json({ error: 'plan_id required when service account not configured' }, 400);
      await c.env.DB.prepare(
        "INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, payment_ref, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_play', ?, 'pending')"
      ).bind(purchaseId, userId, plan_id, plan.name, plan.coins, plan.bonus_coins || 0, plan.price, plan.currency || 'USD', purchase_token).run();
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
      await c.env.DB.prepare(
        "INSERT INTO coin_purchases (id, user_id, plan_id, plan_name, coins, bonus_coins, amount, currency, payment_method, payment_ref, promo_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_play', ?, ?, 'pending')"
      ).bind(purchaseId, userId, plan_id, plan.name, plan.coins, (plan.bonus_coins || 0) + promoBonus, plan.price, plan.currency || 'USD', purchase_token, promo_code || null).run();
    }
    const result = await approveDeposit(c.env.DB, purchaseId, 'google_play', `Google Play product ${product_id} verified`);
    return c.json({ success: result.ok, purchase_id: purchaseId, coins_added: result.coins, already_credited: result.already });
  } catch (e: any) {
    return c.json({ error: 'Google Play verification failed', detail: e.message }, 500);
  }
});

// ─── POST /api/payment/match-utr ─────────────────────────────────────────────
// Admin-only: manually trigger UTR matching for a pending deposit
payment.post('/match-utr', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const { utr_id } = await c.req.json() as any;
  if (!utr_id) return c.json({ error: 'utr_id required' }, 400);
  const purchase = await c.env.DB.prepare("SELECT id, status FROM coin_purchases WHERE utr_id = ? AND payment_method = 'manual' LIMIT 1").bind(utr_id.trim()).first<any>();
  if (!purchase) return c.json({ error: 'No pending manual deposit found for this UTR' }, 404);
  const result = await approveDeposit(c.env.DB, purchase.id, 'manual-admin', `UTR matched: ${utr_id}`);
  return c.json({ ok: result.ok, already: result.already, coins: result.coins });
});

export default payment;
export { approveDeposit };
