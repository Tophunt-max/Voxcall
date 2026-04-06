-- FIX: Store WebRTC track names per role in call_sessions.
-- This allows the backend to return the correct remote track names during pull,
-- eliminating the hardcoded 'audio-0'/'video-1' assumption that breaks on
-- platforms where MID assignment differs.
ALTER TABLE call_sessions ADD COLUMN cf_caller_track_names TEXT;
ALTER TABLE call_sessions ADD COLUMN cf_host_track_names TEXT;
