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
import { stripeService } from './stripe-service';
import { supabaseChatApi } from './supabase-chat-api';

/**
 * Main user deletion service for GDPR compliance
 * Orchestrates deletion across all third-party services and MongoDB
 */

export const userDeletionService = {
  /**
   * Delete a user account and all associated data
   */
  async deleteUser(
    userId: string,
    userType: UserTypeForDeletion,
    requestedBy: string, // 'self' or admin user ID
    reassignDoctorId?: string
  ): Promise<{ deletionId: string; results: DeletionResults; confirmationId: string }> {
    const confirmationId = uuidv4();

    // Gather user metadata before deletion
    const user = userType === 'patient'
      ? await PatientSchema.findById(userId)
      : await DoctorSchema.findById(userId);

    if (!user) {
      throw new Error('User not found');
    }

    const userEmail = user.email || 'unknown';
    const userName = user.name || 'unknown';
    const ssnHash = user.ssnHash || 'unknown';

    // Create deletion log with in_progress status
    const deletionLog = await DeletionLogSchema.create({
      userId,
      userType,
      userEmail,
      userName,
      ssnHash,
      requestedBy,
      requestedAt: new Date(),
      status: 'in_progress' as DeletionStatus,
      confirmationId,
      deletionResults: {
        stripe: { success: false },
        stream: { success: false },
        calendly: { success: false, notificationCreated: false },
        mongodb: { success: false }
      },
      metadata: {}
    });

    // Execute deletions in sequence
    const results: DeletionResults = {
      stripe: await this.deleteStripeData(userId, userType),
      stream: await this.deleteStreamData(userId, userType),
      calendly: await this.createCalendlyNotification(userId, userType, deletionLog._id!.toString()),
      mongodb: await this.deleteMongoDBData(userId, userType, reassignDoctorId)
    };

    // Determine overall status
    const allSuccess = Object.values(results).every(r => r.success);
    const anySuccess = Object.values(results).some(r => r.success);
    const finalStatus: DeletionStatus = allSuccess
      ? 'completed'
      : anySuccess
        ? 'partial_failure'
        : 'failed';

    // Gather metadata
    const metadata: DeletionMetadata = {};
    if (userType === 'patient') {
      const patient = await PatientSchema.findById(userId);
      if (patient?.subscription?.stripeCustomerId) {
        metadata.stripeCustomerId = patient.subscription.stripeCustomerId;
      }
    } else if (userType === 'doctor') {
      const doctor = await DoctorSchema.findById(userId);
      if (doctor) {
        metadata.patientCount = doctor.patients?.length || 0;
        metadata.calendlyUserUri = doctor.calendlyUserUri;
        if (reassignDoctorId) {
          metadata.reassignedDoctorId = reassignDoctorId;
        }
      }
    }

    // Update deletion log with results
    await DeletionLogSchema.findByIdAndUpdate(deletionLog._id, {
      completedAt: new Date(),
      status: finalStatus,
      deletionResults: results,
      metadata
    });

    return {
      deletionId: deletionLog._id!.toString(),
      results,
      confirmationId
    };
  },

  /**
   * Delete Stripe customer data (patients only)
   */
  async deleteStripeData(userId: string, userType: UserTypeForDeletion): Promise<StripeDeletionResult> {
    // Only patients have Stripe accounts
    if (userType !== 'patient') {
      return { success: true }; // No Stripe data to delete for doctors
    }

    try {
      const patient = await PatientSchema.findById(userId);

      if (!patient?.subscription?.stripeCustomerId) {
        return { success: true }; // No Stripe customer ID
      }

      const customerId = patient.subscription.stripeCustomerId;
      const result = await stripeService.deleteCustomer(customerId);

      return {
        ...result,
        customerId
      };
    } catch (error: any) {
      console.error('Error deleting Stripe data:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete Stripe data'
      };
    }
  },

  /**
   * Delete Supabase chat data (soft delete for GDPR compliance)
   */
  async deleteStreamData(userId: string, userType: UserTypeForDeletion): Promise<StreamDeletionResult> {
    try {
      const channelIds: string[] = [];

      // Gather channel IDs before deletion for logging
      if (userType === 'patient') {
        const patient = await PatientSchema.findById(userId);
        if (patient?.supabaseConversationId) {
          channelIds.push(patient.supabaseConversationId);
        }
      } else if (userType === 'doctor') {
        // For doctors, we'll note that channels were handled
        channelIds.push('doctor-channels-handled');
      }

      // Delete user data from Supabase (soft delete messages, deactivate participations)
      await supabaseChatApi.deleteUserData(userId, userType);

      return {
        success: true,
        channelIds
      };
    } catch (error: any) {
      console.error('Error deleting Supabase chat data:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete Supabase chat data'
      };
    }
  },

  /**
   * Create admin notification for user deletion
   */
  async createCalendlyNotification(
    userId: string,
    userType: UserTypeForDeletion,
    deletionLogId: string
  ): Promise<CalendlyDeletionResult> {
    try {
      if (userType === 'doctor') {
        const doctor = await DoctorSchema.findById(userId);

        if (!doctor) {
          return { success: true, notificationCreated: false };
        }

        // Create notification for doctor deletion
        await AdminNotificationSchema.create({
          type: 'user_deletion',
          priority: 'high',
          read: false,
          message: `Doctor account deleted: ${doctor.name} (${doctor.email})`,
          actionRequired: doctor.calendlyUserUri
            ? `Manually delete invitee data for ${doctor.email} in Calendly dashboard. User URI: ${doctor.calendlyUserUri}`
            : `Doctor deletion completed. No Calendly cleanup required.`,
          metadata: {
            userEmail: doctor.email,
            userName: doctor.name,
            userType: 'doctor',
            calendlyUserUri: doctor.calendlyUserUri,
            deletionLogId
          }
        });

        return {
          success: true,
          notificationCreated: true,
          email: doctor.email
        };
      } else {
        // Patient deletion notification
        const patient = await PatientSchema.findById(userId);

        if (!patient) {
          return { success: true, notificationCreated: false };
        }

        await AdminNotificationSchema.create({
          type: 'user_deletion',
          priority: 'medium',
          read: false,
          message: `Patient account deleted: ${patient.name}`,
          actionRequired: 'Patient data has been removed from all systems.',
          metadata: {
            userName: patient.name,
            userType: 'patient',
            deletionLogId
          }
        });

        return {
          success: true,
          notificationCreated: true
        };
      }
    } catch (error: any) {
      console.error('Error creating deletion notification:', error);
      return {
        success: false,
        notificationCreated: false,
        error: error.message || 'Failed to create deletion notification'
      };
    }
  },

  /**
   * Delete MongoDB user data with cascade logic
   */
  async deleteMongoDBData(
    userId: string,
    userType: UserTypeForDeletion,
    reassignDoctorId?: string
  ): Promise<MongoDBDeletionResult> {
    try {
      if (userType === 'patient') {
        return await this.deletePatientData(userId);
      } else if (userType === 'doctor') {
        return await this.deleteDoctorData(userId, reassignDoctorId);
      }

      return { success: false, error: 'Invalid user type' };
    } catch (error: any) {
      console.error('Error deleting MongoDB data:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete MongoDB data'
      };
    }
  },

  /**
   * Delete patient data from MongoDB
   */
  async deletePatientData(patientId: string): Promise<MongoDBDeletionResult> {
    try {
      const patient = await PatientSchema.findById(patientId);

      if (!patient) {
        return { success: false, error: 'Patient not found' };
      }

      // Remove patient from doctor's patients array
      if (patient.doctor) {
        await DoctorSchema.findByIdAndUpdate(patient.doctor, {
          $pull: { patients: patientId }
        });
      }

      // Delete patient document (cascades to embedded documents)
      await PatientSchema.findByIdAndDelete(patientId);

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting patient data:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete patient data'
      };
    }
  },

  /**
   * Delete doctor data from MongoDB
   */
  async deleteDoctorData(doctorId: string, reassignDoctorId?: string): Promise<MongoDBDeletionResult> {
    try {
      const doctor = await DoctorSchema.findById(doctorId);

      if (!doctor) {
        return { success: false, error: 'Doctor not found' };
      }

      // Handle patient reassignment
      const patientIds = doctor.patients || [];

      if (reassignDoctorId) {
        // Reassign all patients to new doctor
        await PatientSchema.updateMany(
          { doctor: doctorId },
          { doctor: reassignDoctorId }
        );

        // Add patients to new doctor's patients array
        await DoctorSchema.findByIdAndUpdate(reassignDoctorId, {
          $addToSet: { patients: { $each: patientIds } }
        });
      } else {
        // Unassign all patients (set doctor field to null)
        await PatientSchema.updateMany(
          { doctor: doctorId },
          { $unset: { doctor: 1 } }
        );
      }

      // Delete doctor document
      await DoctorSchema.findByIdAndDelete(doctorId);

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting doctor data:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete doctor data'
      };
    }
  }
};

export default userDeletionService;
