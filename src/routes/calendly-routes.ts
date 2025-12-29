import { Router } from "express";
import express from "express";
import {
  generateSingleUseLink,
  // getDoctorMeetings,
  createPatientBookingLink,
  getPatientMeetings,
  getPatientAvailableEventTypes,
  getDoctorOwnMeetings,
  handleCalendlyWebhook,
  markMeetingComplete,
  markMeetingCompleteByEmail
} from "../controllers/calendly-controllers";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { requireAdminAuth, requireAdminRole } from "../middleware/admin-auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";

const router = Router();

// Webhook endpoint - public, no auth (uses signature verification instead)
// Must be before authenticated routes
router.post("/webhook", express.json(), handleCalendlyWebhook);

// Patient endpoints (server-side handling) - require patient auth
router.post(
  "/patient-booking",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  createPatientBookingLink
);
router.get(
  "/patient-meetings",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  getPatientMeetings
);
router.get(
  "/patient-event-types",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("patient"),
  getPatientAvailableEventTypes
);

// Admin/Doctor endpoints
router.post(
  "/single-use-link",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  generateSingleUseLink
);
router.get(
  "/doctor-own-meetings",
  requireAuth,
  auditMiddleware,
  requireCSRF,
  requireRole("doctor"),
  getDoctorOwnMeetings
);

// Admin action to mark meeting as complete
// Uses admin_token cookie (not app_token) for authentication
router.post(
  "/mark-complete/:patientId",
  requireAdminAuth,
  requireAdminRole(['admin', 'superadmin']),
  auditMiddleware,
  markMeetingComplete
);

// Admin action to mark meeting as complete by patient email
// Uses admin_token cookie (not app_token) for authentication
router.post(
  "/mark-complete-by-email",
  requireAdminAuth,
  requireAdminRole(['admin', 'superadmin']),
  auditMiddleware,
  markMeetingCompleteByEmail
);

export default router;