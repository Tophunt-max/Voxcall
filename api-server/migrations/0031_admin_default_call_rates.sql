-- 0031_admin_default_call_rates.sql
--
-- Makes the CALLING SYSTEM's default per-minute rate admin-controlled instead
-- of a hardcoded constant. The admin panel (App Config → Calling System) now
-- owns these two values, and the backend + both apps read them everywhere a
-- rate is needed but no explicit host rate exists:
--
--   default_audio_rate  coins/min charged for a voice call (default 25 ≈ ₹5/min)
--   default_video_rate  coins/min charged for a video call (default 40 ≈ ₹8/min)
--
-- These are the SAME numbers previously hardcoded as DEFAULT_AUDIO_RATE /
-- DEFAULT_VIDEO_RATE in lib/levels.ts; seeding them here lets an operator
-- retune the standard call price live without a redeploy. Idempotent.
INSERT INTO app_settings (key, value, updated_at) VALUES
  ('default_audio_rate', '25', unixepoch()),
  ('default_video_rate', '40', unixepoch())
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();
