import express from "express";
import { requireAdminAuth, requireAdminRole } from "../middleware/admin-auth-middleware";
import {
  getDashboardStats,
  getAllPatients,
  getAllDoctors,
  reassignDoctor,
  getUnassignedPatients,
  getPatientSubscriptionDetails,
  checkSSN,
  convertPatientToDoctor,
  addDoctor,
  addProvider,
  getAllProviders,
  updateProvider,
  deactivateProvider,
  assignProviderToPatient,
  unassignProviderFromPatient,
  setProviderTierOverride,
  removeProviderTierOverride,
  getPatientProviderTiers,
  calendlyLookup,
} from "../controllers/admin-controllers";

const router = express.Router();

// All admin routes require admin authentication (admin_token)
// Regular user tokens (app_token) are rejected
router.use(requireAdminAuth);
router.use(requireAdminRole(['admin', 'superadmin']));

// Dashboard statistics
router.get("/dashboard", getDashboardStats);

// Get all patients with pagination
router.get("/patients", getAllPatients);

// Get detailed subscription information for a specific patient
router.get("/patients/:patientId/subscription-details", getPatientSubscriptionDetails);

// Get unassigned patients
router.get("/unassigned-patients", getUnassignedPatients);

// Get all doctors with patient details
router.get("/doctors", getAllDoctors);

// Reassign patient to new doctor
router.post("/reassign-doctor", reassignDoctor);

// Check SSN availability
router.post("/check-ssn", checkSSN);

// Convert patient to doctor
router.post("/convert-patient-to-doctor", convertPatientToDoctor);

// Add new doctor
router.post("/add-doctor", addDoctor);

// Provider management
router.post("/providers", addProvider);
router.get("/providers", getAllProviders);
router.put("/providers/:providerId", updateProvider);
router.delete("/providers/:providerId", deactivateProvider);
router.post("/assign-provider", assignProviderToPatient);
router.post("/unassign-provider", unassignProviderFromPatient);

// Provider tier overrides
router.post("/provider-tier-override", setProviderTierOverride);
router.post("/remove-provider-tier-override", removeProviderTierOverride);
router.get("/patients/:patientId/provider-tiers", getPatientProviderTiers);

// Calendly lookup
router.post("/calendly-lookup", calendlyLookup);

// Legacy route - kept for backwards compatibility
router.get("/users", (req, res) => {
  res.json({
    message: "Admin access granted. Use /api/admin/patients or /api/admin/doctors instead",
    users: []
  });
});

export default router;
