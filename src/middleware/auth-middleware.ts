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
  const clientToken = req.headers["x-csrf-token"] as string;
  const csrf = req.cookies?.csrf_token as string;
  const clientType = browserDetails(req);

  if (clientType === "app") {
    next();
    return;
  }
  if (!clientToken) {
    res.status(403).json({ error: "Missing CSRF token" });
    return;
  }
  else if (clientToken !== csrf)
  {
    res.status(401).json({error: "Wrong CSRF token"});
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
