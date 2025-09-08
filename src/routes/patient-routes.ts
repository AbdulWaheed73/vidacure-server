import { Router } from "express";
import { 
  getAllPatients, 
  submitQuestionnaire, 
  getQuestionnaire, 
  updateQuestionnaire,
  addWeightHistory,
  getWeightHistory 
} from "../controllers/patient-controllers";

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

export default router;