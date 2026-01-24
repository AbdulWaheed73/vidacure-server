-- Migration: 013_create_chat_rpc_functions.sql
-- Description: Creates RPC functions for chat operations (message sending, read receipts, unread counts)
-- Note: These functions were previously created manually and are now version controlled

-- =============================================
-- SEND CHAT MESSAGE
-- Main RPC function for sending messages with validation
-- =============================================
CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_conversation_id uuid,
  p_sender_id text,
  p_sender_role text,
  p_content text,
  p_message_type text DEFAULT 'text'::text,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_message RECORD;
  v_channel_id TEXT;
  v_result JSONB;
BEGIN
  -- Verify sender is a participant in the conversation
  IF NOT is_conversation_member(p_conversation_id, p_sender_id) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Validate sender_role
  IF p_sender_role NOT IN ('patient', 'doctor', 'system') THEN
    RAISE EXCEPTION 'Invalid sender_role: must be patient, doctor, or system';
  END IF;

  -- Validate message_type
  IF p_message_type NOT IN ('text', 'system', 'attachment', 'doctor_handoff') THEN
    RAISE EXCEPTION 'Invalid message_type';
  END IF;

  -- Get the channel_id for the conversation
  SELECT channel_id INTO v_channel_id
  FROM conversations
  WHERE id = p_conversation_id;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- Insert the message
  INSERT INTO messages (
    conversation_id,
    sender_id,
    sender_role,
    content,
    message_type,
    attachments,
    metadata
  )
  VALUES (
    p_conversation_id,
    p_sender_id,
    p_sender_role,
    p_content,
    p_message_type,
    p_attachments,
    p_metadata
  )
  RETURNING * INTO v_message;

  -- Update conversation's last_message_at
  UPDATE conversations
  SET
    last_message_at = v_message.created_at,
    updated_at = NOW()
  WHERE id = p_conversation_id;

  -- Build the result JSONB
  v_result := jsonb_build_object(
    'id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'sender_id', v_message.sender_id,
    'sender_role', v_message.sender_role,
    'content', v_message.content,
    'message_type', v_message.message_type,
    'attachments', v_message.attachments,
    'metadata', v_message.metadata,
    'created_at', v_message.created_at,
    'updated_at', v_message.updated_at,
    'is_deleted', v_message.is_deleted
  );

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION send_chat_message IS 'RPC function to send a chat message with participant validation';

-- =============================================
-- GET UNREAD COUNT (Single Conversation)
-- =============================================
CREATE OR REPLACE FUNCTION public.get_unread_count(
  p_conversation_id uuid,
  p_user_id text
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::INTEGER
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_id != p_user_id
    AND m.is_deleted = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM message_read_receipts r
      WHERE r.message_id = m.id
        AND r.user_id = p_user_id
    );
$function$;

COMMENT ON FUNCTION get_unread_count IS 'Get unread message count for a specific conversation';

-- =============================================
-- GET ALL UNREAD COUNTS (All User Conversations)
-- =============================================
CREATE OR REPLACE FUNCTION public.get_all_unread_counts(p_user_id text)
RETURNS TABLE(conversation_id uuid, unread_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    cp.conversation_id,
    COUNT(m.id)::INTEGER AS unread_count
  FROM conversation_participants cp
  LEFT JOIN messages m ON m.conversation_id = cp.conversation_id
    AND m.sender_id != p_user_id
    AND m.is_deleted = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM message_read_receipts r
      WHERE r.message_id = m.id
        AND r.user_id = p_user_id
    )
  WHERE cp.user_id = p_user_id
    AND cp.is_active = TRUE
  GROUP BY cp.conversation_id;
$function$;

COMMENT ON FUNCTION get_all_unread_counts IS 'Get unread message counts for all conversations a user participates in';

-- =============================================
-- MARK MESSAGES AS READ
-- =============================================
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_conversation_id uuid,
  p_user_id text,
  p_before_timestamp timestamp with time zone DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  -- Verify user is a participant
  IF NOT is_conversation_member(p_conversation_id, p_user_id) THEN
    RAISE EXCEPTION 'User is not a participant in this conversation';
  END IF;

  -- Insert read receipts for all unread messages
  INSERT INTO message_read_receipts (message_id, user_id)
  SELECT m.id, p_user_id
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_id != p_user_id
    AND m.created_at <= p_before_timestamp
    AND m.is_deleted = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM message_read_receipts r
      WHERE r.message_id = m.id AND r.user_id = p_user_id
    )
  ON CONFLICT (message_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION mark_messages_as_read IS 'Mark all messages in a conversation as read up to a timestamp';

-- =============================================
-- GET MESSAGES READ STATUS
-- =============================================
CREATE OR REPLACE FUNCTION public.get_messages_read_status(
  p_message_ids uuid[],
  p_recipient_id text
)
RETURNS TABLE(message_id uuid, is_read boolean, read_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    m.id AS message_id,
    r.id IS NOT NULL AS is_read,
    r.read_at
  FROM unnest(p_message_ids) AS m(id)
  LEFT JOIN message_read_receipts r ON r.message_id = m.id
    AND r.user_id = p_recipient_id;
$function$;

COMMENT ON FUNCTION get_messages_read_status IS 'Get read status for multiple messages (for displaying checkmarks)';

-- =============================================
-- IS MESSAGE READ (Helper)
-- =============================================
CREATE OR REPLACE FUNCTION public.is_message_read(
  p_message_id uuid,
  p_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM message_read_receipts
    WHERE message_id = p_message_id
      AND user_id = p_user_id
  );
$function$;

COMMENT ON FUNCTION is_message_read IS 'Check if a specific message has been read by a user';

-- =============================================
-- BROADCAST NEW MESSAGE (Trigger Function)
-- =============================================
CREATE OR REPLACE FUNCTION public.broadcast_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel_id TEXT;
  v_payload JSONB;
BEGIN
  -- Get the channel_id for this conversation
  SELECT channel_id INTO v_channel_id
  FROM conversations
  WHERE id = NEW.conversation_id;

  -- Build the message payload
  v_payload := jsonb_build_object(
    'type', 'new_message',
    'message', jsonb_build_object(
      'id', NEW.id,
      'conversation_id', NEW.conversation_id,
      'sender_id', NEW.sender_id,
      'sender_role', NEW.sender_role,
      'content', NEW.content,
      'message_type', NEW.message_type,
      'attachments', NEW.attachments,
      'metadata', NEW.metadata,
      'created_at', NEW.created_at,
      'updated_at', NEW.updated_at,
      'is_deleted', NEW.is_deleted
    ),
    'channel_id', v_channel_id
  );

  -- Use pg_notify to broadcast to listening clients
  -- Channel name format: chat:{channel_id}
  PERFORM pg_notify(
    'new_chat_message',
    v_payload::text
  );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION broadcast_new_message IS 'Trigger function to broadcast new messages via pg_notify';

-- Create trigger for broadcasting new messages (if not exists)
DROP TRIGGER IF EXISTS trigger_broadcast_new_message ON messages;
CREATE TRIGGER trigger_broadcast_new_message
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION broadcast_new_message();
