import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import { streamChatApi } from '../services/stream-chat-api';
import PatientSchema from '../schemas/patient-schema';
import DoctorSchema from '../schemas/doctor-schema';

/**
 * Initialize chat for a user (get token and create Stream user)
 */
export async function initializeChat(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    console.log('🔍 Chat initialization request received');
    console.log('🔍 User from token:', req.user);
    
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    console.log('🔍 User ID:', userId, 'Role:', userRole);

    if (!userId || !userRole) {
      console.log('❌ User not authenticated - missing userId or role');
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Get user data from database
    console.log('🔍 Fetching user from database...');
    let user;
    if (userRole === 'patient') {
      console.log('🔍 Looking up patient with ID:', userId);
      user = await PatientSchema.findById(userId);
    } else if (userRole === 'doctor') {
      console.log('🔍 Looking up doctor with ID:', userId);
      user = await DoctorSchema.findById(userId);
    }

    console.log('🔍 Database lookup result:', user ? 'User found' : 'User not found');

    if (!user) {
      console.log('❌ User not found in database');
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Create/update Stream user
    console.log('🔍 Creating Stream user...');
    await streamChatApi.createStreamUser(user);

    // Generate token
    console.log('🔍 Generating Stream token...');
    const token = streamChatApi.generateToken(userId);

    console.log('✅ Chat initialization successful');
    res.json({
      token,
      user: {
        id: userId,
        name: user.name,
        role: userRole,
        streamUserId: userId
      }
    });

  } catch (error) {
    console.error('Error initializing chat:', error);
    res.status(500).json({ error: 'Failed to initialize chat' });
  }
}

/**
 * Get or create patient's medical channel
 */
export async function getPatientChannel(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    let patientId: string;
    let doctorId: string;

    if (userRole === 'patient') {
      patientId = userId;
      
      // Get patient's assigned doctor
      const patient = await PatientSchema.findById(patientId).populate('doctor');
      if (!patient?.doctor) {
        res.status(400).json({ error: 'No doctor assigned to this patient' });
        return;
      }
      doctorId = patient.doctor._id.toString();

    } else if (userRole === 'doctor') {
      // For doctors, get patient ID from request params
      const requestedPatientId = req.params.patientId;
      if (!requestedPatientId) {
        res.status(400).json({ error: 'Patient ID required' });
        return;
      }

      // Verify doctor is assigned to this patient
      const patient = await PatientSchema.findById(requestedPatientId);
      if (!patient || patient.doctor?.toString() !== userId) {
        res.status(403).json({ error: 'Doctor not assigned to this patient' });
        return;
      }

      patientId = requestedPatientId;
      doctorId = userId;

    } else {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Get or create the channel
    const channelId = await streamChatApi.getOrCreatePatientChannel(patientId, doctorId);

    res.json({
      channelId,
      patientId,
      doctorId
    });

  } catch (error) {
    console.error('Error getting patient channel:', error);
    res.status(500).json({ error: 'Failed to get patient channel' });
  }
}

/**
 * Get all channels for a doctor
 */
export async function getDoctorChannels(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (userRole !== 'doctor') {
      res.status(403).json({ error: 'Access denied. Doctors only.' });
      return;
    }

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const channels = await streamChatApi.getDoctorChannels(userId);

    res.json({
      channels: channels.map(channel => ({
        id: channel.id,
        name: 'Medical Chat',
        patientId: channel.id?.replace('patient-', '')?.replace('-medical', '') || 'unknown',
        lastMessageAt: (channel as any).data?.last_message_at,
        memberCount: (channel as any).data?.member_count
      }))
    });

  } catch (error) {
    console.error('Error getting doctor channels:', error);
    res.status(500).json({ error: 'Failed to get doctor channels' });
  }
}

/**
 * Reassign doctor to patient (admin functionality)
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
    await streamChatApi.reassignDoctor(patientId, newDoctorId, oldDoctorId);

    res.json({
      message: 'Doctor reassigned successfully',
      patientId,
      oldDoctorId,
      newDoctorId
    });

  } catch (error) {
    console.error('Error reassigning doctor:', error);
    res.status(500).json({ error: 'Failed to reassign doctor' });
  }
}

/**
 * Send system message to a channel (admin functionality)
 */
export async function sendSystemMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userRole = req.user?.role;

    // Only admins and doctors can send system messages
    if (userRole !== 'admin' && userRole !== 'superadmin' && userRole !== 'doctor') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const { channelId, message, data } = req.body;

    if (!channelId || !message) {
      res.status(400).json({ error: 'Channel ID and message are required' });
      return;
    }

    await streamChatApi.sendSystemMessage(channelId, message, data);

    res.json({ message: 'System message sent successfully' });

  } catch (error) {
    console.error('Error sending system message:', error);
    res.status(500).json({ error: 'Failed to send system message' });
  }
}