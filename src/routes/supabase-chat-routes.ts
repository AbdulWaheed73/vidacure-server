import { Router } from 'express';
import { requireAuth, requireRole, requireActiveSubscription } from '../middleware/auth-middleware';
import {
  getSupabaseChatToken,
  getPatientConversation,
  getDoctorConversations,
  getPatientConversationForDoctor,
  reassignDoctor,
  sendSystemMessage,
  createConversation,
} from '../controllers/supabase-chat-controllers';

const router = Router();

/**
 * Supabase Chat Routes
 * Base path: /api/supabase-chat
 */

// Token generation - authenticated users only
// Note: Subscription check is handled in the controller based on user role
router.post('/token', requireAuth, getSupabaseChatToken);

// Patient routes - require active subscription for chat access
router.get('/conversation', requireAuth, requireRole('patient'), requireActiveSubscription, getPatientConversation);

// Doctor routes
router.get('/conversations', requireAuth, requireRole('doctor'), getDoctorConversations);
router.get('/conversation/:patientId', requireAuth, requireRole('doctor'), getPatientConversationForDoctor);

// Admin routes
router.post('/conversation', requireAuth, requireRole(['admin', 'superadmin']), createConversation);
router.post('/reassign-doctor', requireAuth, requireRole(['admin', 'superadmin']), reassignDoctor);

// Admin/Doctor routes
router.post('/system-message', requireAuth, requireRole(['admin', 'superadmin', 'doctor']), sendSystemMessage);

export default router;
