-- Migration 0028: First-call-free trial for new users
--
-- Engagement / conversion layer ("Layer 4" of the coin economy). Every newly
-- registered user gets a small pool of free CALL minutes that the billing
-- engine consumes BEFORE deducting from their coin balance. Hosts still get
-- paid the full coin amount for those minutes — the platform absorbs the
-- cost as a customer-acquisition expense, similar to a sign-up bonus.
--
-- Why a minute pool instead of a single "first call free":
--   - simpler to express in billing math (one counter, one decrement)
--   - resilient to dropped/short calls (a 5-second misdial doesn't burn the
--     whole freebie)
--   - admin-tunable in one place (`first_call_free_minutes` setting) without
--     a billing-engine code change
--
-- All defaults preserve historical behaviour: existing users get
-- free_call_minutes = 0 (no surprise freebie) until admin runs a backfill.
-- The setting itself is seeded to 5 minutes so a fresh deployment has
-- something to give new users immediately.
--
-- Schema additions (all idempotent; the schema guard re-runs them):
--   users.free_call_minutes      INTEGER DEFAULT 0
--     Remaining free minutes for THIS user. Decremented per billed minute
--     during /call/end. Caps at the admin-configured pool size on signup.
--   call_sessions.free_minutes_used INTEGER DEFAULT 0
--     How many minutes of THIS call were drawn from the user's free pool
--     (for analytics + the call-summary screen). Distinct from
--     coins_charged so we can show the user "5 free + 3 paid = 8 min".

ALTER TABLE users ADD COLUMN free_call_minutes INTEGER DEFAULT 0;
ALTER TABLE call_sessions ADD COLUMN free_minutes_used INTEGER DEFAULT 0;

-- Default pool size — 5 free minutes for every new user. Admin can tune
-- via Settings → Engagement → 'first_call_free_minutes', or set to 0 to
-- disable the feature entirely without removing the schema.
INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('first_call_free_minutes', '5', unixepoch());
