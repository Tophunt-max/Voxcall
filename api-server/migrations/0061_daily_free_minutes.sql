-- ============================================================================
-- Recurring daily free minutes for ALL users (opt-in growth lever).
-- ============================================================================
-- Adds a per-user claim timestamp so the daily free-minutes reward can enforce
-- a once-per-day cooldown (mirrors the VIP daily bonus). The reward amount is
-- admin-controlled via app_settings.daily_free_minutes_all ('0' = disabled).
-- ensureFirstCallFreeSchema auto-heals both on cold start.

ALTER TABLE users ADD COLUMN free_minutes_daily_claim_at INTEGER DEFAULT 0;

INSERT OR IGNORE INTO app_settings (key, value) VALUES ('daily_free_minutes_all', '0');
