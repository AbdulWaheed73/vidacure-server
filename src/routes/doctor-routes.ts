import { Router } from "express";
import {
  getDoctorDashboard,
  getDoctorAppointments,
  getDoctorPrescriptions,
  // getDoctorInbox,
  getDoctorPatients,
  getPatientProfile,
  getDoctorProfile
} from "../controllers/doctor-controllers";
import { updatePrescriptionRequestStatus } from "../controllers/prescription-controllers";
import { getPatientLabOrders } from "../controllers/lab-test-controllers";

const router = Router();

// Doctor dashboard routes
router.get("/dashboard", getDoctorDashboard);
router.get("/appointments", getDoctorAppointments);
router.get("/prescriptions", getDoctorPrescriptions);
// router.get("/inbox", getDoctorInbox);
router.get("/patients", getDoctorPatients);
router.get("/patient-profile", getPatientProfile);

// Doctor profile route
router.get("/profile", getDoctorProfile);

// Prescription management routes
router.put("/prescription-requests/:requestId/status", updatePrescriptionRequestStatus);

// Lab test routes
router.get("/patient/:patientId/lab-orders", getPatientLabOrders);

// Alternative routes for consistency with frontend routing
router.get("/", getDoctorDashboard); // Default dashboard route

export default router;
