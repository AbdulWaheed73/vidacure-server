import { Router } from "express";
import {
  getDoctorDashboard,
  getDoctorAppointments,
  getDoctorPrescriptions,
  getDoctorPatients,
  getPatientProfile,
  getPatientQuestionnaire,
  getDoctorProfile,
  getUnassignedPatients,
  getUnassignedPatientQuestionnaire
} from "../controllers/doctor-controllers";
import { updatePrescriptionRequestStatus } from "../controllers/prescription-controllers";
import { getPatientLabOrders } from "../controllers/lab-test-controllers";
import {
  getTreatmentJournal,
  upsertTreatmentJournal,
  getUnassignedPatientTreatmentJournal,
  upsertUnassignedPatientTreatmentJournal,
} from "../controllers/treatment-journal-controllers";

const router = Router();

// Doctor dashboard routes
router.get("/dashboard", getDoctorDashboard);
router.get("/appointments", getDoctorAppointments);
router.get("/prescriptions", getDoctorPrescriptions);
router.get("/patients", getDoctorPatients);
router.get("/patient-profile", getPatientProfile);
router.get("/patient-questionnaire", getPatientQuestionnaire);

// Unassigned patients routes
router.get("/unassigned-patients", getUnassignedPatients);
router.get("/unassigned-patient-questionnaire/:patientId", getUnassignedPatientQuestionnaire);

// Doctor profile route
router.get("/profile", getDoctorProfile);

// Prescription management routes
router.put("/prescription-requests/:requestId/status", updatePrescriptionRequestStatus);

// Lab test routes
router.get("/patient/:patientId/lab-orders", getPatientLabOrders);

// Treatment journal routes
router.get("/treatment-journal", getTreatmentJournal);
router.put("/treatment-journal", upsertTreatmentJournal);

// Treatment journal for unassigned (unsubscribed) patients
router.get("/unassigned-patient-treatment-journal/:patientId", getUnassignedPatientTreatmentJournal);
router.put("/unassigned-patient-treatment-journal/:patientId", upsertUnassignedPatientTreatmentJournal);

// Alternative routes for consistency with frontend routing
router.get("/", getDoctorDashboard); // Default dashboard route

export default router;
