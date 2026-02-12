import ConsentSchema from '../schemas/consent-schema';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../config/consent-config';
import type { ConsentStatusResponse, ConsentType } from '../types/consent-types';

export const consentService = {
  /**
   * Record a consent decision
   */
  async recordConsent(
    userId: string,
    consentType: ConsentType,
    version: string,
    accepted: boolean,
    ipAddress: string,
    userAgent: string
  ) {
    const consent = await ConsentSchema.create({
      userId,
      consentType,
      version,
      accepted,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });

    return consent;
  },

  /**
   * Check if user has accepted the latest privacy policy version
   */
  async getConsentStatus(userId: string): Promise<ConsentStatusResponse> {
    const latestConsent = await ConsentSchema.findOne({
      userId,
      consentType: 'privacy_policy',
      version: CURRENT_PRIVACY_POLICY_VERSION,
      accepted: true,
      withdrawnAt: null,
    })
      .sort({ timestamp: -1 })
      .lean();

    return {
      hasAcceptedLatest: !!latestConsent,
      currentVersion: CURRENT_PRIVACY_POLICY_VERSION,
      userConsentVersion: latestConsent?.version,
      acceptedAt: latestConsent?.timestamp
        ? new Date(latestConsent.timestamp).toISOString()
        : undefined,
    };
  },

  /**
   * Get full consent history for a user
   */
  async getUserConsents(userId: string) {
    const consents = await ConsentSchema.find({ userId })
      .sort({ timestamp: -1 })
      .lean();

    return consents;
  },

  /**
   * Withdraw consent (sets withdrawnAt on all active consents of a type)
   */
  async withdrawConsent(userId: string, consentType: ConsentType) {
    await ConsentSchema.updateMany(
      {
        userId,
        consentType,
        accepted: true,
        withdrawnAt: null,
      },
      {
        withdrawnAt: new Date(),
      }
    );
  },
};

export default consentService;
