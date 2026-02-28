import type { ConsentType } from '../types/consent-types';

/**
 * Current consent versions per type.
 * Bump a version when its policy/terms are updated — this triggers re-consent for all users.
 *
 * PDL / Patientlagen: treatment_consent
 * GDPR Art. 6-7: privacy_policy, data_sharing, communication_consent
 * Lab testing: lab_test_consent
 */
export const CONSENT_VERSIONS: Record<ConsentType, string> = {
  privacy_policy: '1.0',
  treatment_consent: '1.0',
  data_sharing: '1.0',
  lab_test_consent: '1.0',
  communication_consent: '1.0',
};

/**
 * Consent type metadata for display and legal reference
 */
export const CONSENT_METADATA: Record<ConsentType, { required: boolean; description: string; legalBasis: string }> = {
  privacy_policy: {
    required: true,
    description: 'Processing of personal data according to our privacy policy',
    legalBasis: 'GDPR Art. 6(1)(a) — Consent',
  },
  treatment_consent: {
    required: true,
    description: 'Consent to receive healthcare treatment via the Vidacure platform',
    legalBasis: 'Patientlagen Ch. 4 — Informed consent for treatment',
  },
  data_sharing: {
    required: true,
    description: 'Sharing of health data between your care providers within Vidacure',
    legalBasis: 'PDL Ch. 6 — Consent for data sharing between care units',
  },
  lab_test_consent: {
    required: false,
    description: 'Ordering and processing of laboratory tests via third-party providers',
    legalBasis: 'Patientlagen Ch. 4 — Consent for specific medical procedures',
  },
  communication_consent: {
    required: false,
    description: 'Receiving health-related communications via email and push notifications',
    legalBasis: 'GDPR Art. 6(1)(a) — Consent for electronic communications',
  },
};

/** List of consent types that must be accepted before using the platform */
export const REQUIRED_CONSENT_TYPES: ConsentType[] = Object.entries(CONSENT_METADATA)
  .filter(([, meta]) => meta.required)
  .map(([type]) => type as ConsentType);

/** Kept for backward compatibility */
export const CURRENT_PRIVACY_POLICY_VERSION = CONSENT_VERSIONS.privacy_policy;
