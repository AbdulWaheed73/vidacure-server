import { Response } from 'express';
import { AdminAuthenticatedRequest } from '../middleware/admin-auth-middleware';
import AdminNotificationSchema from '../schemas/admin-notification-schema';
import type { NotificationListQuery } from '../types/admin-notification-types';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';

/**
 * Get admin notifications
 * GET /api/admin/notifications
 */
export const getNotifications = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type, read, page = 1, limit = 20 }: NotificationListQuery = req.query as any;

    const skip = (Number(page) - 1) * Number(limit);

    // Build query
    const query: any = {};
    if (type) {
      query.type = type;
    }
    if (read !== undefined) {
      // Convert string to boolean
      const readValue = String(read);
      query.read = readValue === 'true' || readValue === 'TRUE';
    }

    // Get notifications with pagination
    const [notifications, total, unreadCount] = await Promise.all([
      AdminNotificationSchema.find(query)
        .sort({ priority: -1, createdAt: -1 }) // High priority first, then by date
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AdminNotificationSchema.countDocuments(query),
      AdminNotificationSchema.countDocuments({ read: false })
    ]);

    await auditDatabaseOperation(req as any, 'get_notifications', 'READ', undefined, {
      page,
      limit,
      total,
      unreadCount,
      type,
      read
    });

    res.status(200).json({
      notifications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        unreadCount
      }
    });
  } catch (error: any) {
    console.error('Error in getNotifications:', error);
    await auditDatabaseError(req as any, 'get_notifications', 'READ', error);
    res.status(500).json({
      error: 'Failed to fetch notifications',
      details: error.message
    });
  }
};

/**
 * Mark notification as resolved
 * PUT /api/admin/notifications/:notificationId/resolve
 */
export const resolveNotification = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { notificationId } = req.params;
    const adminId = req.admin?.userId;

    if (!adminId) {
      res.status(401).json({ error: 'Admin not authenticated' });
      return;
    }

    const notification = await AdminNotificationSchema.findById(notificationId);

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    // Update notification
    notification.read = true;
    notification.resolvedAt = new Date();
    notification.resolvedBy = adminId;
    await notification.save();

    await auditDatabaseOperation(req as any, 'resolve_notification', 'UPDATE', notificationId, {
      adminId,
      resolvedAt: notification.resolvedAt
    });

    res.status(200).json({
      success: true,
      message: 'Notification marked as resolved',
      notification
    });
  } catch (error: any) {
    console.error('Error in resolveNotification:', error);
    await auditDatabaseError(req as any, 'resolve_notification', 'UPDATE', error, req.params.notificationId);
    res.status(500).json({
      error: 'Failed to resolve notification',
      details: error.message
    });
  }
};

/**
 * Get notification count (for badge display)
 * GET /api/admin/notifications/count
 */
export const getNotificationCount = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [total, unreadCount, highPriorityUnread] = await Promise.all([
      AdminNotificationSchema.countDocuments(),
      AdminNotificationSchema.countDocuments({ read: false }),
      AdminNotificationSchema.countDocuments({ read: false, priority: 'high' })
    ]);

    res.status(200).json({
      total,
      unreadCount,
      highPriorityUnread
    });
  } catch (error: any) {
    console.error('Error in getNotificationCount:', error);
    res.status(500).json({
      error: 'Failed to fetch notification count',
      details: error.message
    });
  }
};
