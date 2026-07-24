-- 0070_reward_monthly_pass.sql
--
-- Monthly Pass — a Chamet-style "battle pass" that runs on a monthly cycle.
-- Users earn Pass Points by completing / claiming reward tasks; crossing a
-- tier's point threshold unlocks a reward on two tracks:
--   • Common  (free)    — available to everyone.
--   • Premium (VIP/paid) — unlocked for active VIP members automatically, or by
--                          buying the pass with coins for the current month.
-- Points, premium unlock and claims all reset at the UTC month boundary because
-- they are keyed by `period_key` ('YYYY-MM').
--
-- Idempotent: CREATE ... IF NOT EXISTS + INSERT OR IGNORE, safe to re-run.

-- ── 1. Singleton pass configuration (admin-editable) ────────────────────────
CREATE TABLE IF NOT EXISTS reward_pass (
  id              TEXT PRIMARY KEY DEFAULT 'default',
  enabled         INTEGER NOT NULL DEFAULT 1,
  title           TEXT NOT NULL DEFAULT 'Monthly Pass',
  description     TEXT NOT NULL DEFAULT 'Complete tasks to earn Pass Points and unlock monthly rewards.',
  price_coins     INTEGER NOT NULL DEFAULT 1000,  -- cost to unlock the Premium track with coins
  vip_auto_unlock INTEGER NOT NULL DEFAULT 1,      -- active VIP members get the Premium track free
  -- JSON array of tiers. Each tier:
  --   { "level": 1, "points": 100, "label": "Tier 1",
  --     "free_coins": 50, "premium_coins": 150 }
  tiers           TEXT NOT NULL DEFAULT '[]',
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed a default, enabled pass so the feature works on a fresh install.
INSERT OR IGNORE INTO reward_pass (id, enabled, title, description, price_coins, vip_auto_unlock, tiers)
VALUES (
  'default', 1, 'Monthly Pass',
  'Complete tasks to earn Pass Points and unlock monthly rewards. Go VIP or buy the pass to claim Premium rewards too!',
  1000, 1,
  '[{"level":1,"points":100,"label":"Tier 1","free_coins":50,"premium_coins":150},{"level":2,"points":300,"label":"Tier 2","free_coins":80,"premium_coins":250},{"level":3,"points":600,"label":"Tier 3","free_coins":120,"premium_coins":400},{"level":4,"points":1000,"label":"Tier 4","free_coins":180,"premium_coins":600},{"level":5,"points":1500,"label":"Tier 5","free_coins":250,"premium_coins":1000}]'
);

-- ── 2. Per-user, per-month pass state ───────────────────────────────────────
-- One row per (user, month). A brand-new month simply gets a brand-new row,
-- so points + premium-unlock reset automatically at the month boundary.
CREATE TABLE IF NOT EXISTS user_pass_state (
  user_id          TEXT NOT NULL,
  period_key       TEXT NOT NULL,                 -- 'YYYY-MM' (UTC)
  points           INTEGER NOT NULL DEFAULT 0,    -- Pass Points earned this month
  premium_unlocked INTEGER NOT NULL DEFAULT 0,    -- 1 if bought with coins this month
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, period_key)
);

-- ── 3. Per-tier, per-track claim ledger (double-claim guard) ────────────────
CREATE TABLE IF NOT EXISTS user_pass_claims (
  user_id       TEXT NOT NULL,
  period_key    TEXT NOT NULL,
  tier_level    INTEGER NOT NULL,
  track         TEXT NOT NULL,                    -- 'common' | 'premium'
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  claimed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, period_key, tier_level, track)
);
CREATE INDEX IF NOT EXISTS idx_user_pass_claims_user_period
  ON user_pass_claims(user_id, period_key);
