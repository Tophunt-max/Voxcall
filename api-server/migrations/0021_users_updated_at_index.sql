-- Migration 0021: index for the presence broadcast query in PATCH /api/host/status
--
-- The host online/offline toggle broadcasts a presence event to the 100 most
-- recently active users via:
--   SELECT id FROM users WHERE role = 'user' ORDER BY updated_at DESC LIMIT 100
--
-- Without this index, that query is a full table scan + sort, which on a
-- production-scale users table (10k+ rows) can exceed the D1 query budget
-- and bubble up as a 500 from the toggle endpoint — exactly the symptom we
-- saw in the host app ("Status update karne mein error. Dobara try karo.").

CREATE INDEX IF NOT EXISTS idx_users_role_updated_at
  ON users(role, updated_at DESC);
