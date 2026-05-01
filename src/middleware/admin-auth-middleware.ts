import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAdminJWT, AdminJWTPayload } from "../services/admin-auth-service";

// Extend Request to include admin user
export interface AdminAuthenticatedRequest extends Request {
  admin?: AdminJWTPayload;
}

/**
 * Admin authentication middleware
 * ONLY accepts admin_token cookie
 * REJECTS regular app_token cookie
 * Ensures complete separation between admin and regular user access
 */
export function requireAdminAuth(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    // Get admin token from cookie
    const adminToken = req.cookies.admin_token;

    // CRITICAL: Check if regular user token is being used
    const regularToken = req.cookies.app_token;
    if (regularToken && !adminToken) {
      console.log("❌ Regular user token detected for admin route - BLOCKED");
      res.status(403).json({
        error: "Access denied",
        message: "Admin credentials required. Regular user tokens are not accepted.",
      });
      return;
    }

    if (!adminToken) {
      console.log("❌ No admin token provided");
      res.status(401).json({
        error: "Authentication required",
        message: "Admin authentication required. Please log in at /admin/login",
      });
      return;
    }

    // CRITICAL: Reject pending 2FA tokens before full verification
    try {
      const raw = jwt.decode(adminToken) as Record<string, unknown> | null;
      if (raw && raw.isPending2FA) {
        console.log("❌ Pending 2FA token used for admin route - BLOCKED");
        res.status(401).json({
          error: "2FA verification required",
          message: "Please complete two-factor authentication before accessing admin routes.",
        });
        return;
      }
    } catch {
      // If decode fails, verifyAdminJWT below will catch it
    }

    // Verify admin JWT
    const decoded = verifyAdminJWT(adminToken);

    if (!decoded) {
      console.log("❌ Invalid or expired admin token");
      res.status(401).json({
        error: "Invalid authentication",
        message: "Admin token is invalid or expired. Please log in again.",
      });
      return;
    }

    // CRITICAL: Double-check isAdmin flag
    if (!decoded.isAdmin) {
      console.log("❌ Token without admin flag used for admin route - BLOCKED");
      res.status(403).json({
        error: "Access denied",
        message: "Admin credentials required.",
      });
      return;
    }

    // Attach admin user to request
    req.admin = decoded;

    // console.log("✅ Admin authenticated:", {
    //   userId: decoded.userId,
    //   role: decoded.role,
    // });

    next();
  } catch (error) {
    console.error("❌ Admin auth middleware error:", error);
    res.status(500).json({
      error: "Authentication error",
      message: "Failed to authenticate admin user",
    });
  }
}

/**
 * Admin role-based access control
 * Checks if admin has specific role (admin or superadmin)
 */
export function requireAdminRole(allowedRoles: string | string[]) {
  return (
    req: AdminAuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const adminRole = req.admin?.role;

    if (!adminRole || !roles.includes(adminRole)) {
      console.log("❌ Admin insufficient permissions:", {
        required: roles,
        actual: adminRole,
      });
      res.status(403).json({
        error: "Insufficient permissions",
        message: `This action requires one of the following roles: ${roles.join(", ")}`,
      });
      return;
    }

    next();
  };
}

/**
 * Admin CSRF protection (double-submit cookie).
 * Compares admin_csrf_token cookie with x-csrf-token header.
 * The admin token is issued by adminLogin / verifyAdmin2FA / confirmAdmin2FA.
 * Admin sessions are cookie-only (no mobile Bearer flow), so no client-type bypass.
 */
export function requireAdminCSRF(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const headerToken = req.headers["x-csrf-token"] as string | undefined;
  const cookieToken = req.cookies?.admin_csrf_token as string | undefined;

  if (!headerToken || !cookieToken) {
    res.status(403).json({ error: "Missing CSRF token" });
    return;
  }
  if (headerToken !== cookieToken) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }
  next();
}

/**
 * Optional admin authentication
 * Does not require admin authentication, but attaches admin user if authenticated
 */
export function optionalAdminAuth(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const adminToken = req.cookies.admin_token;

    if (adminToken) {
      const decoded = verifyAdminJWT(adminToken);
      if (decoded && decoded.isAdmin) {
        req.admin = decoded;
      }
    }
    else{
      console.log("no admin found !!!");
      return;
    }

    next();
  } catch {
    // Silently fail - this is optional auth
    next();
  }
}
