-- Migration 0027: Daily login streak rewards
--
-- Engagement / retention layer ("Layer 4" of the coin economy). A user who
-- opens the app and taps "Claim" once per day:
--   - increments their consecutive-day streak
--   - earns coins from the admin-tunable schedule (default 5/10/15/20/30/50/100)
--   - earns a milestone bonus on streak = 7 / 14 / 30 / 60 / 100
--
-- Schema additions (idempotent — re-runnable):
--   users.streak_days           : current consecutive-day count (resets to 1
--                                 if the user skips a calendar day in IST).
--   users.last_streak_claim_at  : Unix-epoch seconds of the most recent
--                                 successful claim. Used to (a) detect "am I
--                                 in the same calendar day as last claim?"
--                                 (already-claimed guard) and (b) detect
--                                 "did I claim yesterday?" (continue vs
--                                 reset).
--
-- The schedule + milestones live in app_settings (JSON) so an admin can
-- retune the reward curve without a code redeploy. Defaults are seeded
-- here on first apply.

ALTER TABLE users ADD COLUMN streak_days INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_streak_claim_at INTEGER DEFAULT 0;

-- Default 7-day rotating reward schedule + milestone bonuses.
-- Tunable via Admin Panel → Settings → Engagement once we expose the keys.
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('daily_streak_schedule', '[5,10,15,20,30,50,100]', unixepoch()),
  ('daily_streak_milestones', '{"7":50,"14":100,"30":500,"60":1500,"100":5000}', unixepoch()),
  ('daily_streak_enabled', '1', unixepoch());
