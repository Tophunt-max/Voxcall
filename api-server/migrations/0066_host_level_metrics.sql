-- Migration 0066: Denormalized host metrics for the flexible level-up system
--
-- The level engine now supports arbitrary per-level criteria (see lib/levels.ts
-- METRIC_REGISTRY). Some new metrics are expensive to compute on the hot path
-- (COUNT(DISTINCT caller_id), answered/incoming ratios, favorite counts), so we
-- DENORMALIZE them onto the hosts row and keep them fresh with O(1) increments
-- at the relevant choke points:
--
--   • incoming_calls   — bumped on /call/initiate (every call created)
--   • answered_calls   — bumped on /call/:id/answer when accepted (status→active)
--   • unique_callers   — bumped on the FIRST accepted call from a new caller
--   • favorite_count   — bumped on /user/favorites add, decremented on remove
--
-- answer_rate is DERIVED at read time as answered_calls / incoming_calls (see
-- resolveMetricValue in lib/levels.ts), so it needs no column of its own.
--
-- All four columns default to 0 and are BACKFILLED below from existing data so
-- the metrics are accurate the moment this migration lands (no cold-start skew).

ALTER TABLE hosts ADD COLUMN unique_callers  INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN answered_calls  INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN incoming_calls  INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN favorite_count  INTEGER DEFAULT 0;

-- ── Backfill from historical data ──────────────────────────────────────────
-- incoming_calls = every call_session ever created for the host (any status).
UPDATE hosts SET incoming_calls = (
  SELECT COUNT(*) FROM call_sessions cs WHERE cs.host_id = hosts.id
);

-- answered_calls = calls the host actually picked up. A call that reached
-- 'active' or 'ended' was answered; 'missed'/'declined'/'pending' were not.
UPDATE hosts SET answered_calls = (
  SELECT COUNT(*) FROM call_sessions cs
  WHERE cs.host_id = hosts.id AND cs.status IN ('active', 'ended')
);

-- unique_callers = distinct callers who reached an answered/completed call.
UPDATE hosts SET unique_callers = (
  SELECT COUNT(DISTINCT cs.caller_id) FROM call_sessions cs
  WHERE cs.host_id = hosts.id AND cs.status IN ('active', 'ended')
);

-- favorite_count = current followers (rows in user_favorites for this host).
UPDATE hosts SET favorite_count = (
  SELECT COUNT(*) FROM user_favorites uf WHERE uf.host_id = hosts.id
);

-- Ranking / analytics can order by these; a covering index on the popularity
-- signals keeps discovery queries cheap as the host base grows.
CREATE INDEX IF NOT EXISTS idx_hosts_unique_callers ON hosts(unique_callers);
CREATE INDEX IF NOT EXISTS idx_hosts_favorite_count ON hosts(favorite_count);
