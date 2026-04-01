-- Add CF host session ID for Cloudflare Calls SFU
ALTER TABLE call_sessions ADD COLUMN cf_host_session_id TEXT;
