-- 0045_reward_trigger_counters.sql
--
-- Single-source-of-truth counters for user progress across every reward
-- trigger_type. Previously, achievement progress was derived by summing
-- `user_reward_progress` rows across tasks — which meant an achievement
-- whose `trigger_type` had NO matching reward_task couldn't accumulate
-- progress. This table decouples progress from tasks: any event (call
-- end, coin top-up, referral verify, watch_ad, share_app, daily check-in,
-- talk_minutes) bumps this counter directly, and both tasks and
-- achievements read from it.
--
-- Also seeds two new achievement dimensions:
--   • coin_topup / coin_topup_count — reward users for buying coins
--   • talk_minutes — reward total conversation time
--
-- All statements are idempotent (CREATE ... IF NOT EXISTS + INSERT OR IGNORE)
-- so the migration is safe to re-run via the autoMigrate manifest.

-- ── 1. User trigger counters (single source of truth for progress) ─────────
CREATE TABLE IF NOT EXISTS user_trigger_counters (
  user_id      TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, trigger_type)
);
CREATE INDEX IF NOT EXISTS idx_user_trigger_counters_type ON user_trigger_counters(trigger_type, user_id);

-- ── 2. Backfill from existing reward-progress data ─────────────────────────
-- Long-tenured users shouldn't lose their earned progress. Sum
-- current_count + (claim_count * target_count) per (user_id, task_type) —
-- this mirrors what bumpRewardProgress used to compute inline for achievement
-- checks. INSERT OR IGNORE keeps this idempotent if run again.
INSERT OR IGNORE INTO user_trigger_counters (user_id, trigger_type, count, updated_at)
SELECT p.user_id,
       t.task_type AS trigger_type,
       SUM(p.current_count + COALESCE(p.claim_count * t.target_count, 0)) AS count,
       unixepoch()
  FROM user_reward_progress p
  INNER JOIN reward_tasks t ON t.id = p.task_id
 WHERE p.current_count > 0 OR p.claim_count > 0
 GROUP BY p.user_id, t.task_type
HAVING SUM(p.current_count + COALESCE(p.claim_count * t.target_count, 0)) > 0;

-- ── 3. New seed achievements: coin_topup, coin_topup_count, talk_minutes ──
--
-- Tiers scale coin rewards. Thresholds pick natural round numbers so users
-- have obvious milestones to chase.
INSERT OR IGNORE INTO reward_achievements
  (id, code, title, description, icon, tier, trigger_type, trigger_threshold, coins_reward, sort_order) VALUES
  -- Coin top-up (total coins purchased over lifetime)
  ('ach_topup_100',      'first_topup',       'First Top-Up',       'Bought your first 100 coins.',                  'coin',   'bronze',   'coin_topup',        100,   20,    100),
  ('ach_topup_500',      'topup_saver',       'Top-Up Saver',       'Purchased 500 coins in total.',                 'coin',   'bronze',   'coin_topup',        500,   50,    110),
  ('ach_topup_5000',     'topup_backer',      'Top-Up Backer',      'Purchased 5,000 coins in total.',               'coin',   'silver',   'coin_topup',        5000,  500,   120),
  ('ach_topup_25000',    'topup_patron',      'Top-Up Patron',      'Purchased 25,000 coins in total.',              'coin',   'gold',     'coin_topup',        25000, 2500,  130),
  ('ach_topup_100000',   'topup_whale',       'Top-Up Whale',       'Purchased 100,000 coins in total.',             'coin',   'platinum', 'coin_topup',        100000,10000, 135),

  -- Coin top-up count (number of separate purchases)
  ('ach_topup_count_1',  'first_topup_tx',    'First Purchase',     'Completed your first coin purchase.',           'gift',   'bronze',   'coin_topup_count',  1,     30,    140),
  ('ach_topup_count_5',  'regular_supporter', 'Regular Supporter',  'Made 5 coin purchases.',                        'gift',   'silver',   'coin_topup_count',  5,     200,   150),
  ('ach_topup_count_20', 'super_supporter',   'Super Supporter',    'Made 20 coin purchases.',                       'gift',   'gold',     'coin_topup_count',  20,    1000,  160),

  -- Talk minutes (total conversation time across all calls)
  ('ach_talk_30',        'chatty_starter',    'Chatty Starter',     'Talked for a total of 30 minutes.',             'call',   'bronze',   'talk_minutes',      30,    30,    170),
  ('ach_talk_120',       'chatty_regular',    'Chatty Regular',     'Talked for a total of 2 hours.',                'call',   'silver',   'talk_minutes',      120,   150,   180),
  ('ach_talk_600',       'chatty_pro',        'Chatty Pro',         'Talked for a total of 10 hours.',               'call',   'gold',     'talk_minutes',      600,   1000,  190),
  ('ach_talk_3000',      'chatty_legend',     'Chatty Legend',      'Talked for a total of 50 hours.',               'call',   'platinum', 'talk_minutes',      3000,  5000,  200);
