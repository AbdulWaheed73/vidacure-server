-- Migration: 003_create_messages_table.sql
-- Description: Creates the messages table

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,  -- MongoDB ObjectId as string
  sender_role TEXT NOT NULL CHECK (sender_role IN ('patient', 'doctor', 'system')),
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'system', 'attachment', 'doctor_handoff')),
  attachments JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- Add comment for documentation
COMMENT ON TABLE messages IS 'Chat messages in conversations';
COMMENT ON COLUMN messages.sender_id IS 'MongoDB ObjectId of the message sender';
COMMENT ON COLUMN messages.message_type IS 'Type of message: text, system, attachment, or doctor_handoff';
COMMENT ON COLUMN messages.is_deleted IS 'Soft delete flag for GDPR compliance';
