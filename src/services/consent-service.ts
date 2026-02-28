import ConsentSchema from '../schemas/consent-schema';
import { CONSENT_VERSIONS } from '../config/consent-config';
import type { ConsentStatusResponse, ConsentType, AllConsentsStatusResponse } from '../types/consent-types';
import { logAuditEvent } from './audit-service';

const VALID_CONSENT_TYPES: ConsentType[] = [
  'privacy_policy',
  'treatment_consent',
  'data_sharing',
  'lab_test_consent',
  'communication_consent',
];

export const consentService = {
  /**
   * Validate consent type
   */
  isValidConsentType(type: string): type is ConsentType {
    return VALID_CONSENT_TYPES.includes(type as ConsentType);
  },

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
   * Check consent status for a specific consent type
   */
  async getConsentStatus(userId: string, consentType: ConsentType = 'privacy_policy'): Promise<ConsentStatusResponse> {
    const currentVersion = CONSENT_VERSIONS[consentType];

    const latestConsent = await ConsentSchema.findOne({
      userId,
      consentType,
      version: currentVersion,
      accepted: true,
      withdrawnAt: null,
    })
      .sort({ timestamp: -1 })
      .lean();

    return {
      hasAcceptedLatest: !!latestConsent,
      currentVersion,
      userConsentVersion: latestConsent?.version,
      acceptedAt: latestConsent?.timestamp
        ? new Date(latestConsent.timestamp).toISOString()
        : undefined,
    };
  },

  /**
   * Check status of ALL consent types for a user
   */
  async getAllConsentsStatus(userId: string): Promise<AllConsentsStatusResponse> {
    const consents: Record<string, ConsentStatusResponse> = {};

    for (const consentType of VALID_CONSENT_TYPES) {
      consents[consentType] = await this.getConsentStatus(userId, consentType);
    }

    return { consents: consents as Record<ConsentType, ConsentStatusResponse> };
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
   * Includes audit logging as required by GDPR
   */
  async withdrawConsent(userId: string, consentType: ConsentType, ipAddress: string, userAgent: string) {
    const result = await ConsentSchema.updateMany(
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

    // Audit log the withdrawal — legally significant event
    await logAuditEvent({
      userId,
      role: 'patient',
      action: 'consent_withdrawn',
      operation: 'UPDATE',
      success: true,
      targetId: userId,
      ipAddress,
      userAgent,
      metadata: {
        consentType,
        withdrawnCount: result.modifiedCount,
      },
    });

    return result;
  },
};

export default consentService;
