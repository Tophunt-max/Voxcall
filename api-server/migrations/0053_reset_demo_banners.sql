-- Migration: remove demo/test banners and seed real production banners
--
-- The original schema (migration 0005) shipped DEMO seed banners that leaked
-- into production:
--   • bn1 "Weekend Offer — 30% Off Coins!" (references a fake promo code
--     WEEKEND30 that doesn't exist) — shown on user + host home
--   • bn2 "New Hosts Available!" — generic filler
-- plus test banners created through the admin panel (e.g. a "Buy Coins & Save!"
-- wallet banner). None of these are real offers, so they must not run in prod.
--
-- This migration wipes ALL existing banner rows for a clean slate, then seeds a
-- small set of genuine, production-grade banners:
--   • copy is TRUE (no fake discounts / promo codes)
--   • CTAs point at real in-app routes (/user/referral) — validated to start "/"
--   • audience is set explicitly so user vs host feeds stay separated (0052)
--   • link_type drives safe navigation (internal route vs display-only)
-- Admins can edit/disable/add more from the panel at any time; this is just a
-- sensible default so the feature ships non-empty.

-- 1. Clean slate — remove every demo/test banner regardless of how it was created.
DELETE FROM banners;

-- 2. Seed real, production-grade banners.
INSERT INTO banners
  (id, title, subtitle, image_url, bg_color, cta_text, cta_link, position, audience, link_type, sort_order, active)
VALUES
  -- USER · home — referral is a real feature with real coin rewards.
  ('bn_user_referral', 'Invite Friends, Earn Coins',
   'Share your code — you both get bonus coins', '', '#7C3AED',
   'Invite Now', '/user/referral', 'home_top', 'user', 'internal', 0, 1),

  -- USER · wallet — accurate: larger coin packs already include bonus coins.
  ('bn_user_wallet_bonus', 'Bigger Packs, Bigger Bonuses',
   'Larger coin packs include extra bonus coins', '', '#0EA5E9',
   '', '', 'wallet', 'user', 'none', 0, 1),

  -- HOST · home — genuine earnings tip, host-only audience.
  ('bn_host_peak', 'Stay Online, Earn More',
   'Peak hours (7-11 PM) bring the most calls', '', '#7C3AED',
   '', '', 'home_top', 'host', 'none', 0, 1);
