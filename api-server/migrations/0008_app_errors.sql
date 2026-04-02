-- App error logs: stores client-side crash reports from mobile/web
CREATE TABLE IF NOT EXISTS app_errors (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id     TEXT,
  message     TEXT NOT NULL,
  stack       TEXT,
  context     TEXT,
  platform    TEXT,
  app_version TEXT,
  extra       TEXT,  -- JSON blob
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_app_errors_user ON app_errors (user_id);
CREATE INDEX IF NOT EXISTS idx_app_errors_created ON app_errors (created_at DESC);
