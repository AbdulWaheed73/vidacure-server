import { Response, NextFunction } from "express";
import { verifyAppJWT } from "../services/auth-service";
import { AuthenticatedRequest } from "../types/generic-types";

export function browserDetails(req: AuthenticatedRequest, res: Response): "web" | "mobile" | "app" {
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
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  
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
 const clientType = browserDetails(req, res);
//  console.log("Client type detected in requireAuth:", clientType);
 
 // Get token based on client type
 if (clientType === "app") {
   // For mobile apps, use Bearer token from Authorization header
   token = req.headers['authorization']?.split(" ")[1];
  //  console.log("Using Bearer token for app client");
 } else {
   // For web and mobile browsers, use cookie
   token = req.cookies?.app_token;
  //  console.log("Using cookie token for web/mobile client");
 }

 if (!token) {
   res.status(401).json({ error: "Not authenticated" });
   return;
 }

 const decoded = verifyAppJWT(token);
 if (!decoded) {
   res.status(401).json({ error: "Invalid or expired token" });
   return;
 }
 
 console.log("\nAuthentication passed\n");
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

  // console.log("csrf client token: ",clientToken);

  if (!clientToken) {
    res.status(403).json({ error: "Missing CSRF token" });
    return;
  }

  // For now, just check if token exists
  // You can implement full CSRF validation later
  // console.log("\npass2\n");

  next();
}

// Role-based access control
export function requireRole(allowedRoles: string[]) {
  return (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
