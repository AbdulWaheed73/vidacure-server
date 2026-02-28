import { Router } from "express";
import {
  getMyProviders,
  getProviderDetail,
  createProviderBookingLink,
  getMyProviderMeetings,
} from "../controllers/provider-controllers";

const router = Router();

// All routes require patient auth (applied at mount level in server.ts)

// Get all active providers (universal visibility)
router.get("/my", getMyProviders);

// Get patient's provider meetings
router.get("/meetings/my", getMyProviderMeetings);

// Get provider detail
router.get("/:providerId", getProviderDetail);

// Generate booking link for a provider
router.post("/booking-link", createProviderBookingLink);

export default router;
