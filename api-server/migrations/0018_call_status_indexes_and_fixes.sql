-- Migration 0018: Performance indexes + withdrawal status fix

-- Call sessions status index — pending-for-host polling, concurrent call check, cron reaper
CREATE INDEX IF NOT EXISTS idx_call_sessions_status_created
  ON call_sessions(status, created_at);

CREATE INDEX IF NOT EXISTS idx_call_sessions_caller_status
  ON call_sessions(caller_id, status);

CREATE INDEX IF NOT EXISTS idx_call_sessions_host_status
  ON call_sessions(host_id, status);

-- Withdrawal requests — status column may be missing in older DBs
-- Add status column if not exists (SQLite ALTER TABLE is limited — we use a safe approach)
CREATE TABLE IF NOT EXISTS withdrawal_requests_new (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES hosts(id),
  coins INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'bank',
  account_details TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
  admin_note TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Safe column addition for existing tables
INSERT OR IGNORE INTO withdrawal_requests_new
  SELECT id, host_id, coins, amount, payment_method, account_details,
         COALESCE(status, 'pending'), NULL, created_at, created_at
  FROM withdrawal_requests;

-- coin_purchases payment_ref unique index — prevent duplicate processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_purchases_payment_ref
  ON coin_purchases(payment_ref) WHERE payment_ref IS NOT NULL;
