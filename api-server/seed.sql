-- VoxLink Production Seed Data
-- Run once after migrations: wrangler d1 execute voxlink-db --remote --file seed.sql

-- Admin user (password: Bubun@1997)
INSERT OR IGNORE INTO users (id, name, email, password_hash, role, coins, is_verified, bio) VALUES
  ('admin-001', 'Admin', 'ssunilkumarmohanta3@gmail.com', 'MkcBBBS/UCoOEWHtx9EMT6fndhN+mV0ZWwL94V77SnU=', 'admin', 9999, 1, 'Platform administrator');

-- Coin plans — production INR ladder. Prices authored in USD = round(₹/83) so
-- Indian users see CLEAN ₹ price points (₹49/₹99/₹199/₹499/₹999/₹1999) after
-- the /api/coins/plans FX conversion. Bigger plans give more bonus coins
-- (volume discount), dropping the effective cost from ~₹0.20 to ~₹0.15/coin.
-- See migration 0030_production_inr_coin_economy.sql for the full algorithm.
INSERT OR IGNORE INTO coin_plans (id, name, coins, price, currency, bonus_coins, is_popular, is_active) VALUES
  ('plan-in-049',  'Starter',  250,   0.5904, 'USD',    0, 0, 1),  -- ₹49
  ('plan-in-099',  'Popular',  500,   1.1928, 'USD',   50, 1, 1),  -- ₹99
  ('plan-in-199',  'Value',   1000,   2.3976, 'USD',  150, 0, 1),  -- ₹199
  ('plan-in-499',  'Super',   2500,   6.0120, 'USD',  500, 0, 1),  -- ₹499
  ('plan-in-999',  'Mega',    5000,  12.0361, 'USD', 1250, 0, 1),  -- ₹999
  ('plan-in-1999', 'Pro',    10000,  24.0843, 'USD', 3000, 0, 1);  -- ₹1999

-- App settings — coin economy knobs (single source of truth; tune in admin).
--   coin_to_usd_rate 0.0015 → host payout ≈ ₹0.125 gross per coin
--   host_revenue_share 0.70 → L1 host cut (level system can raise to 0.80)
INSERT OR REPLACE INTO app_settings (key, value) VALUES
  ('coin_to_usd_rate',        '0.0015'),
  ('host_revenue_share',      '0.70'),
  ('min_withdrawal_coins',    '5000'),
  ('min_coins_for_call',      '50'),
  ('registration_bonus_coins','50'),
  ('first_call_free_minutes', '5'),
  ('app_name',                'VoxLink'),
  ('app_version',             '1.0.0');

-- Talk topics
INSERT OR IGNORE INTO talk_topics (id, name, icon, is_active) VALUES
  ('topic-001', 'Casual Talk',       '💬', 1),
  ('topic-002', 'Life Advice',       '💡', 1),
  ('topic-003', 'Career',            '💼', 1),
  ('topic-004', 'Relationships',     '❤️', 1),
  ('topic-005', 'Mental Health',     '🧠', 1),
  ('topic-006', 'Language Practice', '🌍', 1),
  ('topic-007', 'Music',             '🎵', 1),
  ('topic-008', 'Travel',            '✈️', 1);

-- FAQs
INSERT OR IGNORE INTO faqs (id, question, answer, order_index, is_active) VALUES
  ('faq1', 'How do coins work?',
   'Coins are the in-app currency. You spend coins per minute during audio or video calls with hosts.',
   1, 1),
  ('faq2', 'How do I become a host?',
   'Go to your profile, tap "Become a Host", fill in your details and specialties, and start earning.',
   2, 1),
  ('faq3', 'How are hosts paid?',
   'Hosts earn 70% of the coins spent during calls. Coins can be withdrawn once you reach the minimum threshold.',
   3, 1),
  ('faq4', 'Is my data private?',
   'Yes. All calls are end-to-end encrypted and we never share your personal information with third parties.',
   4, 1),
  ('faq5', 'What happens if a call drops?',
   'You are only charged for the time you were actually connected. Incomplete minutes are not charged.',
   5, 1);
