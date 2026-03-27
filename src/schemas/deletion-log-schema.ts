import mongoose, { Schema, Document } from 'mongoose';
import type { DeletionLogT } from '../types/user-deletion-types';

const DeletionLogSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    userType: {
      type: String,
      enum: ['patient', 'doctor'],
      required: true
    },
    userEmail: {
      type: String,
      required: true
    },
    userName: {
      type: String,
      required: true
    },
    ssnHash: {
      type: String,
      required: true
    },
    requestedBy: {
      type: String,
      required: true // 'self' or admin user ID
    },
    requestedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    completedAt: {
      type: Date
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'partial_failure', 'failed'],
      required: true,
      default: 'in_progress',
      index: true
    },
    deletionResults: {
      stripe: {
        success: { type: Boolean, required: true },
        error: { type: String },
        customerId: { type: String }
      },
      stream: {
        success: { type: Boolean, required: true },
        error: { type: String },
        channelIds: [{ type: String }]
      },
      calendly: {
        success: { type: Boolean, required: true },
        notificationCreated: { type: Boolean, required: true },
        email: { type: String }
      },
      mongodb: {
        success: { type: Boolean, required: true },
        error: { type: String }
      }
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    confirmationId: {
      type: String,
      required: true,
      unique: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
DeletionLogSchema.index({ requestedAt: -1 });
DeletionLogSchema.index({ status: 1, requestedAt: -1 });

export default mongoose.model<DeletionLogT & Document>('DeletionLog', DeletionLogSchema);
