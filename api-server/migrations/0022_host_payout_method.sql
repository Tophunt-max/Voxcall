-- Migration 0022: payout method on hosts table
--
-- The host app's Settings screen previously had "Payout Method" wired to a
-- "Coming Soon" alert because there was no place on the backend to store
-- the host's preferred payout channel + account details.
--
-- We now store BOTH the method and the channel-specific details on the host
-- row so the wallet/withdraw flow can pre-fill the request and admins can
-- match the request to the host's saved method.
--
-- payout_method:  one of 'bank' | 'upi' | 'paytm' | 'phonepe' (text enum)
-- payout_details: JSON-encoded object with fields specific to the method:
--   bank    -> { account_holder, account_number, ifsc, bank_name }
--   upi     -> { upi_id }
--   paytm   -> { phone_number }
--   phonepe -> { phone_number }
--
-- We do NOT enforce a CHECK constraint on payout_method to keep the schema
-- forward-compatible if more channels are added later (Stripe, PayPal, etc).
-- Validation is performed in the Hono route via zod.

ALTER TABLE hosts ADD COLUMN payout_method TEXT;
ALTER TABLE hosts ADD COLUMN payout_details TEXT;
