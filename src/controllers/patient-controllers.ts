import { Request, Response } from "express";
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