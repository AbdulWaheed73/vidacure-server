import { Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { AuthenticatedRequest } from "../types/generic-types";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";

// Create prescription request
export const createPrescriptionRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentWeight, hasSideEffects, sideEffectsDescription } = req.body;
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

    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      await auditDatabaseError(req, "create_prescription_request", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "create_prescription_request_find_patient", "READ", userId);

    const newRequest = {
      status: "pending" as const,
      currentWeight,
      hasSideEffects,
      sideEffectsDescription: hasSideEffects ? sideEffectsDescription : undefined,
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
    const { status } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!["pending", "approved", "denied", "under_review"].includes(status)) {
      res.status(400).json({ error: "Invalid status value" });
      return;
    }

    // Find patient by prescription request ID
    const patient = await PatientSchema.findOne({
      "prescriptionRequests._id": requestId
    });

    if (!patient) {
      await auditDatabaseError(req, "update_prescription_request_status", "READ", new Error("Prescription request not found"), userId);
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