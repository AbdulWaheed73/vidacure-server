-- Migration: 001_create_conversations_table.sql
-- Description: Creates the conversations table (replaces Stream channels)

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT UNIQUE NOT NULL,  -- Format: 'patient-{patientId}-medical'
  type TEXT NOT NULL DEFAULT 'messaging',
  created_by TEXT NOT NULL,  -- MongoDB ObjectId as string
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Add comment for documentation
COMMENT ON TABLE conversations IS 'Chat conversations between patients and doctors';
COMMENT ON COLUMN conversations.channel_id IS 'Unique channel identifier in format: patient-{patientId}-medical';
COMMENT ON COLUMN conversations.created_by IS 'MongoDB ObjectId of the patient who owns this conversation';
