-- Drop typing indicators table (feature removed)
-- This table was used for ephemeral typing indicator data
-- Removing to reduce realtime traffic and code complexity

DROP TABLE IF EXISTS public.typing_indicators;
