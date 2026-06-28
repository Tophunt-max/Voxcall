-- Migration 0036: User blocking system
-- Allows users to block other users, preventing calls, chat, and matchmaking.

CREATE TABLE IF NOT EXISTS user_blocks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(blocker_id, blocked_id)
);

-- Index for fast lookups: "has A blocked B?" and "all users blocked by A"
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
-- Composite for the most common check (single-row lookup)
CREATE INDEX IF NOT EXISTS idx_user_blocks_pair ON user_blocks(blocker_id, blocked_id);
