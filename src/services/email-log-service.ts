import { Types } from "mongoose";
import EmailSendLogSchema from "../schemas/email-send-log-schema";
import { EmailSendSource, EmailSendStatus } from "../types/email-send-log-type";

type RecordEmailSendInput = {
  patientId: Types.ObjectId | string;
  patientEmail: string;
  source: EmailSendSource;
  subject: string;
  status: EmailSendStatus;
  templateId?: Types.ObjectId | string;
  templateTitle?: string;
  sentByAdminId?: Types.ObjectId | string;
  error?: string;
  consentGranted?: boolean;
};

/**
 * Single write-point for the email history. Called by the drip job and by manual
 * admin sends. Never throws — a logging failure must not break the send flow.
 */
export async function recordEmailSend(input: RecordEmailSendInput): Promise<void> {
  try {
    await EmailSendLogSchema.create({
      patientId: input.patientId,
      patientEmail: input.patientEmail,
      source: input.source,
      subject: input.subject,
      status: input.status,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.templateTitle ? { templateTitle: input.templateTitle } : {}),
      ...(input.sentByAdminId ? { sentByAdminId: input.sentByAdminId } : {}),
      ...(input.error ? { error: input.error } : {}),
      consentGranted: input.consentGranted ?? false,
      sentAt: new Date(),
    });
  } catch (err) {
    console.error("[email-log] failed to record send:", err instanceof Error ? err.message : err);
  }
}
