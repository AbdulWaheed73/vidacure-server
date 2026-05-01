import express from 'express';
import {
  getNotifications,
  resolveNotification,
  getNotificationCount
} from '../controllers/admin-notification-controller';
import { requireAdminAuth, requireAdminRole, requireAdminCSRF } from '../middleware/admin-auth-middleware';
import { auditMiddleware } from '../middleware/audit-middleware';

const router = express.Router();

/**
 * Admin notification endpoints
 * All require admin authentication + role.
 * NOTE: requireAdminCSRF intentionally not wired (see admin-routes.ts comment).
 */
router.use(requireAdminAuth);
router.use(requireAdminRole(['admin', 'superadmin']));

// GET /api/admin/notifications
// Get all notifications (paginated, filterable)
router.get(
  '/',
  auditMiddleware,
  getNotifications
);

// GET /api/admin/notifications/count
// Get notification counts for badge display
router.get(
  '/count',
  getNotificationCount
);

// PUT /api/admin/notifications/:notificationId/resolve
// Mark notification as resolved
router.put(
  '/:notificationId/resolve',
  auditMiddleware,
  resolveNotification
);

export default router;
