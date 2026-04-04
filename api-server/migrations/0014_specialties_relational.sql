-- FIX #18: Specialties and Languages as Relational Tables
-- Currently stored as JSON strings — prevents proper indexing and fast search.
-- New tables allow indexed lookups and efficient filtering.

CREATE TABLE IF NOT EXISTS host_specialties (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS host_languages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_host_specialties_host ON host_specialties(host_id);
CREATE INDEX IF NOT EXISTS idx_host_specialties_name ON host_specialties(specialty);
CREATE INDEX IF NOT EXISTS idx_host_languages_host ON host_languages(host_id);
CREATE INDEX IF NOT EXISTS idx_host_languages_name ON host_languages(language);

-- NOTE: Data migration from hosts.specialties (JSON) to host_specialties table
-- must be done via a one-time script after this migration runs.
-- The existing hosts.specialties and hosts.languages JSON columns are kept for
-- backward compatibility during the transition period.
