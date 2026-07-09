-- Migration: message edit + soft-delete support
--
-- edited_at : unix seconds when the sender last edited the message (NULL = never edited).
-- is_deleted: 1 when the sender deleted the message ("delete for everyone"). We keep
--             the row (content blanked) so thread ordering + counts stay stable and
--             the client can render a "This message was deleted" placeholder.

ALTER TABLE messages ADD COLUMN edited_at INTEGER;
ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0;
