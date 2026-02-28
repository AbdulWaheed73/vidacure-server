import mongoose, { Schema, Document } from 'mongoose';
import type { ConsentT } from '../types/consent-types';

const ConsentSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    consentType: {
      type: String,
      enum: ['privacy_policy', 'treatment_consent', 'data_sharing', 'lab_test_consent', 'communication_consent'],
      required: true
    },
    version: {
      type: String,
      required: true
    },
    accepted: {
      type: Boolean,
      required: true
    },
    ipAddress: {
      type: String,
      required: true
    },
    userAgent: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now
    },
    withdrawnAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient lookups
ConsentSchema.index({ userId: 1, consentType: 1, version: 1 });

export default mongoose.model<ConsentT & Document>('Consent', ConsentSchema);
