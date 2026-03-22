import { v4 as uuidv4 } from 'uuid';
import type {
  DeletionResults,
  StripeDeletionResult,
  StreamDeletionResult,
  CalendlyDeletionResult,
  MongoDBDeletionResult,
  UserTypeForDeletion,
  DeletionStatus,
  DeletionMetadata
} from '../types/user-deletion-types';
import DeletionLogSchema from '../schemas/deletion-log-schema';
import AdminNotificationSchema from '../schemas/admin-notification-schema';
import PatientSchema from '../schemas/patient-schema';
import DoctorSchema from '../schemas/doctor-schema';
import AuditLogSchema from '../schemas/auditLog-schema';
import { stripeService } from './stripe-service';
import { DELETION_GRACE_PERIOD_DAYS, calculateRetentionExpiry } from '../config/retention-config';

/**
 * User deletion service — GDPR + PDL compliant
 *
 * Strategy for patients:
 * 1. On deletion request: set deletionRequestedAt, start grace period
 * 2. After grace period (30 days): anonymize personal identifiers, retain clinical data
 * 3. After retention period (10 years from last care event): full hard-delete
 *
 * Doctors: immediate deletion (no clinical data to retain)
 */

export const userDeletionService = {
  /**
   * Request account deletion — starts the grace period
   * Patient can cancel within DELETION_GRACE_PERIOD_DAYS
   */
  async requestDeletion(
    userId: string,
    userType: UserTypeForDeletion,
    requestedBy: string
  ): Promise<{ deletionId: string; confirmationId: string; gracePeriodEnds: Date }> {
    const confirmationId = uuidv4();

    const user = userType === 'patient'
      ? await PatientSchema.findById(userId)
      : await DoctorSchema.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    if (userType === 'patient') {
      // Check if already pending deletion
      if ((user as any).deletionRequestedAt && !(user as any).deletionCancelledAt) {
        throw new Error('Deletion already requested');
      }

      // Set grace period
      const gracePeriodEnds = new Date();
      gracePeriodEnds.setDate(gracePeriodEnds.getDate() + DELETION_GRACE_PERIOD_DAYS);

      await PatientSchema.findByIdAndUpdate(userId, {
        deletionRequestedAt: new Date(),
        deletionCancelledAt: null,
      });

      // Create deletion log
      await DeletionLogSchema.create({
        userId,
        userType,
        userEmail: user.email || 'unknown',
        userName: user.name || 'unknown',
        ssnHash: user.ssnHash || 'unknown',
        requestedBy,
        requestedAt: new Date(),
        status: 'pending' as DeletionStatus,
        confirmationId,
        deletionResults: {
          stripe: { success: false },
          stream: { success: false },
          calendly: { success: false, notificationCreated: false },
          mongodb: { success: false }
        },
        metadata: { gracePeriodEnds: gracePeriodEnds.toISOString() }
      });

      return { deletionId: confirmationId, confirmationId, gracePeriodEnds };
    }

    // For doctors: proceed immediately (no clinical data retention needed)
    return this.executeImmediateDeletion(userId, userType, requestedBy, confirmationId);
  },

  /**
   * Cancel a pending deletion within grace period
   */
  async cancelDeletion(userId: string): Promise<void> {
    const patient = await PatientSchema.findById(userId).select('deletionRequestedAt anonymizedAt');

    if (!patient) {
      throw new Error('Patient not found');
    }

    if (!patient.deletionRequestedAt) {
      throw new Error('No pending deletion to cancel');
    }

    if (patient.anonymizedAt) {
      throw new Error('Anonymization already completed, deletion cannot be reversed');
    }

    await PatientSchema.findByIdAndUpdate(userId, {
      deletionCancelledAt: new Date(),
      deletionRequestedAt: null,
    });
  },

  /**
   * Execute anonymization for patients whose grace period has expired
   * Should be called by a scheduled job (cron)
   */
  async processExpiredGracePeriods(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DELETION_GRACE_PERIOD_DAYS);

    const patients = await PatientSchema.find({
      deletionRequestedAt: { $lte: cutoff },
      anonymizedAt: null,
      deletionCancelledAt: null,
    }).select('_id');

    let processed = 0;
    for (const patient of patients) {
      try {
        await this.anonymizePatient(patient._id!.toString());
        processed++;
      } catch (error) {
        console.error(`Failed to anonymize patient ${patient._id}:`, error);
      }
    }

    return processed;
  },

  /**
   * Anonymize a patient's personal identifiers while retaining clinical data
   * PDL: clinical data must be retained 10 years from last care event
   */
  async anonymizePatient(patientId: string): Promise<void> {
    const patient = await PatientSchema.findById(patientId);
    if (!patient) throw new Error('Patient not found');

    // Determine last care event for retention calculation
    const lastCareEvent = this.getLastCareEvent(patient);
    const retentionExpiry = calculateRetentionExpiry(lastCareEvent, 'patient_records');

    // Delete from Stripe
    if (patient.subscription?.stripeCustomerId) {
      try {
        await stripeService.deleteCustomer(patient.subscription.stripeCustomerId);
      } catch (error) {
        console.error('Failed to delete Stripe data during anonymization:', error);
      }
    }

    // Strip personal identifiers, retain clinical data
    const anonymizedId = `anon_${patientId.slice(-8)}`;
    await PatientSchema.findByIdAndUpdate(patientId, {
      $set: {
        name: 'Anonymized Patient',
        given_name: 'Anonymized',
        family_name: 'Patient',
        email: `${anonymizedId}@deleted.vidacure.se`,
        ssnHash: `anonymized_${anonymizedId}`,
        encryptedSsn: null,
        anonymizedAt: new Date(),
        retentionExpiresAt: retentionExpiry,
        dateOfBirth: null,
        gender: null,
        'subscription.stripeCustomerId': null,
        'subscription.stripeSubscriptionId': null,
      },
    });

    // Mark audit logs referencing this patient as anonymized
    await AuditLogSchema.updateMany(
      { targetId: patient._id },
      { $set: { 'metadata.subjectAnonymized': true } }
    );

    // Create admin notification
    await AdminNotificationSchema.create({
      type: 'user_deletion',
      priority: 'medium',
      read: false,
      message: `Patient account anonymized: ${anonymizedId}`,
      actionRequired: `Clinical data retained until ${retentionExpiry?.toISOString() || 'indefinite'}. Full purge after retention period.`,
      metadata: {
        anonymizedId,
        userType: 'patient',
        anonymizedAt: new Date().toISOString(),
        retentionExpiresAt: retentionExpiry?.toISOString(),
      }
    });

    // Update deletion log
    await DeletionLogSchema.findOneAndUpdate(
      { userId: patientId, status: { $in: ['pending', 'in_progress'] } },
      {
        status: 'completed',
        completedAt: new Date(),
        'deletionResults.mongodb': { success: true },
        'deletionResults.stripe': { success: true },
        'deletionResults.stream': { success: true },
        'metadata.anonymizedAt': new Date().toISOString(),
        'metadata.retentionExpiresAt': retentionExpiry?.toISOString(),
      }
    );
  },

  /**
   * Determine the last care event date for retention period calculation
   */
  getLastCareEvent(patient: any): Date {
    const dates: Date[] = [patient.updatedAt || patient.createdAt];

    if (patient.weightHistory?.length) {
      const latestWeight = patient.weightHistory[patient.weightHistory.length - 1];
      if (latestWeight?.date) dates.push(new Date(latestWeight.date));
    }

    if (patient.prescriptionRequests?.length) {
      const latestRx = patient.prescriptionRequests[patient.prescriptionRequests.length - 1];
      if (latestRx?.updatedAt) dates.push(new Date(latestRx.updatedAt));
    }

    if (patient.calendly?.meetings?.length) {
      const latestMeeting = patient.calendly.meetings[patient.calendly.meetings.length - 1];
      if (latestMeeting?.scheduledTime) dates.push(new Date(latestMeeting.scheduledTime));
    }

    if (patient.providerMeetings?.length) {
      const latestProviderMeeting = patient.providerMeetings[patient.providerMeetings.length - 1];
      if (latestProviderMeeting?.scheduledTime) dates.push(new Date(latestProviderMeeting.scheduledTime));
    }

    return new Date(Math.max(...dates.map(d => d.getTime())));
  },

  /**
   * Purge records whose retention period has expired
   * Should be called by a scheduled job (cron)
   */
  async purgeExpiredRetentions(): Promise<number> {
    const now = new Date();

    const expiredPatients = await PatientSchema.find({
      anonymizedAt: { $ne: null },
      retentionExpiresAt: { $lte: now },
    }).select('_id');

    let purged = 0;
    for (const patient of expiredPatients) {
      try {
        await PatientSchema.findByIdAndDelete(patient._id);
        purged++;
      } catch (error) {
        console.error(`Failed to purge expired patient ${patient._id}:`, error);
      }
    }

    return purged;
  },

  /**
   * Execute immediate deletion (for doctors or admin-initiated force deletions)
   */
  async executeImmediateDeletion(
    userId: string,
    userType: UserTypeForDeletion,
    requestedBy: string,
    confirmationId?: string
  ): Promise<{ deletionId: string; confirmationId: string; gracePeriodEnds: Date }> {
    const cId = confirmationId || uuidv4();

    const user = userType === 'patient'
      ? await PatientSchema.findById(userId)
      : await DoctorSchema.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const deletionLog = await DeletionLogSchema.create({
      userId,
      userType,
      userEmail: user.email || 'unknown',
      userName: user.name || 'unknown',
      ssnHash: user.ssnHash || 'unknown',
      requestedBy,
      requestedAt: new Date(),
      status: 'in_progress' as DeletionStatus,
      confirmationId: cId,
      deletionResults: {
        stripe: { success: false },
        stream: { success: false },
        calendly: { success: false, notificationCreated: false },
        mongodb: { success: false }
      },
      metadata: {}
    });

    const results: DeletionResults = {
      stripe: await this.deleteStripeData(userId, userType),
      stream: await this.deleteStreamData(userId, userType),
      calendly: await this.createCalendlyNotification(userId, userType, deletionLog._id!.toString()),
      mongodb: await this.deleteMongoDBData(userId, userType)
    };

    const allSuccess = Object.values(results).every(r => r.success);
    const anySuccess = Object.values(results).some(r => r.success);
    const finalStatus: DeletionStatus = allSuccess ? 'completed' : anySuccess ? 'partial_failure' : 'failed';

    await DeletionLogSchema.findByIdAndUpdate(deletionLog._id, {
      completedAt: new Date(),
      status: finalStatus,
      deletionResults: results,
    });

    return {
      deletionId: deletionLog._id!.toString(),
      confirmationId: cId,
      gracePeriodEnds: new Date(),
    };
  },

  async deleteStripeData(userId: string, userType: UserTypeForDeletion): Promise<StripeDeletionResult> {
    if (userType !== 'patient') return { success: true };

    try {
      const patient = await PatientSchema.findById(userId).select('subscription.stripeCustomerId');
      if (!patient?.subscription?.stripeCustomerId) return { success: true };

      const customerId = patient.subscription.stripeCustomerId;
      const result = await stripeService.deleteCustomer(customerId);
      return { ...result, customerId };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to delete Stripe data' };
    }
  },

  async deleteStreamData(_userId: string, _userType: UserTypeForDeletion): Promise<StreamDeletionResult> {
    // Chat data is now in MongoDB (Socket.IO chat service) — handled separately if needed
    return { success: true, channelIds: [] };
  },

  async createCalendlyNotification(
    userId: string,
    userType: UserTypeForDeletion,
    deletionLogId: string
  ): Promise<CalendlyDeletionResult> {
    try {
      const user = userType === 'doctor'
        ? await DoctorSchema.findById(userId).select('name email calendlyUserUri')
        : await PatientSchema.findById(userId).select('name email');

      if (!user) return { success: true, notificationCreated: false };

      await AdminNotificationSchema.create({
        type: 'user_deletion',
        priority: userType === 'doctor' ? 'high' : 'medium',
        read: false,
        message: `${userType === 'doctor' ? 'Doctor' : 'Patient'} account deleted: ${user.name}`,
        actionRequired: userType === 'doctor' && (user as any).calendlyUserUri
          ? `Manually review Calendly data for ${user.email}.`
          : `Deletion completed.`,
        metadata: { userType, deletionLogId },
      });

      return { success: true, notificationCreated: true };
    } catch (error: any) {
      return { success: false, notificationCreated: false, error: error.message };
    }
  },

  async deleteMongoDBData(
    userId: string,
    userType: UserTypeForDeletion,
    reassignDoctorId?: string
  ): Promise<MongoDBDeletionResult> {
    try {
      if (userType === 'patient') {
        const patient = await PatientSchema.findById(userId).select('doctor');
        if (!patient) return { success: false, error: 'Patient not found' };

        if (patient.doctor) {
          await DoctorSchema.findByIdAndUpdate(patient.doctor, {
            $pull: { patients: userId }
          });
        }

        await PatientSchema.findByIdAndDelete(userId);
        return { success: true };
      }

      if (userType === 'doctor') {
        const doctor = await DoctorSchema.findById(userId).select('patients');
        if (!doctor) return { success: false, error: 'Doctor not found' };

        const patientIds = doctor.patients || [];
        if (reassignDoctorId) {
          await PatientSchema.updateMany({ doctor: userId }, { doctor: reassignDoctorId });
          await DoctorSchema.findByIdAndUpdate(reassignDoctorId, {
            $addToSet: { patients: { $each: patientIds } }
          });
        } else {
          await PatientSchema.updateMany({ doctor: userId }, { $unset: { doctor: 1 } });
        }

        await DoctorSchema.findByIdAndDelete(userId);
        return { success: true };
      }

      return { success: false, error: 'Invalid user type' };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Legacy compatibility: direct delete (calls requestDeletion for patients)
   */
  async deleteUser(
    userId: string,
    userType: UserTypeForDeletion,
    requestedBy: string,
    reassignDoctorId?: string
  ) {
    if (userType === 'doctor') {
      return this.executeImmediateDeletion(userId, userType, requestedBy);
    }

    return this.requestDeletion(userId, userType, requestedBy);
  },
};

export default userDeletionService;
