-- Migration 0038: Tipping / Gifting system
-- Users can send tips (extra coins) to hosts after or during a call.

CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  host_id TEXT,
  call_session_id TEXT,
  amount INTEGER NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tips_sender ON tips(sender_id);
CREATE INDEX IF NOT EXISTS idx_tips_recipient ON tips(recipient_id);
CREATE INDEX IF NOT EXISTS idx_tips_host ON tips(host_id);
CREATE INDEX IF NOT EXISTS idx_tips_session ON tips(call_session_id);
