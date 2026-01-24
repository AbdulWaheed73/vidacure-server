-- Migration: 006_create_typing_indicators_table.sql
-- Description: Creates the typing_indicators table (UNLOGGED for performance)

-- UNLOGGED tables are faster but data is lost on crash (acceptable for ephemeral typing data)
CREATE UNLOGGED TABLE IF NOT EXISTS typing_indicators (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- MongoDB ObjectId as string
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Add comment for documentation
COMMENT ON TABLE typing_indicators IS 'Ephemeral typing indicator data (UNLOGGED for performance)';
COMMENT ON COLUMN typing_indicators.user_id IS 'MongoDB ObjectId of the user who is typing';
