-- Migration 0026: Random Call feature controls
--
-- Adds host-side opt-in flags, a tracking column on call_sessions, and a
-- short-lived history table so the random matchmaker can:
--   1. Skip hosts who don't want to be in the random pool.
--   2. Skip hosts who can't (or don't want to) take video calls.
--   3. Tag any session that originated from /match/find so analytics and
--      the host UI can distinguish random calls from direct ones.
--   4. Avoid re-matching the same host to the same caller within a short
--      window, and enforce per-day caps + post-decline cooldowns.
--
-- All flags default to "behave like before" so existing rows are unaffected:
--   - accepts_random_calls = 1  (every existing host stays in the pool)
--   - allows_video         = 1  (every existing host can take video calls)
--   - is_random_match      = 0  (every historical call stays "direct")

-- 1. Host-side toggles ──────────────────────────────────────────────────────
ALTER TABLE hosts ADD COLUMN accepts_random_calls INTEGER DEFAULT 1;
ALTER TABLE hosts ADD COLUMN allows_video INTEGER DEFAULT 1;

-- Random matchmaker filters on these flags + is_active + is_online; the
-- composite index covers that filter plus the user_id self-exclusion check.
CREATE INDEX IF NOT EXISTS idx_hosts_random_pool
  ON hosts(is_active, is_online, accepts_random_calls);

-- 2. Mark random-match sessions ─────────────────────────────────────────────
ALTER TABLE call_sessions ADD COLUMN is_random_match INTEGER DEFAULT 0;

-- 3. No-repeat / decline-cooldown / daily-limit state ───────────────────────
--
-- Lightweight log of who-matched-whom-when. The matcher reads it for three
-- separate guards (no-repeat, daily limit, decline cooldown) so this table
-- is on the hot path — keep it narrow + indexed.
--
-- `outcome` is set when the caller resolves the match:
--   'matched'   -> server returned a host (default on insert)
--   'accepted'  -> caller accepted and the call started
--   'declined'  -> caller decline button (or "skip / next match")
--   'timeout'   -> caller never resolved within the poll window
CREATE TABLE IF NOT EXISTS random_match_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  call_type TEXT NOT NULL CHECK(call_type IN ('audio','video')),
  outcome TEXT NOT NULL DEFAULT 'matched'
    CHECK(outcome IN ('matched','accepted','declined','timeout')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Daily-limit + decline-cooldown queries scan a user's recent rows by time.
CREATE INDEX IF NOT EXISTS idx_random_match_user_time
  ON random_match_history(user_id, created_at DESC);

-- No-repeat guard: "did this user already match this host in the last N min?"
CREATE INDEX IF NOT EXISTS idx_random_match_user_host_time
  ON random_match_history(user_id, host_id, created_at DESC);
