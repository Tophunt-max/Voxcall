-- VoxLink Production Seed Data
-- Run once after migrations: wrangler d1 execute voxlink-db --remote --file seed.sql

-- Admin user (password: admin123)
INSERT OR IGNORE INTO users (id, name, email, password_hash, role, coins, is_verified, bio) VALUES
  ('admin-001', 'Admin', 'admin@voxlink.app', 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=', 'admin', 9999, 1, 'Platform administrator');

-- Coin plans
INSERT OR IGNORE INTO coin_plans (id, name, coins, price, bonus_coins, is_popular, is_active) VALUES
  ('plan-001', 'Starter',  100,   0.99,    0, 0, 1),
  ('plan-002', 'Basic',    500,   4.99,   50, 0, 1),
  ('plan-003', 'Popular', 1200,   9.99,  200, 1, 1),
  ('plan-004', 'Pro',     3000,  24.99,  600, 0, 1),
  ('plan-005', 'Elite',   7000,  49.99, 2000, 0, 1);

-- App settings
INSERT OR REPLACE INTO app_settings (key, value) VALUES
  ('coin_to_usd_rate',       '0.01'),
  ('host_revenue_share',     '0.70'),
  ('min_withdrawal_coins',   '100'),
  ('app_name',               'VoxLink'),
  ('app_version',            '1.0.0');

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
