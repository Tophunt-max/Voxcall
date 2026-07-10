-- Migration: production-grade promotional banners
--
-- Until now every app fetched the SAME banner rows (position=home), so regular
-- users and hosts were shown identical promos, admins could not schedule or
-- order banners, and the app had to guess whether a CTA was an in-app route or
-- an external URL. This migration makes banners a first-class, targetable,
-- schedulable, orderable content type.
--
--   audience   : who sees the banner — 'user' (user app) | 'host' (host app) | 'all'
--   link_type  : how the CTA opens   — 'none' | 'internal' (in-app route) | 'external' (https URL)
--   sort_order : admin-controlled ordering within a position (lower = first)
--   starts_at  : optional unix ts — banner hidden before this time
--   ends_at    : optional unix ts — banner hidden after this time
--
-- Defaults keep every existing banner behaving exactly as before (user-facing,
-- internal link, no schedule) so nothing breaks on deploy.

ALTER TABLE banners ADD COLUMN audience   TEXT    NOT NULL DEFAULT 'user';
ALTER TABLE banners ADD COLUMN link_type  TEXT    NOT NULL DEFAULT 'internal';
ALTER TABLE banners ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE banners ADD COLUMN starts_at  INTEGER;
ALTER TABLE banners ADD COLUMN ends_at    INTEGER;

-- Backfill link_type from the existing cta_link shape so old banners open
-- correctly under the new type-aware handler:
--   https URL  → external
--   empty      → none
--   /path      → internal (the column default, left as-is)
UPDATE banners SET link_type = 'external' WHERE cta_link LIKE 'http%';
UPDATE banners SET link_type = 'none'     WHERE cta_link IS NULL OR cta_link = '';

-- Indexes for the hot public read path (active + position + audience filter).
CREATE INDEX IF NOT EXISTS idx_banners_active_position ON banners(active, position);
CREATE INDEX IF NOT EXISTS idx_banners_audience         ON banners(audience);

-- Seed a host-facing example so operators immediately see the separation
-- working. Kept INACTIVE so it never surprises a live host feed until an admin
-- reviews and enables it.
INSERT OR IGNORE INTO banners
  (id, title, subtitle, image_url, bg_color, cta_text, cta_link, position, audience, link_type, sort_order, active)
VALUES
  ('bn_host_welcome', 'Boost Your Earnings', 'Stay online during peak hours to earn more coins', '', '#6A00B8', '', '', 'home_top', 'host', 'none', 0, 0);
