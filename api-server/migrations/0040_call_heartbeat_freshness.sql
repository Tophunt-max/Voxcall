-- Migration 0040: Call heartbeat freshness
--
-- Adds call_sessions.last_heartbeat_at — a unix timestamp stamped every ~25s
-- by POST /api/calls/:id/heartbeat while a call is active.
--
-- Why: the stale-call cron reaper previously force-ended ANY active call whose
-- `started_at` was older than 30 minutes. That kills perfectly healthy long
-- calls (a 31-minute conversation would be dropped) AND lets a dead-client
-- call linger for up to 30 minutes. With a heartbeat timestamp the reaper can
-- instead end only calls whose client has gone SILENT (no heartbeat within the
-- staleness window), so healthy calls of any length survive and crashed/idle
-- clients are reaped within a few minutes.
--
-- NULL on existing rows; the reaper coalesces to `started_at` for any call
-- that hasn't heartbeated yet, preserving a sane fallback.

ALTER TABLE call_sessions ADD COLUMN last_heartbeat_at INTEGER;

-- Partial index over active calls only — the reaper's hot query filters on
-- status = 'active' and orders by freshness. Keeps the index tiny (most rows
-- are 'ended').
CREATE INDEX IF NOT EXISTS idx_call_sessions_active_heartbeat
  ON call_sessions(last_heartbeat_at)
  WHERE status = 'active';
