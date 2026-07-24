-- Migration 0067: More denormalized host metrics for the level system
--
-- Adds two work/availability signals the flexible level engine can gate on
-- (see METRIC_REGISTRY in lib/levels.ts):
--
--   • online_minutes — cumulative time the host has spent ONLINE/available.
--       Accumulated on the /host/status toggle: a fresh timestamp is stamped
--       into `online_since` when the host goes online, and the elapsed minutes
--       (capped at 24h per session to guard against a stuck-online host) are
--       added to `online_minutes` when they go offline.
--   • active_days   — lifetime count of distinct IST days the host was active
--       (came online). Incremented exactly once per day by the same atomic CAS
--       that credits the daily streak (lib/hostStreak.ts), so it can never
--       double-count. Unlike `streak_max` (which resets on a missed day) this
--       is a monotonic measure of total effort over the host's lifetime.
--
-- Two derived metrics (avg_call_minutes, repeat_callers) need NO column — they
-- are computed at read time from existing counters (total_minutes /
-- answered_calls, and answered_calls - unique_callers respectively).

ALTER TABLE hosts ADD COLUMN online_minutes INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN online_since   INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN active_days    INTEGER DEFAULT 0;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- active_days: approximate historical activity from the number of distinct IST
-- calendar days on which the host had a completed (ended) call. IST is UTC+5:30
-- = 19800 seconds, so the IST day index is floor((ended_at + 19800) / 86400).
-- This is the best proxy available (there is no per-day presence log), and it
-- only ever undercounts (online-without-a-call days aren't captured), which is
-- the safe direction for a promotion-only system.
UPDATE hosts SET active_days = (
  SELECT COUNT(DISTINCT (cs.ended_at + 19800) / 86400)
  FROM call_sessions cs
  WHERE cs.host_id = hosts.id AND cs.status = 'ended' AND cs.ended_at IS NOT NULL
);

-- online_minutes has no historical source (online-time was never recorded) and
-- online_since starts cleared — both begin accumulating from the next toggle.
