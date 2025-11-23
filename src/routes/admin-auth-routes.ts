import express from "express";
import {
  initiateAdminLogin,
  handleAdminCallback,
  adminLogout,
  getCurrentAdmin,
} from "../controllers/admin-auth-controllers";
import { requireAdminAuth } from "../middleware/admin-auth-middleware";

const router = express.Router();

// Admin authentication routes - separate from regular user auth

/**
 * GET /api/admin/auth/login
 * Initiate admin login with BankID
 * Redirects to Criipto for admin authentication
 */
router.get("/login", initiateAdminLogin);

/**
 * GET /api/admin/auth/callback
 * Handle callback from BankID for admin login
 * Only checks Admin collection
 * Sets admin_token cookie on success
 */
router.get("/callback", handleAdminCallback);

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
