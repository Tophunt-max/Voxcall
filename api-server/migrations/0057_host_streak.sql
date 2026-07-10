-- Migration: host daily streak (engagement)
--
-- Tracks a host's consecutive-active-day streak (credited when they come online
-- each IST day) so we can reward daily engagement with bonus coins. Streak
-- reward coins are intentionally engagement bonuses (NOT hosts.total_earnings),
-- so they never inflate the work-based level system.

ALTER TABLE hosts ADD COLUMN streak_days        INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN last_streak_day_at INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN streak_max         INTEGER DEFAULT 0;

-- Admin-tunable config (schedule = per-cycle-day reward; milestones = one-time
-- bonuses). Seeded via INSERT OR IGNORE so admin edits are never overwritten.
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('host_streak_enabled',    '1',                                                unixepoch()),
  ('host_streak_schedule',   '[0,10,15,20,30,50,75]',                            unixepoch()),
  ('host_streak_milestones', '{"7":100,"14":250,"30":1000,"60":3000,"100":10000}', unixepoch());
