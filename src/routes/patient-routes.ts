import { Router } from "express";
import {
  getAllPatients,
  submitQuestionnaire,
  getQuestionnaire,
  updateQuestionnaire,
  addWeightHistory,
  getWeightHistory,
  getProfile,
  updateProfile,
  getAccessLog
} from "../controllers/patient-controllers";
import { getPatientTreatmentJournal } from "../controllers/treatment-journal-controllers";

const router = Router();

// Patient management routes
router.get("/", getAllPatients);

// Questionnaire routes
router.post("/questionnaire", submitQuestionnaire);
router.get("/questionnaire", getQuestionnaire);
router.patch("/questionnaire", updateQuestionnaire);

// Weight history routes
router.post("/weight-history", addWeightHistory);
router.get("/weight-history", getWeightHistory);

// Profile routes
router.get("/profile", getProfile);
router.patch("/profile", updateProfile);

// Access log (loggutdrag) - PDL Ch. 8
router.get("/access-log", getAccessLog);

// Treatment journal (read-only for patient)
router.get("/treatment-journal", getPatientTreatmentJournal);

export default router;