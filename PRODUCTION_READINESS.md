# VoxCall — Production Readiness Audit

> **Scope:** `api-server` (Cloudflare Workers + D1) — billing, payments, auth, CORS, cron, rate limiting, withdrawals.
> **Date:** 2026-05-31
> **Verdict:** The codebase is well-hardened for an MVP/beta (atomic coin transfers, webhook signature checks, token revocation, audit logs, race-condition guards). However, several **real gaps** remain before it is safe for **real-money production traffic** — two of them are direct revenue/abuse leaks.

Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low/Polish
Status legend: ✅ Fixed · 🟡 Partially fixed (needs follow-up) · ⬜ Open

| # | Severity | Title | Area | Status |
|---|----------|-------|------|--------|
| 1 | 🔴 | No mid-call billing → free unlimited calls, host earns 0 | Billing | ✅ Fixed |
| 2 | 🔴 | Promo `max_uses` not enforced in live flows | Promo/Coins | ✅ Fixed |
| 3 | 🟠 | PhonePe & Paytm signature schemes don't match providers | Payments | 🟡 Fixed (validate in sandbox) |
| 4 | 🟠 | Webhook HMAC comparison not constant-time | Payments/Security | ✅ Fixed |
| 5 | 🟠 | JWT in WebSocket URL + 100% request logging | Security | 🟡 Header support added; client migration + log scrub pending |
| 6 | 🟠 | CORS allowlist too broad (`*.pages.dev`, `*.replit.*`) | Security | ✅ Fixed (set `CORS_ALLOWED_ORIGINS` in prod) |
| 7 | 🟡 | Rate limiting is D1-backed, non-atomic, fail-open | Reliability | ✅ Fixed (atomic upsert) |
| 8 | 🟡 | DB migrations not auto-applied on deploy | Ops | ✅ Fixed (`--remote`) |
| 9 | 🟡 | Coin transfer + bookkeeping not one atomic unit | Billing | ✅ Fixed (reconciliation sweep) |
| 10 | 🟡 | Currency inconsistency in payouts (USD vs INR) | Billing | 🟡 Admin label fixed; host-app hardcoded rate needs decision |
| 11 | 🟡 | `e.message` leaked to clients on 500s | Security | ✅ Fixed |
| 12 | 🟡 | FX rates hardcoded | Billing | ✅ Fixed (cron refresh + static fallback) |
| 13 | 🟢 | Misc polish (TURN fallback, plans auth, D1 write scaling) | Various | ⬜ Open (documented) |

---

## 🔴 1. No mid-call billing → free unlimited calls + host earns nothing

**Files:** `src/routes/call.ts` (`/initiate`, `/end`), `src/lib/billing.ts` (`atomicCallTransfer`), `src/index.ts` (`reapStaleCalls`).

**What happens today:**
- Coins are only ever moved at call **end** (`POST /api/calls/end`), the 30-minute cron reaper, or admin force-end.
- `atomicCallTransfer` is **all-or-nothing**: the `EXISTS (… coins >= ?2)` guard requires the caller to hold the **entire** call cost. If they don't, **zero** coins move and `actualCoinsCharged = 0`.
- `max_seconds` is computed at `/initiate` and sent to the client, but the **server never enforces it**. It is purely a UI hint.

**Exploit / failure mode:**
1. User buys the minimum (2 minutes' worth of coins).
2. User talks for hours (a modified client simply ignores `max_seconds`; even an honest client that drifts can overrun).
3. At `/end`, the full charge (e.g. 60 min × 5 = 300 coins) exceeds the caller's balance → transfer fails → **caller charged 0, host earns 0**.
4. Net result: **free unlimited call** for the caller, **unpaid work** for the host.

**Recommended fix (pick one):**
- **Option A — Per-minute heartbeat billing (preferred):** client sends a periodic `POST /api/calls/heartbeat` (e.g. every 30–60s); server deducts the incremental coins via the same atomic transfer and **force-ends** the call when the balance can no longer cover the next interval. Most accurate, prevents overrun.
- **Option B — Partial / best-effort billing:** at `/end`, charge `min(coinsCharged, callerBalance)` and pay the host their proportional share of whatever was actually collected (never 0 for a real call). Simpler, but still lets a caller overrun within a single billing window.
- **In both cases:** enforce `max_seconds` server-side as a hard cap (the reaper already ends calls at 30 min — tighten this to the per-call balance cap).

---

## 🔴 2. Promo `max_uses` not enforced in live payment flows

**Files:** `src/routes/coin.ts` (`/manual-deposit`, disabled `/purchase`), `src/routes/payment.ts` (`/initiate`, `approveDeposit`).

**What happens today:**
- `UPDATE promo_codes SET used_count = used_count + 1` exists **only** in the disabled `/api/coins/purchase` route.
- The **live** flows — `/api/coins/manual-deposit`, `/api/payment/initiate` + webhook `approveDeposit` — read the promo and apply `bonus_coins`, but **never increment `used_count`**.

**Exploit:** A promo created with `max_uses: 100` (or `1`) can be redeemed an **unlimited** number of times, each time granting bonus coins. The `expires_at` and `max_uses` checks on read are meaningless because the counter never advances.

**Recommended fix:** Increment `used_count` **atomically at credit time** (inside `approveDeposit` and the manual-deposit approval), guarded by `WHERE used_count < max_uses` so the bonus is only granted while quota remains. Store the resolved promo id on the `coin_purchases` row so credit-time can find it. Treat the increment + credit as one batch.

---

## 🟠 3. PhonePe & Paytm signature verification likely mismatched with providers

**File:** `src/routes/payment.ts` (`/webhook/phonepe`, `/webhook/paytm`, `verifyPaytmChecksum`).

- **PhonePe:** real `X-Verify` = `SHA256(base64(payload) + endpointPath + saltKey) + "###" + saltIndex`. Current code computes `HMAC-SHA256(body)` with the secret — **different algorithm**.
- **Paytm:** real checksum uses AES-128-CBC with a random IV ("salt") over sorted params, then base64. Current code computes `HMAC-SHA256` of pipe-joined sorted values — **different algorithm**.

**Impact:** Genuine provider callbacks will be **rejected**, so coins silently never credit for those gateways — and the operational temptation becomes "just disable verification," which reopens the forgery hole the code was hardened against.

**Note:** Razorpay (`HMAC-SHA256(body)`, hex) and Stripe (`t=…,v1=…` over `${t}.${body}`) match their documented schemes and look correct.

**Recommended fix:** Re-implement PhonePe and Paytm verification per the **current** official integration docs (or use their server SDKs' verification primitives). Add a unit test per gateway with a known-good sample payload + signature.

---

## 🟠 4. Webhook signature comparison is not constant-time

**File:** `src/routes/payment.ts` (all webhook handlers).

All signature checks use plain string comparison (`expected !== sig`, `expected === checksum`, …), which short-circuits on the first differing byte → **timing side-channel** that can leak the expected signature byte-by-byte.

**Recommended fix:** Use a constant-time comparison (XOR-accumulate over equal-length byte arrays, or `crypto.subtle` verify). The repo already does constant-time comparison for passwords (`lib/hash.ts`) — reuse the same primitive.

---

## 🟠 5. JWT token in WebSocket URL query string + 100% request logging

**Files:** `src/index.ts` (`/api/ws/notifications`, `/api/ws/call/:sessionId`), `wrangler.toml` (`[observability] head_sampling_rate = 1`).

WebSocket auth accepts `?token=<JWT>`. With observability capturing 100% of request metadata (URLs), tokens can land in **Workers logs**, intermediary proxies, and browser history.

**Recommended fix:** Pass the token via `Sec-WebSocket-Protocol` (subprotocol) header, or issue a short-lived single-use WS "ticket" from an authenticated POST and pass that in the URL instead of the long-lived JWT. At minimum, scrub `token` from logged URLs.

---

## 🟠 6. CORS allowlist too broad

**File:** `src/index.ts` (`ALLOWED_ORIGINS`).

`/\.pages\.dev$/`, `/\.replit\.dev$/`, `/\.replit\.app$/` allow **any** subdomain on those shared platforms — e.g. an attacker can deploy `attacker.pages.dev` and become an allowed origin. (Bearer-token auth means CORS isn't the only defense, but this is still an unnecessary production loosening.) `credentials: true` is also unnecessary with Bearer-token (non-cookie) auth, and returning `'*'` for no-origin requests while `credentials: true` is spec-invalid (harmless for native apps, but sloppy).

**Recommended fix:** In production, restrict the allowlist to your actual deployed domains (the anchored `voxlink.*` / `voxcall.*` patterns are good; drop the wildcard platform domains or gate them behind a `dev`-only env flag). Drop `credentials: true` unless cookies are actually used.

---

## 🟡 7. Rate limiting is D1-backed, non-atomic, and fail-open

**Files:** `src/middleware/auth.ts` (`adminMiddleware`), `src/routes/call.ts` (`/initiate`), auth routes.

- Counter logic is **read-then-write** (`SELECT attempts` → `UPDATE attempts + 1`), which is TOCTOU: parallel requests read the same value and undercount → limits can be exceeded under burst.
- Every limiter **fails open** (on any D1 error it proceeds), so a D1 hiccup silently disables all rate limiting.
- High-frequency per-minute keys add write pressure to D1's single-writer model.

**Recommended fix:** Use a **Durable Object** counter (atomic `state.storage` increments) or the Cloudflare **Rate Limiting binding** for the sensitive paths (login/OTP, admin, call initiation). Keep fail-open only for non-security-critical limits.

---

## 🟡 8. Database migrations are not auto-applied on deploy

**Files:** `migrations/*.sql`, `src/lib/schemaGuard.ts` (`ensureUsersSchema`), `.github/workflows/deploy-backend.yml`.

The runtime `ensureUsersSchema` ALTER-check (run on the `/api/*` cold path) is described in-code as "belt-and-suspenders for the case where `wrangler d1 migrations apply` didn't reach production." This confirms schema drift has occurred. Relying on runtime self-healing is fragile and only covers the `users` table.

**Recommended fix:** Add `wrangler d1 migrations apply voxlink-db --remote` as a gated step in the deploy workflow (after build, before traffic shift). Once reliable, retire the runtime ALTER hack.

---

## 🟡 9. Coin transfer + bookkeeping are not a single atomic unit

**Files:** `src/routes/call.ts` (`/end`), `src/index.ts` (`reapStaleCalls`).

The flow is: (1) `atomicCallTransfer` as its own statement, then (2) a separate `db.batch([...])` for `call_sessions` status + host stats + `coin_transactions`. If the isolate dies **between** (1) and (2): coins have moved, but the session stays `status='active'` with `ended_at` set, no ledger rows exist, and host stats are stale. The reaper's `WHERE … ended_at IS NULL` guard then **skips it forever** — a permanently inconsistent, unbilled-but-charged row.

**Recommended fix:** Fold the transfer into the same `db.batch` as the bookkeeping (D1 batches are atomic), or add a reconciliation pass that detects `ended_at IS NOT NULL AND status != 'ended'` rows and finalizes them.

---

## 🟡 10. Currency inconsistency in payouts

**Files:** `src/routes/coin.ts` (`/withdraw`), `admin-panel/src/pages/SettingsPage.tsx`, `admin-panel/src/pages/AppConfig.tsx`, `voxlink-host/services/PaymentService.ts`.

The same concept is represented three different ways:
- Setting key is `coin_to_usd_rate` (default `0.01`), withdrawal computes `usdAmount = coins × rate`.
- Admin Settings UI labels it **"Coin → INR Rate"**; AppConfig uses a separate `coin_to_inr_rate` / `host_payout_percent`.
- Host app hardcodes `COIN_TO_INR_RATE = 0.5` and `MINIMUM_WITHDRAWAL = 500`, independent of server settings.

For real payouts this is a money-correctness landmine (USD math labelled as INR, host app disagreeing with server).

**Recommended fix:** Pick a single payout currency and a single source of truth (server `app_settings`), have the host app read the rate from the API instead of hardcoding, and align labels/keys.

---

## 🟡 11. Raw `e.message` leaked to clients on 500 responses

**Files:** `src/routes/payment.ts` (webhooks), `src/routes/call.ts` (`/end`), others using `return c.json({ error: e.message }, 500)`.

Leaks internal error detail (and occasionally upstream API payloads, e.g. Google Play) to callers.

**Recommended fix:** Return a generic message (`{ error: 'Internal error' }`) to clients and log the detail server-side (`console.error`). Optionally include a correlation id.

---

## 🟡 12. FX rates are hardcoded

**Files:** `src/lib/currency.ts` (`USD_TO_FOREIGN`).

Static conversion table drifts from real rates over time; volatile currencies (e.g. ARS) can mis-price plans significantly.

**Recommended fix:** Fetch rates from an FX API on a schedule (cron) and cache in `app_settings`/KV, with the static table as a fallback. At minimum, document the manual refresh cadence.

---

## 🟢 13. Lower-priority polish

- **`/api/coins/plans`** does a manual JWT verify for currency without ban/revocation checks — low risk (currency only), but inconsistent with `authMiddleware`.
- **Public TURN fallback** (`openrelay.metered.ca`) is not production-grade; ensure `TURN_KEY_ID`/`TURN_KEY_TOKEN` are actually set in prod or cellular users get one-way/no audio.
- **D1 write scaling:** `coin_transactions`, `rate_limits`, and `call_sessions` are all write-heavy on a single-writer D1. The PostgreSQL migration plan should be prioritized ahead of significant call-volume growth, not after.

---

## Suggested fix order

1. **#2 Promo `max_uses`** — small, safe, stops direct coin abuse.
2. **#4 Constant-time compare**, **#6 CORS**, **#11 error leakage** — small, safe security hardening.
3. **#1 Mid-call billing** — needs a design decision (heartbeat vs partial billing); biggest revenue impact.
4. **#3 PhonePe/Paytm signatures** — required before enabling those gateways in prod.
5. **#7 rate limiting**, **#8 migrations**, **#9 atomicity**, **#10 currency** — reliability/ops pass.
6. **#5 JWT-in-URL**, **#12 FX**, **#13 polish** — as capacity allows.

---

## Fixes applied (2026-05-31)

All `api-server` changes below ship together; `typecheck`, `lint` (0 errors), `vitest` (61 tests), and `wrangler deploy --dry-run` all pass.

- **#1 Mid-call billing** — `lib/billing.ts` now exposes `affordableCoins()` + `chargeCallerAffordable()`: callers are charged what they can afford (capped at balance) and hosts are paid their share of what was actually collected (never 0 for real talk-time). Applied at both `/api/calls/end`, `/api/calls/:id/end`, and the cron reaper. Added `POST /api/calls/:id/heartbeat` which force-ends + settles a call once elapsed time exceeds the caller's balance cap (server-side overrun protection). **Client TODO:** call the heartbeat every ~20–30s during an active call.
- **#2 Promo `max_uses`** — `approveDeposit()` (the single credit chokepoint, now also used by admin manual approval) atomically consumes one promo use with a `used_count < max_uses` guard and strips the promo bonus if the quota is already spent.
- **#3 PhonePe/Paytm** — correct provider schemes implemented in new `lib/gatewayVerify.ts` (PhonePe legacy `X-VERIFY` + Standard-Checkout `Authorization`; Paytm AES-128-CBC checksum), with roundtrip unit tests. **Validate against each provider's sandbox before enabling in prod.**
- **#4 Constant-time** — all webhook signature/secret comparisons use `timingSafeEqual`.
- **#5 WS token** — `Sec-WebSocket-Protocol` header is now accepted (preferred over `?token=`); query param kept for backward compat. Migrate clients, then drop query support.
- **#6 CORS** — set `CORS_ALLOWED_ORIGINS` (comma-separated exact origins) as a Worker secret/var in prod to replace the broad dev patterns.
- **#7 Rate limiting** — new `lib/rateLimit.ts` does an atomic `INSERT … ON CONFLICT … RETURNING` check-and-increment (no TOCTOU); used by auth, admin, and call-initiate limiters.
- **#8 Migrations** — deploy workflow now runs `wrangler d1 migrations apply voxlink-db --remote`.
- **#9 Atomicity** — `reconcileStuckEndedCalls()` cron sweep finalizes rows left `ended_at`-set-but-not-`ended` (crash between transfer and bookkeeping), inferring the charged amount from the ledger and never double-charging.
- **#11 Error leakage** — webhook/`/end`/Google-Play 500s return a generic message; detail is logged server-side.
- **#12 FX** — `maybeRefreshFxRates()` cron pulls live rates (no-key API) into `app_settings.fx_rates_usd` every 12h; `convertFromUSD()` prefers them and falls back to the static table.

### New configuration introduced

| Key / Var | Where | Purpose |
|-----------|-------|---------|
| `CORS_ALLOWED_ORIGINS` | Worker var/secret | Exact prod CORS allowlist (comma-separated). Unset = permissive dev patterns. |
| `phonepe_salt_key` | `app_settings` | PhonePe legacy `X-VERIFY` salt key (falls back to `phonepe_webhook_secret`). |
| `phonepe_webhook_username` / `phonepe_webhook_password` | `app_settings` | PhonePe Standard-Checkout `Authorization` webhook credentials. |
| `fx_rates_usd` / `fx_rates_updated` | `app_settings` | Cron-managed live FX cache (auto-written; do not edit by hand). |

### Residual follow-ups (need product/infra decisions)

- **#10 host-app rate:** `voxlink-host/services/PaymentService.ts` hardcodes `COIN_TO_INR_RATE = 0.5` and `MINIMUM_WITHDRAWAL = 500`, which disagree with the server (`coin_to_usd_rate = 0.01`, `min_withdrawal_coins = 100`). Decide the payout currency + single source of truth, then have the host app read the rate from the API. **Not changed here** to avoid altering real payout values blindly. (Also: `admin-panel/AppConfig.tsx` uses keys the backend doesn't accept — `coin_to_inr_rate`, `host_payout_percent` — so edits there silently no-op; reconcile with `SettingsPage.tsx`.)
- **#5:** scrub `token` from logged URLs and complete client migration to the subprotocol header.
- **#13:** ensure prod `TURN_KEY_ID`/`TURN_KEY_TOKEN` are set; consider prioritizing the D1 → Postgres migration before call-volume growth.

---

## Double-check (round 2, 2026-05-31)

Re-ran and stress-tested the above changes; tightened test coverage and surfaced deeper issues.

### Verified / hardened
- **Test coverage added for the new code** (now **69 tests**, all green, run repeatedly for stability):
  - `chargeCallerAffordable` (FIX #1) — proves a caller who overruns is charged up to their balance and the host is paid their share (e.g. owed 50, balance 30 → host earns 21, **not 0**).
  - `registerHit` / `checkRateLimit` (FIX #7) — proves the atomic upsert increments correctly, caps at the right hit, resets an expired window, and fails open when the table is missing.
  - Promo `max_uses` (FIX #2) and gateway signatures (FIX #3) already covered.
- **Flaky pre-existing test fixed** — `jwt.test.ts` "tampered token" flipped the **last** base64url char of the signature, which decodes to identical bytes ~⅓ of the time (spare-bit alignment), so the tampered token was sometimes still valid and the test failed intermittently. Now tampers the payload's first char (deterministic). This flakiness could have let a red build slip through the new CI deploy gate.
- **FX refresh retry** — a failed refresh now retries in ~1h instead of holding the stale 12h claim.

### Newly surfaced (need product decision — NOT changed blindly)
- **#14 Host withdrawal is mocked:** `voxlink-host/services/PaymentService.ts` `withdrawEarnings()` is a `setTimeout` mock that writes to local AsyncStorage and **never calls `POST /api/coins/withdraw`**. The real server withdrawal flow (with coin-freezing + admin approval) exists but the host app isn't wired to it. Hosts' in-app withdrawals do not actually reach the backend. **High priority** — decide and wire the real endpoint.
- **#15 `AppConfig.tsx` is largely non-functional:** it `POST`s keys (`min_android_version`, `coin_to_inr_rate`, `host_payout_percent`, `free_coins_on_signup`, `guest_daily_call_limit`, `force_update_*`, …) that are NOT in the backend's `ALLOWED_APP_CONFIG_KEYS`/`ALLOWED_SETTINGS` allowlist, so they are silently dropped server-side. Admins believe they're changing config that never persists. Either extend the backend allowlist AND wire those keys into behaviour, or remove the dead fields and consolidate on `SettingsPage.tsx`.
- **#16 Two overlapping admin economy editors:** `SettingsPage.tsx` (correct keys) and `AppConfig.tsx` (wrong keys) both edit "coin rate / payout %", inviting drift and confusion. Consolidate into one.


---

## Double-check (round 3, 2026-05-31) — frontend + remaining items RESOLVED

Acted on the "fix everything" follow-up. Investigated the round-2 frontend findings (one was mis-scoped) and fixed them. **All three packages verified green:** api-server (typecheck + 69 tests + dry-run build), admin-panel (typecheck + vite build), voxlink-host (typecheck).

- **#14 corrected + cleaned up** — the host **wallet already uses the real API** (`API.requestWithdrawal` → `POST /api/coins/withdraw`); the round-2 note over-stated this. `PaymentService.ts` was **100% dead code** (no imports anywhere) whose `COIN_TO_INR_RATE = 0.5` contradicted the server's `0.01`. **Deleted the dead file.**
- **#10 host single-source-of-truth** — the host wallet's minimum-withdrawal threshold (was hardcoded `100`) now comes from `GET /api/app-config` (`min_withdrawal_coins`), falling back to 100. The live coin→fiat helper already used `0.01` (consistent with the server), so nothing else needed changing once the dead 0.5 constant was removed.
- **#15 admin config made functional + honest** — extended the backend `ALLOWED_SETTINGS` allowlist with the version-gate keys the live `GET /api/app/version` endpoint actually reads (`app_min_version_user|host`, `app_latest_version_user|host`, `app_download_url_user|host`, `app_update_block_message`, `app_update_recommend_message`). Rewrote `AppConfig.tsx` to edit **only** persisted+consumed keys (version gate, maintenance, support email); removed all dead fields (announcement / call-duration / guest-limit / signup-bonus had no backend consumer).
- **#16 economy consolidated** — removed the dangerous duplicate economy fields from `AppConfig.tsx`. In particular `host_payout_percent` (0–100 percent) collided with the canonical `host_revenue_share` (0–1 fraction) billing uses, so a naive save could have paid hosts 100×. Economy is now edited only on `SettingsPage.tsx`; AppConfig links to it.

### Still deferred (genuinely risky / broader change)
- **#5 WS token client migration** — the server already accepts the token via `Sec-WebSocket-Protocol`. Moving the mobile clients off `?token=` also needs the Durable Objects to echo the negotiated subprotocol on the 101 handshake; getting that wrong breaks realtime calls/notifications for **all** users, so it's left for a dedicated, separately-tested change. Interim: scrub `token` from logged URLs / lower log retention.
- **D1 → Postgres** before significant call-volume growth (single-writer ceiling).
