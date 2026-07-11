-- VoxLink Production Seed Data
-- Run once after migrations: wrangler d1 execute voxlink-db --remote --file seed.sql

-- ─── Admin user ─────────────────────────────────────────────────────────────
-- SECURITY: Do NOT hardcode a real admin email or password hash in this file.
-- This file is committed to source control, so anything here is public to
-- everyone with repo access. Before running the seed:
--   1. Set ADMIN_EMAIL below to your real admin email address.
--   2. Generate a STRONG, random password and its PBKDF2 hash, then paste the
--      hash in place of REPLACE_WITH_PBKDF2_HASH. Generate the hash with the
--      same scheme the API uses (api-server/src/lib/hash.ts → hashPassword),
--      e.g. in a Worker/Node one-off:
--          import { hashPassword } from './src/lib/hash';
--          console.log(await hashPassword('<your-strong-password>'));
--      The output looks like: pbkdf2:100000:<saltHex>:<hashHex>
--   3. Never commit the real hash back to git. Keep it only in the live D1 DB.
--
-- The placeholder hash below is intentionally NOT a valid login — running this
-- seed unedited creates an admin row that CANNOT be logged into, so there is no
-- known-credential backdoor. Set a real password via the reset flow afterwards.
INSERT OR IGNORE INTO users (id, name, email, password_hash, role, coins, is_verified, bio) VALUES
  ('admin-001', 'Admin', 'REPLACE_WITH_YOUR_ADMIN_EMAIL', 'REPLACE_WITH_PBKDF2_HASH', 'admin', 9999, 1, 'Platform administrator');

-- Coin plans — production INR ladder, priced NATIVELY in INR (coin_plans.price
-- is the rupee amount; /api/coins/plans converts to other currencies only for
-- non-INR users). Bigger plans give more bonus coins (volume discount),
-- dropping the effective cost from ~₹0.20 to ~₹0.15/coin. See migration
-- 0032_coin_plans_inr_native.sql.
INSERT OR IGNORE INTO coin_plans (id, name, coins, price, currency, bonus_coins, is_popular, is_active) VALUES
  ('plan-in-049',  'Starter',  250,    49, 'INR',    0, 0, 1),  -- ₹49
  ('plan-in-099',  'Popular',  500,    99, 'INR',   50, 1, 1),  -- ₹99
  ('plan-in-199',  'Value',   1000,   199, 'INR',  150, 0, 1),  -- ₹199
  ('plan-in-499',  'Super',   2500,   499, 'INR',  500, 0, 1),  -- ₹499
  ('plan-in-999',  'Mega',    5000,   999, 'INR', 1250, 0, 1),  -- ₹999
  ('plan-in-1999', 'Pro',    10000,  1999, 'INR', 3000, 0, 1);  -- ₹1999

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
  ('default_audio_rate',      '25'),  -- standard voice call ≈ ₹5/min
  ('default_video_rate',      '40'),  -- standard video call ≈ ₹8/min
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
