-- Migration 0039: Host profile gallery + intro video
-- Allows hosts to upload multiple gallery images and an intro video URL.

-- Gallery images table (max 6 per host)
CREATE TABLE IF NOT EXISTS host_gallery (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  host_id TEXT NOT NULL,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_host_gallery_host ON host_gallery(host_id);

-- Add intro_video_url column to hosts table
ALTER TABLE hosts ADD COLUMN intro_video_url TEXT;
-- Add schedule columns for availability display
ALTER TABLE hosts ADD COLUMN available_from TEXT;
ALTER TABLE hosts ADD COLUMN available_to TEXT;
ALTER TABLE hosts ADD COLUMN timezone TEXT DEFAULT 'Asia/Kolkata';
