-- 0046_achievement_windows.sql
--
-- Add a rolling-window / duration mechanic to achievements. Each achievement
-- now has a `duration_days` field:
--
--   0  → evergreen (existing behaviour, no time pressure)
--   >0 → time-limited quest. When a user first makes progress on this
--        achievement, a `user_achievement_progress` row is created with
--        `started_at = now`. The user has `duration_days` days to complete
--        it. If they don't, the row is reset (counter → 0, started_at
--        pushed forward on the next bump) so they can try again.
--
-- This decouples achievement progress from the lifetime global counter
-- (user_trigger_counters). The global counter still exists for
-- always-cumulative achievements (duration_days = 0) and for admin
-- analytics; the new per-achievement table drives the actual unlock logic.
--
-- Default: every existing seeded achievement gets `duration_days = 7` so
-- the whole surface turns into weekly quests without any admin action.
-- Admin can override on a per-achievement basis (0 = evergreen).

-- ── 1. Extend reward_achievements with duration_days ─────────────────────
-- Guarded via a temp check because SQLite doesn't have `ADD COLUMN IF NOT
-- EXISTS`. autoMigrate always runs statements individually, so a repeat run
-- would trip the "duplicate column" error unless we bail out on the second
-- pass. The check uses `pragma_table_info` (D1-compatible).
--
-- On D1 (Cloudflare's SQLite), pragma_table_info is safe to query inside
-- a migration, but we can't conditionally ADD COLUMN in pure SQL. Instead
-- we accept the possible "duplicate column" error on re-runs — the wrapper
-- treats it as a no-op (already-migrated). See autoMigrate for that logic.
ALTER TABLE reward_achievements ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 0;

-- Every previously-seeded achievement becomes a 7-day quest by default.
UPDATE reward_achievements SET duration_days = 7 WHERE duration_days = 0;

-- ── 2. Per-user per-achievement progress + rolling window ────────────────
CREATE TABLE IF NOT EXISTS user_achievement_progress (
  user_id         TEXT NOT NULL,
  achievement_id  TEXT NOT NULL,
  current_count   INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_ach_prog_user ON user_achievement_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ach_prog_ach ON user_achievement_progress(achievement_id);
