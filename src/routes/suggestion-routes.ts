import express from "express";
import { createSuggestion } from "../controllers/suggestion-controllers";

const router = express.Router();

// POST /  — submit a suggestion (mounted under /api/patient/suggestions and /api/doctor/suggestions)
router.post("/", createSuggestion);

export default router;
