import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import consentService from '../services/consent-service';
import { REQUIRED_CONSENT_TYPES } from '../config/consent-config';
import type { ConsentType } from '../types/consent-types';

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
      // Fail closed: PDL/GDPR require we cannot serve protected data
      // when consent state is unknown.
      console.error('Consent check failed:', error);
      res.status(503).json({
        error: 'Consent verification unavailable',
        message: 'Please retry shortly.',
      });
    });
}

/**
 * Middleware factory: require a specific optional consent type for a feature.
 * Returns 451 if the patient hasn't accepted the specified consent.
 */
export function requireSpecificConsent(consentType: ConsentType) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== 'patient') {
      next();
      return;
    }

    const userId = req.user.userId;

    consentService.getConsentStatus(userId, consentType)
      .then((status) => {
        if (!status.hasAcceptedLatest) {
          res.status(451).json({
            error: 'Consent required',
            message: `You must accept the ${consentType} consent before using this feature.`,
            missingConsents: [{
              consentType,
              requiredVersion: status.currentVersion,
            }],
          });
          return;
        }
        next();
      })
      .catch((error) => {
        console.error(`Consent check failed for ${consentType}:`, error);
        res.status(503).json({
          error: 'Consent verification unavailable',
          message: 'Please retry shortly.',
        });
      });
  };
}
