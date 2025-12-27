import mongoose, { Schema, Document } from 'mongoose';
import type { AdminNotificationT } from '../types/admin-notification-types';

const AdminNotificationSchema: Schema = new Schema(
  {
    type: {
      type: String,
      enum: ['calendly_deletion', 'general'],
      required: true,
      index: true
    },
    priority: {
      type: String,
      enum: ['high', 'medium', 'low'],
      required: true,
      default: 'medium',
      index: true
    },
    read: {
      type: Boolean,
      required: true,
      default: false,
      index: true
    },
    message: {
      type: String,
      required: true
    },
    actionRequired: {
      type: String,
      required: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    resolvedAt: {
      type: Date
    },
    resolvedBy: {
      type: String // Admin user ID who resolved it
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
AdminNotificationSchema.index({ read: 1, createdAt: -1 });
AdminNotificationSchema.index({ type: 1, read: 1 });
AdminNotificationSchema.index({ priority: -1, createdAt: -1 });

export default mongoose.model<AdminNotificationT & Document>('AdminNotification', AdminNotificationSchema);
