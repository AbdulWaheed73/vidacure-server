-- Migration: 014_fix_search_path_security.sql
-- Description: Fix mutable search_path security issue in older functions
-- This prevents search_path injection attacks

-- Fix cleanup_typing_indicators
CREATE OR REPLACE FUNCTION public.cleanup_typing_indicators()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM typing_indicators
  WHERE started_at < NOW() - INTERVAL '10 seconds';
END;
$$;

-- Fix get_or_create_conversation
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(
  p_channel_id TEXT,
  p_patient_id TEXT,
  p_doctor_id TEXT
)
RETURNS TABLE(conversation_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

-- Fix update_conversation_last_message
CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE conversations
  SET
    last_message_at = NEW.created_at,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

-- Fix update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
