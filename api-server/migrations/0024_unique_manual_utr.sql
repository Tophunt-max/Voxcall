-- Prevent duplicate manual-deposit submissions racing with each other.
--
-- /api/coins/manual-deposit performs a SELECT … WHERE utr_id = ? followed by
-- an INSERT. Two concurrent requests from the same user (or different users)
-- with the same UTR can both pass the SELECT (TOCTOU) and both INSERT a
-- `pending` coin_purchase row. When an admin then approves both, the user
-- receives 2× the coin credit because approveDeposit's atomic CAS is keyed
-- on coin_purchases.id, not on utr_id.
--
-- A partial UNIQUE INDEX (only on rows where payment_method='manual') closes
-- the race at the SQLite/D1 level: the second INSERT raises a constraint
-- failure that the application code converts into a clean 409 response.
-- Online gateways (Razorpay/Stripe/PhonePe/Paytm/Google Play) are unaffected
-- because they live on `payment_ref`, which already has its own unique index
-- from migration 0018.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_purchases_manual_utr
  ON coin_purchases(utr_id)
  WHERE utr_id IS NOT NULL AND payment_method = 'manual';
