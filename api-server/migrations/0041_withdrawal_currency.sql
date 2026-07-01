-- Migration 0041: withdrawal payout currency
--
-- Store each withdrawal in the host's own currency + a currency code, so the
-- payout amount is displayed correctly for both Indian and international hosts.
--
-- Background: /api/coins/withdraw used to store `amount` as raw USD with no
-- currency, and the admin panel rendered it as INR (formatInr) — an ~83× wrong
-- figure (₹0.53 instead of ₹44 for 1000 coins). Going forward `amount` holds
-- the host-local amount and `currency` records which currency that is.
--
-- Migration 0018 recreated withdrawal_requests without the original 0001
-- `currency` column, so we re-add it here (default INR — the platform base).

ALTER TABLE withdrawal_requests ADD COLUMN currency TEXT DEFAULT 'INR';
