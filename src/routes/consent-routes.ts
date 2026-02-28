import express from 'express';
import {
  recordConsent,
  getConsentStatus,
  getUserConsents,
  withdrawConsent,
} from '../controllers/consent-controller';
import { requireAuth, requireCSRF } from '../middleware/auth-middleware';
import { auditMiddleware } from '../middleware/audit-middleware';

const router = express.Router();

/**
 * GET /api/consent/status
 * Check if user has accepted the latest privacy policy version
 */
router.get(
  '/status',
  requireAuth,
  auditMiddleware,
  getConsentStatus
);

/**
 * GET /api/consent
 * Get full consent history for the authenticated user
 */
router.get(
  '/',
  requireAuth,
  auditMiddleware,
  getUserConsents
);

/**
 * POST /api/consent
 * Record a consent decision (accept/reject privacy policy)
 */
router.post(
  '/',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  recordConsent
);

/**
 * POST /api/consent/withdraw
 * Withdraw a specific consent type
 */
router.post(
  '/withdraw',
  requireAuth,
  auditMiddleware,
  requireCSRF,
  withdrawConsent
);

export default router;
