import { StreamChat } from 'stream-chat';
import { PatientT } from '../types/patient-type';
import { DoctorT } from '../types/doctor-type';
import PatientSchema from '../schemas/patient-schema';
import DoctorSchema from '../schemas/doctor-schema';

// Initialize Stream Chat client (singleton instance)
const getStreamClient = (): StreamChat => {
  return StreamChat.getInstance(
    process.env.STREAM_API_KEY as string,
    process.env.STREAM_API_SECRET as string
  );
};

/**
 * Pure functions for Stream Chat operations
 * No class state - just functional API calls
 */
export const streamChatApi = {
  /**
   * Generate a Stream Chat token for a user (no expiration for better UX)
   */
  generateToken(userId: string): string {
    const client = getStreamClient();
    return client.createToken(userId); // No expiration - token valid until revoked
  },

  /**
   * Create or update a Stream Chat user
   */
  async createStreamUser(user: PatientT | DoctorT): Promise<void> {
    const client = getStreamClient();
    
    const streamUser = {
      id: user._id?.toString() || '',
      name: user.name,
      // given_name: user.given_name,
      // family_name: user.family_name,
      user_type: user.role, // Custom field for our app logic
      // medical_professional: user.role === 'doctor',
      // patient_id: user.role === 'patient' ? user._id?.toString() : undefined,
      // doctor_id: user.role === 'doctor' ? user._id?.toString() : undefined,
    };

    await client.upsertUser(streamUser);
  },

  /**
   * Create or get a patient's medical channel and update database relations
   */
  async getOrCreatePatientChannel(patientId: string, doctorId: string): Promise<string> {
    const channelId = `patient-${patientId}-medical`;
    
    // Update patient's doctor field and channel ID in database
    await PatientSchema.findByIdAndUpdate(patientId, { 
      doctor: doctorId,
      chatChannelId: channelId
    });

    // Add patient to doctor's patients array and add channel to doctor's assigned channels
    await DoctorSchema.findByIdAndUpdate(doctorId, {
      $addToSet: { 
        patients: patientId,
        assignedChannels: channelId
      }
    });
    
    const client = getStreamClient();
    const channel = client.channel('messaging', channelId, {
      created_by_id: patientId,
      members: [patientId, doctorId],
    });

    await channel.create();
    return channelId;
  },

  /**
   * Reassign doctor to patient channel (for doctor handoffs)
   */
  async reassignDoctor(patientId: string, newDoctorId: string, oldDoctorId?: string): Promise<void> {
    const client = getStreamClient();
    const channelId = `patient-${patientId}-medical`;
    const channel = client.channel('messaging', channelId);

    try {
      // Update patient's doctor field in database
      await PatientSchema.findByIdAndUpdate(patientId, { 
        doctor: newDoctorId 
      });

      // Remove patient from old doctor's patients array and remove channel from assigned channels
      if (oldDoctorId) {
        await DoctorSchema.findByIdAndUpdate(oldDoctorId, {
          $pull: { 
            patients: patientId,
            assignedChannels: channelId
          }
        });
        
        // Remove old doctor from channel
        await channel.removeMembers([oldDoctorId]);
      }

      // Add patient to new doctor's patients array and add channel to assigned channels
      await DoctorSchema.findByIdAndUpdate(newDoctorId, {
        $addToSet: { 
          patients: patientId,
          assignedChannels: channelId
        }
      });

      // Add new doctor to channel
      await channel.addMembers([newDoctorId]);

      // Send handoff notification (using new doctor's ID instead of system)
      await channel.sendMessage({
        text: `A new doctor has been assigned to this case.`,
        user_id: newDoctorId,
        attachments: [{
          type: 'doctor_handoff',
          title: 'Doctor Handoff',
          text: `Previous doctor: ${oldDoctorId || 'None'}, New doctor: ${newDoctorId}`,
          color: '#2196F3'
        }]
      });

    } catch (error) {
      console.error('Error reassigning doctor:', error);
      throw error;
    }
  },

  /**
   * Get all channels for a doctor
   */
  async getDoctorChannels(doctorId: string) {
    const client = getStreamClient();
    
    const filter = {
      type: 'messaging',
      members: { $in: [doctorId] }
    };

    const sort = [{ last_message_at: -1 }];
    const channels = await client.queryChannels(filter, sort);
    
    return channels;
  },

  /**
   * Get patient's medical channel
   */
  async getPatientChannel(patientId: string) {
    const client = getStreamClient();
    const channelId = `patient-${patientId}-medical`;
    const channel = client.channel('messaging', channelId);
    
    try {
      await channel.watch();
      return channel;
    } catch (error) {
      console.error('Error getting patient channel:', error);
      return null;
    }
  },

  /**
   * Send a system message to a channel
   */
  async sendSystemMessage(channelId: string, message: string, data?: Record<string, unknown>, senderId?: string): Promise<void> {
    const client = getStreamClient();
    const channel = client.channel('messaging', channelId);
    
    // If no senderId provided, get the first channel member (usually the doctor)
    if (!senderId) {
      const channelInfo = await channel.query();
      const members = Object.keys(channelInfo.members || {});
      senderId = members.find(id => id.startsWith('doctor')) || members[0] || 'unknown';
    }
    
    await channel.sendMessage({
      text: message,
      user_id: senderId,
      attachments: data ? [{ 
        type: 'system_data',
        title: 'System Message',
        text: message,
        color: '#28a745'
      }] : undefined
    });
  },

  /**
   * Delete a user from Stream Chat and cleanup database relations
   */
  async deleteUser(userId: string, userRole: 'patient' | 'doctor'): Promise<void> {
    const client = getStreamClient();
    
    if (userRole === 'patient') {
      // Remove patient from doctor's patients array
      const patient = await PatientSchema.findById(userId);
      if (patient?.doctor) {
        await DoctorSchema.findByIdAndUpdate(patient.doctor, {
          $pull: { patients: userId }
        });
      }
    } else if (userRole === 'doctor') {
      // Reassign all patients to another doctor or mark as unassigned
      await PatientSchema.updateMany(
        { doctor: userId },
        { $unset: { doctor: 1 } }
      );
      
      // Clear doctor's patients array
      await DoctorSchema.findByIdAndUpdate(userId, {
        patients: []
      });
    }

    await client.deleteUser(userId, { mark_messages_deleted: true });
  },

  /**
   * Deactivate a user (soft delete)
   */
  async deactivateUser(userId: string): Promise<void> {
    const client = getStreamClient();
    await client.deactivateUser(userId, { mark_messages_deleted: false });
  }
};