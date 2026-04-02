-- Add rate_per_minute to call_sessions (stores the per-minute coin rate at time of call)
ALTER TABLE call_sessions ADD COLUMN rate_per_minute INTEGER DEFAULT 0;
