import { Response, NextFunction } from "express";
import { verifyAppJWT } from "../services/auth-service";
import { AuthenticatedRequest } from "../types/generic-types";
import PatientSchema from "../schemas/patient-schema";


export function browserDetails(
  req: AuthenticatedRequest,
): "web" | "mobile" | "app" {
  // First check the x-client header
  const clientToken = req.headers["x-client"] as string;
  // console.log("x-client header:", clientToken);

  if (clientToken === "web") {
    return "web";
  } else if (clientToken === "mobile") {
    return "mobile";
  } else if (clientToken === "app") {
    return "app";
  }

  // If no header, try to detect from User-Agent
  const userAgent = req.headers["user-agent"] || "";
  // console.log("User-Agent:", userAgent);

  // Check if it's a mobile device
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent
    );

  if (isMobile) {
    return "mobile";
  } else {
    return "web";
  }
}

// Authentication middleware
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  let token: string | undefined;

  // Determine client type
  const clientType = browserDetails(req);

  // Get token based on client type
  if (clientType === "app") {
    // For mobile apps, use Bearer token from Authorization header
    token = req.headers["authorization"]?.split(" ")[1];
  } else {
    // For web and mobile browsers, use cookie
    token = req.cookies?.app_token;
  }

  if (!token) {
    res.status(401).json({
      error: "Not authenticated",
    });
    return;
  }

  const decoded = verifyAppJWT(token);
  if (!decoded) {
    res.status(401).json({
      error: "Invalid or expired token",
    });
    return;
  }

  req.user = decoded;
  next();
}

// CSRF protection middleware (simplified - you can implement full CSRF protection later)
export async function requireCSRF(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // CSRF only applies to cookie-authenticated requests. The mobile app
  // authenticates via Authorization: Bearer and sends no app_token cookie, so it
  // is not exposed to CSRF and is skipped here. Gating on the actual auth cookie
  // (rather than the client-asserted, spoofable x-client header) closes the
  // header-based CSRF bypass: a cross-site request riding the victim's app_token
  // cookie can no longer skip the check by sending x-client: app.
  if (!req.cookies?.app_token) {
    next();
    return;
  }

  const clientToken = req.headers["x-csrf-token"] as string;
  const csrf = req.cookies?.csrf_token as string;

  if (!clientToken) {
    res.status(403).json({ error: "Missing CSRF token" });
    return;
  } else if (clientToken !== csrf) {
    res.status(401).json({ error: "Wrong CSRF token" });
    return;
  }

  next();
}

// Role-based access control
export function requireRole(allowedRoles: string | string[]) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    // console.log("\n\n\nroleeeewewewewew: ", req?.user?.role, "\n\n\n")

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const userRole = req?.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

// Subscription validation middleware
export async function requireActiveSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Skip subscription check for doctors
  if (req.user.role === "doctor") {
    next();
    return;
  }

  // For patients, verify active subscription
  if (req.user.role === "patient") {
    try {
      const patient = await PatientSchema.findById(req.user.userId)
        .select("subscription.status")
        .lean();

      if (!patient) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }

      const validStatuses = ["active", "trialing", "past_due"];
      const subscriptionStatus = patient.subscription?.status;

      if (!subscriptionStatus || !validStatuses.includes(subscriptionStatus)) {
        res.status(403).json({
          error: "Subscription required",
          message: "An active subscription is required to access this feature",
        });
        return;
      }

      next();
    } catch (error) {
      console.error("❌ Error checking subscription status:", error);
      res.status(500).json({ error: "Failed to verify subscription status" });
      return;
    }
  } else {
    // For any other roles (admin, superadmin, etc.), skip subscription check
    next();
  }
}

// Blocks mutating actions (e.g. creating a prescription request) when a patient's
// subscription payment is past due. Unlike requireActiveSubscription, this is meant to
// be attached to specific mutation routes only, so reads (e.g. prescription history)
// remain accessible during the grace period.
export async function blockPastDueSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Only patients have subscriptions; let other roles through.
  if (req.user.role !== "patient") {
    next();
    return;
  }

  try {
    const patient = await PatientSchema.findById(req.user.userId)
      .select("subscription.status")
      .lean();

    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    if (patient.subscription?.status === "past_due") {
      res.status(403).json({
        error: "subscription_past_due",
        message:
          "Your subscription payment is past due. Please update your billing to request a prescription.",
      });
      return;
    }

    next();
  } catch (error) {
    console.error("❌ Error checking past due subscription status:", error);
    res.status(500).json({ error: "Failed to verify subscription status" });
    return;
  }
}

// Combined middleware for doctor-only access
// export function requireDoctor(
//   req: AuthenticatedRequest,
//   res: Response,
//   next: NextFunction
// ): void {
//   // First check authentication
//   requireAuth(req, res, () => {
//     // Then check CSRF (if needed)
//     requireCSRF(req, res, () => {
//       // Finally check doctor role
//       const roleCheck = requireRole(['doctor']);
//       roleCheck(req, res, next);
//     });
//   });
// }
