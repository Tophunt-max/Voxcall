-- 0044_reward_dopamine.sql
--
-- Production-grade dopamine mechanics layered on top of the existing
-- reward_tasks system (migration 0043).
--
-- Adds:
--   • Lucky Spin Wheel (variable reward, biggest single dopamine driver)
--   • Time-limited Campaigns (FOMO multipliers on top of every claim)
--   • Coupon Codes (marketing lever redeemable for coins)
--   • Achievements (silent milestones with tiered badges)
--   • Budget cap tracking (production safety — hard ceiling on daily payouts)
--
-- Every payout path — claim, spin, coupon, achievement — funnels through the
-- same atomic UPDATE users + INSERT coin_transactions batch used elsewhere in
-- the codebase, plus an UPSERT into reward_budget_daily. If any statement in
-- the batch fails the whole payout rolls back, so the ledger and reward
-- tables can never diverge.
--
-- All statements are idempotent (CREATE ... IF NOT EXISTS + INSERT OR IGNORE)
-- so the migration is safe to re-run via the autoMigrate manifest.

-- ── 1. Lucky Spin Wheel ─────────────────────────────────────────────────────
--
-- reward_spin_config is a single-row config table (id = 'default'). The
-- segments column is a JSON array of `{ label, coins, weight, color, emoji }`.
-- Weights are relative — the server picks a segment by weighted random.
-- Client renders a wheel with segments proportional to `weight`.
CREATE TABLE IF NOT EXISTS reward_spin_config (
  id                  TEXT PRIMARY KEY,
  enabled             INTEGER NOT NULL DEFAULT 1,
  daily_free_spins    INTEGER NOT NULL DEFAULT 1,
  segments            TEXT    NOT NULL,   -- JSON array
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO reward_spin_config (id, enabled, daily_free_spins, segments) VALUES (
  'default', 1, 1,
  '[
    {"label":"5 coins",    "coins":5,    "weight":30, "color":"#8B5CF6", "emoji":"🪙"},
    {"label":"10 coins",   "coins":10,   "weight":25, "color":"#EC4899", "emoji":"🪙"},
    {"label":"25 coins",   "coins":25,   "weight":18, "color":"#F59E0B", "emoji":"💰"},
    {"label":"50 coins",   "coins":50,   "weight":12, "color":"#10B981", "emoji":"💰"},
    {"label":"100 coins",  "coins":100,  "weight":8,  "color":"#3B82F6", "emoji":"🎁"},
    {"label":"250 coins",  "coins":250,  "weight":4,  "color":"#EF4444", "emoji":"🎁"},
    {"label":"500 coins",  "coins":500,  "weight":2,  "color":"#F97316", "emoji":"👑"},
    {"label":"1000 coins", "coins":1000, "weight":1,  "color":"#D946EF", "emoji":"💎"}
  ]'
);

-- Per-user spin state. free_spins_remaining resets to daily_free_spins each
-- UTC day; earned_spins_remaining never expires (granted via task rewards).
CREATE TABLE IF NOT EXISTS user_spin_state (
  user_id                 TEXT PRIMARY KEY,
  free_spins_remaining    INTEGER NOT NULL DEFAULT 0,
  earned_spins_remaining  INTEGER NOT NULL DEFAULT 0,
  last_free_reset_day     TEXT    NOT NULL DEFAULT '',  -- YYYY-MM-DD UTC
  total_spins             INTEGER NOT NULL DEFAULT 0,
  total_coins_won         INTEGER NOT NULL DEFAULT 0,
  last_win_amount         INTEGER,
  last_spun_at            INTEGER,
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS reward_spin_history (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  segment_index   INTEGER NOT NULL,
  segment_label   TEXT    NOT NULL,
  coins_won       INTEGER NOT NULL,
  campaign_id     TEXT,                 -- if a campaign multiplier was active
  spun_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spin_history_user ON reward_spin_history(user_id, spun_at DESC);

-- ── 2. Time-limited Campaigns ────────────────────────────────────────────────
--
-- A campaign is active when now() ∈ [starts_at, ends_at] AND active = 1.
-- multiplier: 2.0 means "double coins during this window".
-- applies_to_task_types: CSV of task_type strings, or empty = applies to all.
CREATE TABLE IF NOT EXISTS reward_campaigns (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  banner_image_url       TEXT NOT NULL DEFAULT '',
  starts_at              INTEGER NOT NULL,
  ends_at                INTEGER NOT NULL,
  multiplier             REAL    NOT NULL DEFAULT 1.0,
  applies_to_task_types  TEXT    NOT NULL DEFAULT '',  -- CSV; '' = all
  applies_to_spin        INTEGER NOT NULL DEFAULT 1,   -- 1 = also multiplies spin wins
  active                 INTEGER NOT NULL DEFAULT 1,
  created_at             INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_campaigns_active_end ON reward_campaigns(active, ends_at);

-- ── 3. Coupon Codes ─────────────────────────────────────────────────────────
--
-- Codes stored uppercase (redemption normalises). max_uses = null → unlimited.
-- per_user_limit caps how many times ONE user can redeem the same code.
CREATE TABLE IF NOT EXISTS reward_coupons (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  coins_reward    INTEGER NOT NULL,
  max_uses        INTEGER,                              -- null = unlimited
  used_count      INTEGER NOT NULL DEFAULT 0,
  per_user_limit  INTEGER NOT NULL DEFAULT 1,
  expires_at      INTEGER,                              -- null = never
  active          INTEGER NOT NULL DEFAULT 1,
  note            TEXT NOT NULL DEFAULT '',             -- admin-facing memo
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON reward_coupons(active, expires_at);

CREATE TABLE IF NOT EXISTS user_coupon_redemptions (
  user_id         TEXT NOT NULL,
  coupon_id       TEXT NOT NULL,
  code            TEXT NOT NULL,
  coins_awarded   INTEGER NOT NULL,
  redeemed_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, coupon_id, redeemed_at)
);
CREATE INDEX IF NOT EXISTS idx_coupon_red_user ON user_coupon_redemptions(user_id, redeemed_at DESC);

-- ── 4. Achievements (silent milestones) ─────────────────────────────────────
--
-- Trigger types mirror reward_tasks.task_type. When bumpRewardProgress runs,
-- it also checks every active achievement of the matching trigger_type and
-- unlocks any whose threshold was just crossed.
CREATE TABLE IF NOT EXISTS reward_achievements (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  icon                TEXT NOT NULL DEFAULT 'trophy',
  tier                TEXT NOT NULL DEFAULT 'bronze',  -- bronze/silver/gold/platinum
  trigger_type        TEXT NOT NULL,
  trigger_threshold   INTEGER NOT NULL,
  coins_reward        INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 100,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_achievements_active_trigger ON reward_achievements(active, trigger_type);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         TEXT NOT NULL,
  achievement_id  TEXT NOT NULL,
  unlocked_at     INTEGER NOT NULL,
  coins_awarded   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, unlocked_at DESC);

-- Seed default achievements. Admin can add/edit/remove.
INSERT OR IGNORE INTO reward_achievements
  (id, code, title, description, icon, tier, trigger_type, trigger_threshold, coins_reward, sort_order) VALUES
  ('ach_first_call',    'first_caller',      'First Call',        'Made your very first call.',    'call',    'bronze',   'complete_calls',  1,     20,    10),
  ('ach_ten_calls',     'chatter',           'Chatter',           'Completed 10 calls.',           'call',    'bronze',   'complete_calls',  10,    100,   20),
  ('ach_fifty_calls',   'social_butterfly',  'Social Butterfly',  'Completed 50 calls.',           'call',    'silver',   'complete_calls',  50,    500,   30),
  ('ach_hundred_calls', 'connector',         'Connector',         'Completed 100 calls.',          'call',    'gold',     'complete_calls',  100,   1500,  40),
  ('ach_spend_500',     'coin_spender',      'Coin Spender',      'Spent 500 coins on calls.',     'coin',    'bronze',   'spend_coins',     500,   50,    50),
  ('ach_spend_5000',    'big_spender',       'Big Spender',       'Spent 5000 coins on calls.',    'coin',    'silver',   'spend_coins',     5000,  500,   60),
  ('ach_refer_one',     'community_seeder',  'Community Seeder',  'Invited 1 friend who joined.',  'invite',  'bronze',   'refer_friend',    1,     100,   70),
  ('ach_refer_ten',     'community_builder', 'Community Builder', 'Invited 10 friends who joined.','invite',  'gold',     'refer_friend',    10,    2000,  80);

-- ── 5. Budget cap tracking ──────────────────────────────────────────────────
--
-- One row per UTC day. Every reward payout upserts +coins into this row.
-- The claim / spin / coupon / achievement endpoints check the cap BEFORE
-- committing the batch, then include the +coins increment in the SAME batch
-- so a burst of concurrent requests can't collectively exceed the cap.
CREATE TABLE IF NOT EXISTS reward_budget_daily (
  day_key      TEXT PRIMARY KEY,        -- YYYY-MM-DD UTC
  coins_paid   INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── 6. App-level feature flags & caps ───────────────────────────────────────
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('reward_daily_budget_cap',     '0'),      -- 0 = unlimited
  ('reward_campaigns_enabled',    'true'),
  ('reward_spin_enabled',         'true'),
  ('reward_coupons_enabled',      'true'),
  ('reward_achievements_enabled', 'true'),
  ('reward_push_nudges_enabled',  'true');
