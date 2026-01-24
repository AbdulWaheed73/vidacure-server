-- Migration: 008_create_functions_and_triggers.sql
-- Description: Creates database functions and triggers

-- Function to update conversation last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET
    last_message_at = NEW.created_at,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update last_message_at
DROP TRIGGER IF EXISTS trigger_update_last_message ON messages;
CREATE TRIGGER trigger_update_last_message
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_last_message();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for conversations updated_at
DROP TRIGGER IF EXISTS trigger_conversations_updated_at ON conversations;
CREATE TRIGGER trigger_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for messages updated_at
DROP TRIGGER IF EXISTS trigger_messages_updated_at ON messages;
CREATE TRIGGER trigger_messages_updated_at
BEFORE UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up old typing indicators (> 10 seconds)
CREATE OR REPLACE FUNCTION cleanup_typing_indicators()
RETURNS void AS $$
BEGIN
  DELETE FROM typing_indicators
  WHERE started_at < NOW() - INTERVAL '10 seconds';
END;
$$ LANGUAGE plpgsql;

-- Function to get or create conversation by channel_id
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_channel_id TEXT,
  p_patient_id TEXT,
  p_doctor_id TEXT
) RETURNS TABLE(conversation_id UUID, created BOOLEAN) AS $$
DECLARE
  v_conversation_id UUID;
  v_created BOOLEAN := FALSE;
BEGIN
  -- Try to find existing conversation
  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE channel_id = p_channel_id;

  -- Create if not exists
  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (channel_id, created_by, type)
    VALUES (p_channel_id, p_patient_id, 'messaging')
    RETURNING id INTO v_conversation_id;

    -- Add participants
    INSERT INTO conversation_participants (conversation_id, user_id, user_role)
    VALUES
      (v_conversation_id, p_patient_id, 'patient'),
      (v_conversation_id, p_doctor_id, 'doctor');

    v_created := TRUE;
  END IF;

  RETURN QUERY SELECT v_conversation_id, v_created;
END;
$$ LANGUAGE plpgsql;
