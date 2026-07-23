-- Migration 0065: Gift-send idempotency
--
-- Gift sends debit real coins. A network timeout + client retry (or a
-- duplicate request) previously charged the user twice because there was no
-- idempotency guard. We tag each gift message with a client-supplied
-- idempotency_key and enforce uniqueness so a retry returns the ORIGINAL gift
-- instead of charging again. Idempotent / re-runnable.

ALTER TABLE messages ADD COLUMN idempotency_key TEXT;

-- Partial unique index: only non-null keys are constrained (regular messages
-- leave it NULL). A duplicate gift-send collides here and is caught + reversed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key
  ON messages(idempotency_key) WHERE idempotency_key IS NOT NULL;
