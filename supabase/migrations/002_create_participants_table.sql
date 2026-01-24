-- Migration: 002_create_participants_table.sql
-- Description: Creates the conversation_participants table

CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- MongoDB ObjectId as string
  user_role TEXT NOT NULL CHECK (user_role IN ('patient', 'doctor')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);

-- Add comment for documentation
COMMENT ON TABLE conversation_participants IS 'Participants in chat conversations (patient + doctor)';
COMMENT ON COLUMN conversation_participants.user_id IS 'MongoDB ObjectId of the user';
COMMENT ON COLUMN conversation_participants.is_active IS 'Whether the user is still an active participant';
