import { Types } from 'mongoose';

// Notification types
export type NotificationType = 'calendly_deletion' | 'general';

// Notification priority
export type NotificationPriority = 'high' | 'medium' | 'low';

// Notification metadata
export type NotificationMetadata = {
  userEmail?: string;
  userName?: string;
  calendlyUserUri?: string;
  deletionLogId?: Types.ObjectId;
  [key: string]: any;
};

// Admin notification document type
export type AdminNotificationT = {
  _id?: Types.ObjectId;
  type: NotificationType;
  priority: NotificationPriority;
  read: boolean;
  message: string;
  actionRequired: string;
  metadata: NotificationMetadata;
  createdAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: string; // Admin user ID who resolved it
  updatedAt?: Date;
};

// Notification query parameters
export type NotificationListQuery = {
  type?: NotificationType;
  read?: boolean;
  page?: number;
  limit?: number;
};

// Notification list response
export type NotificationListResponse = {
  notifications: AdminNotificationT[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    unreadCount: number;
  };
};
