-- 0042_coin_economy_consistency.sql
--
-- BUGFIX: the coin economy had THREE different values for the "same" coin
-- worth, and TWO different per-minute call-rate defaults, scattered across the
-- backend seed, the admin panel and the mobile apps. Users saw the coin value
-- (and call cost) flip between screens.
--
-- This migration pins ONE internally-consistent set of production defaults.
-- Everything is authored in INR (this is an India-first product); the backend
-- derives USD (and every other currency) FROM the INR value. Admins can still
-- change any of these live from the admin panel — this only fixes the seed.
--
--   coin_value_inr    = 0.05    → the single source of truth (₹ per coin)
--   coin_to_usd_rate  = 0.0006  → 0.05 ÷ 83 (kept in sync so non-INR / legacy
--                                 readers match; the FX cron re-pins it)
--   default_audio_rate/random_call_audio_rate = 25  (₹ ~1.25/min at ₹0.05)
--   default_video_rate/random_call_video_rate = 40
--
-- Idempotent: straight UPSERTs of absolute values.

-- ── 1. Coin value — align coin_to_usd_rate with the INR source of truth ────
-- Previous seed (migration 0030) stored 0.0015 (≈₹0.125/coin) which disagreed
-- with the admin panel default (₹0.05 → 0.0006). Pin both to ₹0.05.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('coin_value_inr',   '0.05',   unixepoch()),
  ('coin_to_usd_rate', '0.0006', unixepoch())
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();

-- ── 2. Call rates — one consistent default for BOTH direct and random ──────
-- Direct calls already defaulted to 25/40 (default_audio_rate/default_video_
-- rate). The random-match fallback used to be 5/8, so random calls were billed
-- ~5x cheaper than the advertised default. Unify to 25/40 so the rate shown in
-- the apps matches what is actually billed. Per-level random rates in
-- level_config can still be tuned by the admin for higher tiers.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('default_audio_rate',      '25', unixepoch()),
  ('default_video_rate',      '40', unixepoch()),
  ('random_call_audio_rate',  '25', unixepoch()),
  ('random_call_video_rate',  '40', unixepoch())
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();
