import { Types } from "mongoose";

// Single source of truth for the send "source" — feeds the schema enum + union.
export const EMAIL_SEND_SOURCES = ["drip", "manual_template", "manual_custom"] as const;
export type EmailSendSource = (typeof EMAIL_SEND_SOURCES)[number];

export const EMAIL_SEND_STATUSES = ["sent", "failed"] as const;
export type EmailSendStatus = (typeof EMAIL_SEND_STATUSES)[number];

/**
 * Append-only record of EVERY email sent to a patient — automated drip and manual
 * admin sends alike. This is the human-readable history (the "Email Log"); the
 * drip idempotency ledger remains EmailDispatch. One row per send attempt.
 */
export type EmailSendLogT = {
  _id?: Types.ObjectId;
  patientId: Types.ObjectId;        // ref: Patient
  patientEmail: string;             // snapshot of the recipient at send time
  source: EmailSendSource;          // drip | manual_template | manual_custom
  templateId?: Types.ObjectId;      // ref: EmailTemplate (drip / manual_template)
  templateTitle?: string;           // snapshot (templates can be edited/deleted later)
  subject: string;
  sentByAdminId?: Types.ObjectId;   // ref: Admin (manual sends only)
  status: EmailSendStatus;
  error?: string;
  consentGranted: boolean;          // was communication_consent in place at send time
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
