-- OPTIMIZATION #18: Covering indexes for frequently-executed queries
-- Covering indexes store all columns needed by a query in the index itself,
-- eliminating the need for the DB engine to look up the actual table row.
-- These dramatically speed up the host listing, call history, and rating queries.

-- Hosts listing: ORDER BY is_online DESC, rating DESC, total_minutes DESC, id ASC
-- Without this index D1 scans ALL hosts then sorts. With it: index-only scan.
CREATE INDEX IF NOT EXISTS idx_hosts_listing
  ON hosts(is_active, is_online DESC, rating DESC, total_minutes DESC, id);

-- Host featured: WHERE is_active=1 AND rating>=4.0 ORDER BY is_top_rated DESC, rating DESC
CREATE INDEX IF NOT EXISTS idx_hosts_featured
  ON hosts(is_active, rating, is_top_rated DESC);

-- Call sessions history by caller (most common query for users)
CREATE INDEX IF NOT EXISTS idx_calls_by_caller
  ON call_sessions(caller_id, created_at DESC);

-- Call sessions history by host user (for host-app earnings/history)
CREATE INDEX IF NOT EXISTS idx_calls_by_host
  ON call_sessions(host_id, created_at DESC);

-- Call sessions by status (for stale-call cron + admin live-calls view)
CREATE INDEX IF NOT EXISTS idx_calls_by_status
  ON call_sessions(status, created_at DESC);

-- Ratings by host_id for quick AVG computation and review listing
CREATE INDEX IF NOT EXISTS idx_ratings_by_host
  ON ratings(host_id, created_at DESC);

-- Chat messages by room_id + created_at for message history (most-used chat query)
CREATE INDEX IF NOT EXISTS idx_chat_by_room
  ON messages(room_id, created_at DESC);

-- Users by email (login lookup)
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- Coin transactions by user for wallet history
CREATE INDEX IF NOT EXISTS idx_coin_tx_user
  ON coin_transactions(user_id, created_at DESC);

-- Audit logs by admin for audit trail viewing
CREATE INDEX IF NOT EXISTS idx_audit_admin
  ON audit_logs(admin_id, created_at DESC);
