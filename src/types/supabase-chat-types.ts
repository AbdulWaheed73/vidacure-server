// Supabase Chat Types
// All types related to Supabase Realtime chat functionality

// =============================================
// DATABASE TABLE TYPES (matching PostgreSQL schema)
// =============================================

export type SupabaseConversation = {
  id: string;  // UUID
  channel_id: string;  // Format: 'patient-{patientId}-medical'
  type: string;
  created_by: string;  // MongoDB ObjectId
  created_at: string;  // ISO timestamp
  updated_at: string;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
};

export type SupabaseParticipant = {
  id: string;  // UUID
  conversation_id: string;
  user_id: string;  // MongoDB ObjectId
  user_role: 'patient' | 'doctor';
  is_active: boolean;
  joined_at: string;
  left_at: string | null;
};

export type SupabaseMessage = {
  id: string;  // UUID
  conversation_id: string;
  sender_id: string;  // MongoDB ObjectId
  sender_role: 'patient' | 'doctor' | 'system';
  content: string;
  message_type: 'text' | 'system' | 'attachment' | 'doctor_handoff';
  attachments: SupabaseAttachment[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_deleted: boolean;
};

export type SupabaseAttachment = {
  id?: string;
  type: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  thumbnail_path?: string;
  url?: string;
};

export type SupabaseReadReceipt = {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
};

export type SupabasePresence = {
  user_id: string;
  status: 'online' | 'offline' | 'away';
  last_seen: string;
  metadata: Record<string, unknown>;
};

export type SupabaseTypingIndicator = {
  conversation_id: string;
  user_id: string;
  started_at: string;
};

// =============================================
// JWT TOKEN TYPES
// =============================================

export type SupabaseChatTokenPayload = {
  sub: string;  // MongoDB user ID
  user_role: 'patient' | 'doctor';  // Custom claim for user's application role
  role: 'authenticated';  // PostgreSQL role (required by Supabase)
  subscription_active: boolean;
  subscription_expires_at?: string;
  aud: string;  // 'authenticated'
  exp: number;  // Expiry timestamp
  iat: number;  // Issued at timestamp
};

// =============================================
// API REQUEST/RESPONSE TYPES
// =============================================

export type CreateConversationInput = {
  patientId: string;
  doctorId: string;
};

export type CreateConversationResult = {
  conversationId: string;
  channelId: string;
  created: boolean;
};

export type SendMessageInput = {
  conversationId: string;
  content: string;
  messageType?: 'text' | 'system' | 'attachment' | 'doctor_handoff';
  attachments?: SupabaseAttachment[];
  metadata?: Record<string, unknown>;
};

export type GetConversationResponse = {
  conversation: SupabaseConversation;
  participants: SupabaseParticipant[];
};

export type GetConversationsResponse = {
  conversations: (SupabaseConversation & {
    participants: SupabaseParticipant[];
    lastMessage?: SupabaseMessage;
  })[];
};

export type SupabaseChatTokenResponse = {
  token: string;
  expiresAt: string;
  user: {
    id: string;
    name: string;
    role: 'patient' | 'doctor';
    subscriptionActive: boolean;
  };
};

// =============================================
// SERVICE TYPES
// =============================================

export type ReassignDoctorInput = {
  patientId: string;
  newDoctorId: string;
  oldDoctorId?: string;
};

export type DeleteUserDataInput = {
  userId: string;
  userRole: 'patient' | 'doctor';
};

// =============================================
// REALTIME EVENT TYPES
// =============================================

export type RealtimeMessageEvent = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'messages';
  record: SupabaseMessage;
  old_record?: SupabaseMessage;
};

export type RealtimePresenceEvent = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'user_presence';
  record: SupabasePresence;
  old_record?: SupabasePresence;
};

export type RealtimeTypingEvent = {
  type: 'INSERT' | 'DELETE';
  table: 'typing_indicators';
  record: SupabaseTypingIndicator;
};

export type BroadcastTypingPayload = {
  userId: string;
  isTyping: boolean;
};

export type BroadcastNewMessagePayload = {
  message: SupabaseMessage;
};
