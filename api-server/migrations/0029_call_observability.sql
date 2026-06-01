-- Migration 0029: Calling system observability + Layer-4 polish
--
-- Adds the missing pieces from the calling-system algorithm review:
--   1. call_sessions.end_reason — granular taxonomy of WHY a call ended.
--      Lets analytics distinguish caller_hangup vs host_hangup vs balance_zero
--      vs heartbeat_timeout vs cron_reaped without parsing description strings.
--   2. call_quality — per-call quality metrics (jitter, packet loss, RTT)
--      sampled by the client every ~30s during active calls. Drives a future
--      "Top quality hosts" filter and helps debug user-reported call drops.
--   3. app_settings rows for two new billing/UX knobs:
--        billing_granularity_sec    (default 60)  per-minute round-up; flip
--                                                  to 1 for whole-second
--                                                  precision billing.
--        low_balance_warn_seconds   (default 60)  push call_low_balance WS
--                                                  event when caller has
--                                                  < this many seconds left.
--
-- All defaults preserve historical behaviour:
--   - end_reason defaults to NULL on existing rows (legacy calls stay
--     "unknown reason" — only new calls get tagged).
--   - billing_granularity_sec defaults to 60 → identical math to before.
--   - low_balance_warn_seconds defaults to 60 → opt-in feature; client
--     ignores the WS event if it doesn't know about it.

-- 1. End-call reason ────────────────────────────────────────────────────────
-- TEXT instead of CHECK constraint so we can add new reasons later without
-- another migration. Application-level validation enforces the canonical set
-- ('caller_hangup' | 'host_hangup' | 'declined' | 'missed' |
--  'balance_zero' | 'heartbeat_timeout' | 'cron_reaped' |
--  'force_admin' | 'connection_lost').
ALTER TABLE call_sessions ADD COLUMN end_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_call_sessions_end_reason
  ON call_sessions(end_reason)
  WHERE end_reason IS NOT NULL;

-- 2. Call quality metrics ──────────────────────────────────────────────────
-- One row per quality sample (client posts every 30s). Narrow + indexed for
-- per-host aggregation — avg(jitter_ms), p95(packet_loss_pct) etc.
--
-- `role` distinguishes caller-side vs host-side measurements; both parties
-- post their own samples since network conditions are asymmetric.
CREATE TABLE IF NOT EXISTS call_quality (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  call_session_id TEXT NOT NULL REFERENCES call_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('caller','host')),
  -- Per-second jitter (RFC 3550) in milliseconds. NULL when the client
  -- couldn't measure it (early in the call before any RTCP report).
  jitter_ms REAL,
  -- 0.0 – 100.0 percent of packets lost in the sampling window.
  packet_loss_pct REAL,
  -- Round-trip time milliseconds (from STUN binding requests).
  rtt_ms REAL,
  -- Selected codec for analytics (e.g. 'opus', 'h264', 'vp8').
  codec TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_call_quality_session
  ON call_quality(call_session_id);
CREATE INDEX IF NOT EXISTS idx_call_quality_user_time
  ON call_quality(user_id, created_at DESC);

-- 3. Settings — billing granularity + low-balance warning threshold ────────
-- INSERT OR IGNORE so re-running on an already-seeded DB is a no-op.
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('billing_granularity_sec', '60', unixepoch()),
  ('low_balance_warn_seconds', '60', unixepoch());
