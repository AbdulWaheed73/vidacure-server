import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import consentService from '../services/consent-service';
import { REQUIRED_CONSENT_TYPES } from '../config/consent-config';

// Paths that are exempt from consent checks (e.g. onboarding must work before consent)
const CONSENT_EXEMPT_PATHS = [
  '/questionnaire',
  '/profile',
];

/**
 * Middleware: block access to protected endpoints if required consents are missing.
 * When consent version is bumped in consent-config.ts, patients must re-consent.
 *
 * Exemptions: consent endpoints themselves, auth endpoints, health check,
 * onboarding routes (questionnaire, profile).
 */
export function requireConsent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Only enforce for patients (doctors/admins don't need patient consent)
  if (!req.user || req.user.role !== 'patient') {
    next();
    return;
  }

  // Exempt onboarding-related paths so new patients can complete setup
  if (CONSENT_EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
    next();
    return;
  }

  const userId = req.user.userId;

  // Check all required consent types asynchronously
  Promise.all(
    REQUIRED_CONSENT_TYPES.map(async (type) => {
      const status = await consentService.getConsentStatus(userId, type);
      return { type, hasAccepted: status.hasAcceptedLatest, currentVersion: status.currentVersion };
    })
  )
    .then((results) => {
      const missing = results.filter((r) => !r.hasAccepted);

      if (missing.length > 0) {
        res.status(451).json({
          error: 'Consent required',
          message: 'You must accept the latest terms before continuing.',
          missingConsents: missing.map((m) => ({
            consentType: m.type,
            requiredVersion: m.currentVersion,
          })),
        });
        return;
      }

      next();
    })
    .catch((error) => {
      // If consent check fails, don't block — fail open for availability
      console.error('Consent check failed:', error);
      next();
    });
}
