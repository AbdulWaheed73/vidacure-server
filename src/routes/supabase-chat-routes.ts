import { Router } from 'express';
import { requireAuth, requireCSRF, requireRole, requireActiveSubscription } from '../middleware/auth-middleware';
import { auditMiddleware } from '../middleware/audit-middleware';
import {
  getSupabaseChatToken,
  getPatientConversation,
  getDoctorConversations,
  getPatientConversationForDoctor,
  reassignDoctor,
  sendSystemMessage,
  createConversation,
  getUnreadCounts,
} from '../controllers/supabase-chat-controllers';

const router = Router();

/**
 * Supabase Chat Routes
 * Base path: /api/supabase-chat
 */

// Token generation - authenticated users only
router.post('/token', requireAuth, auditMiddleware, requireCSRF, getSupabaseChatToken);

// Patient routes - require active subscription for chat access
router.get('/conversation', requireAuth, auditMiddleware, requireRole('patient'), requireActiveSubscription, getPatientConversation);

// Unread counts - any authenticated user
router.get('/unread-counts', requireAuth, auditMiddleware, getUnreadCounts);

// Doctor routes
router.get('/conversations', requireAuth, auditMiddleware, requireRole('doctor'), getDoctorConversations);
router.get('/conversation/:patientId', requireAuth, auditMiddleware, requireRole('doctor'), getPatientConversationForDoctor);

// Admin routes
router.post('/conversation', requireAuth, auditMiddleware, requireCSRF, requireRole(['admin', 'superadmin']), createConversation);
router.post('/reassign-doctor', requireAuth, auditMiddleware, requireCSRF, requireRole(['admin', 'superadmin']), reassignDoctor);

// Admin/Doctor routes
router.post('/system-message', requireAuth, auditMiddleware, requireCSRF, requireRole(['admin', 'superadmin', 'doctor']), sendSystemMessage);

export default router;
