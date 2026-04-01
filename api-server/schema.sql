-- VoxLink D1 Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  gender TEXT CHECK(gender IN ('male','female','other')),
  bio TEXT DEFAULT '',
  coins INTEGER DEFAULT 100,
  role TEXT DEFAULT 'user' CHECK(role IN ('user','host','admin')),
  is_verified INTEGER DEFAULT 0,
  otp TEXT,
  otp_expires_at INTEGER,
  fcm_token TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  specialties TEXT DEFAULT '[]',
  languages TEXT DEFAULT '["English"]',
  coins_per_minute INTEGER DEFAULT 5,
  total_minutes INTEGER DEFAULT 0,
  total_earnings INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  is_online INTEGER DEFAULT 0,
  is_top_rated INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  identity_verified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS coin_plans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  coins INTEGER NOT NULL,
  price REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  bonus_coins INTEGER DEFAULT 0,
  is_popular INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS coin_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('purchase','spend','bonus','refund','withdrawal')),
  amount INTEGER NOT NULL,
  description TEXT,
  ref_id TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  caller_id TEXT NOT NULL REFERENCES users(id),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  type TEXT NOT NULL CHECK(type IN ('audio','video')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','ended','missed','declined')),
  cf_session_id TEXT,
  duration_seconds INTEGER DEFAULT 0,
  coins_charged INTEGER DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  last_message TEXT,
  last_message_at INTEGER,
  unread_user INTEGER DEFAULT 0,
  unread_host INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, host_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  room_id TEXT NOT NULL REFERENCES chat_rooms(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  content TEXT,
  media_url TEXT,
  media_type TEXT CHECK(media_type IN ('image','audio','video',NULL)),
  is_read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  call_session_id TEXT REFERENCES call_sessions(id),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(host_id, user_id, call_session_id)
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  host_id TEXT NOT NULL REFERENCES hosts(id),
  coins INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  payment_method TEXT,
  account_details TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
  admin_note TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT DEFAULT '{}',
  is_read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS talk_topics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  icon TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_hosts_user_id ON hosts(user_id);
CREATE INDEX IF NOT EXISTS idx_hosts_is_online ON hosts(is_online);
CREATE INDEX IF NOT EXISTS idx_call_sessions_caller ON call_sessions(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_host ON call_sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_transactions(user_id, created_at);

-- Default seed data
INSERT OR IGNORE INTO coin_plans (id, name, coins, price, bonus_coins, is_popular) VALUES
  ('plan1', 'Starter', 50, 0.99, 0, 0),
  ('plan2', 'Basic', 100, 1.99, 10, 0),
  ('plan3', 'Popular', 300, 4.99, 50, 1),
  ('plan4', 'Value', 500, 7.99, 100, 0),
  ('plan5', 'Pro', 1000, 14.99, 250, 0),
  ('plan6', 'Elite', 2000, 24.99, 600, 0);

INSERT OR IGNORE INTO faqs (id, question, answer, order_index) VALUES
  ('faq1', 'How do coins work?', 'Coins are the in-app currency. You spend coins per minute during audio or video calls with hosts.', 1),
  ('faq2', 'How do I become a host?', 'Go to your profile and tap "Become a Host". Fill in your details and submit for review.', 2),
  ('faq3', 'Are calls private?', 'Yes, all calls are encrypted end-to-end. We do not record call content.', 3),
  ('faq4', 'How do I withdraw earnings?', 'Hosts can request withdrawal from the wallet tab. Minimum withdrawal is 100 coins.', 4),
  ('faq5', 'What payment methods are supported?', 'We support credit/debit cards, PayPal, and major digital wallets.', 5);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('app_name', 'VoxLink'),
  ('min_withdrawal_coins', '100'),
  ('coin_to_usd_rate', '0.01'),
  ('host_revenue_share', '0.70'),
  ('random_call_enabled', '1'),
  ('maintenance_mode', '0');
