-- Migration: 005_create_presence_table.sql
-- Description: Creates the user_presence table for online status tracking

CREATE TABLE IF NOT EXISTS user_presence (
  user_id TEXT PRIMARY KEY,  -- MongoDB ObjectId as string
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'away')),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Add comment for documentation
COMMENT ON TABLE user_presence IS 'Tracks user online/offline status';
COMMENT ON COLUMN user_presence.user_id IS 'MongoDB ObjectId of the user';
COMMENT ON COLUMN user_presence.status IS 'Current status: online, offline, or away';
