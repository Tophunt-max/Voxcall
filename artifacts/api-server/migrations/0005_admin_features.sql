-- Promo Codes
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

-- Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT REFERENCES users(id),
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

-- Content Reports
CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reporter_id TEXT REFERENCES users(id),
  reporter_name TEXT,
  reported_user_id TEXT REFERENCES users(id),
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

-- User Bans
CREATE TABLE IF NOT EXISTS user_bans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT REFERENCES users(id),
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

-- Audit Logs
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

-- Promotional Banners
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

-- Referral Codes
CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id),
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Referral Uses
CREATE TABLE IF NOT EXISTS referral_uses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referrer_id TEXT NOT NULL REFERENCES users(id),
  referred_id TEXT NOT NULL REFERENCES users(id),
  coins_given INTEGER DEFAULT 100,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(referred_id)
);

-- Hosts extra columns (ignore if already exist via separate ALTER)
CREATE TABLE IF NOT EXISTS _host_col_migration_done (done INTEGER DEFAULT 1);

-- Seed: Promo Codes
INSERT OR IGNORE INTO promo_codes (id, code, type, discount_pct, bonus_coins, max_uses, used_count, expires_at, active) VALUES
  ('pc1', 'WELCOME50', 'percent', 50, 0, 100, 34, '2026-06-30', 1),
  ('pc2', 'VOXLINK20', 'percent', 20, 0, 500, 210, '2026-05-15', 1),
  ('pc3', 'COINS100', 'bonus', 0, 100, 200, 55, '2026-07-31', 1);

-- Seed: Banners
INSERT OR IGNORE INTO banners (id, title, subtitle, bg_color, cta_text, cta_link, position, active) VALUES
  ('bn1', 'Weekend Offer — 30% Off Coins!', 'Limited time only. Use code WEEKEND30', '#7C3AED', 'Grab Deal', '/coins', 'home_top', 1),
  ('bn2', 'New Hosts Available!', 'Explore 20+ new hosts added this week', '#0EA5E9', 'Browse Hosts', '/hosts', 'home_middle', 1);
