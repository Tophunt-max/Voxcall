-- ============================================================================
-- VIP signup-bonus claim tracking — makes the per-plan signup bonus a genuine
-- ONE-TIME grant per (user, tier) instead of firing on every renewal / re-sub.
-- ============================================================================
-- Previously /api/vip/subscribe granted `signup_bonus_coins` on EVERY subscribe
-- or extend, so a plan whose signup bonus was >= its price could be farmed by
-- repeatedly re-subscribing. The composite PRIMARY KEY makes the grant an
-- atomic INSERT OR IGNORE: it succeeds (changes=1) only the first time a user
-- subscribes to a given tier; renewals/re-subscribes hit the PK and grant
-- nothing. Upgrading to a NEW tier still earns that tier's bonus once.
-- (Runtime ensureVipSignupBonusSchema auto-heals this on cold start too.)

CREATE TABLE IF NOT EXISTS vip_signup_bonus_claims (
  user_id     TEXT NOT NULL,
  tier        TEXT NOT NULL,
  bonus_coins INTEGER DEFAULT 0,
  claimed_at  INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, tier)
);
