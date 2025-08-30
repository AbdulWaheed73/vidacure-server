import { Router } from "express";
import { 
  getAllPatients, 
  submitQuestionnaire, 
  getQuestionnaire, 
  updateQuestionnaire 
} from "../controllers/patient-controllers";

const router = Router();

// Patient management routes
router.get("/", getAllPatients);

// Questionnaire routes
router.post("/questionnaire", submitQuestionnaire);
router.get("/questionnaire", getQuestionnaire);
router.patch("/questionnaire", updateQuestionnaire);

export default router;