-- Migration 0068: Gift & referral host metrics for the level system
--
-- Two more denormalized counters the flexible level engine can gate on
-- (see METRIC_REGISTRY in lib/levels.ts):
--
--   • gifts_received       — lifetime count of gifts + tips the host received.
--       Bumped in the gift-send (routes/gifts.ts) and tip-send (routes/tip.ts)
--       transaction batches — the same atomic write that credits the host's
--       earnings — so the counter can never drift from the ledger.
--   • successful_referrals — lifetime count of referrals by this host's user
--       that reached 'unlocked'. Bumped when a referral unlocks
--       (lib/referral.ts) and decremented on clawback, both keyed by the
--       referrer's user_id (a no-op when the referrer isn't a host).
--
-- A third new metric, languages_count (how many languages the host speaks), is
-- DERIVED at read time from the existing hosts.languages JSON array — no column.

ALTER TABLE hosts ADD COLUMN gifts_received       INTEGER DEFAULT 0;
ALTER TABLE hosts ADD COLUMN successful_referrals INTEGER DEFAULT 0;

-- ── Backfill from historical data ──────────────────────────────────────────
-- gifts_received = tips received + gift chat-messages received.
UPDATE hosts SET gifts_received =
  (SELECT COUNT(*) FROM tips t WHERE t.host_id = hosts.id)
  + (SELECT COUNT(*) FROM messages m
       JOIN chat_rooms cr ON cr.id = m.room_id
      WHERE cr.host_id = hosts.id AND m.type = 'gift');

-- successful_referrals = referrals by this host's user that are unlocked.
UPDATE hosts SET successful_referrals = (
  SELECT COUNT(*) FROM referral_uses ru
  WHERE ru.referrer_id = hosts.user_id AND ru.status = 'unlocked'
);
