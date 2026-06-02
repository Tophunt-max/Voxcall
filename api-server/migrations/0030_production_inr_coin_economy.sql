-- 0030_production_inr_coin_economy.sql
--
-- Production-grade coin economy tuned for Indian (INR) users, with a single,
-- internally-consistent algorithm. Safe to run on an existing DB: it
-- deactivates the old USD-priced plans and upserts the canonical INR plan
-- ladder + economy settings.
--
-- ─── THE ALGORITHM (single source of truth) ───────────────────────────────
-- 1. Coin plan prices are authored in USD (coin_plans.price). The API
--    (/api/coins/plans) converts to the user's currency via the FX table
--    (1 USD = ₹83). Each plan's USD price below = round(₹ / 83), so an Indian
--    user always sees the CLEAN ₹ price point (₹49 / ₹99 / ₹199 / ...).
-- 2. Buy value  : ~₹0.20 per coin on the smallest plan, dropping to ~₹0.15 on
--    the largest (the discount is delivered as BONUS coins, not a lower price).
-- 3. Spend      : caller pays `rate × minutes` coins; the host is credited
--    `earning_share` (0.70 at L1 → 0.80 at L5) of those coins. Platform keeps
--    the remainder.
-- 4. Payout     : a host converts their (already share-adjusted) coin balance
--    to cash at `coin_to_usd_rate` USD/coin (× FX for the local payout). At
--    0.0015 that is ≈ ₹0.125 gross per coin, so a host nets ≈ ₹0.0875/coin at
--    L1 (70%) — roughly half of the ₹0.18 a user paid for that coin, leaving a
--    healthy platform margin for payment fees, bonus-coin dilution and the
--    free-trial pool.
--
--      buy ≈ ₹0.18/coin   →   host net ≈ ₹0.0875/coin   →   platform ≈ ₹0.09/coin
--
-- Tune any of these live from the admin panel (App Config / Coin Plans) — this
-- migration only seeds sensible production defaults.

-- ── 1. Retire the legacy USD plan ladder ──────────────────────────────────
UPDATE coin_plans SET is_active = 0;

-- ── 2. Canonical INR plan ladder (USD price = ₹ / 83 → clean ₹ for India) ──
-- name        ₹     usd       coins   bonus  total   eff ₹/coin
-- Starter     49    0.5904     250      0      250     0.196
-- Popular     99    1.1928     500     50      550     0.180   ← most popular
-- Value       199   2.3976    1000    150     1150     0.173
-- Super       499   6.0120    2500    500     3000     0.166
-- Mega        999  12.0361    5000   1250     6250     0.160
-- Pro        1999  24.0843   10000   3000    13000     0.154
INSERT INTO coin_plans (id, name, coins, price, currency, bonus_coins, is_popular, is_active) VALUES
  ('plan-in-049',  'Starter',  250,   0.5904, 'USD',    0, 0, 1),
  ('plan-in-099',  'Popular',  500,   1.1928, 'USD',   50, 1, 1),
  ('plan-in-199',  'Value',   1000,   2.3976, 'USD',  150, 0, 1),
  ('plan-in-499',  'Super',   2500,   6.0120, 'USD',  500, 0, 1),
  ('plan-in-999',  'Mega',    5000,  12.0361, 'USD', 1250, 0, 1),
  ('plan-in-1999', 'Pro',    10000,  24.0843, 'USD', 3000, 0, 1)
ON CONFLICT(id) DO UPDATE SET
  name        = excluded.name,
  coins       = excluded.coins,
  price       = excluded.price,
  currency    = excluded.currency,
  bonus_coins = excluded.bonus_coins,
  is_popular  = excluded.is_popular,
  is_active   = 1;

-- ── 3. Economy settings (the algorithm's knobs) ───────────────────────────
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('coin_to_usd_rate',        '0.0015', unixepoch()),  -- host payout ≈ ₹0.125 gross/coin
  ('host_revenue_share',      '0.70',   unixepoch()),  -- L1 host share; level system can raise to 0.80
  ('min_withdrawal_coins',    '5000',   unixepoch()),  -- ≈ ₹620 minimum payout (batches transfers)
  ('min_coins_for_call',      '50',     unixepoch()),  -- ≈ ₹9 floor to start a call
  ('registration_bonus_coins','50',     unixepoch()),  -- welcome coins for new signups
  ('first_call_free_minutes', '5',      unixepoch())   -- new-user free-trial pool (kept)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();
