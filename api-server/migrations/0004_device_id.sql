-- Add device_id for persistent Quick Login (same device = same account across reinstalls)
ALTER TABLE users ADD COLUMN device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id) WHERE device_id IS NOT NULL;
