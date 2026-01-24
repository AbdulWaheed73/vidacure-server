-- Migration: 011_create_storage_bucket.sql
-- Description: Creates the chat-attachments storage bucket with RLS

-- Create the chat-attachments bucket (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  FALSE,  -- Private bucket
  10485760,  -- 10MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS on storage.objects
-- Note: RLS is enabled by default on storage.objects

-- Policy: Users can upload to their conversations
DROP POLICY IF EXISTS "Users can upload to their conversations" ON storage.objects;
CREATE POLICY "Users can upload to their conversations"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND (
    -- Check if user is a participant in the conversation
    -- Path format: {conversationId}/{timestamp}_{filename}
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.user_id = (auth.jwt() ->> 'sub')
      AND cp.is_active = TRUE
      AND c.id::text = (storage.foldername(name))[1]
    )
    OR auth.role() = 'service_role'
  )
);

-- Policy: Users can view attachments in their conversations
DROP POLICY IF EXISTS "Users can view attachments in their conversations" ON storage.objects;
CREATE POLICY "Users can view attachments in their conversations"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'chat-attachments'
  AND (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.user_id = (auth.jwt() ->> 'sub')
      AND cp.is_active = TRUE
      AND c.id::text = (storage.foldername(name))[1]
    )
    OR auth.role() = 'service_role'
  )
);

-- Policy: Users can delete their own uploads
DROP POLICY IF EXISTS "Users can delete their own uploads" ON storage.objects;
CREATE POLICY "Users can delete their own uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'chat-attachments'
  AND (
    owner_id = (auth.jwt() ->> 'sub')
    OR auth.role() = 'service_role'
  )
);

-- Create message_attachments table for metadata
CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL,  -- MongoDB ObjectId
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,  -- Supabase Storage path
  thumbnail_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for message_attachments
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON message_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON message_attachments(uploader_id);

-- Enable RLS on message_attachments
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view attachments in their conversations
DROP POLICY IF EXISTS "Users can view attachment metadata" ON message_attachments;
CREATE POLICY "Users can view attachment metadata"
ON message_attachments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = message_attachments.conversation_id
    AND cp.user_id = (auth.jwt() ->> 'sub')
    AND cp.is_active = TRUE
  )
  OR auth.role() = 'service_role'
);

-- Policy: Users can insert attachment metadata for their uploads
DROP POLICY IF EXISTS "Users can insert attachment metadata" ON message_attachments;
CREATE POLICY "Users can insert attachment metadata"
ON message_attachments FOR INSERT
WITH CHECK (
  uploader_id = (auth.jwt() ->> 'sub')
  AND EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = message_attachments.conversation_id
    AND cp.user_id = (auth.jwt() ->> 'sub')
    AND cp.is_active = TRUE
  )
  OR auth.role() = 'service_role'
);

-- Add comment for documentation
COMMENT ON TABLE message_attachments IS 'Metadata for file attachments in chat messages';
