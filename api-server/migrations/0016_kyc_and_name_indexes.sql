-- FIX: Index for host_applications lookup by user_id (used in become-host KYC check)
-- Allows ORDER BY created_at DESC to use the index rather than full table scan
CREATE INDEX IF NOT EXISTS idx_host_apps_user_created
  ON host_applications(user_id, created_at DESC);

-- Index for users.name for admin search (partial name lookups use LIKE 'term%' which benefits from this)
CREATE INDEX IF NOT EXISTS idx_users_name
  ON users(name);

-- Index for users.status (used in auth middleware banned/deleted check)
CREATE INDEX IF NOT EXISTS idx_users_status
  ON users(status);
