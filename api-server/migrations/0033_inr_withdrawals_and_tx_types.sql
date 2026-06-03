-- 0033_inr_withdrawals_and_tx_types.sql
-- Align fresh/live money tables with the India-first economy.
-- - Withdrawal amounts are now stored/displayed in INR.
-- - coin_transactions needs the withdrawal_pending ledger type used when a
--   host withdrawal freezes coins before admin approval.

-- Existing rows are left untouched: historical USD-denominated withdrawal rows
-- need manual/accounting review. New withdrawal inserts explicitly set INR.

PRAGMA foreign_keys = OFF;

ALTER TABLE coin_transactions RENAME TO coin_transactions_old;

CREATE TABLE coin_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('purchase','spend','bonus','refund','withdrawal','withdrawal_pending')),
  amount INTEGER NOT NULL,
  description TEXT,
  ref_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

INSERT INTO coin_transactions (id, user_id, type, amount, description, ref_id, created_at)
SELECT id, user_id, type, amount, description, ref_id, created_at
FROM coin_transactions_old;

DROP TABLE coin_transactions_old;

CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);

PRAGMA foreign_keys = ON;
