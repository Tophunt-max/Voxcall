-- FIX #12: Refresh Token Rotation
-- Adds token_invalidated_at to users table.
-- When a user explicitly logs out or changes password, this timestamp is set to NOW.
-- The authMiddleware checks that token iat > token_invalidated_at to reject old tokens.
-- This allows immediate token revocation without maintaining a blocklist.

ALTER TABLE users ADD COLUMN token_invalidated_at INTEGER DEFAULT 0;
