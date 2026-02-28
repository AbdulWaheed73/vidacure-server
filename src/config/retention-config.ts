/**
 * Data Retention Policy Configuration
 *
 * Legal basis:
 * - PDL Ch. 3 S. 17: Patient records must be retained minimum 10 years from last care event
 * - GDPR Art. 5(1)(e): Data must not be kept longer than necessary
 * - GDPR Art. 17: Right to erasure (balanced against PDL retention requirements)
 *
 * Strategy: Anonymize personal identifiers immediately on deletion request,
 * retain clinical data for the legally mandated period, then hard-delete.
 */

type RetentionRule = {
  /** Minimum retention period in years */
  retentionYears: number;
  /** Whether retention is indefinite (no auto-deletion) */
  indefinite: boolean;
  /** Legal basis for the retention period */
  legalBasis: string;
  /** Human-readable description */
  description: string;
};

export const RETENTION_RULES: Record<string, RetentionRule> = {
  patient_records: {
    retentionYears: 10,
    indefinite: false,
    legalBasis: 'PDL Ch. 3 S. 17 — patientjournaler ska bevaras i minst tio år',
    description: 'Patient health records (weight history, questionnaires, prescriptions) retained 10 years from last care event',
  },

  audit_logs: {
    retentionYears: 5,
    indefinite: false,
    legalBasis: 'PDL Ch. 4 + GDPR Art. 5(2) — accountability and access logging',
    description: 'Audit trail entries retained 5 years for compliance verification',
  },

  consent_records: {
    retentionYears: 0,
    indefinite: true,
    legalBasis: 'GDPR Art. 7(1) — controller must demonstrate consent was given',
    description: 'Consent records retained indefinitely as proof of legal basis',
  },

  chat_messages: {
    retentionYears: 10,
    indefinite: false,
    legalBasis: 'PDL Ch. 3 S. 17 — clinically relevant communications are part of patient record',
    description: 'Doctor-patient chat messages retained as part of the medical record',
  },

  deletion_logs: {
    retentionYears: 0,
    indefinite: true,
    legalBasis: 'GDPR Art. 17(2) — proof that deletion was carried out',
    description: 'Records of data deletion retained indefinitely for compliance proof',
  },

  subscription_data: {
    retentionYears: 7,
    indefinite: false,
    legalBasis: 'Bokföringslagen (Swedish Accounting Act) — 7 year retention for financial records',
    description: 'Payment and subscription records retained per accounting law',
  },
};

/** Grace period (in days) before anonymization begins after deletion request */
export const DELETION_GRACE_PERIOD_DAYS = 30;

/**
 * Calculate retention expiry date from last care event
 */
export function calculateRetentionExpiry(lastCareEvent: Date, category: string): Date | null {
  const rule = RETENTION_RULES[category];
  if (!rule || rule.indefinite) return null;

  const expiry = new Date(lastCareEvent);
  expiry.setFullYear(expiry.getFullYear() + rule.retentionYears);
  return expiry;
}
