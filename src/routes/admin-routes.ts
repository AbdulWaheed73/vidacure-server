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
  setProviderTierOverride,
  removeProviderTierOverride,
  getPatientProviderTiers,
  calendlyLookup,
  getAuditLogs,
  getAuditAnomalies,
  createLogReview,
  getLogReviews,
  getLogReviewById,
  resolveLogReview,
  createPromotion,
  listPromotions,
  deactivatePromotion,
  getSubscriptionProducts,
  sendPaymentFailedEmailManual,
} from "../controllers/admin-controllers";
import {
  listSuggestions,
  deleteSuggestion,
} from "../controllers/suggestion-controllers";

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

// Manually send the "payment failed" email to a patient
router.post("/patients/:patientId/send-payment-failed-email", sendPaymentFailedEmailManual);

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
// Provider tier overrides
router.post("/provider-tier-override", setProviderTierOverride);
router.post("/remove-provider-tier-override", removeProviderTierOverride);
router.get("/patients/:patientId/provider-tiers", getPatientProviderTiers);

// Promotion / Coupon management
router.post("/promotions", createPromotion);
router.get("/promotions", listPromotions);
router.post("/promotions/:promoCodeId/deactivate", deactivatePromotion);
router.get("/subscription-products", getSubscriptionProducts);

// Calendly lookup
router.post("/calendly-lookup", calendlyLookup);

// Audit log review (PDL compliance - systematic log reviews)
router.get("/audit-logs", getAuditLogs);
router.get("/audit-logs/anomalies", getAuditAnomalies);
// Recorded loggkontroll review records (literal /reviews before :id param)
router.post("/audit-logs/reviews", createLogReview);
router.get("/audit-logs/reviews", getLogReviews);
router.get("/audit-logs/reviews/:id", getLogReviewById);
router.patch("/audit-logs/reviews/:id/resolve", resolveLogReview);

// Platform improvement suggestions — superadmin-only
router.get("/suggestions", requireAdminRole(['admin']), listSuggestions);
router.delete("/suggestions/:id", requireAdminRole(['admin']), deleteSuggestion);

// Legacy route - kept for backwards compatibility
router.get("/users", (req, res) => {
  res.json({
    message: "Admin access granted. Use /api/admin/patients or /api/admin/doctors instead",
    users: []
  });
});

export default router;
