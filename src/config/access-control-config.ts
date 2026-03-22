/**
 * Access Control Authorization Matrix
 * PDL Ch. 4 S. 2 — "Behovs- och riskanalys" (Needs and Risk Analysis)
 *
 * Documents what each role can access within the system.
 * Only staff directly involved in a patient's care AND who need the data
 * may access it (PDL inner secrecy / inre sekretess).
 *
 * This serves as the documented authorization policy required by Swedish law.
 */

export type AccessRole = 'patient' | 'doctor' | 'admin' | 'superadmin';

export type DataCategory =
  | 'personal_info'        // name, email, DOB, gender
  | 'ssn'                  // Swedish personal number (encrypted)
  | 'health_data'          // weight, BMI, side effects, questionnaire answers
  | 'prescription_data'    // prescriptions, prescription requests, medication
  | 'appointment_data'     // Calendly meetings, scheduling
  | 'subscription_data'    // Stripe subscription, payment status
  | 'chat_messages'        // Doctor-patient chat via Socket.IO
  | 'lab_test_data'        // Lab test orders and results
  | 'audit_logs'           // Access logs (loggutdrag)
  | 'consent_records'      // GDPR consent history
  | 'provider_assignments' // Provider-patient relationships and tiers;

type AccessLevel = 'none' | 'own' | 'care_relationship' | 'all_summary' | 'all_full';

type AccessRule = {
  level: AccessLevel;
  justification: string;
};

/**
 * Authorization matrix: role -> data category -> access rule
 *
 * Access levels:
 * - none: No access
 * - own: Can only access own data (self-service)
 * - care_relationship: Can access data for patients in their care
 * - all_summary: Can see summary/listing data for all (no health details)
 * - all_full: Full access to all records (requires documented justification)
 */
export const ACCESS_CONTROL_MATRIX: Record<AccessRole, Record<DataCategory, AccessRule>> = {
  patient: {
    personal_info: { level: 'own', justification: 'Self-service profile management' },
    ssn: { level: 'none', justification: 'SSN only used for authentication, not displayed' },
    health_data: { level: 'own', justification: 'Patient views own health records' },
    prescription_data: { level: 'own', justification: 'Patient views own prescriptions' },
    appointment_data: { level: 'own', justification: 'Patient manages own appointments' },
    subscription_data: { level: 'own', justification: 'Patient manages own subscription' },
    chat_messages: { level: 'own', justification: 'Patient participates in own care chat' },
    lab_test_data: { level: 'own', justification: 'Patient views own lab results' },
    audit_logs: { level: 'own', justification: 'PDL Ch. 8 — patient right to log extract (loggutdrag)' },
    consent_records: { level: 'own', justification: 'GDPR — view and manage own consents' },
    provider_assignments: { level: 'own', justification: 'Patient sees assigned providers and tiers' },
  },

  doctor: {
    personal_info: { level: 'care_relationship', justification: 'Doctor needs patient identity for care' },
    ssn: { level: 'none', justification: 'SSN not needed for clinical care delivery' },
    health_data: { level: 'care_relationship', justification: 'PDL — direct care relationship required' },
    prescription_data: { level: 'care_relationship', justification: 'Doctor manages prescriptions for assigned patients' },
    appointment_data: { level: 'care_relationship', justification: 'Doctor manages appointments with own patients' },
    subscription_data: { level: 'none', justification: 'Billing is not clinical — no need' },
    chat_messages: { level: 'care_relationship', justification: 'Doctor communicates with assigned patients' },
    lab_test_data: { level: 'care_relationship', justification: 'Doctor reviews results for assigned patients' },
    audit_logs: { level: 'none', justification: 'Audit review is admin responsibility' },
    consent_records: { level: 'none', justification: 'Consent management is admin responsibility' },
    provider_assignments: { level: 'none', justification: 'Provider management is admin responsibility' },
  },

  admin: {
    personal_info: { level: 'all_summary', justification: 'Admin manages user accounts and assignments' },
    ssn: { level: 'none', justification: 'Admin uses SSN hash only for lookup, never sees plaintext' },
    health_data: { level: 'none', justification: 'PDL inner secrecy — admin has no care relationship' },
    prescription_data: { level: 'none', justification: 'PDL inner secrecy — clinical data restricted' },
    appointment_data: { level: 'all_summary', justification: 'Admin manages scheduling and Calendly integration' },
    subscription_data: { level: 'all_full', justification: 'Admin manages billing and subscriptions' },
    chat_messages: { level: 'none', justification: 'PDL inner secrecy — chat is clinical communication' },
    lab_test_data: { level: 'none', justification: 'PDL inner secrecy — lab data is clinical' },
    audit_logs: { level: 'all_full', justification: 'PDL Ch. 4 — admin performs systematic log reviews' },
    consent_records: { level: 'all_full', justification: 'GDPR compliance management' },
    provider_assignments: { level: 'all_full', justification: 'Admin manages provider-patient relationships' },
  },

  superadmin: {
    personal_info: { level: 'all_summary', justification: 'System administration' },
    ssn: { level: 'none', justification: 'SSN access restricted at infrastructure level' },
    health_data: { level: 'none', justification: 'PDL inner secrecy — even superadmin lacks care relationship' },
    prescription_data: { level: 'none', justification: 'PDL inner secrecy — clinical data restricted' },
    appointment_data: { level: 'all_summary', justification: 'System administration' },
    subscription_data: { level: 'all_full', justification: 'System administration and billing oversight' },
    chat_messages: { level: 'none', justification: 'PDL inner secrecy — chat is clinical communication' },
    lab_test_data: { level: 'none', justification: 'PDL inner secrecy — lab data is clinical' },
    audit_logs: { level: 'all_full', justification: 'System security oversight and compliance' },
    consent_records: { level: 'all_full', justification: 'GDPR compliance oversight' },
    provider_assignments: { level: 'all_full', justification: 'System administration' },
  },
};

/**
 * Fields excluded from admin patient queries (health data)
 * Used by admin-controllers.ts for .select() projections
 */
export const ADMIN_PATIENT_SAFE_FIELDS = 'name email doctor providers subscription lastLogin createdAt calendly providerTierOverrides';

/**
 * Fields that constitute "health data" under PDL/GDPR
 * These must NEVER be returned in admin endpoints
 */
export const HEALTH_DATA_FIELDS = [
  'weightHistory',
  'questionnaire',
  'prescription',
  'prescriptionRequests',
  'bmi',
  'height',
  'dateOfBirth',
  'gender',
  'sideEffects',
  'medicationName',
  'dosage',
];
