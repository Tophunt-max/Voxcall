-- Fix: Clean up stuck call_sessions that were never reaped due to the
-- 'processing' CHECK constraint bug in the cron reaper.
-- Any call still 'pending' or 'active' older than 5 minutes is dead.
UPDATE call_sessions
SET status = 'ended',
    ended_at = unixepoch(),
    duration_seconds = CASE
      WHEN status = 'active' AND started_at IS NOT NULL
        THEN unixepoch() - started_at
      ELSE 0
    END,
    coins_charged = 0
WHERE status IN ('pending', 'active')
  AND created_at < unixepoch() - 300;
