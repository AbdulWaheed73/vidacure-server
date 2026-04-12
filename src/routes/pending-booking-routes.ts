import { Router } from "express";
import { getMeetingStatus } from "../controllers/pending-booking-controllers";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";

const router = Router();

router.get(
  "/meeting-status",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  getMeetingStatus
);

export default router;
