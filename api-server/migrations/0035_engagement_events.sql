-- 0035_engagement_events.sql
--
-- Engagement event logging: the feedback loop for the personalized
-- recommender (lib/recommend.ts) and the home feed. Until now the only
-- behavioral signal we stored was a COMPLETED call (a conversion); we never
-- captured impressions or clicks, so we could not measure rail CTR /
-- conversion or move exploration from blind jitter toward data-driven ranking.
--
-- Two tables:
--   • engagement_events     — append-only raw events (impression/click/etc.).
--                             Pruned to engagement_events_retention_days by the
--                             daily rollup cron so it stays bounded on D1.
--   • host_engagement_stats — per-host per-day rollup (impressions/clicks/
--                             conversions) the recommender + admin can read
--                             cheaply without scanning the raw table.
--
-- Mirrors lib/schemaGuard.ts (ensureEngagementSchema) so the hand-applied
-- (`wrangler d1 migrations apply`) and runtime auto-migrator paths converge on
-- the same end state. Idempotent: CREATE ... IF NOT EXISTS + INSERT OR IGNORE.

-- ── 1. Raw append-only event log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  -- e.g. reco_impression, reco_click, host_click, call_start, call_complete
  event_type  TEXT NOT NULL,
  -- nullable: not every event targets a specific host
  host_id     TEXT,
  -- where it happened: home_reco, home_top, search, random, banner
  surface     TEXT,
  -- optional: the model score at impression time (for offline analysis)
  score       REAL,
  -- optional small JSON blob for extra context (capped server-side)
  meta        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_engagement_events_host_type_time ON engagement_events(host_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_engagement_events_user_time ON engagement_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_engagement_events_type_time ON engagement_events(event_type, created_at);

-- ── 2. Per-host per-day rollup (cheap reads for ranking + admin) ────────────
CREATE TABLE IF NOT EXISTS host_engagement_stats (
  host_id      TEXT NOT NULL,
  day          TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  conversions  INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (host_id, day)
);
CREATE INDEX IF NOT EXISTS idx_host_engagement_stats_day ON host_engagement_stats(day);

-- ── 3. Tunable knobs (all admin-editable; safe defaults) ────────────────────
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('engagement_events_enabled',        '1'),
  ('engagement_events_retention_days', '30'),
  ('last_engagement_rollup_day',       '0');
