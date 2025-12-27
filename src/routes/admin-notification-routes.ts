import express from 'express';
import {
  getNotifications,
  resolveNotification,
  getNotificationCount
} from '../controllers/admin-notification-controller';
import { requireAdminAuth } from '../middleware/admin-auth-middleware';
import { auditMiddleware } from '../middleware/audit-middleware';

const router = express.Router();

/**
 * Admin notification endpoints
 * All require admin authentication
 */

// GET /api/admin/notifications
// Get all notifications (paginated, filterable)
router.get(
  '/',
  requireAdminAuth,
  auditMiddleware,
  getNotifications
);

// GET /api/admin/notifications/count
// Get notification counts for badge display
router.get(
  '/count',
  requireAdminAuth,
  getNotificationCount
);

// PUT /api/admin/notifications/:notificationId/resolve
// Mark notification as resolved
router.put(
  '/:notificationId/resolve',
  requireAdminAuth,
  auditMiddleware,
  resolveNotification
);

export default router;
