-- ============================================================================
-- Referral integrity — anti-fraud hardening for the referral reward system.
-- ============================================================================
-- Adds payout-hold, clawback, velocity/manual-review, and audit fields to
-- referral_uses. The runtime schemaGuard (ensureReferralIntegritySchema) heals
-- these on cold start too, so prod works even if migrations lag.
--
-- referral_uses.status lifecycle:
--   pending  → recorded at signup, not yet earned
--   review   → genuine but held for admin review (velocity cap / high risk)
--   unlocked → credited
--   void     → self-referral / rejected, never pays out
--
-- reward_state (referrer reward only): none → held → released | clawed_back
--   held: referrer_reward is added to BOTH users.coins AND users.coins_held so
--         it is non-spendable AND non-withdrawable until the hold expires. The
--         release cron flips held→released (coins_held -= referrer_reward);
--         clawback flips held→clawed_back (coins -= reward, coins_held -= reward).

ALTER TABLE referral_uses ADD COLUMN unlocked_at INTEGER;
ALTER TABLE referral_uses ADD COLUMN reward_state TEXT DEFAULT 'none';
ALTER TABLE referral_uses ADD COLUMN hold_until INTEGER DEFAULT 0;
ALTER TABLE referral_uses ADD COLUMN referrer_reward INTEGER DEFAULT 0;
ALTER TABLE referral_uses ADD COLUMN new_user_reward INTEGER DEFAULT 0;
ALTER TABLE referral_uses ADD COLUMN flagged INTEGER DEFAULT 0;
ALTER TABLE referral_uses ADD COLUMN flag_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_referral_uses_referrer_status ON referral_uses(referrer_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_uses_reward_hold ON referral_uses(reward_state, hold_until);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('referral_integrity_enabled', '1'),
  ('referral_hold_days', '7'),
  ('referral_daily_unlock_cap', '25'),
  ('referral_total_cap', '0'),
  ('referral_clawback_days', '14'),
  ('referral_risk_review_enabled', '1');
