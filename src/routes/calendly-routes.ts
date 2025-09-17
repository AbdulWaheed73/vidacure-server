import { Router } from "express";
import {
  generateSingleUseLink,
  // getDoctorMeetings,
  createPatientBookingLink,
  getPatientMeetings,
  getPatientAvailableEventTypes,
  getDoctorOwnMeetings
} from "../controllers/calendly-controllers";

const router = Router();

// Patient endpoints (server-side handling)
router.post("/patient-booking", createPatientBookingLink);
router.get("/patient-meetings", getPatientMeetings);
router.get("/patient-event-types", getPatientAvailableEventTypes);

// Admin/Doctor endpoints
router.post("/single-use-link", generateSingleUseLink);
// router.get("/doctor-meetings/:email", getDoctorMeetings);
router.get("/doctor-own-meetings", getDoctorOwnMeetings);

export default router;