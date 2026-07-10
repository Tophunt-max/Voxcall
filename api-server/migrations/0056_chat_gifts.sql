-- Migration: chat gifts (monetization)
--
-- Users send coin-priced gifts (🌹❤️💎) inside a chat. Coins are debited from
-- the sender and credited to the host (counting toward host earnings + levels,
-- exactly like tips), and the gift is persisted as a special chat message so it
-- renders inline in both apps.
--
-- Design: messages.media_type has a CHECK constraint SQLite can't ALTER, so a
-- gift is flagged by a NEW unconstrained `msg_kind` column plus denormalized
-- gift_icon/gift_name/gift_amount so a gift bubble renders from the message row
-- alone (resilient to later catalog edits/deletes).

-- Admin-managed gift catalog.
CREATE TABLE IF NOT EXISTS gifts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL,                 -- emoji shown in the picker + bubble
  price_coins INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_gifts_active ON gifts(is_active, sort_order);

-- Gift metadata on messages (msg_kind = 'gift' marks a gift message).
ALTER TABLE messages ADD COLUMN msg_kind    TEXT;
ALTER TABLE messages ADD COLUMN gift_icon   TEXT;
ALTER TABLE messages ADD COLUMN gift_name   TEXT;
ALTER TABLE messages ADD COLUMN gift_amount INTEGER;

-- Seed a sensible default catalog (admin can edit/add/disable in the panel).
INSERT OR IGNORE INTO gifts (id, name, icon, price_coins, sort_order, is_active) VALUES
  ('gift_rose',    'Rose',    '🌹', 10,   0, 1),
  ('gift_heart',   'Heart',   '❤️', 50,   1, 1),
  ('gift_teddy',   'Teddy',   '🧸', 100,  2, 1),
  ('gift_cake',    'Cake',    '🎂', 200,  3, 1),
  ('gift_diamond', 'Diamond', '💎', 500,  4, 1),
  ('gift_crown',   'Crown',   '👑', 1000, 5, 1),
  ('gift_rocket',  'Rocket',  '🚀', 2000, 6, 1);
