import { Router } from "express";
import {
  createPendingSession,
  getPendingSession,
  linkBookingToUser,
  getMeetingStatus,
} from "../controllers/pending-booking-controllers";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";
import { pendingSessionRateLimiter, sessionLookupRateLimiter } from "../middleware/rate-limit-middleware";

const router = Router();

// Public routes (no auth required) - for pre-login flow
// Rate limited to prevent abuse
router.post("/session", pendingSessionRateLimiter, createPendingSession);
router.get("/session/:token", sessionLookupRateLimiter, getPendingSession);

// Protected routes (auth required)
router.post(
  "/link",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  linkBookingToUser
);

router.get(
  "/meeting-status",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  getMeetingStatus
);

export default router;
