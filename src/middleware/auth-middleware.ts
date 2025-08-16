import { Response, NextFunction } from "express";
import { verifyAppJWT } from "../services/auth-service";
import { AuthenticatedRequest } from "../types/generic-types";

// Authentication middleware
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.app_token;
  
  if (!token) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  
  const decoded = verifyAppJWT(token);
  if (!decoded) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  console.log("\npass1\n");
  req.user = decoded;
  next();
}

// CSRF protection middleware (simplified - you can implement full CSRF protection later)
export async function requireCSRF(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  // if (req.method === 'GET') {
  // console.log("\npass2\n");

  //   next();
  //   return;
  // }
  
  const clientToken = req.headers['x-csrf-token'] as string;
  
  if (!clientToken) {
    res.status(403).json({ error: "Missing CSRF token" });
    return;
  }
  
  // For now, just check if token exists
  // You can implement full CSRF validation later
  console.log("\npass2\n");

  next();
}

// Role-based access control
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
