import { Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { AuthenticatedRequest } from "../types/generic-types";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";

export const getAllPatients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const patients = await PatientSchema.find().select('name given_name family_name role ssnHash lastLogin createdAt');
      await auditDatabaseOperation(req, "get_all_patients", "READ", undefined, { count: patients.length });
      res.status(200).json(patients);
    } catch (error) {
      await auditDatabaseError(req, "get_all_patients", "READ", error);
      res.status(500).json({ error: "Error fetching patients" });
    }
  };

// Submit questionnaire answers
export const submitQuestionnaire = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { questionnaire } = req.body;
    const userId = req.user?.userId;
    console.log("user ID: ", userId);


    if (!questionnaire || !Array.isArray(questionnaire)) {
      res.status(400).json({ error: "Invalid questionnaire format" });
      return;
    }

    // Validate questionnaire structure
    const isValidFormat = questionnaire.every(
      (item: any) => item.questionId && typeof item.answer === 'string'
    );

    if (!isValidFormat) {
      res.status(400).json({ error: "Invalid questionnaire answer format" });
      return;
    }

    // Find patient by ID directly
    const patient = await PatientSchema.findById(userId);
    
    if (!patient) {
      await auditDatabaseError(req, "submit_questionnaire_find_patient", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "submit_questionnaire_find_patient", "READ", userId);

    // Update questionnaire
    patient.questionnaire = questionnaire;
    
    // Mark onboarding as completed when questionnaire is submitted
    patient.hasCompletedOnboarding = true;
    
    // Save patient and send response
    try {
      await patient.save();
      await auditDatabaseOperation(req, "submit_questionnaire_save", "UPDATE", userId, { 
        questionnaireLength: questionnaire.length,
        onboardingCompleted: true 
      });
      res.status(200).json({ 
        message: "Questionnaire submitted successfully",
        questionnaire: patient.questionnaire 
      });
    } catch (saveError) {
      console.error("Error saving patient questionnaire:", saveError);
      await auditDatabaseError(req, "submit_questionnaire_save", "UPDATE", saveError, userId);
      res.status(500).json({ error: "Error saving questionnaire" });
    }
  } catch (error) {
    console.error("Error submitting questionnaire:", error);
    await auditDatabaseError(req, "submit_questionnaire", "UPDATE", error, req.user?.userId);
    res.status(500).json({ error: "Error submitting questionnaire" });
  }
};

// Get questionnaire answers
export const getQuestionnaire = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const patient = await PatientSchema.findById(userId);
    
    if (!patient) {
      await auditDatabaseError(req, "get_questionnaire", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "get_questionnaire", "READ", userId, { 
      questionnaireLength: patient.questionnaire?.length || 0 
    });

    res.status(200).json({ 
      questionnaire: patient.questionnaire || [] 
    });
  } catch (error) {
    console.error("Error fetching questionnaire:", error);
    await auditDatabaseError(req, "get_questionnaire", "READ", error, req.user?.userId);
    res.status(500).json({ error: "Error fetching questionnaire" });
  }
};

// Update specific questionnaire answers
export const updateQuestionnaire = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { updates } = req.body; // Array of {questionId, answer} updates
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!updates || !Array.isArray(updates)) {
      res.status(400).json({ error: "Invalid updates format" });
      return;
    }

    const patient = await PatientSchema.findById(userId);
    
    if (!patient) {
      await auditDatabaseError(req, "update_questionnaire", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "update_questionnaire_find_patient", "READ", userId);

    // Update specific questions
    updates.forEach((update: { questionId: string; answer: string }) => {
      const existingIndex = patient.questionnaire.findIndex(
        q => q.questionId === update.questionId
      );
      
      if (existingIndex >= 0) {
        // Update existing answer
        patient.questionnaire[existingIndex].answer = update.answer;
      } else {
        // Add new answer
        patient.questionnaire.push({
          questionId: update.questionId,
          answer: update.answer
        });
      }
    });

    await patient.save();
    await auditDatabaseOperation(req, "update_questionnaire_save", "UPDATE", userId, { 
      updatesCount: updates.length,
      questionnaireLength: patient.questionnaire.length 
    });

    res.status(200).json({ 
      message: "Questionnaire updated successfully",
      questionnaire: patient.questionnaire 
    });
  } catch (error) {
    console.error("Error updating questionnaire:", error);
    await auditDatabaseError(req, "update_questionnaire", "UPDATE", error, req.user?.userId);
    res.status(500).json({ error: "Error updating questionnaire" });
  }
};

// Add weight history entry
export const addWeightHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { weight, sideEffects, notes } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (!weight || typeof weight !== 'number') {
      res.status(400).json({ error: "Weight is required and must be a number" });
      return;
    }

    const patient = await PatientSchema.findById(userId);
    
    if (!patient) {
      await auditDatabaseError(req, "add_weight_history", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "add_weight_history_find_patient", "READ", userId);

    // Create date string in yyyy-mm-dd format (current date)
    const today = new Date();
    const dateString = today.toISOString().split('T')[0]; // yyyy-mm-dd
    const entryDate = new Date(dateString + 'T00:00:00.000Z'); // Set to midnight UTC

    // Check if entry for today already exists
    const existingEntryIndex = patient.weightHistory.findIndex(entry => {
      const entryDateString = entry.date.toISOString().split('T')[0];
      return entryDateString === dateString;
    });

    const newEntry = {
      weight,
      date: entryDate,
      sideEffects: sideEffects || undefined,
      notes: notes || undefined
    };

    if (existingEntryIndex >= 0) {
      // Override existing entry for the same date
      patient.weightHistory[existingEntryIndex] = newEntry;
      await auditDatabaseOperation(req, "add_weight_history_update_existing", "UPDATE", userId, { 
        date: dateString,
        weight,
        hadSideEffects: !!sideEffects,
        hadNotes: !!notes 
      });
    } else {
      // Add new entry
      patient.weightHistory.push(newEntry);
      await auditDatabaseOperation(req, "add_weight_history_add_new", "UPDATE", userId, { 
        date: dateString,
        weight,
        hadSideEffects: !!sideEffects,
        hadNotes: !!notes 
      });
    }

    await patient.save();
    await auditDatabaseOperation(req, "add_weight_history_save", "UPDATE", userId, { 
      totalEntries: patient.weightHistory.length 
    });

    res.status(200).json({ 
      message: "Weight history updated successfully",
      entry: newEntry
    });
  } catch (error) {
    console.error("Error adding weight history:", error);
    await auditDatabaseError(req, "add_weight_history", "UPDATE", error, req.user?.userId);
    res.status(500).json({ error: "Error adding weight history" });
  }
};

// Get weight history
export const getWeightHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      await auditDatabaseError(req, "get_weight_history", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "get_weight_history", "READ", userId, {
      entriesCount: patient.weightHistory?.length || 0
    });

    // Sort weight history by date (newest first)
    const sortedHistory = patient.weightHistory
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(entry => ({
        weight: entry.weight,
        date: entry.date.toISOString().split('T')[0], // Return as yyyy-mm-dd
        sideEffects: entry.sideEffects,
        notes: entry.notes
      }));

    res.status(200).json({
      weightHistory: sortedHistory
    });
  } catch (error) {
    console.error("Error fetching weight history:", error);
    await auditDatabaseError(req, "get_weight_history", "READ", error, req.user?.userId);
    res.status(500).json({ error: "Error fetching weight history" });
  }
};

// Update patient profile (e.g., email)
export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    const userId = req.user?.userId;
console.log("\n\n\nupdateProfile called with:", req.body);
    if (!userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      await auditDatabaseError(req, "update_profile", "READ", new Error("Patient not found"), userId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    await auditDatabaseOperation(req, "update_profile_find_patient", "READ", userId);

    // Update email if provided
    if (email !== undefined) {
      patient.email = email;
    }

    await patient.save();
    await auditDatabaseOperation(req, "update_profile_save", "UPDATE", userId, {
      emailUpdated: email !== undefined
    });

    res.status(200).json({
      message: "Profile updated successfully"
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    await auditDatabaseError(req, "update_profile", "UPDATE", error, req.user?.userId);
    res.status(500).json({ error: "Error updating profile" });
  }
};