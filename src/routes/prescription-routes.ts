import { Router } from "express";
import {
  createPrescriptionRequest,
  getPrescriptionRequests
} from "../controllers/prescription-controllers";
import { blockPastDueSubscription } from "../middleware/auth-middleware";

const router = Router();

// Prescription request routes
router.post("/requests", blockPastDueSubscription, createPrescriptionRequest);
router.get("/requests", getPrescriptionRequests);

export default router;