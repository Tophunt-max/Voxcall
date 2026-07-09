-- 0043_reward_tasks.sql
--
-- Reward / Rewards Hub — production-grade coin-earning tasks the user can
-- complete inside the app. This gives the trophy button a proper destination
-- and creates a first-class earning surface without touching the referral
-- system.
--
-- Two tables:
--   • reward_tasks          — admin-editable catalog of tasks (title, reward,
--                             target, cooldown). Seeded with sensible defaults
--                             so a fresh install has a working page.
--   • user_reward_progress  — per-user state on each task (progress + last
--                             claimed time + lifetime earnings from the task).
--
-- Design:
--   • Task types are behavioural (daily_checkin, complete_calls, refer_friend,
--     spend_coins, watch_ad, share_app). The backend increments matching
--     progress rows when the corresponding event happens (see bumpRewardProgress
--     in routes/rewards.ts). "daily_checkin" auto-completes on claim.
--   • cooldown_hours = 0  → one-time task (claim once, ever).
--   • cooldown_hours > 0  → recurring task; after claim the count resets to 0
--                           and the user can claim again after the cooldown.
--   • Coins are credited via UPDATE users SET coins = coins + ? in a batch
--     alongside a coin_transactions row (type = 'bonus'), matching every
--     other coin-earning path in the codebase.
--
-- All statements are idempotent (CREATE ... IF NOT EXISTS + INSERT OR IGNORE)
-- so the migration is safe to re-run via the autoMigrate manifest.

-- ── 1. Task catalog ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reward_tasks (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,           -- stable machine key, e.g. 'daily_checkin'
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  icon           TEXT NOT NULL DEFAULT 'gift',   -- semantic hint for the client renderer
  category       TEXT NOT NULL DEFAULT 'daily',  -- daily / one_time / ongoing (UI grouping)
  task_type      TEXT NOT NULL,                  -- daily_checkin / complete_calls / refer_friend / spend_coins / watch_ad / share_app
  target_count   INTEGER NOT NULL DEFAULT 1,     -- units required before claim is enabled
  coins_reward   INTEGER NOT NULL,               -- coins credited on claim
  cooldown_hours INTEGER NOT NULL DEFAULT 0,     -- 0 = one-time; 24 = daily; 168 = weekly
  cta_link       TEXT NOT NULL DEFAULT '',       -- optional in-app deep link
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reward_tasks_active_sort ON reward_tasks(active, sort_order);
CREATE INDEX IF NOT EXISTS idx_reward_tasks_task_type   ON reward_tasks(task_type);

-- ── 2. Per-user progress ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_reward_progress (
  user_id         TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  current_count   INTEGER NOT NULL DEFAULT 0,     -- units accumulated since last claim (or ever, for one-time tasks)
  claim_count     INTEGER NOT NULL DEFAULT 0,     -- how many times this task has been claimed
  last_claimed_at INTEGER,                        -- unix ts; null if never claimed
  total_earned    INTEGER NOT NULL DEFAULT 0,     -- lifetime coins earned from this task
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_user_reward_progress_user ON user_reward_progress(user_id);

-- ── 3. Seed default tasks so a fresh install has a working page ─────────────
--
-- Coin values are intentionally conservative so admins can tune them up.
-- codes are stable — the client can rely on them for icon lookup / analytics.
INSERT OR IGNORE INTO reward_tasks
  (id,                    code,              title,                     description,                                                     icon,      category,   task_type,        target_count, coins_reward, cooldown_hours, sort_order) VALUES
  ('rt_daily_checkin',    'daily_checkin',   'Daily Check-in',          'Open the app and collect your daily bonus coins.',              'calendar','daily',    'daily_checkin',   1,           10,           24,             10),
  ('rt_first_call',       'first_call',      'Make Your First Call',    'Complete your very first call and unlock a bonus.',             'call',    'one_time', 'complete_calls',  1,           50,           0,              20),
  ('rt_ten_calls',        'ten_calls',       'Complete 10 Calls',       'Complete 10 calls to earn a bonus. Progress carries forward.',  'call',    'ongoing',  'complete_calls', 10,          100,           0,              30),
  ('rt_refer_one',        'refer_1_friend',  'Invite 1 Friend',         'Invite a friend and both of you earn coins on their first login.', 'invite','ongoing',  'refer_friend',    1,           100,          0,              40),
  ('rt_refer_five',       'refer_5_friends', 'Invite 5 Friends',        'Grow your community — invite 5 friends for a bigger bonus.',    'invite',  'ongoing',  'refer_friend',    5,           500,          0,              50),
  ('rt_spend_100',        'spend_100_coins', 'Spend 100 Coins on Calls','Complete calls totalling 100 coins.',                           'coin',    'ongoing',  'spend_coins',   100,           20,           0,              60),
  ('rt_watch_ad',         'watch_ad',        'Watch a Video Ad',        'Watch a short video ad to earn coins. Available 5x per day.',   'video',   'daily',    'watch_ad',        1,            5,           4,             70),
  ('rt_share_app',        'share_app',       'Share the App',           'Share the app with anyone — get bonus coins once per day.',     'share',   'daily',    'share_app',       1,           10,          24,             80);
