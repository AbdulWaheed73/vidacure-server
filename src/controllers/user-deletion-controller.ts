import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import { AdminAuthenticatedRequest } from '../middleware/admin-auth-middleware';
import userDeletionService from '../services/user-deletion-service';
import DeletionLogSchema from '../schemas/deletion-log-schema';
import type { AdminDeletionRequest, DeletionListQuery } from '../types/user-deletion-types';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';

/**
 * Self-deletion: Logged-in users delete their own account
 * DELETE /api/users/me
 */
export const deleteSelf = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Validate user type
    if (userRole !== 'patient' && userRole !== 'doctor') {
      res.status(403).json({ error: 'Only patients and doctors can delete their accounts' });
      return;
    }

    await auditDatabaseOperation(req, 'delete_self_initiated', 'DELETE', userId, {
      userType: userRole
    });

    // Execute deletion
    const result = await userDeletionService.deleteUser(userId, userRole, 'self');

    await auditDatabaseOperation(req, 'delete_self_completed', 'DELETE', userId, {
      deletionId: result.deletionId,
      confirmationId: result.confirmationId,
      status: result.results
    });

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
      deletionId: result.deletionId,
      results: result.results,
      confirmationId: result.confirmationId
    });
  } catch (error: any) {
    console.error('Error in deleteSelf:', error);
    await auditDatabaseError(req, 'delete_self', 'DELETE', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to delete account',
      details: error.message
    });
  }
};

/**
 * Admin deletion: Admins delete any user account
 * DELETE /api/admin/users/:userId
 */
export const deleteUserByAdmin = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { userType, reassignDoctorId }: AdminDeletionRequest = req.body;
    const adminId = req.admin?.userId;

    if (!adminId) {
      res.status(401).json({ error: 'Admin not authenticated' });
      return;
    }

    if (!userId || !userType) {
      res.status(400).json({ error: 'User ID and user type are required' });
      return;
    }

    // Validate user type
    if (userType !== 'patient' && userType !== 'doctor') {
      res.status(400).json({ error: 'Invalid user type. Must be "patient" or "doctor"' });
      return;
    }

    // Validate reassignDoctorId if provided
    if (userType === 'doctor' && reassignDoctorId) {
      // TODO: Verify that reassignDoctorId exists and is a valid doctor
    }

    await auditDatabaseOperation(req as any, 'admin_delete_user_initiated', 'DELETE', userId, {
      userType,
      adminId,
      reassignDoctorId
    });

    // Execute deletion
    const result = await userDeletionService.deleteUser(
      userId,
      userType,
      adminId,
      reassignDoctorId
    );

    await auditDatabaseOperation(req as any, 'admin_delete_user_completed', 'DELETE', userId, {
      deletionId: result.deletionId,
      confirmationId: result.confirmationId,
      status: result.results
    });

    res.status(200).json({
      success: true,
      message: 'User account deleted successfully',
      deletionId: result.deletionId,
      results: result.results,
      confirmationId: result.confirmationId
    });
  } catch (error: any) {
    console.error('Error in deleteUserByAdmin:', error);
    await auditDatabaseError(req as any, 'admin_delete_user', 'DELETE', error, req.params.userId);
    res.status(500).json({
      error: 'Failed to delete user account',
      details: error.message
    });
  }
};

/**
 * Get deletion history (admin only)
 * GET /api/admin/deletions
 */
export const getDeletions = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, status }: DeletionListQuery = req.query as any;

    const skip = (Number(page) - 1) * Number(limit);

    // Build query
    const query: any = {};
    if (status) {
      query.status = status;
    }

    // Get deletions with pagination
    const [deletions, total] = await Promise.all([
      DeletionLogSchema.find(query)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('userId userType userEmail requestedBy requestedAt completedAt status')
        .lean(),
      DeletionLogSchema.countDocuments(query)
    ]);

    await auditDatabaseOperation(req as any, 'get_deletions', 'READ', undefined, {
      page,
      limit,
      total,
      status
    });

    res.status(200).json({
      deletions: deletions.map(d => ({
        deletionId: d._id?.toString(),
        userId: d.userId,
        userType: d.userType,
        userEmail: d.userEmail,
        requestedBy: d.requestedBy,
        requestedAt: d.requestedAt,
        completedAt: d.completedAt,
        status: d.status
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total
      }
    });
  } catch (error: any) {
    console.error('Error in getDeletions:', error);
    await auditDatabaseError(req as any, 'get_deletions', 'READ', error);
    res.status(500).json({
      error: 'Failed to fetch deletion history',
      details: error.message
    });
  }
};

/**
 * Get specific deletion details (admin only)
 * GET /api/admin/deletions/:deletionId
 */
export const getDeletionById = async (req: AdminAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { deletionId } = req.params;

    const deletion = await DeletionLogSchema.findById(deletionId).lean();

    if (!deletion) {
      res.status(404).json({ error: 'Deletion log not found' });
      return;
    }

    await auditDatabaseOperation(req as any, 'get_deletion_by_id', 'READ', deletionId);

    res.status(200).json(deletion);
  } catch (error: any) {
    console.error('Error in getDeletionById:', error);
    await auditDatabaseError(req as any, 'get_deletion_by_id', 'READ', error, req.params.deletionId);
    res.status(500).json({
      error: 'Failed to fetch deletion details',
      details: error.message
    });
  }
};
