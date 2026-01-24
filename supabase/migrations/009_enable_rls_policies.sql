-- Migration: 009_enable_rls_policies.sql
-- Description: Enables Row Level Security and creates all security policies

-- Enable RLS on all tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;

-- =============================================
-- SECURITY DEFINER FUNCTION (avoids RLS recursion)
-- =============================================

CREATE OR REPLACE FUNCTION is_conversation_member(conv_id UUID, usr_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id
    AND user_id = usr_id
    AND is_active = TRUE
  );
$$;

-- =============================================
-- CONVERSATIONS POLICIES
-- =============================================

-- Users can view their conversations
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
CREATE POLICY "Users can view their conversations"
ON conversations FOR SELECT
USING (
  is_conversation_member(id, (auth.jwt() ->> 'sub'))
  OR auth.role() = 'service_role'
);

-- Service role can create conversations (server-side only)
DROP POLICY IF EXISTS "Service role can create conversations" ON conversations;
CREATE POLICY "Service role can create conversations"
ON conversations FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Service role can update conversations
DROP POLICY IF EXISTS "Service role can update conversations" ON conversations;
CREATE POLICY "Service role can update conversations"
ON conversations FOR UPDATE
USING (auth.role() = 'service_role');

-- =============================================
-- PARTICIPANTS POLICIES
-- =============================================

-- Users can view participants of their conversations
DROP POLICY IF EXISTS "Users can view participants of their conversations" ON conversation_participants;
CREATE POLICY "Users can view participants of their conversations"
ON conversation_participants FOR SELECT
USING (
  is_conversation_member(conversation_id, (auth.jwt() ->> 'sub'))
  OR auth.role() = 'service_role'
);

-- Service role can manage participants
DROP POLICY IF EXISTS "Service role can manage participants" ON conversation_participants;
CREATE POLICY "Service role can manage participants"
ON conversation_participants FOR ALL
USING (auth.role() = 'service_role');

-- =============================================
-- MESSAGES POLICIES
-- =============================================

-- Users can view messages in their conversations
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view messages in their conversations"
ON messages FOR SELECT
USING (
  is_conversation_member(conversation_id, (auth.jwt() ->> 'sub'))
  OR auth.role() = 'service_role'
);

-- Active subscribers and doctors can send messages
DROP POLICY IF EXISTS "Active subscribers and doctors can send messages" ON messages;
CREATE POLICY "Active subscribers and doctors can send messages"
ON messages FOR INSERT
WITH CHECK (
  is_conversation_member(conversation_id, (auth.jwt() ->> 'sub'))
  AND (
    -- Doctors can always send
    (auth.jwt() ->> 'user_role') = 'doctor'
    OR
    -- Patients must have active subscription
    (
      (auth.jwt() ->> 'user_role') = 'patient'
      AND (auth.jwt() ->> 'subscription_active')::boolean = TRUE
    )
  )
  -- Ensure sender_id matches the authenticated user
  AND sender_id = (auth.jwt() ->> 'sub')
);

-- Service role can send system messages
DROP POLICY IF EXISTS "Service role can send system messages" ON messages;
CREATE POLICY "Service role can send system messages"
ON messages FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- Service role can update messages (for soft delete)
DROP POLICY IF EXISTS "Service role can update messages" ON messages;
CREATE POLICY "Service role can update messages"
ON messages FOR UPDATE
USING (auth.role() = 'service_role');

-- =============================================
-- READ RECEIPTS POLICIES
-- =============================================

-- Users can view read receipts in their conversations
DROP POLICY IF EXISTS "Users can view read receipts" ON message_read_receipts;
CREATE POLICY "Users can view read receipts"
ON message_read_receipts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_read_receipts.message_id
    AND is_conversation_member(m.conversation_id, (auth.jwt() ->> 'sub'))
  )
  OR auth.role() = 'service_role'
);

-- Users can insert their own read receipts
DROP POLICY IF EXISTS "Users can insert their own read receipts" ON message_read_receipts;
CREATE POLICY "Users can insert their own read receipts"
ON message_read_receipts FOR INSERT
WITH CHECK (
  user_id = (auth.jwt() ->> 'sub')
  AND EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = message_read_receipts.message_id
    AND is_conversation_member(m.conversation_id, (auth.jwt() ->> 'sub'))
  )
);

-- =============================================
-- PRESENCE POLICIES
-- =============================================

-- Anyone can view presence
DROP POLICY IF EXISTS "Anyone can view presence" ON user_presence;
CREATE POLICY "Anyone can view presence"
ON user_presence FOR SELECT
USING (TRUE);

-- Users can update their own presence
DROP POLICY IF EXISTS "Users can manage their own presence" ON user_presence;
CREATE POLICY "Users can manage their own presence"
ON user_presence FOR ALL
USING (user_id = (auth.jwt() ->> 'sub'));

-- Service role can manage all presence
DROP POLICY IF EXISTS "Service role can manage presence" ON user_presence;
CREATE POLICY "Service role can manage presence"
ON user_presence FOR ALL
USING (auth.role() = 'service_role');

-- =============================================
-- TYPING INDICATORS POLICIES
-- =============================================

-- Users can view typing in their conversations
DROP POLICY IF EXISTS "Users can view typing in their conversations" ON typing_indicators;
CREATE POLICY "Users can view typing in their conversations"
ON typing_indicators FOR SELECT
USING (
  is_conversation_member(conversation_id, (auth.jwt() ->> 'sub'))
  OR auth.role() = 'service_role'
);

-- Users can manage their own typing status
DROP POLICY IF EXISTS "Users can manage their own typing status" ON typing_indicators;
CREATE POLICY "Users can manage their own typing status"
ON typing_indicators FOR ALL
USING (user_id = (auth.jwt() ->> 'sub'));
