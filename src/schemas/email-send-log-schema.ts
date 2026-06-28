import mongoose, { Schema, Document, Types } from "mongoose";
import { EmailSendLogT, EMAIL_SEND_SOURCES, EMAIL_SEND_STATUSES } from "../types/email-send-log-type";

const EmailSendLogSchema: Schema = new Schema(
  {
    patientId: { type: Types.ObjectId, ref: "Patient", required: true },
    patientEmail: { type: String, required: true },
    source: { type: String, enum: [...EMAIL_SEND_SOURCES], required: true },
    templateId: { type: Types.ObjectId, ref: "EmailTemplate" },
    templateTitle: { type: String },
    subject: { type: String, required: true },
    sentByAdminId: { type: Types.ObjectId, ref: "Admin" },
    status: { type: String, enum: [...EMAIL_SEND_STATUSES], required: true },
    error: { type: String },
    consentGranted: { type: Boolean, default: false },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Per-patient history (newest first) + the global Email Log feed.
EmailSendLogSchema.index({ patientId: 1, sentAt: -1 });
EmailSendLogSchema.index({ sentAt: -1 });
EmailSendLogSchema.index({ source: 1, sentAt: -1 });

export default mongoose.model<EmailSendLogT & Document>("EmailSendLog", EmailSendLogSchema);
