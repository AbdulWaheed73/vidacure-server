import { Response } from "express";
import mongoose from "mongoose";
import { AuthenticatedRequest } from "../types/generic-types";
import SuggestionSchema from "../schemas/suggestion-schema";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import {
  auditDatabaseOperation,
  auditDatabaseError,
} from "../middleware/audit-middleware";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

// POST /api/patient/suggestions  OR  /api/doctor/suggestions
export async function createSuggestion(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (role !== "patient" && role !== "doctor") {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    const { title, description } = req.body ?? {};

    if (typeof title !== "string" || typeof description !== "string") {
      res.status(400).json({ error: "Title and description are required" });
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle || !trimmedDescription) {
      res.status(400).json({ error: "Title and description cannot be empty" });
      return;
    }

    if (trimmedTitle.length > TITLE_MAX) {
      res.status(400).json({ error: `Title must be at most ${TITLE_MAX} characters` });
      return;
    }

    if (trimmedDescription.length > DESCRIPTION_MAX) {
      res
        .status(400)
        .json({ error: `Description must be at most ${DESCRIPTION_MAX} characters` });
      return;
    }

    const userDoc =
      role === "patient"
        ? await PatientSchema.findById(userId).select("name").lean()
        : await DoctorSchema.findById(userId).select("name").lean();

    if (!userDoc) {
      await auditDatabaseError(
        req,
        "suggestion_created",
        "CREATE",
        new Error("Submitter not found"),
        userId
      );
      res.status(404).json({ error: "User not found" });
      return;
    }

    const submitterName = (userDoc as any).name || "Unknown";

    const suggestion = await SuggestionSchema.create({
      submittedBy: new mongoose.Types.ObjectId(userId),
      submitterRole: role,
      submitterName,
      title: trimmedTitle,
      description: trimmedDescription,
    });

    await auditDatabaseOperation(req, "suggestion_created", "CREATE", String(suggestion._id));

    res.status(201).json({ suggestion: suggestion.toObject() });
  } catch (error) {
    await auditDatabaseError(req, "suggestion_created", "CREATE", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// GET /api/admin/suggestions  (superadmin)
export async function listSuggestions(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const suggestions = await SuggestionSchema.find({})
      .sort({ createdAt: -1 })
      .lean();

    await auditDatabaseOperation(req, "list_suggestions", "READ");

    res.status(200).json({ suggestions });
  } catch (error) {
    await auditDatabaseError(req, "list_suggestions", "READ", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// DELETE /api/admin/suggestions/:id  (superadmin)
export async function deleteSuggestion(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || !mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: "Valid suggestion id is required" });
      return;
    }

    const deleted = await SuggestionSchema.findByIdAndDelete(id).lean();

    if (!deleted) {
      await auditDatabaseError(
        req,
        "suggestion_deleted",
        "DELETE",
        new Error("Suggestion not found"),
        id
      );
      res.status(404).json({ error: "Suggestion not found" });
      return;
    }

    await auditDatabaseOperation(req, "suggestion_deleted", "DELETE", id);

    res.status(200).json({ success: true });
  } catch (error) {
    await auditDatabaseError(req, "suggestion_deleted", "DELETE", error, req.params?.id);
    res.status(500).json({ error: "Internal server error" });
  }
}
