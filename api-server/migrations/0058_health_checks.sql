-- Health check history table — stores per-minute health probe results so the
-- admin dashboard can render uptime %, latency charts, and incident timelines.
-- Cron writes one row every minute; pruned to 7 days retention by the same cron.
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at INTEGER NOT NULL,               -- unix seconds
  -- Overall verdict
  overall_status TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'degraded' | 'down'
  -- Per-service probe results (ms latency, -1 = unreachable)
  db_latency_ms INTEGER NOT NULL DEFAULT 0,
  db_status TEXT NOT NULL DEFAULT 'ok',
  r2_latency_ms INTEGER NOT NULL DEFAULT 0,
  r2_status TEXT NOT NULL DEFAULT 'ok',
  agora_status TEXT NOT NULL DEFAULT 'ok',   -- ok | unconfigured | error
  fcm_status TEXT NOT NULL DEFAULT 'ok',     -- ok | unconfigured | error
  email_status TEXT NOT NULL DEFAULT 'ok',   -- ok | unconfigured
  -- Counters (snapshot at probe time)
  active_calls INTEGER NOT NULL DEFAULT 0,
  online_hosts INTEGER NOT NULL DEFAULT 0,
  error_count_hour INTEGER NOT NULL DEFAULT 0,
  -- Cron health — seconds since last successful cron execution
  cron_age_sec INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_health_checks_at ON health_checks (checked_at DESC);
