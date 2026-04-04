-- Add status column to users table for account banning/deletion
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active' CHECK(status IN ('active','banned','deleted'));
