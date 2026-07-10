-- Migration: structured, admin-configurable VIP perks
--
-- Until now three advertised perks lived ONLY as free-text strings in
-- vip_plans.perks, with no column and no enforcement — so an admin had no way
-- to actually turn them on/off per plan, and the backend couldn't act on them:
--
--   priority_matching : bias random matching toward higher-quality hosts
--   priority_support  : mark this VIP's support tickets high-priority
--   profile_frame     : show an exclusive animated frame around the avatar
--
-- Making them real 0/1 columns lets the admin panel toggle them per plan and
-- lets the API enforce/surface them. Defaults are 0 so existing/legacy plans
-- are unchanged until an admin opts in.

ALTER TABLE vip_plans ADD COLUMN priority_matching INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vip_plans ADD COLUMN priority_support  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vip_plans ADD COLUMN profile_frame     INTEGER NOT NULL DEFAULT 0;

-- Backfill the seeded plans so reality matches the perk copy they already
-- advertise (see migrations 0048/0050):
--   silver   → priority support
--   gold     → priority matching + priority support
--   platinum → priority matching + priority support + exclusive profile frame
UPDATE vip_plans SET priority_support = 1                                         WHERE tier = 'silver';
UPDATE vip_plans SET priority_matching = 1, priority_support = 1                  WHERE tier = 'gold';
UPDATE vip_plans SET priority_matching = 1, priority_support = 1, profile_frame = 1 WHERE tier = 'platinum';
