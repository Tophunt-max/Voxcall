-- Migration 0025: Host level-up system
-- 1. Audit trail of every host promotion (who, when, why, reward granted)
-- 2. UNIQUE(host_id, new_level) makes the one-time coin reward idempotent —
--    a host can be promoted to a given level only once, ever, so the reward
--    can never be double-granted (concurrent raters, recalc + live path, etc).
-- 3. Track when a host's level last changed.

CREATE TABLE IF NOT EXISTS host_level_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  old_level INTEGER NOT NULL,
  new_level INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'admin' | 'recalc'
  coins_awarded INTEGER DEFAULT 0,
  rating REAL,
  review_count INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_host_level_history_host ON host_level_history(host_id);

-- Idempotency guard for the one-time level reward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_host_level_history_reward
  ON host_level_history(host_id, new_level);

-- When the host's level was last changed (set by the level-up engine).
ALTER TABLE hosts ADD COLUMN level_updated_at INTEGER;
