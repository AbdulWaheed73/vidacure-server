import { Types } from "mongoose";

/**
 * An email in the monthly drip "stock". Admins add/edit these from the admin
 * portal. Each patient walks the active templates in `order`, receiving each one
 * exactly once (see EmailDispatch + patient.emailSequence.sentTemplateIds).
 */
export type EmailTemplateT = {
  _id?: Types.ObjectId;
  title: string;       // admin-facing label, e.g. "Month 1 – Getting started"
  subject: string;     // email subject line shown to the patient
  html: string;        // full HTML body sent via Resend
  order: number;       // position in the sequence (ascending)
  isActive: boolean;   // inactive templates are skipped (retire without deleting history)
  createdAt: Date;
  updatedAt: Date;
};
