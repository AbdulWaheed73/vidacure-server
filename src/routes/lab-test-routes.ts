import { Router } from "express";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";
import {
  getTestPackages,
  placeLabTestOrder,
  getOrders,
  getOrderById,
  handleGiddirWebhook,
} from "../controllers/lab-test-controllers";

const router = Router();

// Webhook — no auth, uses webhook secret verification in controller
router.post("/webhook", handleGiddirWebhook);

// Patient endpoints — protected with auth middleware
const patientAuth = [requireAuth, auditMiddleware, requireCSRF, requireRole("patient")];

router.get("/packages", ...patientAuth, getTestPackages);
router.post("/orders", ...patientAuth, placeLabTestOrder);
router.get("/orders", ...patientAuth, getOrders);
router.get("/orders/:orderId", ...patientAuth, getOrderById);

export default router;
