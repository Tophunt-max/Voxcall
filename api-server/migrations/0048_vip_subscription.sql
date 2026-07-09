-- Migration: VIP subscription system
--
-- Users buy a VIP plan with coins. While active (vip_expires_at > now) they get
-- the plan's perks: a % discount on every call, free daily bonus coins, the
-- ability to chat any host without calling first, and a VIP badge/tier.
--
-- Benefits are read live from vip_plans (joined on the stored tier), so an admin
-- editing a plan updates every active subscriber. vip_subscriptions keeps an
-- audit trail of every purchase.

-- Per-user VIP state
ALTER TABLE users ADD COLUMN vip_tier TEXT;              -- active plan tier (silver/gold/platinum) or NULL
ALTER TABLE users ADD COLUMN vip_expires_at INTEGER;     -- unix seconds; VIP active while this is in the future
ALTER TABLE users ADD COLUMN vip_daily_claim_at INTEGER; -- last daily-bonus claim (unix seconds)

-- Admin-configurable VIP plans
CREATE TABLE IF NOT EXISTS vip_plans (
  id                TEXT PRIMARY KEY,
  tier              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  price_coins       INTEGER NOT NULL,
  duration_days     INTEGER NOT NULL DEFAULT 30,
  call_discount_pct INTEGER NOT NULL DEFAULT 0,   -- % off per-minute call rate (clamped to loss-proof floor at billing)
  daily_bonus_coins INTEGER NOT NULL DEFAULT 0,   -- free coins claimable once/day
  chat_unlock       INTEGER NOT NULL DEFAULT 1,   -- 1 = can DM any host without a prior call
  badge             TEXT,                          -- emoji/label shown next to the name
  color             TEXT,                          -- accent colour for the plan card
  perks             TEXT DEFAULT '[]',             -- JSON array of human-readable perk strings
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER DEFAULT (unixepoch())
);

-- Purchase history / audit
CREATE TABLE IF NOT EXISTS vip_subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier          TEXT NOT NULL,
  price_coins   INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_vip_subs_user ON vip_subscriptions(user_id);

-- Default plans (prices in coins)
INSERT OR IGNORE INTO vip_plans (id, tier, name, price_coins, duration_days, call_discount_pct, daily_bonus_coins, chat_unlock, badge, color, perks, sort_order) VALUES
('vip_silver',   'silver',   'Silver VIP',   999,  30,  5,   20,  1, '⭐', '#9CA3AF',
  '["Silver VIP badge","5% off every call","20 free coins daily","Chat any host without calling first","Priority support"]', 1),
('vip_gold',     'gold',     'Gold VIP',     2499, 30, 10,   60,  1, '👑', '#F59E0B',
  '["Gold VIP badge","10% off every call","60 free coins daily","Chat any host without calling first","Priority matching","Priority support"]', 2),
('vip_platinum', 'platinum', 'Platinum VIP', 4999, 30, 20,  150,  1, '💎', '#A855F7',
  '["Platinum VIP badge","20% off every call","150 free coins daily","Chat any host without calling first","Priority matching","Exclusive profile frame","24/7 priority support"]', 3);
