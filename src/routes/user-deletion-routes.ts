import express from 'express';
import {
  deleteSelf,
  cancelDeletion,
  deleteUserByAdmin,
  getDeletions,
  getDeletionById
} from '../controllers/user-deletion-controller';
import { exportMyData } from '../controllers/data-export-controller';
import { getMySSN } from '../controllers/ssn-controller';
import { requireAuth, requireCSRF } from '../middleware/auth-middleware';
import { requireAdminAuth, requireAdminRole, requireAdminCSRF } from '../middleware/admin-auth-middleware';
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
 * SSN reveal endpoint
 * GET /api/users/me/ssn
 * Authenticated users can view their own decrypted SSN
 */
router.get(
  '/me/ssn',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  getMySSN
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
 * Cancel pending deletion (within grace period)
 * POST /api/users/me/cancel-deletion
 */
router.post(
  '/me/cancel-deletion',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  cancelDeletion
);

/**
 * Admin deletion endpoints
 */

// DELETE /api/admin/users/:userId
// Account deletion is irreversible (anonymize + retain) — keep on the lower
// admin tier for now. Re-tighten to ['superadmin'] once the org has confirmed
// at least one superadmin exists in production.
// NOTE: requireAdminCSRF intentionally not wired (see admin-routes.ts comment).
router.delete(
  '/admin/:userId',
  requireAdminAuth,
  requireAdminRole(['admin', 'superadmin']),
  auditMiddleware,
  deleteUserByAdmin
);

// GET /api/admin/deletions
// Get deletion history (paginated)
router.get(
  '/admin/deletions',
  requireAdminAuth,
  requireAdminRole(['admin', 'superadmin']),
  auditMiddleware,
  getDeletions
);

// GET /api/admin/deletions/:deletionId
// Get specific deletion details
router.get(
  '/admin/deletions/:deletionId',
  requireAdminAuth,
  requireAdminRole(['admin', 'superadmin']),
  auditMiddleware,
  getDeletionById
);

export default router;
