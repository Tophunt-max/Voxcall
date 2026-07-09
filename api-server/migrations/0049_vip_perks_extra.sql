-- Migration: extra VIP perks — signup bonus, daily free minutes, expiry reminder
--
-- signup_bonus_coins : one-time coins granted when a user subscribes/renews
-- daily_free_minutes : free call minutes added to the user's pool on daily claim
-- users.vip_reminder_at : last time we pushed a "VIP expiring soon" reminder

ALTER TABLE vip_plans ADD COLUMN signup_bonus_coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vip_plans ADD COLUMN daily_free_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN vip_reminder_at INTEGER;

-- Launch values for the seeded plans
UPDATE vip_plans SET signup_bonus_coins = 100, daily_free_minutes = 2  WHERE tier = 'silver';
UPDATE vip_plans SET signup_bonus_coins = 300, daily_free_minutes = 5  WHERE tier = 'gold';
UPDATE vip_plans SET signup_bonus_coins = 800, daily_free_minutes = 10 WHERE tier = 'platinum';
