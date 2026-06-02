-- 0032_coin_plans_inr_native.sql
--
-- BUGFIX: coin plan price unit mismatch.
--
-- The admin panel authors plan prices in INR (the field is labelled
-- "Price (INR ₹)" and the cards render ₹{price}), but the server's
-- /api/coins/plans previously treated coin_plans.price as USD and multiplied
-- by the FX rate (×83) for Indian users. Net effect:
--   • an admin "₹99" plan showed to users as ₹8,217 (99 × 83), and
--   • the seeded USD plans (e.g. 1.19) showed in the admin panel as "₹1.19".
--
-- The code fix makes /api/coins/plans convert from each plan's OWN
-- `currency` (defaulting new admin-created plans to INR). This migration
-- aligns the DATA with that model:
--   1. Re-base the 6 seeded production plans to INR-native whole-rupee prices
--      (₹49/99/199/499/999/1999) so they read correctly on both sides.
--   2. Mark every existing coin plan as INR (this product prices in ₹). Any
--      genuinely USD-priced legacy plan can be re-set from the admin panel.
--
-- Idempotent: the UPSERTs set absolute values, and the currency UPDATE is a
-- straight assignment.

-- 1. Seeded production plans → clean INR prices (coins/bonus unchanged).
UPDATE coin_plans SET price = 49,   currency = 'INR' WHERE id = 'plan-in-049';
UPDATE coin_plans SET price = 99,   currency = 'INR' WHERE id = 'plan-in-099';
UPDATE coin_plans SET price = 199,  currency = 'INR' WHERE id = 'plan-in-199';
UPDATE coin_plans SET price = 499,  currency = 'INR' WHERE id = 'plan-in-499';
UPDATE coin_plans SET price = 999,  currency = 'INR' WHERE id = 'plan-in-999';
UPDATE coin_plans SET price = 1999, currency = 'INR' WHERE id = 'plan-in-1999';

-- 2. Everything else: this app prices in INR, so stamp INR on any remaining
--    rows whose currency is still the legacy 'USD' default. (No price change —
--    operators can correct individual amounts from the admin panel.)
UPDATE coin_plans SET currency = 'INR' WHERE currency IS NULL OR currency = 'USD';
