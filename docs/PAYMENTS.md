# Payment Gateways — Operator Runbook

How the coin-purchase money path is secured, and the exact settings an operator
must configure before enabling a gateway in production.

## How a purchase is credited

1. The app calls `POST /api/payment/initiate` (authenticated). This creates a
   **pending** `coin_purchases` row and fixes the coin amount from the plan.
   The credited coin count is therefore **server-authoritative** — a webhook
   payload can never inflate it.
2. The gateway calls its webhook (`/api/payment/webhook/{razorpay|stripe|phonepe|paytm|generic}`).
   The handler verifies the signature/checksum (constant-time, fail-closed) and
   then calls the single credit chokepoint, `approveDeposit`.
3. `approveDeposit` credits coins exactly once via an atomic compare-and-set on
   `coin_purchases.status` (`WHERE status != 'success'`), so retried/duplicate
   webhooks never double-credit.

## Required `app_settings` per gateway

A webhook is **rejected with 500** until its secret is configured (no silent
bypass). Set these via the admin panel / DB:

| Gateway  | Keys |
|----------|------|
| Razorpay | `razorpay_webhook_secret` |
| Stripe   | `stripe_webhook_secret` |
| PhonePe  | Standard Checkout: `phonepe_webhook_username` + `phonepe_webhook_password` — or Legacy S2S: `phonepe_salt_key` (a.k.a. `phonepe_webhook_secret`) |
| Paytm    | `paytm_merchant_key` (16 bytes, for the AES-128-CBC checksum) |
| Generic  | `generic_webhook_secret` |
| Google Play | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (Worker env var, base64 service-account JSON) |

Before flipping a gateway live, validate the signature scheme against that
provider's **sandbox** with real credentials — the exact callback body/units
vary by provider integration version (see `src/lib/gatewayVerify.ts`).

## Amount / currency verification (defense-in-depth)

In addition to the signature check, `approveDeposit` compares the amount the
gateway reports it **captured** against the expected purchase price + currency.
This catches underpayment, amount tampering, and currency swaps.

Callers normalise the gateway amount to **major units** (rupees, not paise)
before the check:

| Gateway  | Field | Unit → major |
|----------|-------|--------------|
| Razorpay | `payment.entity.amount` | paise ÷ 100 |
| Stripe   | `amount_total` (or `amount`) | cents ÷ 100 |
| PhonePe  | `data.amount` | paise ÷ 100 (INR only) |
| Paytm    | `TXNAMOUNT` | already rupees |

**Rollout is deliberately two-stage** so a wrong unit assumption can never bounce
real payments:

- `payment_enforce_amount` **unset / `'0'` (default): LOG-ONLY.** A mismatch
  writes an `app_errors` alert (context `payment_amount_mismatch`) — visible in
  the admin error feed, the health monitor's hourly error count, and the coin
  reconciliation watchdog — but the coins are **still credited**.
- `payment_enforce_amount = '1'`: **ENFORCE.** A mismatch blocks the credit
  (purchase stays `pending`) and still alerts.

**Recommended procedure:** run in log-only mode through sandbox + early
production, confirm the mismatch alerts stay at zero for legitimate payments
(i.e. the per-gateway units above are correct for your integration), then set
`payment_enforce_amount = '1'` to make it a hard gate.

Tolerance: differences ≤ 1 major unit are ignored (gateway rounding); currency
must match exactly.

## Coin-integrity watchdog

An hourly cron (`maybeReconcileCoins`) checks that total wallet coins equal the
signed sum of the coin ledger and raises an `app_errors` alert on drift beyond
tolerance. Tunables: `coin_recon_interval_sec` (default 3600), `coin_recon_alert_pct`
(default 2), `coin_recon_alert_min_abs` (default 1000). Live view:
`GET /admin/coin-reconciliation` (`last_auto_check` = latest watchdog verdict).
