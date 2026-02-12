import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import dataExportService from '../services/data-export-service';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';

/**
 * Export authenticated patient's data (GDPR Article 20 - Data Portability)
 * GET /api/users/me/data-export
 */
export const exportMyData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    if (userRole !== 'patient') {
      res.status(403).json({ error: 'Data export is only available for patients' });
      return;
    }

    await auditDatabaseOperation(req, 'data_export_initiated', 'READ', userId, {
      userType: userRole,
    });

    const data = await dataExportService.exportPatientData(userId);

    await auditDatabaseOperation(req, 'data_export_completed', 'READ', userId, {
      sections: Object.keys(data),
    });

    res.status(200).json(data);
  } catch (error: any) {
    console.error('Error in exportMyData:', error);
    await auditDatabaseError(req, 'data_export', 'READ', error, req.user?.userId);
    res.status(500).json({
      error: 'Failed to export data',
      details: error.message,
    });
  }
};
