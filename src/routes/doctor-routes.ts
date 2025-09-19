import { Router } from "express";
import {
  getDoctorDashboard,
  getDoctorAppointments,
  getDoctorPrescriptions,
  getDoctorInbox
} from "../controllers/doctor-controllers";
import { updatePrescriptionRequestStatus } from "../controllers/prescription-controllers";

const router = Router();

// Doctor dashboard routes
router.get("/dashboard", getDoctorDashboard);
router.get("/appointments", getDoctorAppointments);
router.get("/prescriptions", getDoctorPrescriptions);
router.get("/inbox", getDoctorInbox);

// Prescription management routes
router.put("/prescription-requests/:requestId/status", updatePrescriptionRequestStatus);

// Alternative routes for consistency with frontend routing
router.get("/", getDoctorDashboard); // Default dashboard route

export default router;