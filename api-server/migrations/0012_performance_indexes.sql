-- FIX #3: Missing performance indexes for production scale
-- These indexes prevent full table scans on hot query paths

-- Composite index for main host discovery page (is_active + is_online + rating sort)
CREATE INDEX IF NOT EXISTS idx_hosts_discovery ON hosts(is_active, is_online, rating DESC);

-- Index for host featured/top-rated queries
CREATE INDEX IF NOT EXISTS idx_hosts_top_rated ON hosts(is_top_rated, is_active);

-- Index for promo code lookup during checkout
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);

-- Index for coin_transactions ref_id join with call_sessions
CREATE INDEX IF NOT EXISTS idx_coin_tx_ref ON coin_transactions(ref_id);

-- Index for call_sessions status (used in stale call cleanup + subqueries)
CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON call_sessions(status);

-- Composite index for call_sessions host lookup with status filter
CREATE INDEX IF NOT EXISTS idx_call_sessions_host_status ON call_sessions(host_id, status);

-- Index for withdrawal_requests status (admin panel queries)
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status, created_at DESC);

-- Index for notifications cleanup
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- FIX #17: Change withdrawal_requests.amount_usd from REAL to INTEGER cents
-- Store USD amounts as integer cents to avoid floating-point rounding errors
-- e.g. $10.50 → 1050 cents
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS amount_cents INTEGER DEFAULT 0;
