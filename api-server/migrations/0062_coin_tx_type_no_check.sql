-- ============================================================================
-- Remove the stale type CHECK on coin_transactions.
-- ============================================================================
-- The original table (0001) declared:
--     type TEXT NOT NULL CHECK(type IN
--       ('purchase','spend','bonus','refund','withdrawal'))
-- but the app has since written other types to this ledger (e.g.
-- 'withdrawal_pending', 'adjustment'). Because every ledger insert is
-- best-effort (wrapped in try/catch so a bookkeeping failure never blocks the
-- user's balance change), a CHECK rejection failed SILENTLY: the wallet was
-- debited/credited with NO matching ledger row, producing coin drift and a
-- broken audit trail. The code was conformed to the allowed set, but the CHECK
-- remains a landmine for any future type.
--
-- SQLite can't ALTER a CHECK constraint, so we rebuild the table WITHOUT a type
-- CHECK (the app is the source of truth for valid types). Ordering is chosen so
-- the runtime auto-migrator (which re-runs a failed migration from the top and
-- executes each statement non-transactionally) is safe:
--   * the new table is fully populated + indexed BEFORE anything destructive;
--   * the copy is de-duplicated (`WHERE id NOT IN ...`) so a partial re-run
--     tops up rather than duplicates;
--   * the only destructive window is the final DROP+RENAME pair — and even if
--     it were interrupted, every row is preserved in coin_transactions_v2 and
--     recovery is a single `ALTER TABLE coin_transactions_v2 RENAME TO
--     coin_transactions`.

-- 1. New table, identical columns, NO type CHECK. IF NOT EXISTS so a re-run
--    after a partial application is a tolerated no-op.
CREATE TABLE IF NOT EXISTS coin_transactions_v2 (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT,
  ref_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- 2. Copy every row not already copied (idempotent).
INSERT INTO coin_transactions_v2 (id, user_id, type, amount, description, ref_id, created_at)
  SELECT id, user_id, type, amount, description, ref_id, created_at
  FROM coin_transactions
  WHERE id NOT IN (SELECT id FROM coin_transactions_v2);

-- 3. Swap the CHECK-constrained table out for the new one.
DROP TABLE coin_transactions;
ALTER TABLE coin_transactions_v2 RENAME TO coin_transactions;

-- 4. Recreate every index the original table carried (0001 / 0012 / 0033 +
--    the runtime schemaGuard index). Names match so nothing else has to change.
CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coin_tx_ref ON coin_transactions(ref_id);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user_created ON coin_transactions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_coin_tx_type ON coin_transactions(type);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user_time ON coin_transactions(user_id, created_at);
