-- Migration: 004_create_read_receipts_table.sql
-- Description: Creates the message_read_receipts table

CREATE TABLE IF NOT EXISTS message_read_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- MongoDB ObjectId as string
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Add comment for documentation
COMMENT ON TABLE message_read_receipts IS 'Tracks which users have read which messages';
COMMENT ON COLUMN message_read_receipts.user_id IS 'MongoDB ObjectId of the user who read the message';
