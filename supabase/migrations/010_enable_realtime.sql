-- Migration: 010_enable_realtime.sql
-- Description: Enables Supabase Realtime on required tables

-- Enable Realtime for messages table (new messages broadcast)
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable Realtime for typing_indicators table
ALTER PUBLICATION supabase_realtime ADD TABLE typing_indicators;

-- Enable Realtime for user_presence table
ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;

-- Enable Realtime for message_read_receipts table
ALTER PUBLICATION supabase_realtime ADD TABLE message_read_receipts;

-- Enable Realtime for conversation_participants (for doctor reassignment notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;

-- Note: conversations table doesn't need realtime as it's rarely updated
-- and updates are handled via messages/participants changes
