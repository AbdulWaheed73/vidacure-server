import { Response } from 'express';
import { AuthenticatedRequest } from '../types/generic-types';
import { decryptSSN } from '../services/auth-service';
import { auditDatabaseOperation, auditDatabaseError } from '../middleware/audit-middleware';
import Patient from '../schemas/patient-schema';
import Doctor from '../schemas/doctor-schema';

/**
 * Reveal authenticated user's own SSN (decrypted)
 * GET /api/users/me/ssn
 */
export const getMySSN = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    let encryptedSsn: string | undefined;

    if (userRole === 'patient') {
      const patient = await Patient.findById(userId).select('encryptedSsn').lean();
      if (!patient) {
        res.status(404).json({ error: 'Patient not found' });
        return;
      }
      encryptedSsn = patient.encryptedSsn;
    } else if (userRole === 'doctor') {
      const doctor = await Doctor.findById(userId).select('encryptedSsn').lean();
      if (!doctor) {
        res.status(404).json({ error: 'Doctor not found' });
        return;
      }
      encryptedSsn = doctor.encryptedSsn;
    } else {
      res.status(403).json({ error: 'SSN reveal not available for this role' });
      return;
    }

    if (!encryptedSsn) {
      res.status(404).json({ error: 'SSN not available' });
      return;
    }

    const ssn = decryptSSN(encryptedSsn);

    await auditDatabaseOperation(req, 'ssn_revealed', 'READ', userId, {
      userType: userRole,
    });

    res.status(200).json({ ssn });
  } catch (error: any) {
    console.error('Error in getMySSN:', error);
    await auditDatabaseError(req, 'ssn_reveal', 'READ', error, req.user?.userId);
    res.status(500).json({ error: 'Failed to retrieve SSN' });
  }
};
