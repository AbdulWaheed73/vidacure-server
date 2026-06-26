import { Response } from "express";
import { Types } from "mongoose";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import { AuthenticatedRequest } from "../types/generic-types";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";
import { PrescriptionRequestStatus, CurrentMedication } from "../types/prescription-types";
import { sendPrescriptionRequestNotification } from "../services/email-service";

// Create prescription request
export const createPrescriptionRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentWeight, hasSideEffects, sideEffectsDescription, currentMedications } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (typeof currentWeight !== 'number' || typeof hasSideEffects !== 'boolean') {
      res.status(400).json({ error: "Current weight and side effects status are required" });
      return;
    }

    if (hasSideEffects && !sideEffectsDescription) {
      res.status(400).json({ error: "Side effects description is required when side effects are reported" });
      return;
    }

    // Patient-reported current medications are optional. Sanitize: trim values
    // and keep only rows that have a non-empty medication name.
    let sanitizedMedications: CurrentMedication[] = [];
    if (currentMedications !== undefined) {
      if (!Array.isArray(currentMedications)) {
        res.status(400).json({ error: "currentMedications must be an array" });
        return;
      }
      sanitizedMedications = currentMedications
        .map((med: { name?: unknown; dosage?: unknown }) => ({
          name: typeof med?.name === 'string' ? med.name.trim() : '',
          dosage: typeof med?.dosage === 'string' ? med.dosage.trim() : '',
        }))
        .filter((med) => med.name.length > 0)
        .map((med) => ({
          name: med.name,
          dosage: med.dosage.length > 0 ? med.dosage : undefined,
        }));
    }

    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      await auditDatabaseError(req, "create_prescription_request", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "create_prescription_request_find_patient", "READ", userId);

    const newRequest = {
      status: PrescriptionRequestStatus.PENDING,
      currentWeight,
      hasSideEffects,
      sideEffectsDescription: hasSideEffects ? sideEffectsDescription : undefined,
      currentMedications: sanitizedMedications,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    patient.prescriptionRequests.push(newRequest);
    await patient.save();

    await auditDatabaseOperation(req, "create_prescription_request_save", "CREATE", userId, {
      currentWeight,
      hasSideEffects,
      hasDescription: !!sideEffectsDescription
    });

    // Notify the patient's assigned doctor (fire-and-forget — never blocks the response)
    if (patient.doctor) {
      const doctor = await DoctorSchema.findById(patient.doctor).select("name given_name email");
      if (doctor?.email) {
        sendPrescriptionRequestNotification({
          to: doctor.email,
          doctorName: doctor.given_name || doctor.name || "Doctor",
          patientName: patient.given_name || patient.name || "Patient",
          requestedAt: newRequest.createdAt,
        }).catch(() => {});
      }
    }

    res.status(201).json({
      message: "Prescription request created successfully",
      request: newRequest
    });
  } catch (error) {
    console.error("Error creating prescription request:", error);
    await auditDatabaseError(req, "create_prescription_request", "CREATE", error, req.user?.userId);
    res.status(500).json({ error: "Error creating prescription request" });
  }
};

// Get all prescription requests for the patient
export const getPrescriptionRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      await auditDatabaseError(req, "get_prescription_requests", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "get_prescription_requests", "READ", userId, {
      requestsCount: patient.prescriptionRequests?.length || 0
    });

    // Sort requests by date (newest first)
    const sortedRequests = patient.prescriptionRequests
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.status(200).json({
      prescriptionRequests: sortedRequests
    });
  } catch (error) {
    console.error("Error fetching prescription requests:", error);
    await auditDatabaseError(req, "get_prescription_requests", "READ", error, req.user?.userId);
    res.status(500).json({ error: "Error fetching prescription requests" });
  }
};

// Update prescription request status (for doctors)
export const updatePrescriptionRequestStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.params;
    const { status, prescribedMedications, medicationName, dosage, usageInstructions, dateIssued, validTill, rejectionNote } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const validStatuses = Object.values(PrescriptionRequestStatus);
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status value" });
      return;
    }

    if (status === PrescriptionRequestStatus.DENIED && (typeof rejectionNote !== 'string' || !rejectionNote.trim())) {
      res.status(400).json({ error: "Rejection note is required when denying a prescription request" });
      return;
    }

    // Sanitize the doctor-prescribed medications. Accept the new array form;
    // fall back to the legacy single medicationName/dosage fields for older clients.
    let sanitizedPrescribed: CurrentMedication[] = [];
    if (Array.isArray(prescribedMedications)) {
      sanitizedPrescribed = prescribedMedications
        .map((med: { name?: unknown; dosage?: unknown }) => ({
          name: typeof med?.name === 'string' ? med.name.trim() : '',
          dosage: typeof med?.dosage === 'string' ? med.dosage.trim() : '',
        }))
        .filter((med) => med.name.length > 0)
        .map((med) => ({ name: med.name, dosage: med.dosage.length > 0 ? med.dosage : undefined }));
    } else if (typeof medicationName === 'string' && medicationName.trim()) {
      sanitizedPrescribed = [{
        name: medicationName.trim(),
        dosage: typeof dosage === 'string' && dosage.trim() ? dosage.trim() : undefined,
      }];
    }

    if (status === PrescriptionRequestStatus.APPROVED && sanitizedPrescribed.length === 0) {
      res.status(400).json({ error: "At least one prescribed medication is required when approving a request" });
      return;
    }

    // Find patient by prescription request ID — scoped to the requesting doctor
    // so doctor A cannot act on prescription requests belonging to doctor B's patients.
    const patient = await PatientSchema.findOne({
      "prescriptionRequests._id": requestId,
      doctor: userId,
    });

    if (!patient) {
      await auditDatabaseError(req, "update_prescription_request_status", "READ", new Error("Prescription request not found or not owned by this doctor"), userId);
      res.status(404).json({ error: "Prescription request not found" });
      return;
    }

    await auditDatabaseOperation(req, "update_prescription_request_status_find", "READ", userId, { requestId });

    // Find and update the specific request
    const request = patient.prescriptionRequests.find(req => req._id?.toString() === requestId);
    if (!request) {
      res.status(404).json({ error: "Prescription request not found" });
      return;
    }

    const oldStatus = request.status;
    request.status = status;
    request.updatedAt = new Date();

    // Update prescription details if provided
    if (sanitizedPrescribed.length > 0) {
      request.prescribedMedications = sanitizedPrescribed;
      // Keep the legacy single fields in sync with the first medication so older
      // reads and the top-level prescription summary continue to work.
      request.medicationName = sanitizedPrescribed[0].name;
      request.dosage = sanitizedPrescribed[0].dosage;
    }
    if (usageInstructions) request.usageInstructions = usageInstructions;
    if (dateIssued) request.dateIssued = new Date(dateIssued);
    if (validTill) request.validTill = new Date(validTill);

    if (status === PrescriptionRequestStatus.DENIED) {
      request.rejectionNote = rejectionNote.trim();
    }

    // When approved, also set the top-level prescription field. Summarize all
    // prescribed medications into the medicationDetails string.
    if (status === PrescriptionRequestStatus.APPROVED) {
      const medicationDetails = sanitizedPrescribed
        .map((med) => (med.dosage ? `${med.name} (${med.dosage})` : med.name))
        .join(', ');
      patient.prescription = {
        doctor: new Types.ObjectId(userId),
        medicationDetails,
        validFrom: request.dateIssued || new Date(),
        validTo: request.validTill || new Date(),
        status: 'active',
        updatedAt: new Date(),
      };
    }

    await patient.save();

    await auditDatabaseOperation(req, "update_prescription_request_status_save", "UPDATE", userId, {
      requestId,
      oldStatus,
      newStatus: status,
      patientId: patient._id
    });

    res.status(200).json({
      message: "Prescription request status updated successfully",
      request
    });
  } catch (error) {
    console.error("Error updating prescription request status:", error);
    await auditDatabaseError(req, "update_prescription_request_status", "UPDATE", error, req.user?.userId);
    res.status(500).json({ error: "Error updating prescription request status" });
  }
};