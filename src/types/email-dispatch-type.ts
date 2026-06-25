import { Types } from "mongoose";

// Single source of truth: the runtime array feeds both the union type below and
// the Mongoose schema enum (TS unions don't exist at runtime).
export const EMAIL_DISPATCH_STATUSES = ["reserved", "sent", "failed"] as const;
export type EmailDispatchStatus = (typeof EMAIL_DISPATCH_STATUSES)[number];

/**
 * One row per (patient, template) — the idempotency ledger that makes
 * double-sends physically impossible. A unique index on {patientId, templateId}
 * means the drip job can crash, restart or double-fire and a patient will never
 * receive the same email twice.
 *
 * Lifecycle: reserved -> sent (on Resend success) or failed (retried up to a cap).
 */
export type EmailDispatchT = {
  _id?: Types.ObjectId;
  patientId: Types.ObjectId;   // ref: Patient
  templateId: Types.ObjectId;  // ref: EmailTemplate
  status: EmailDispatchStatus;
  attempts: number;            // send attempts so far (caps automatic retries)
  sentAt?: Date;               // set when status becomes "sent"
  lastError?: string;          // last Resend/send error, for diagnostics
  createdAt: Date;
  updatedAt: Date;
};
