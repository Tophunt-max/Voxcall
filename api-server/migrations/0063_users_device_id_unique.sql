-- Prevent duplicate guest accounts racing on the same device_id.
--
-- POST /api/auth/quick-login (and its /guest-login alias) performs a
-- SELECT users WHERE device_id = ? followed by an INSERT when no row is
-- found. Two concurrent quick-login requests from the SAME device (e.g. a
-- cold-start app firing the request twice, a flaky network causing a
-- client-side retry, or two WebViews on the same device) can both pass the
-- SELECT (TOCTOU — neither sees the other's not-yet-committed row) and both
-- INSERT a brand-new guest user row with the same device_id. Each INSERT
-- also grants a fresh `registration_bonus_coins` welcome bonus, so this bug
-- is directly farmable for unlimited free coins by racing the endpoint, and
-- even without malicious intent it silently fragments one physical device
-- into multiple accounts (breaking "same device = same account" quick-login
-- semantics and confusing referral/self-referral device-based guards).
--
-- STEP 1: heal any duplicates the race already produced in production
-- BEFORE adding the constraint (a straight CREATE UNIQUE INDEX would fail if
-- any duplicates exist). We keep the OLDEST row per device_id (first
-- created — the account that's actually been in use) and null out
-- device_id on every newer duplicate. This does not touch coins/data on the
-- newer rows; it only detaches them from the device so a future quick-login
-- from that device resumes on the kept (oldest) account, and the orphaned
-- duplicate rows remain queryable by admins for manual cleanup if desired.
UPDATE users
   SET device_id = NULL
 WHERE device_id IS NOT NULL
   AND id NOT IN (
     SELECT id FROM (
       SELECT id, device_id,
              ROW_NUMBER() OVER (
                PARTITION BY device_id
                ORDER BY created_at ASC, id ASC
              ) AS rn
         FROM users
        WHERE device_id IS NOT NULL
     )
     WHERE rn = 1
   );

-- STEP 2: a partial UNIQUE INDEX (only on rows where device_id IS NOT NULL)
-- closes the race at the SQLite/D1 level going forward, mirroring the
-- existing fix for coin_purchases.utr_id (migration 0024) and payment_ref
-- (migration 0018): a second concurrent INSERT now raises a constraint
-- failure that the application code (routes/auth.ts quickLoginHandler)
-- catches and resolves to the row that won the race, returning that account
-- instead of a 500 or a duplicate account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device_id_unique
  ON users(device_id)
  WHERE device_id IS NOT NULL;
