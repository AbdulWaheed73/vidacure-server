import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import consentService from '../services/consent-service';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';
import type { RecordConsentRequest } from '../types/consent-types';

/**
 * Record a consent decision
 * POST /api/consent
 */
export const recordConsent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { consentType, version, accepted }: RecordConsentRequest = req.body;

    if (!consentType || !version || typeof accepted !== 'boolean') {
      res.status(400).json({ error: 'consentType, version, and accepted are required' });
      return;
    }

    if (!consentService.isValidConsentType(consentType)) {
      res.status(400).json({ error: 'Invalid consent type' });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    const consent = await consentService.recordConsent(
      userId,
      consentType,
      version,
      accepted,
      ipAddress,
      userAgent
    );

    await auditDatabaseOperation(req, 'consent_recorded', 'CREATE', userId, {
      consentType,
      version,
      accepted,
    });

    res.status(201).json({
      success: true,
      message: 'Consent recorded successfully',
      consent: {
        consentType: consent.consentType,
        version: consent.version,
        accepted: consent.accepted,
        timestamp: consent.timestamp,
      },
    });
  } catch (error: any) {
    await auditDatabaseError(req, 'record_consent', 'CREATE', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to record consent',
      details: error.message,
    });
  }
};

/**
 * Get consent status for all consent types
 * GET /api/consent/status
 */
export const getConsentStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const status = await consentService.getAllConsentsStatus(userId);

    await auditDatabaseOperation(req, 'consent_status_checked', 'READ', userId);

    res.status(200).json(status);
  } catch (error: any) {
    await auditDatabaseError(req, 'get_consent_status', 'READ', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to get consent status',
      details: error.message,
    });
  }
};

/**
 * Get full consent history for the authenticated user
 * GET /api/consent
 */
export const getUserConsents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const consents = await consentService.getUserConsents(userId);

    await auditDatabaseOperation(req, 'consent_history_viewed', 'READ', userId);

    res.status(200).json({ consents });
  } catch (error: any) {
    await auditDatabaseError(req, 'get_user_consents', 'READ', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to get consent history',
      details: error.message,
    });
  }
};

/**
 * Withdraw a specific consent type
 * POST /api/consent/withdraw
 */
export const withdrawConsent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { consentType } = req.body;

    if (!consentType || !consentService.isValidConsentType(consentType)) {
      res.status(400).json({ error: 'Valid consentType is required' });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    await consentService.withdrawConsent(userId, consentType, ipAddress, userAgent);

    res.status(200).json({
      success: true,
      message: `Consent for ${consentType} has been withdrawn`,
    });
  } catch (error: any) {
    await auditDatabaseError(req, 'withdraw_consent', 'UPDATE', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to withdraw consent',
      details: error.message,
    });
  }
};
