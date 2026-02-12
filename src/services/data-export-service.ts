import { createClient, SupabaseClient } from '@supabase/supabase-js';
import PatientSchema from '../schemas/patient-schema';
import type { PatientDataExport, ChatMessageExport } from '../types/data-export-types';

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

export const dataExportService = {
  /**
   * Export all patient data for GDPR data portability (Article 20)
   */
  async exportPatientData(userId: string): Promise<PatientDataExport> {
    const patient = await PatientSchema.findById(userId).lean();

    if (!patient) {
      throw new Error('Patient not found');
    }

    // Fetch chat messages from Supabase
    let chatMessages: ChatMessageExport[] = [];
    if (patient.supabaseConversationId) {
      try {
        chatMessages = await this.fetchChatMessages(patient.supabaseConversationId);
      } catch (error) {
        console.error('Error fetching chat messages for export:', error);
        // Continue export without chat messages rather than failing entirely
      }
    }

    return {
      exportedAt: new Date().toISOString(),
      format: 'vidacure-patient-data-v1',
      personalInfo: {
        name: patient.name,
        givenName: patient.given_name,
        familyName: patient.family_name,
        email: patient.email || '',
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString() : undefined,
        gender: patient.gender,
        height: patient.height,
        bmi: patient.bmi,
      },
      weightHistory: (patient.weightHistory || []).map(entry => ({
        weight: entry.weight,
        date: new Date(entry.date).toISOString(),
        sideEffects: entry.sideEffects,
        notes: entry.notes,
      })),
      questionnaire: (patient.questionnaire || []).map(q => ({
        questionId: q.questionId,
        answer: q.answer,
      })),
      prescription: patient.prescription
        ? {
            medicationDetails: patient.prescription.medicationDetails,
            validFrom: new Date(patient.prescription.validFrom).toISOString(),
            validTo: new Date(patient.prescription.validTo).toISOString(),
            status: patient.prescription.status,
            updatedAt: new Date(patient.prescription.updatedAt).toISOString(),
          }
        : null,
      prescriptionRequests: (patient.prescriptionRequests || []).map(req => ({
        status: req.status,
        currentWeight: req.currentWeight,
        hasSideEffects: req.hasSideEffects,
        sideEffectsDescription: req.sideEffectsDescription,
        medicationName: req.medicationName,
        dosage: req.dosage,
        usageInstructions: req.usageInstructions,
        dateIssued: req.dateIssued ? new Date(req.dateIssued).toISOString() : undefined,
        validTill: req.validTill ? new Date(req.validTill).toISOString() : undefined,
        createdAt: new Date(req.createdAt).toISOString(),
        updatedAt: new Date(req.updatedAt).toISOString(),
      })),
      appointments: (patient.calendly?.meetings || []).map(meeting => ({
        scheduledTime: new Date(meeting.scheduledTime).toISOString(),
        status: meeting.status,
        completedAt: meeting.completedAt ? new Date(meeting.completedAt).toISOString() : undefined,
        source: meeting.source,
        createdAt: new Date(meeting.createdAt).toISOString(),
      })),
      subscription: patient.subscription
        ? {
            status: patient.subscription.status,
            planType: patient.subscription.planType,
            currentPeriodStart: new Date(patient.subscription.currentPeriodStart).toISOString(),
            currentPeriodEnd: new Date(patient.subscription.currentPeriodEnd).toISOString(),
            cancelAtPeriodEnd: patient.subscription.cancelAtPeriodEnd,
            canceledAt: patient.subscription.canceledAt
              ? new Date(patient.subscription.canceledAt).toISOString()
              : undefined,
            trialStart: patient.subscription.trialStart
              ? new Date(patient.subscription.trialStart).toISOString()
              : undefined,
            trialEnd: patient.subscription.trialEnd
              ? new Date(patient.subscription.trialEnd).toISOString()
              : undefined,
          }
        : null,
      chatMessages,
    };
  },

  /**
   * Fetch chat messages from Supabase for a conversation
   */
  async fetchChatMessages(conversationId: string): Promise<ChatMessageExport[]> {
    const supabase = getSupabaseClient();

    const { data: messages, error } = await supabase
      .from('messages')
      .select('content, sender_role, message_type, created_at')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (messages || []).map(msg => ({
      content: msg.content,
      senderRole: msg.sender_role,
      messageType: msg.message_type,
      createdAt: msg.created_at,
    }));
  },
};

export default dataExportService;
