import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import TreatmentJournalSchema from "../schemas/treatment-journal-schema";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import {
  auditDatabaseOperation,
  auditDatabaseError,
} from "../middleware/audit-middleware";

// GET /api/doctor/treatment-journal?patientId=...
export async function getTreatmentJournal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    const patientId = req.query.patientId as string;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!patientId) {
      res.status(400).json({ error: "A valid patientId query parameter is required" });
      return;
    }

    // Verify patient belongs to this doctor
    const patient = await PatientSchema.findOne({
      _id: patientId,
      doctor: doctorId,
    }).lean();

    if (!patient) {
      await auditDatabaseError(
        req,
        "get_treatment_journal",
        "READ",
        new Error("Patient not found or not assigned to doctor"),
        patientId
      );
      res.status(404).json({ error: "Patient not found or not assigned to this doctor" });
      return;
    }

    const journal = await TreatmentJournalSchema.findOne({ patient: patientId }).lean();

    await auditDatabaseOperation(req, "get_treatment_journal", "READ", patientId);

    res.status(200).json({ journal: journal || null });
  } catch (error) {
    await auditDatabaseError(
      req,
      "get_treatment_journal",
      "READ",
      error,
      req.query.patientId as string
    );
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// PUT /api/doctor/treatment-journal
export async function upsertTreatmentJournal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    const { patientId, content } = req.body;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!patientId || typeof content !== "string") {
      res.status(400).json({ error: "patientId and content are required" });
      return;
    }

    // Verify patient belongs to this doctor
    const patient = await PatientSchema.findOne({
      _id: patientId,
      doctor: doctorId,
    }).lean();

    if (!patient) {
      await auditDatabaseError(
        req,
        "upsert_treatment_journal",
        "UPDATE",
        new Error("Patient not found or not assigned to doctor"),
        patientId
      );
      res.status(404).json({ error: "Patient not found or not assigned to this doctor" });
      return;
    }

    const existing = await TreatmentJournalSchema.findOne({ patient: patientId });

    if (existing) {
      existing.content = content;
      existing.doctor = doctorId as any;
      await existing.save();

      await auditDatabaseOperation(req, "journal_updated", "UPDATE", patientId);

      res.status(200).json({ journal: existing.toObject() });
    } else {
      const journal = await TreatmentJournalSchema.create({
        patient: patientId,
        doctor: doctorId,
        content,
      });

      await auditDatabaseOperation(req, "journal_created", "CREATE", patientId);

      res.status(201).json({ journal: journal.toObject() });
    }
  } catch (error) {
    await auditDatabaseError(
      req,
      "upsert_treatment_journal",
      "UPDATE",
      error,
      req.body?.patientId
    );
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

// GET /api/patient/treatment-journal
export async function getPatientTreatmentJournal(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const patientId = req.user?.userId;

    if (!patientId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const journal = await TreatmentJournalSchema.findOne({ patient: patientId })
      .populate("doctor", "name")
      .lean();

    await auditDatabaseOperation(req, "get_treatment_journal", "READ", patientId);

    if (!journal) {
      res.status(200).json({ journal: null });
      return;
    }

    const doctorName = (journal.doctor as any)?.name || "Your Doctor";

    res.status(200).json({
      journal: {
        _id: journal._id,
        content: journal.content,
        doctorName,
        createdAt: journal.createdAt,
        updatedAt: journal.updatedAt,
      },
    });
  } catch (error) {
    await auditDatabaseError(
      req,
      "get_treatment_journal",
      "READ",
      error,
      req.user?.userId
    );
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
