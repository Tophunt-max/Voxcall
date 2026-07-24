-- 0071_reward_task_audience.sql
--
-- Per-task audience targeting for reward tasks, so VIP and free users can be
-- shown different tasks — AND so VIP-exclusive tasks are still VISIBLE to free
-- users (rendered locked 🔒) as a VIP upsell hook.
--
-- audience values:
--   'all'  — everyone sees + can claim (default; existing tasks are unchanged)
--   'vip'  — shown to EVERYONE, but only active VIP members can claim. Free
--            users see it locked with an "Unlock with VIP" CTA.
--   'free' — shown + claimable only to NON-VIP users (e.g. "Subscribe to VIP"
--            nudges); hidden from existing VIP members.
--
-- Backward-compatible: the column defaults to 'all', so every pre-existing task
-- behaves exactly as before. Idempotent — the auto-migrator tolerates the
-- "duplicate column name" error on re-run.

ALTER TABLE reward_tasks ADD COLUMN audience TEXT NOT NULL DEFAULT 'all';
CREATE INDEX IF NOT EXISTS idx_reward_tasks_audience ON reward_tasks(audience);
