import mongoose, { Schema, Document } from "mongoose";
import { EmailTemplateT } from "../types/email-template-type";

const EmailTemplateSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    order: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// The drip job lists active templates in sequence order every run.
EmailTemplateSchema.index({ isActive: 1, order: 1 });

export default mongoose.model<EmailTemplateT & Document>("EmailTemplate", EmailTemplateSchema);
