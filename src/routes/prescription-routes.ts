import { Router } from "express";
import {
  createPrescriptionRequest,
  getPrescriptionRequests
} from "../controllers/prescription-controllers";

const router = Router();

// Prescription request routes
router.post("/requests", createPrescriptionRequest);
router.get("/requests", getPrescriptionRequests);

export default router;