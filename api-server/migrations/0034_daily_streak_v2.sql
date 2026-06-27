-- 0034_daily_streak_v2.sql
--
-- Daily rewards engagement v2. Mirrors lib/schemaGuard.ts (ensureStreakSchema)
-- so the hand-applied (`wrangler d1 migrations apply`) and runtime
-- auto-migrator paths converge on the same end state.
--
-- Adds the columns the freeze/repair, monthly-chest, longest-streak and
-- reminder logic read, plus the new admin-tunable app_settings knobs. Every
-- new setting defaults to "no behavior change" so an existing economy is
-- untouched until an admin opts in from the Settings page.
--
-- Idempotent: the auto-migrator tolerates "duplicate column" errors on
-- re-run, and the settings use INSERT OR IGNORE so an admin's tuned values
-- are never overwritten.

-- ── 1. New user columns (freeze tokens, monthly counters, longest streak) ──
ALTER TABLE users ADD COLUMN streak_freezes INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN streak_month_key TEXT;
ALTER TABLE users ADD COLUMN streak_claims_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN streak_chest_month TEXT;
ALTER TABLE users ADD COLUMN streak_max INTEGER DEFAULT 0;

-- ── 2. New economy knobs (all "off"/neutral by default) ────────────────────
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('daily_streak_comeback_bonus',    '0'),
  ('daily_streak_guest_multiplier',  '1'),
  ('daily_streak_minute_rewards',    '{}'),
  ('daily_streak_freeze_enabled',    '0'),
  ('daily_streak_freeze_monthly',    '2'),
  ('daily_streak_repair_cost_coins', '50'),
  ('daily_streak_chest_enabled',     '0'),
  ('daily_streak_chest_threshold',   '20'),
  ('daily_streak_chest_reward',      '500'),
  ('daily_streak_reminder_enabled',  '1'),
  ('daily_streak_reminder_hour_ist', '20');

-- ── 3. Extend the milestone curve with long-horizon rewards (180/365) ──────
-- Only rewrites the row when it is still the original 5-tier default, so a
-- custom milestone map configured by an admin is never clobbered.
UPDATE app_settings
   SET value = '{"7":50,"14":100,"30":500,"60":1500,"100":5000,"180":12000,"365":30000}'
 WHERE key = 'daily_streak_milestones'
   AND value = '{"7":50,"14":100,"30":500,"60":1500,"100":5000}';
