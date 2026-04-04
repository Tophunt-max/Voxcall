-- Missing tables required by API routes

-- Host Applications (KYC submissions)
CREATE TABLE IF NOT EXISTS host_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  date_of_birth TEXT,
  gender TEXT,
  phone TEXT,
  bio TEXT,
  specialties TEXT DEFAULT '[]',
  languages TEXT DEFAULT '["English"]',
  experience TEXT,
  audio_rate INTEGER DEFAULT 5,
  video_rate INTEGER DEFAULT 8,
  aadhar_front_url TEXT,
  aadhar_back_url TEXT,
  verification_video_url TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','under_review','approved','rejected')),
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  submitted_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_host_applications_user ON host_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_host_applications_status ON host_applications(status);

-- Payment Gateways
CREATE TABLE IF NOT EXISTS payment_gateways (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual',
  icon_emoji TEXT DEFAULT '💳',
  platforms TEXT DEFAULT '["all"]',
  instruction TEXT DEFAULT '',
  redirect_url TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  position INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Coin Purchases (deposit tracking)
CREATE TABLE IF NOT EXISTS coin_purchases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT,
  plan_name TEXT,
  coins INTEGER NOT NULL DEFAULT 0,
  bonus_coins INTEGER DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  payment_method TEXT DEFAULT 'unknown',
  gateway_id TEXT,
  gateway_name TEXT,
  payment_ref TEXT,
  utr_id TEXT,
  promo_code TEXT,
  status TEXT DEFAULT 'success' CHECK(status IN ('pending','success','failed','refunded')),
  admin_note TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_coin_purchases_user ON coin_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_purchases_status ON coin_purchases(status);

-- App Errors (error reporting)
CREATE TABLE IF NOT EXISTS app_errors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT,
  error_type TEXT,
  message TEXT,
  stack TEXT,
  context TEXT,
  platform TEXT,
  app_version TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Promo Codes (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  code TEXT UNIQUE NOT NULL,
  type TEXT DEFAULT 'percent' CHECK(type IN ('percent','bonus')),
  discount_pct INTEGER DEFAULT 0,
  bonus_coins INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 100,
  used_count INTEGER DEFAULT 0,
  expires_at TEXT,
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Support Tickets (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  subject TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  messages TEXT DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Content Reports (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reporter_id TEXT,
  reporter_name TEXT,
  reported_user_id TEXT,
  reported_user TEXT,
  reported_type TEXT DEFAULT 'user',
  reason TEXT NOT NULL,
  category TEXT DEFAULT 'harassment',
  evidence TEXT,
  status TEXT DEFAULT 'pending',
  action_taken TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- User Bans (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS user_bans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  type TEXT DEFAULT 'user',
  reason TEXT NOT NULL,
  ban_type TEXT DEFAULT 'permanent',
  device_id TEXT,
  banned_by TEXT DEFAULT 'Admin',
  banned_at INTEGER DEFAULT (unixepoch()),
  expires_at TEXT
);

-- Audit Logs (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  admin_id TEXT,
  admin_name TEXT,
  admin_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Banners (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS banners (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  bg_color TEXT DEFAULT '#7C3AED',
  cta_text TEXT DEFAULT 'Learn More',
  cta_link TEXT DEFAULT '',
  position TEXT DEFAULT 'home_top',
  active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Referral Codes (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Referral Uses (if not from 0005 migration)
CREATE TABLE IF NOT EXISTS referral_uses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referrer_id TEXT NOT NULL REFERENCES users(id),
  referred_id TEXT NOT NULL REFERENCES users(id),
  coins_given INTEGER DEFAULT 100,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(referred_id)
);

-- Safe ALTER TABLE additions (these fail silently if column already exists)
-- Note: SQLite does not support IF NOT EXISTS on ALTER TABLE; wrangler handles duplicates gracefully
