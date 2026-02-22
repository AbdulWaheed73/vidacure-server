import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { PatientT } from '../types/patient-type';
import { DoctorT } from '../types/doctor-type';
import PatientSchema from '../schemas/patient-schema';
import DoctorSchema from '../schemas/doctor-schema';
import {
  SupabaseConversation,
  SupabaseMessage,
  SupabaseParticipant,
  SupabaseChatTokenPayload,
  CreateConversationResult,
  GetConversationResponse,
  GetConversationsResponse,
} from '../types/supabase-chat-types';

// Initialize Supabase client (service role for server-side operations)
const getSupabaseClient = (): SupabaseClient => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

/**
 * Supabase Chat API Service
 * Handles all Supabase Realtime chat operations
 */
export const supabaseChatApi = {
  /**
   * Generate a Supabase JWT token for a user with subscription claims
   */
  generateToken(user: PatientT | DoctorT): string {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('Missing SUPABASE_JWT_SECRET environment variable');
    }

    const userId = user._id?.toString() || '';
    const isPatient = user.role === 'patient';
    const patient = user as PatientT;

    // Check subscription status for patients
    const subscriptionActive = isPatient
      ? patient.subscription?.status === 'active' || patient.subscription?.status === 'trialing'
      : true; // Doctors always have access

    const subscriptionExpiresAt = isPatient && patient.subscription?.currentPeriodEnd
      ? patient.subscription.currentPeriodEnd.toISOString()
      : undefined;

    // Get the Supabase project ref from the URL (e.g., "wvmekwvxrxwbjukwgbgb" from "https://wvmekwvxrxwbjukwgbgb.supabase.co")
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';

    const payload = {
      // Required Supabase claims
      iss: 'supabase',  // Issuer must be 'supabase'
      ref: projectRef,   // Project reference
      role: 'authenticated',  // PostgreSQL role
      aud: 'authenticated',   // Audience

      // User identification
      sub: userId,

      // Custom claims for our app
      user_role: user.role as 'patient' | 'doctor',
      subscription_active: subscriptionActive,
      subscription_expires_at: subscriptionExpiresAt,

      // Timestamps
      exp: Math.floor(Date.now() / 1000) + (6 * 60 * 60), // 6 hours expiry
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, jwtSecret, {
      algorithm: 'HS256',
      header: { alg: 'HS256', typ: 'JWT' }  // Include typ in header
    });
  },

  /**
   * Get token expiry timestamp
   */
  getTokenExpiry(): string {
    return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6 hours from now
  },

  /**
   * Create or update user presence in Supabase
   */
  async upsertUserPresence(userId: string, status: 'online' | 'offline' | 'away' = 'online'): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('user_presence')
      .upsert({
        user_id: userId,
        status,
        last_seen: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Error upserting user presence:', error);
      throw error;
    }
  },

  /**
   * Create or get a patient's conversation and update database relations
   */
  async getOrCreatePatientConversation(patientId: string, doctorId: string): Promise<CreateConversationResult> {
    const supabase = getSupabaseClient();
    const channelId = `patient-${patientId}-medical`;

    // Check if conversation already exists
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('channel_id', channelId)
      .single();

    if (existingConversation) {
      // Update MongoDB relations if needed
      await PatientSchema.findByIdAndUpdate(patientId, {
        doctor: doctorId,
        supabaseConversationId: existingConversation.id,
      });

      await DoctorSchema.findByIdAndUpdate(doctorId, {
        $addToSet: { patients: patientId },
      });

      return {
        conversationId: existingConversation.id,
        channelId,
        created: false,
      };
    }

    // Create new conversation
    const { data: newConversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        channel_id: channelId,
        type: 'messaging',
        created_by: patientId,
      })
      .select('id')
      .single();

    if (convError || !newConversation) {
      console.error('Error creating conversation:', convError);
      throw convError || new Error('Failed to create conversation');
    }

    // Add participants
    const { error: participantsError } = await supabase
      .from('conversation_participants')
      .insert([
        {
          conversation_id: newConversation.id,
          user_id: patientId,
          user_role: 'patient',
        },
        {
          conversation_id: newConversation.id,
          user_id: doctorId,
          user_role: 'doctor',
        },
      ]);

    if (participantsError) {
      console.error('Error adding participants:', participantsError);
      throw participantsError;
    }

    // Update MongoDB relations
    await PatientSchema.findByIdAndUpdate(patientId, {
      doctor: doctorId,
      supabaseConversationId: newConversation.id,
    });

    await DoctorSchema.findByIdAndUpdate(doctorId, {
      $addToSet: { patients: patientId },
    });

    return {
      conversationId: newConversation.id,
      channelId,
      created: true,
    };
  },

  /**
   * Get patient's conversation
   */
  async getPatientConversation(patientId: string): Promise<GetConversationResponse | null> {
    const supabase = getSupabaseClient();
    const channelId = `patient-${patientId}-medical`;

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants (*)
      `)
      .eq('channel_id', channelId)
      .single();

    if (error || !conversation) {
      console.error('Error getting patient conversation:', error);
      return null;
    }

    return {
      conversation: conversation as SupabaseConversation,
      participants: conversation.conversation_participants as SupabaseParticipant[],
    };
  },

  /**
   * Get all conversations for a doctor
   */
  async getDoctorConversations(doctorId: string): Promise<GetConversationsResponse> {
    const supabase = getSupabaseClient();

    // Get all conversation IDs where the doctor is an active participant
    const { data: participations, error: partError } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', doctorId)
      .eq('is_active', true);

    if (partError) {
      console.error('Error getting doctor participations:', partError);
      throw partError;
    }

    if (!participations || participations.length === 0) {
      return { conversations: [] };
    }

    const conversationIds = participations.map(p => p.conversation_id);

    // Get full conversation data with participants and last message
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants (*),
        messages (
          id,
          content,
          sender_id,
          sender_role,
          created_at,
          message_type
        )
      `)
      .in('id', conversationIds)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (convError) {
      console.error('Error getting doctor conversations:', convError);
      throw convError;
    }

    // Process conversations to include last message
    const processedConversations = (conversations || []).map(conv => {
      const messages = conv.messages as SupabaseMessage[] || [];
      const lastMessage = messages.length > 0
        ? messages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        : undefined;

      return {
        ...conv,
        participants: conv.conversation_participants as SupabaseParticipant[],
        lastMessage,
        messages: undefined, // Remove full messages array
      };
    });

    return { conversations: processedConversations };
  },

  /**
   * Reassign doctor to patient conversation
   */
  async reassignDoctor(patientId: string, newDoctorId: string, oldDoctorId?: string): Promise<void> {
    const supabase = getSupabaseClient();
    const channelId = `patient-${patientId}-medical`;

    // Get the conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('channel_id', channelId)
      .single();

    if (convError || !conversation) {
      console.error('Error finding conversation for reassignment:', convError);
      throw convError || new Error('Conversation not found');
    }

    const conversationId = conversation.id;

    // Deactivate old doctor's participation
    if (oldDoctorId) {
      await supabase
        .from('conversation_participants')
        .update({
          is_active: false,
          left_at: new Date().toISOString(),
        })
        .eq('conversation_id', conversationId)
        .eq('user_id', oldDoctorId);

      // Update MongoDB - remove from old doctor
      await DoctorSchema.findByIdAndUpdate(oldDoctorId, {
        $pull: { patients: patientId },
      });
    }

    // Check if new doctor is already a participant
    const { data: existingParticipant } = await supabase
      .from('conversation_participants')
      .select('id, is_active')
      .eq('conversation_id', conversationId)
      .eq('user_id', newDoctorId)
      .single();

    if (existingParticipant) {
      // Reactivate existing participant
      await supabase
        .from('conversation_participants')
        .update({
          is_active: true,
          left_at: null,
        })
        .eq('id', existingParticipant.id);
    } else {
      // Add new participant
      await supabase
        .from('conversation_participants')
        .insert({
          conversation_id: conversationId,
          user_id: newDoctorId,
          user_role: 'doctor',
        });
    }

    // Update MongoDB relations
    await PatientSchema.findByIdAndUpdate(patientId, {
      doctor: newDoctorId,
    });

    await DoctorSchema.findByIdAndUpdate(newDoctorId, {
      $addToSet: { patients: patientId },
    });

    // Send handoff system message
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: newDoctorId,
      sender_role: 'system',
      content: 'A new doctor has been assigned to this conversation.',
      message_type: 'doctor_handoff',
      metadata: {
        old_doctor_id: oldDoctorId || null,
        new_doctor_id: newDoctorId,
      },
    });
  },

  /**
   * Send a system message to a conversation
   */
  async sendSystemMessage(
    conversationId: string,
    content: string,
    metadata?: Record<string, unknown>,
    senderId?: string
  ): Promise<SupabaseMessage> {
    const supabase = getSupabaseClient();

    // If no senderId provided, get the doctor from the conversation
    if (!senderId) {
      const { data: doctorParticipant } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_role', 'doctor')
        .eq('is_active', true)
        .single();

      senderId = doctorParticipant?.user_id || 'system';
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        sender_role: 'system',
        content,
        message_type: 'system',
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error || !message) {
      console.error('Error sending system message:', error);
      throw error || new Error('Failed to send system message');
    }

    return message as SupabaseMessage;
  },

  /**
   * Soft delete user's messages and deactivate participations (GDPR)
   */
  async deleteUserData(userId: string, userRole: 'patient' | 'doctor'): Promise<void> {
    const supabase = getSupabaseClient();

    // Soft delete all messages from this user
    await supabase
      .from('messages')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        content: '[Message deleted]',
      })
      .eq('sender_id', userId);

    // Deactivate all participations
    await supabase
      .from('conversation_participants')
      .update({
        is_active: false,
        left_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Delete presence
    await supabase
      .from('user_presence')
      .delete()
      .eq('user_id', userId);

    // Delete typing indicators
    await supabase
      .from('typing_indicators')
      .delete()
      .eq('user_id', userId);

    // Handle MongoDB cleanup based on role
    if (userRole === 'patient') {
      const patient = await PatientSchema.findById(userId);
      if (patient?.doctor) {
        await DoctorSchema.findByIdAndUpdate(patient.doctor, {
          $pull: { patients: userId },
        });
      }
    } else if (userRole === 'doctor') {
      // Unassign all patients from this doctor
      await PatientSchema.updateMany(
        { doctor: userId },
        { $unset: { doctor: 1 } }
      );

      await DoctorSchema.findByIdAndUpdate(userId, {
        patients: [],
      });
    }
  },

  /**
   * Get conversation by ID
   */
  async getConversationById(conversationId: string): Promise<GetConversationResponse | null> {
    const supabase = getSupabaseClient();

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants (*)
      `)
      .eq('id', conversationId)
      .single();

    if (error || !conversation) {
      return null;
    }

    return {
      conversation: conversation as SupabaseConversation,
      participants: conversation.conversation_participants as SupabaseParticipant[],
    };
  },

  /**
   * Get all unread counts for a user across all conversations
   */
  async getAllUnreadCounts(userId: string): Promise<{ [conversationId: string]: number }> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc('get_all_unread_counts', {
      p_user_id: userId,
    });

    if (error) {
      console.error('Failed to get unread counts:', error);
      return {};
    }

    const counts: { [conversationId: string]: number } = {};
    if (data) {
      data.forEach((item: { conversation_id: string; unread_count: number }) => {
        counts[item.conversation_id] = item.unread_count;
      });
    }
    return counts;
  },

  /**
   * Check if user is participant in conversation
   */
  async isUserParticipant(conversationId: string, userId: string): Promise<boolean> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    return !error && !!data;
  },
};

// Export individual functions for convenience
export const {
  generateToken,
  getTokenExpiry,
  upsertUserPresence,
  getOrCreatePatientConversation,
  getPatientConversation,
  getDoctorConversations,
  reassignDoctor,
  sendSystemMessage,
  deleteUserData,
  getConversationById,
  getAllUnreadCounts,
  isUserParticipant,
} = supabaseChatApi;
