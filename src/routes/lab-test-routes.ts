import { Router } from "express";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";
import { paymentRateLimiter } from "../middleware/rate-limit-middleware";
import { requireSpecificConsent } from "../middleware/consent-middleware";
import {
  getTestPackages,
  placeLabTestOrder,
  createLabTestCheckoutSession,
  getOrders,
  getOrderById,
  handleGiddirWebhook,
  forceSyncOrders,
} from "../controllers/lab-test-controllers";

const router = Router();

// Webhook — no auth, uses webhook secret verification in controller
router.post("/webhook", handleGiddirWebhook);

// Patient endpoints — protected with auth + lab test consent
const patientAuth = [requireAuth, auditMiddleware, requireCSRF, requireRole("patient"), requireSpecificConsent('lab_test_consent')];

router.get("/packages", ...patientAuth, getTestPackages);
router.post("/orders", ...patientAuth, placeLabTestOrder);
router.post("/create-checkout-session", paymentRateLimiter, ...patientAuth, createLabTestCheckoutSession);
router.post("/sync", ...patientAuth, forceSyncOrders);
router.get("/orders", ...patientAuth, getOrders);
router.get("/orders/:orderId", ...patientAuth, getOrderById);

export default router;
