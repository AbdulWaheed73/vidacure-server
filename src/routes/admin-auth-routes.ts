import express from "express";
import {
  adminLogin,
  verifyAdmin2FA,
  setupAdmin2FA,
  confirmAdmin2FA,
  adminLogout,
  getCurrentAdmin,
} from "../controllers/admin-auth-controllers";
import { requireAdminAuth } from "../middleware/admin-auth-middleware";
import { createRateLimiter } from "../middleware/rate-limit-middleware";

const router = express.Router();

// Rate limiter for admin auth endpoints: 10 attempts per 15 minutes per IP
const adminAuthRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  keyGenerator: (req) => `admin-login:${req.ip}`,
});

/**
 * POST /api/admin/auth/login
 * Phase 1: Email + password → pending 2FA token
 */
router.post("/login", adminAuthRateLimiter, adminLogin);

/**
 * POST /api/admin/auth/verify-2fa
 * Phase 2: Pending token + TOTP code → full admin session
 */
router.post("/verify-2fa", adminAuthRateLimiter, verifyAdmin2FA);

/**
 * POST /api/admin/auth/setup-2fa
 * Generate TOTP secret and QR code for first-time setup
 */
router.post("/setup-2fa", adminAuthRateLimiter, setupAdmin2FA);

/**
 * POST /api/admin/auth/confirm-2fa
 * Confirm TOTP setup with a valid code
 */
router.post("/confirm-2fa", adminAuthRateLimiter, confirmAdmin2FA);

/**
 * POST /api/admin/auth/logout
 * Admin logout - clears admin_token and admin_csrf_token cookies
 */
router.post("/logout", adminLogout);

/**
 * GET /api/admin/auth/me
 * Get current admin user info
 * Requires admin authentication
 */
router.get("/me", requireAdminAuth, getCurrentAdmin);

export default router;
