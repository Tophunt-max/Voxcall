-- Migration: richer banner designs + a full set of production banners
--
-- Adds two presentation fields so each banner can have its own look:
--   gradient_to : optional 2nd gradient colour (bg_color -> gradient_to). When
--                 null the app derives a darker shade of bg_color, so old rows
--                 still render a gradient.
--   icon        : optional emoji shown on the banner (right side) when there is
--                 no image_url — a cheap way to give every banner a distinct
--                 visual without uploading art.
--
-- Then it upgrades the 3 seeds from 0053 with gradients/icons and adds more
-- banners so every carousel actually SLIDES (multiple slides per surface):
--   • User home   : 3 banners (referral, rewards, random call)
--   • User search : 3 banners (Invite Friends [restored], VIP, Lucky Spin)
--   • User wallet : 2 banners (pack bonus, VIP savings)
--   • Host home   : 2 banners (peak hours, ratings)
-- All CTAs point at real in-app routes; copy is truthful (no fake promos).

ALTER TABLE banners ADD COLUMN gradient_to TEXT;
ALTER TABLE banners ADD COLUMN icon        TEXT;

-- Upgrade the existing 0053 seeds with a gradient + icon.
UPDATE banners SET gradient_to = '#DB2777', icon = '🎁' WHERE id = 'bn_user_referral';
UPDATE banners SET gradient_to = '#2563EB', icon = '🪙' WHERE id = 'bn_user_wallet_bonus';
UPDATE banners SET gradient_to = '#9333EA', icon = '🔥' WHERE id = 'bn_host_peak';

-- Additional banners so each slider has multiple slides.
INSERT OR IGNORE INTO banners
  (id, title, subtitle, image_url, bg_color, gradient_to, icon, cta_text, cta_link, position, audience, link_type, sort_order, active)
VALUES
  -- USER · home
  ('bn_home_rewards', 'Daily Rewards Await', 'Log in daily for free coins and spins', '', '#0EA5E9', '#14B8A6', '🎉',
   'Open Rewards', '/user/rewards', 'home_middle', 'user', 'internal', 1, 1),
  ('bn_home_random', 'Meet Someone New', 'Start a random call and make a friend', '', '#F59E0B', '#EF4444', '🎲',
   'Try Now', '/user/screens/home/random', 'home_bottom', 'user', 'internal', 2, 1),

  -- USER · search  (search_top restores the classic Invite Friends banner)
  ('bn_search_invite', 'Invite Friends', 'Earn up to 10,000 coins per invite', '', '#E43535', '#F26E3E', '🎁',
   'Invite Now', '/user/referral', 'search_top', 'user', 'internal', 0, 1),
  ('bn_search_vip', 'Go VIP', 'Cheaper calls, daily bonus coins and more', '', '#7B2FF7', '#A855F7', '👑',
   'Explore VIP', '/user/vip', 'search_middle', 'user', 'internal', 1, 1),
  ('bn_search_spin', 'Spin & Win', 'Try your luck on the daily lucky spin', '', '#EC4899', '#8B5CF6', '🎡',
   'Spin Now', '/user/rewards-spin', 'search_bottom', 'user', 'internal', 2, 1),

  -- USER · wallet
  ('bn_wallet_vip', 'VIP = Cheaper Calls', 'Save on every call with a VIP plan', '', '#7B2FF7', '#A855F7', '👑',
   'See VIP', '/user/vip', 'wallet', 'user', 'internal', 1, 1),

  -- HOST · home
  ('bn_host_rating', 'Great Ratings, More Calls', 'Keep your rating high to rank higher', '', '#0EA5E9', '#14B8A6', '⭐',
   '', '', 'home_top', 'host', 'none', 1, 1);
