-- 0033: Follow-up performance indexes for write-heavy / hot-read tables.
--
-- These cover queries that previously fell back to a full table scan + sort:
--   • coin_transactions: the wallet "coin history" screen filters by user and
--     orders by recency; only ref_id was indexed before. A (user_id, id)
--     index serves the per-user history scan directly. (created_at column may
--     not exist on the oldest rows — id is monotonic so it orders the same.)
--   • notifications: the in-app notifications list reads a user's rows newest
--     first. The existing (user_id, is_read) index doesn't help the ORDER BY
--     created_at; this composite does.
--   • ratings: host profile screens aggregate AVG(stars)/COUNT(*) per host;
--     a host_id index turns that into an index range scan.
--   • call_quality: the per-host quality dashboards aggregate by session; an
--     index on call_session_id avoids scanning the whole samples table.
--   • coin_transactions(type): admin analytics filter by transaction type
--     (spend / bonus / purchase) across all users.
--
-- All are IF NOT EXISTS so they are safe to re-run and converge a DB that was
-- partially hand-indexed.

-- Per-user coin ledger, newest first (wallet history).
CREATE INDEX IF NOT EXISTS idx_coin_tx_user_created
  ON coin_transactions(user_id, id DESC);

-- Admin/analytics: filter the ledger by transaction type.
CREATE INDEX IF NOT EXISTS idx_coin_tx_type
  ON coin_transactions(type);

-- Notifications list: a user's notifications, newest first.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Host ratings aggregation (AVG/COUNT per host) + review listing.
CREATE INDEX IF NOT EXISTS idx_ratings_host
  ON ratings(host_id);

-- Call-quality samples grouped per call session (host quality dashboards).
CREATE INDEX IF NOT EXISTS idx_call_quality_session
  ON call_quality(call_session_id);
