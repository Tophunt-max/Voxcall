-- Rate limiting table: tracks request counts per IP+route window
CREATE TABLE IF NOT EXISTS rate_limits (
  id           TEXT PRIMARY KEY,  -- key: "rl:<route>:<ip>:<window>"
  attempts     INTEGER NOT NULL DEFAULT 1,
  window_reset INTEGER NOT NULL   -- Unix timestamp when this window expires
);

-- Auto-clean expired entries (Cloudflare D1 does not run background jobs,
-- so we rely on INSERT OR REPLACE + window_reset checks at query time)
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (window_reset);
