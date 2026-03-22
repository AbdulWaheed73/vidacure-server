import mongoose, { Types } from 'mongoose';
import PatientSchema from '../schemas/patient-schema';
import AuditLogSchema from '../schemas/auditLog-schema';
import ConsentSchema from '../schemas/consent-schema';
import type { PatientDataExport, ChatMessageExport } from '../types/data-export-types';

/** Safely convert a value to ISO string, returning undefined for invalid dates */
const safeDate = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value as string | number | Date);
  return isNaN(date.getTime()) ? undefined : date.toISOString();
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

    // Fetch chat messages from MongoDB (Socket.IO chat collections)
    let chatMessages: ChatMessageExport[] = [];
    try {
      chatMessages = await this.fetchChatMessages(userId);
    } catch (error) {
      console.error('Error fetching chat messages for export:', error);
    }

    return {
      exportedAt: new Date().toISOString(),
      format: 'vidacure-patient-data-v1',
      personalInfo: {
        name: patient.name,
        givenName: patient.given_name,
        familyName: patient.family_name,
        email: patient.email || '',
        dateOfBirth: safeDate(patient.dateOfBirth),
        gender: patient.gender,
        height: patient.height,
        bmi: patient.bmi,
      },
      weightHistory: (patient.weightHistory || []).map(entry => ({
        weight: entry.weight,
        date: safeDate(entry.date) || new Date().toISOString(),
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
            validFrom: safeDate(patient.prescription.validFrom) || '',
            validTo: safeDate(patient.prescription.validTo) || '',
            status: patient.prescription.status,
            updatedAt: safeDate(patient.prescription.updatedAt) || '',
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
        dateIssued: safeDate(req.dateIssued),
        validTill: safeDate(req.validTill),
        createdAt: safeDate(req.createdAt) || '',
        updatedAt: safeDate(req.updatedAt) || '',
      })),
      appointments: (patient.calendly?.meetings || []).map(meeting => ({
        scheduledTime: safeDate(meeting.scheduledTime) || '',
        status: meeting.status,
        completedAt: safeDate(meeting.completedAt),
        source: meeting.source,
        createdAt: safeDate(meeting.createdAt) || '',
      })),
      subscription: patient.subscription
        ? {
            status: patient.subscription.status,
            planType: patient.subscription.planType,
            currentPeriodStart: safeDate(patient.subscription.currentPeriodStart) || '',
            currentPeriodEnd: safeDate(patient.subscription.currentPeriodEnd) || '',
            cancelAtPeriodEnd: patient.subscription.cancelAtPeriodEnd,
            canceledAt: safeDate(patient.subscription.canceledAt),
            trialStart: safeDate(patient.subscription.trialStart),
            trialEnd: safeDate(patient.subscription.trialEnd),
          }
        : null,
      chatMessages,
      accessLog: await this.fetchAccessLog(userId),
      consentHistory: await this.fetchConsentHistory(userId),
    };
  },

  /**
   * Fetch audit log entries for this patient (loggutdrag)
   */
  async fetchAccessLog(userId: string): Promise<{ action: string; role: string; timestamp: string }[]> {
    try {
      const logs = await AuditLogSchema.find({ targetId: new Types.ObjectId(userId) })
        .select('action role timestamp')
        .sort({ timestamp: -1 })
        .limit(1000)
        .lean();

      return logs.map(log => ({
        action: log.action,
        role: log.role,
        timestamp: log.timestamp?.toISOString() || '',
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch consent history for this patient
   */
  async fetchConsentHistory(userId: string): Promise<{ consentType: string; version: string; accepted: boolean; timestamp: string; withdrawnAt?: string }[]> {
    try {
      const consents = await ConsentSchema.find({ userId })
        .sort({ timestamp: -1 })
        .lean();

      return consents.map(c => ({
        consentType: c.consentType,
        version: c.version,
        accepted: c.accepted,
        timestamp: c.timestamp?.toISOString() || '',
        withdrawnAt: c.withdrawnAt ? new Date(c.withdrawnAt).toISOString() : undefined,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Fetch chat messages from MongoDB (Socket.IO chat collections)
   */
  async fetchChatMessages(patientId: string): Promise<ChatMessageExport[]> {
    const db = mongoose.connection.db;
    if (!db) return [];

    // Find the patient's conversation in chat_conversations
    const conversation = await db.collection('chat_conversations').findOne({
      patientId: new Types.ObjectId(patientId),
    });

    if (!conversation) return [];

    // Fetch messages for the conversation
    const messages = await db.collection('chat_messages')
      .find({
        conversationId: conversation._id,
        isDeleted: { $ne: true },
      })
      .sort({ createdAt: 1 })
      .toArray();

    return messages.map(msg => ({
      content: msg.content,
      senderRole: msg.senderRole,
      messageType: msg.messageType,
      createdAt: msg.createdAt?.toISOString?.() || new Date(msg.createdAt).toISOString(),
    }));
  },
};

export default dataExportService;
