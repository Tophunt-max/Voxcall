-- 0074_call_free_minutes_cap.sql
--
-- Per-call free-minute cap, stamped on the session at initiate time (when the
-- caller's VIP status is known). Billing reads this so free-minute cards are
-- capped per call:
--   • free user  → 1 free minute per audio call
--   • VIP user   → up to 3 free minutes per audio call
--   • video call → 0 (cards never apply to video)
-- Extra cards beyond the cap stay in the pool for other calls / hosts.
--
-- Idempotent: ALTER tolerated on re-run.

ALTER TABLE call_sessions ADD COLUMN free_minutes_cap INTEGER NOT NULL DEFAULT 1;
