-- 0073_pass_free_minutes.sql
--
-- Monthly Pass rewards switch from COINS to FREE-MINUTE CARDS:
--   • Free Minutes card  → talk to hosts free (consumes users.free_call_minutes)
--   • Random Call card   → free minutes for random calls (new pool below)
-- 1 card = 1 free minute. Both are claimable from the pass tiers.
--
-- We add a SEPARATE random-call free-minute pool so host-call free minutes and
-- random-call free minutes never mix: host calls burn free_call_minutes, random
-- calls burn free_random_minutes (see lib/billing.ts).
--
-- Idempotent: ALTER tolerated on re-run; the tiers UPDATE is a one-time reset of
-- the DEFAULT pass config to the new minute-based reward shape.

-- ── 1. New random-call free-minute pool on users ────────────────────────────
ALTER TABLE users ADD COLUMN free_random_minutes INTEGER NOT NULL DEFAULT 0;

-- ── 2. Reset the default Monthly Pass tiers to minute-based rewards ──────────
-- Each tier grants, per track:
--   *_minutes         → host-call free minutes (Free Minutes card)
--   *_random_minutes  → random-call free minutes (Random Call card)
-- Free (Common) track is smaller; VIP (Premium) track is richer.
UPDATE reward_pass
   SET tiers = '[{"level":1,"points":100,"label":"Tier 1","free_minutes":2,"free_random_minutes":1,"premium_minutes":5,"premium_random_minutes":3},{"level":2,"points":300,"label":"Tier 2","free_minutes":3,"free_random_minutes":2,"premium_minutes":8,"premium_random_minutes":5},{"level":3,"points":600,"label":"Tier 3","free_minutes":5,"free_random_minutes":3,"premium_minutes":12,"premium_random_minutes":8},{"level":4,"points":1000,"label":"Tier 4","free_minutes":8,"free_random_minutes":5,"premium_minutes":20,"premium_random_minutes":12},{"level":5,"points":1500,"label":"Tier 5","free_minutes":12,"free_random_minutes":8,"premium_minutes":30,"premium_random_minutes":20}]',
       updated_at = unixepoch()
 WHERE id = 'default';
