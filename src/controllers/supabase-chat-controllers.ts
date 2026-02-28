import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import { supabaseChatApi } from '../services/supabase-chat-api';
import PatientSchema from '../schemas/patient-schema';
import DoctorSchema from '../schemas/doctor-schema';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';

/**
 * Generate Supabase JWT token for chat
 * POST /api/supabase-chat/token
 */
export async function getSupabaseChatToken(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Get user data from database
    let user;
    if (userRole === 'patient') {
      user = await PatientSchema.findById(userId);
    } else if (userRole === 'doctor') {
      user = await DoctorSchema.findById(userId);
    }

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Update user presence
    await supabaseChatApi.upsertUserPresence(userId, 'online');

    // Generate Supabase JWT token
    const token = supabaseChatApi.generateToken(user);
    const expiresAt = supabaseChatApi.getTokenExpiry();

    // Check subscription status for response
    const isPatient = userRole === 'patient';
    const patient = user as typeof PatientSchema.prototype;
    const subscriptionActive = isPatient
      ? patient.subscription?.status === 'active' || patient.subscription?.status === 'trialing'
      : true;

    await auditDatabaseOperation(req, 'chat_token_generated', 'READ', userId);

    res.json({
      token,
      expiresAt,
      user: {
        id: userId,
        name: user.name,
        role: userRole,
        subscriptionActive,
      },
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_token_generate', 'READ', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to generate chat token' });
  }
}

/**
 * Get patient's conversation
 * GET /api/supabase-chat/conversation
 */
export async function getPatientConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (userRole !== 'patient') {
      res.status(403).json({ error: 'Access denied. Patients only.' });
      return;
    }

    // Get patient's assigned doctor
    const patient = await PatientSchema.findById(userId).populate('doctor');
    if (!patient?.doctor) {
      res.status(400).json({ error: 'No doctor assigned to this patient' });
      return;
    }

    const doctorId = patient.doctor._id.toString();
    const doctorName = (patient.doctor as any).name || 'Doctor';

    // Get or create conversation
    const result = await supabaseChatApi.getOrCreatePatientConversation(userId, doctorId);

    // Get full conversation data
    const conversationData = await supabaseChatApi.getPatientConversation(userId);

    await auditDatabaseOperation(req, 'chat_patient_conversation_accessed', 'READ', userId);

    res.json({
      conversationId: result.conversationId,
      channelId: result.channelId,
      created: result.created,
      conversation: conversationData?.conversation,
      participants: conversationData?.participants,
      doctorName,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_patient_conversation', 'READ', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to get patient conversation' });
  }
}

/**
 * Get doctor's conversations
 * GET /api/supabase-chat/conversations
 */
export async function getDoctorConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (userRole !== 'doctor') {
      res.status(403).json({ error: 'Access denied. Doctors only.' });
      return;
    }

    const result = await supabaseChatApi.getDoctorConversations(userId);

    // Map conversations to include patient info
    const conversationsWithPatientInfo = await Promise.all(
      result.conversations.map(async (conv) => {
        // Extract patient ID from channel_id (format: patient-{patientId}-medical)
        const patientId = conv.channel_id.replace('patient-', '').replace('-medical', '');
        const patient = await PatientSchema.findById(patientId).select('name given_name family_name');

        return {
          ...conv,
          patientId,
          patientName: patient?.name || `Patient ${patientId.slice(-4)}`,
        };
      })
    );

    await auditDatabaseOperation(req, 'chat_doctor_conversations_accessed', 'READ', userId);

    res.json({
      conversations: conversationsWithPatientInfo,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_doctor_conversations', 'READ', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to get doctor conversations' });
  }
}

/**
 * Get specific patient's conversation (for doctors)
 * GET /api/supabase-chat/conversation/:patientId
 */
export async function getPatientConversationForDoctor(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const { patientId } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (userRole !== 'doctor') {
      res.status(403).json({ error: 'Access denied. Doctors only.' });
      return;
    }

    if (!patientId) {
      res.status(400).json({ error: 'Patient ID required' });
      return;
    }

    // Verify doctor is assigned to this patient
    const patient = await PatientSchema.findById(patientId);
    if (!patient || patient.doctor?.toString() !== userId) {
      res.status(403).json({ error: 'Doctor not assigned to this patient' });
      return;
    }

    // Get or create conversation
    const result = await supabaseChatApi.getOrCreatePatientConversation(patientId, userId);

    // Get full conversation data
    const conversationData = await supabaseChatApi.getPatientConversation(patientId);

    await auditDatabaseOperation(req, 'chat_doctor_viewed_patient_conversation', 'READ', patientId);

    res.json({
      conversationId: result.conversationId,
      channelId: result.channelId,
      created: result.created,
      conversation: conversationData?.conversation,
      participants: conversationData?.participants,
      patientId,
      patientName: patient.name,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_doctor_view_patient_conversation', 'READ', error, req.params?.patientId);
    res.status(500).json({ error: 'Failed to get patient conversation' });
  }
}

/**
 * Reassign doctor to patient (admin only)
 * POST /api/supabase-chat/reassign-doctor
 */
export async function reassignDoctor(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userRole = req.user?.role;

    // Only admins can reassign doctors
    if (userRole !== 'admin' && userRole !== 'superadmin') {
      res.status(403).json({ error: 'Access denied. Admin only.' });
      return;
    }

    const { patientId, newDoctorId, oldDoctorId } = req.body;

    if (!patientId || !newDoctorId) {
      res.status(400).json({ error: 'Patient ID and new doctor ID are required' });
      return;
    }

    // Verify patient exists
    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }

    // Verify new doctor exists
    const newDoctor = await DoctorSchema.findById(newDoctorId);
    if (!newDoctor) {
      res.status(404).json({ error: 'New doctor not found' });
      return;
    }

    // Perform the reassignment
    await supabaseChatApi.reassignDoctor(patientId, newDoctorId, oldDoctorId);

    await auditDatabaseOperation(req, 'chat_reassign_doctor', 'UPDATE', patientId, { newDoctorId, oldDoctorId });

    res.json({
      message: 'Doctor reassigned successfully',
      patientId,
      oldDoctorId,
      newDoctorId,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_reassign_doctor', 'UPDATE', error, req.body?.patientId);
    res.status(500).json({ error: 'Failed to reassign doctor' });
  }
}

/**
 * Send system message to conversation (admin/doctor)
 * POST /api/supabase-chat/system-message
 */
export async function sendSystemMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    // Only admins and doctors can send system messages
    if (userRole !== 'admin' && userRole !== 'superadmin' && userRole !== 'doctor') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const { conversationId, message, metadata } = req.body;

    if (!conversationId || !message) {
      res.status(400).json({ error: 'Conversation ID and message are required' });
      return;
    }

    // Verify user has access to this conversation
    if (userRole === 'doctor') {
      const isParticipant = await supabaseChatApi.isUserParticipant(conversationId, userId!);
      if (!isParticipant) {
        res.status(403).json({ error: 'Doctor not a participant in this conversation' });
        return;
      }
    }

    const sentMessage = await supabaseChatApi.sendSystemMessage(
      conversationId,
      message,
      metadata,
      userId
    );

    await auditDatabaseOperation(req, 'chat_system_message_sent', 'CREATE', userId, { conversationId });

    res.json({
      message: 'System message sent successfully',
      sentMessage,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_system_message', 'CREATE', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to send system message' });
  }
}

/**
 * Create conversation (internal use, e.g., after subscription purchase)
 * POST /api/supabase-chat/conversation
 */
export async function createConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userRole = req.user?.role;

    // Only admins or system can create conversations directly
    // Normally conversations are created via doctor assignment
    if (userRole !== 'admin' && userRole !== 'superadmin') {
      res.status(403).json({ error: 'Access denied. Admin only.' });
      return;
    }

    const { patientId, doctorId } = req.body;

    if (!patientId || !doctorId) {
      res.status(400).json({ error: 'Patient ID and doctor ID are required' });
      return;
    }

    // Verify patient exists
    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      res.status(404).json({ error: 'Patient not found' });
      return;
    }

    // Verify doctor exists
    const doctor = await DoctorSchema.findById(doctorId);
    if (!doctor) {
      res.status(404).json({ error: 'Doctor not found' });
      return;
    }

    const result = await supabaseChatApi.getOrCreatePatientConversation(patientId, doctorId);

    await auditDatabaseOperation(req, 'chat_conversation_created', 'CREATE', patientId, { doctorId, created: result.created });

    res.json({
      message: result.created ? 'Conversation created successfully' : 'Conversation already exists',
      conversationId: result.conversationId,
      channelId: result.channelId,
      created: result.created,
    });
  } catch (error) {
    await auditDatabaseError(req, 'chat_create_conversation', 'CREATE', error, req.body?.patientId);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
}

/**
 * Get unread message counts for current user
 * GET /api/supabase-chat/unread-counts
 */
export async function getUnreadCounts(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const counts = await supabaseChatApi.getAllUnreadCounts(userId);

    await auditDatabaseOperation(req, 'chat_unread_counts', 'READ', userId);

    res.json({ counts });
  } catch (error) {
    await auditDatabaseError(req, 'chat_unread_counts', 'READ', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to get unread counts' });
  }
}
