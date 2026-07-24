-- 0069_reward_monthly_tasks.sql
--
-- Monthly Tasks — a new task cycle for the Rewards / Tasks page, modelled on
-- the Chamet "Monthly Tasks (x/y)" surface. A monthly task accumulates progress
-- across the whole calendar month (UTC) and can be claimed ONCE per month once
-- its target is reached; at the UTC month boundary the progress + claim state
-- reset automatically so the task is available again the next month.
--
-- Implementation notes
-- --------------------
-- • Monthly tasks live in the SAME `reward_tasks` table with `category = 'monthly'`.
--   The `category` column is a free-text string (see 0043) so no schema change is
--   needed to allow the new value — the backend (routes/rewards.ts) interprets
--   `monthly` specially.
-- • Per-user monthly state reuses `user_reward_progress`. We add a `period_key`
--   column ('YYYY-MM' in UTC) that records WHICH month the current_count /
--   claim_count belong to. When the stored period_key no longer matches the
--   current month, the backend treats the progress as reset (0 / unclaimed) and
--   rotates the row on the next bump/claim. Daily / one-time / ongoing tasks
--   leave period_key NULL and are completely unaffected.
--
-- Idempotent: ALTER is tolerated by the auto-migrator's "duplicate column name"
-- guard, and all seeds use INSERT OR IGNORE.

-- ── 1. Per-user monthly period tracking ─────────────────────────────────────
ALTER TABLE user_reward_progress ADD COLUMN period_key TEXT;
CREATE INDEX IF NOT EXISTS idx_user_reward_progress_period
  ON user_reward_progress(user_id, period_key);

-- ── 2. Seed a few monthly tasks so a fresh install has a working page ───────
-- cooldown_hours is irrelevant for monthly tasks (claim cadence is the calendar
-- month, enforced by period_key) — kept 0. Rewards are chunkier than daily
-- tasks to make the monthly cycle feel worth chasing.
INSERT OR IGNORE INTO reward_tasks
  (id,                     code,                title,                    description,                                                  icon,      category,  task_type,        target_count, coins_reward, cooldown_hours, sort_order) VALUES
  ('rt_monthly_30_calls',  'monthly_30_calls',  'Complete 30 Calls',      'Complete 30 calls this month to earn a big bonus.',          'call',    'monthly', 'complete_calls',  30,          500,          0,              210),
  ('rt_monthly_spend_1000','monthly_spend_1000','Spend 1000 Coins',       'Spend 1000 coins on calls this month for a monthly reward.', 'coin',    'monthly', 'spend_coins',   1000,          300,          0,              220),
  ('rt_monthly_refer_3',   'monthly_refer_3',   'Invite 3 Friends',       'Invite 3 friends this month and earn a monthly bonus.',      'invite',  'monthly', 'refer_friend',     3,          400,          0,              230);
