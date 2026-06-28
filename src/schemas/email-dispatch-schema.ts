import mongoose, { Schema, Document, Types } from "mongoose";
import { EmailDispatchT, EMAIL_DISPATCH_STATUSES } from "../types/email-dispatch-type";

const EmailDispatchSchema: Schema = new Schema(
  {
    patientId: { type: Types.ObjectId, ref: "Patient", required: true },
    templateId: { type: Types.ObjectId, ref: "EmailTemplate", required: true },
    status: { type: String, enum: [...EMAIL_DISPATCH_STATUSES], default: "reserved", required: true },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true }
);

// THE safety net: one dispatch per (patient, template). A duplicate insert throws
// a duplicate-key error, so a patient can never be sent the same template twice —
// regardless of crashes, restarts or an accidental double-fire of the cron.
EmailDispatchSchema.index({ patientId: 1, templateId: 1 }, { unique: true });

export default mongoose.model<EmailDispatchT & Document>("EmailDispatch", EmailDispatchSchema);
