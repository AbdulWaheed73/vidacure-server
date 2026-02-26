import mongoose, { Schema, Document } from "mongoose";
import { ProviderT } from "../types/provider-type";

const ProviderSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    providerType: { type: String, required: true, index: true },
    specialty: { type: String, required: false },
    bio: { type: String, required: false },
    calendlyUserUri: { type: String },
    eventTypes: {
      free: { type: String, default: "" },
      premium: { type: String, default: "" },
    },
    isActive: { type: Boolean, default: true },
    adminNotes: { type: String, required: false },
  },
  { timestamps: true }
);

// Compound index for efficient querying
ProviderSchema.index({ isActive: 1, providerType: 1 });

export default mongoose.model<ProviderT & Document>("Provider", ProviderSchema);
