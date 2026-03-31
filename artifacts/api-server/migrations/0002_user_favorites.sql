-- Migration: Add user_favorites + improve talk_topics + faqs
-- Add missing columns to talk_topics
ALTER TABLE talk_topics ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE talk_topics ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add missing sort_order to faqs (already has order_index, add sort_order as alias)
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add user_favorites table
CREATE TABLE IF NOT EXISTS user_favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, host_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_host ON user_favorites(host_id);
