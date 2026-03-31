-- Seed data for VoxLink local development

-- Admin user (password: admin123)
INSERT OR IGNORE INTO users (id, name, email, password_hash, role, coins, is_verified, bio) VALUES
  ('admin-001', 'Admin', 'admin@voxlink.app', 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=', 'admin', 9999, 1, 'Platform administrator');

-- Demo users
INSERT OR IGNORE INTO users (id, name, email, password_hash, role, coins, is_verified, gender, bio) VALUES
  ('user-001', 'Arjun Sharma', 'arjun@demo.com', 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=', 'user', 500, 1, 'male', 'Love to connect and talk!'),
  ('user-002', 'Priya Mehta', 'priya@demo.com', 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=', 'host', 1200, 1, 'female', 'Professional listener and life coach'),
  ('user-003', 'Rahul Kumar', 'rahul@demo.com', 'JAvlGPq9JyTdtvBO6x2llnRI1+gxwIyPqCKAn3THIKk=', 'user', 250, 0, 'male', 'Music lover and traveler');

-- Demo hosts
INSERT OR IGNORE INTO hosts (id, user_id, display_name, specialties, languages, coins_per_minute, is_active, is_online, rating, review_count, total_minutes, identity_verified, is_top_rated) VALUES
  ('host-001', 'user-002', 'Priya M.', '["Life Coaching","Stress Relief","Career Advice"]', '["English","Hindi"]', 10, 1, 1, 4.8, 234, 1560, 1, 1),
  ('host-002', 'user-003', 'Rahul K.', '["Casual Talk","Music","Travel"]', '["English","Hindi"]', 6, 1, 0, 4.5, 89, 340, 0, 0);

-- Coin plans
INSERT OR IGNORE INTO coin_plans (id, name, coins, price, bonus_coins, is_popular, is_active) VALUES
  ('plan-001', 'Starter', 100, 0.99, 0, 0, 1),
  ('plan-002', 'Basic', 500, 4.99, 50, 0, 1),
  ('plan-003', 'Popular', 1200, 9.99, 200, 1, 1),
  ('plan-004', 'Pro', 3000, 24.99, 600, 0, 1),
  ('plan-005', 'Elite', 7000, 49.99, 2000, 0, 1);

-- App settings
INSERT OR REPLACE INTO app_settings (key, value) VALUES
  ('coin_to_usd_rate', '0.01'),
  ('host_revenue_share', '0.70'),
  ('min_withdrawal_coins', '100'),
  ('app_name', 'VoxLink'),
  ('app_version', '1.0.0');

-- Talk topics (icon column, not emoji)
INSERT OR IGNORE INTO talk_topics (id, name, icon, is_active) VALUES
  ('topic-001', 'Casual Talk', '💬', 1),
  ('topic-002', 'Life Advice', '💡', 1),
  ('topic-003', 'Career', '💼', 1),
  ('topic-004', 'Relationships', '❤️', 1),
  ('topic-005', 'Mental Health', '🧠', 1),
  ('topic-006', 'Language Practice', '🌍', 1),
  ('topic-007', 'Music', '🎵', 1),
  ('topic-008', 'Travel', '✈️', 1);
