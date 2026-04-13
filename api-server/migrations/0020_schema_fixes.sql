-- Migration 0020: Fix schema issues found in production audit
-- 1. Add missing columns that only existed in run-migrations
-- 2. Fix CHECK constraints that are too restrictive
-- 3. Add missing indexes for performance
-- 4. Add missing table manual_qr_codes

-- Fix: hosts table missing columns
ALTER TABLE hosts ADD COLUMN audio_coins_per_minute INTEGER;
ALTER TABLE hosts ADD COLUMN video_coins_per_minute INTEGER;
ALTER TABLE hosts ADD COLUMN level INTEGER DEFAULT 1;
ALTER TABLE hosts ADD COLUMN chat_unlock_policy TEXT DEFAULT 'after_first_call';

-- Fix: users table missing referral_code
ALTER TABLE users ADD COLUMN referral_code TEXT;

-- Fix: referral_uses missing code column
ALTER TABLE referral_uses ADD COLUMN code TEXT;

-- Fix: coin_purchases missing columns
ALTER TABLE coin_purchases ADD COLUMN screenshot_url TEXT;
ALTER TABLE coin_purchases ADD COLUMN gateway_order_id TEXT;

-- Fix: payment_gateways missing webhook_secret
ALTER TABLE payment_gateways ADD COLUMN webhook_secret TEXT;

-- Fix: host_applications missing application_type
ALTER TABLE host_applications ADD COLUMN application_type TEXT DEFAULT 'new';

-- Fix: app_errors missing extra column (errors.ts uses it)
ALTER TABLE app_errors ADD COLUMN extra TEXT;

-- Fix: Missing index on users.google_id (login path)
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Fix: Missing index on users.device_id (quick-login path)
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);

-- Fix: Missing index on users.email (login/signup path)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Fix: manual_qr_codes table (admin CRUD needs this)
CREATE TABLE IF NOT EXISTS manual_qr_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL DEFAULT 'UPI QR',
  upi_id TEXT,
  qr_image_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch())
);
