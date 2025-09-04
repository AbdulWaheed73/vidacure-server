import { Request, Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { AuthenticatedRequest } from "../types/generic-types";

export const getAllPatients = async (req: Request, res: Response): Promise<void> => {
    try {
      const patients = await PatientSchema.find().select('name given_name family_name role ssnHash lastLogin createdAt');
      res.status(200).json(patients);
    } catch {
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
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    // Update questionnaire
    patient.questionnaire = questionnaire;
    
    // Mark onboarding as completed when questionnaire is submitted
    patient.hasCompletedOnboarding = true;
    
    // Save patient and send response
    try {
      await patient.save();
      res.status(200).json({ 
        message: "Questionnaire submitted successfully",
        questionnaire: patient.questionnaire 
      });
    } catch (saveError) {
      console.error("Error saving patient questionnaire:", saveError);
      res.status(500).json({ error: "Error saving questionnaire" });
    }
  } catch (error) {
    console.error("Error submitting questionnaire:", error);
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
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    res.status(200).json({ 
      questionnaire: patient.questionnaire || [] 
    });
  } catch (error) {
    console.error("Error fetching questionnaire:", error);
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
      res.status(404).json({ error: "Patient not found" });
      return;
    }

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

    res.status(200).json({ 
      message: "Questionnaire updated successfully",
      questionnaire: patient.questionnaire 
    });
  } catch (error) {
    console.error("Error updating questionnaire:", error);
    res.status(500).json({ error: "Error updating questionnaire" });
  }
};