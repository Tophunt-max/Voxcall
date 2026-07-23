-- Migration 0064: Scheduled admin notifications
--
-- The admin panel's Bulk Notifications screen has a "Schedule for later"
-- toggle, but the backend previously ignored it and sent immediately. This
-- table lets /admin/notifications/send store a future send and a cron job
-- (deliverDueScheduledNotifications) fan it out when it's due.
--
-- status: 'pending' → 'sending' (atomic cron claim) → 'sent' | 'failed'.
-- target mirrors the immediate-send API: 'all' | 'hosts' | 'user'.
-- Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'system',
  target        TEXT NOT NULL DEFAULT 'all',
  user_id       TEXT,
  schedule_time INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  sent_count    INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at       INTEGER
);

-- The cron polls for due, still-pending rows — index that access path.
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due
  ON scheduled_notifications(status, schedule_time);
