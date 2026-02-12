import express from 'express';
import {
  deleteSelf,
  deleteUserByAdmin,
  getDeletions,
  getDeletionById
} from '../controllers/user-deletion-controller';
import { exportMyData } from '../controllers/data-export-controller';
import { requireAuth, requireCSRF } from '../middleware/auth-middleware';
import { requireAdminAuth } from '../middleware/admin-auth-middleware';
import { auditMiddleware } from '../middleware/audit-middleware';

const router = express.Router();

/**
 * Data export endpoint (GDPR Article 20 - Data Portability)
 * GET /api/users/me/data-export
 * Authenticated patients can download all their personal data
 */
router.get(
  '/me/data-export',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  exportMyData
);

/**
 * Self-deletion endpoint
 * DELETE /api/users/me
 * Authenticated users can delete their own account
 */
router.delete(
  '/me',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  deleteSelf
);

/**
 * Admin deletion endpoints
 */

// DELETE /api/admin/users/:userId
// Admins can delete any user account
router.delete(
  '/admin/:userId',
  requireAdminAuth,
  auditMiddleware,
  deleteUserByAdmin
);

// GET /api/admin/deletions
// Get deletion history (paginated)
router.get(
  '/admin/deletions',
  requireAdminAuth,
  auditMiddleware,
  getDeletions
);

// GET /api/admin/deletions/:deletionId
// Get specific deletion details
router.get(
  '/admin/deletions/:deletionId',
  requireAdminAuth,
  auditMiddleware,
  getDeletionById
);

export default router;
