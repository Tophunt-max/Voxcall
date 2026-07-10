-- Migration: index hosts.level for the rank-boost ordering
--
-- Host listings and matchmaking ORDER BY a CASE expression over hosts.level
-- (rank_boost per level). Without an index D1 scans + sorts all hosts. This
-- composite index covers the common "active + level" access pattern used by
-- the rank-boosted listing/recommendation queries.
CREATE INDEX IF NOT EXISTS idx_hosts_level ON hosts(is_active, level);
