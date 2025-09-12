import { Router } from 'express';
import { requireAuth, requireRole} from '../middleware/auth-middleware';
import {
  initializeChat,
  getPatientChannel,
  getDoctorChannels,
  reassignDoctor,
  sendSystemMessage
} from '../controllers/chat-controllers';

const router = Router();

// Initialize chat for authenticated user (get token and setup Stream user)
router.post('/initialize', requireAuth, initializeChat);

// Get patient's medical channel
router.get('/patient/channel', requireAuth, requireRole('patient'), getPatientChannel);

// Get patient's medical channel for a doctor
router.get('/patient/:patientId/channel', requireAuth, requireRole('doctor'), getPatientChannel);

// Get all channels for a doctor
router.get('/doctor/channels', requireAuth, requireRole('doctor'), getDoctorChannels);

// Admin routes for doctor reassignment
router.post('/reassign-doctor', requireAuth, requireRole('admin'), reassignDoctor);
router.post('/reassign-doctor', requireAuth, requireRole('superadmin'), reassignDoctor);

// Send system message (admin/doctor only)
router.post('/system-message', requireAuth, sendSystemMessage);

export default router;