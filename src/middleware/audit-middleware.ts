import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import { createAuditLogger } from "../services/audit-service";


export function auditMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  // Only create audit logger if user is authenticated
  if (req.user) {
    req.auditLogger = createAuditLogger(req);
  }
  
  next();
}

// Helper function to wrap controller functions with audit logging
export function withAudit<T extends any[]>(
  controllerFn: (req: AuthenticatedRequest, res: Response, ...args: T) => Promise<void>,
  action: string,
  operation: "CREATE" | "READ" | "UPDATE" | "DELETE"
) {
  return async (req: AuthenticatedRequest, res: Response, ...args: T): Promise<void> => {
    const startTime = Date.now();
    let success = false;
    let error: any = null;
    
    try {
      await controllerFn(req, res, ...args);
      success = res.statusCode < 400;
    } catch (err) {
      error = err;
      success = false;
      throw err; // Re-throw to maintain original error handling
    } finally {
      // Log the audit event
      if (req.auditLogger) {
        const metadata = {
          responseTime: Date.now() - startTime,
          statusCode: res.statusCode,
          method: req.method,
          path: req.path
        };
        
        if (success) {
          await req.auditLogger.logSuccess(action, operation, undefined, metadata);
        } else {
          await req.auditLogger.logFailure(action, operation, error, undefined, metadata);
        }
      }
    }
  };
}

// Helper function for logging specific database operations within controllers
export async function auditDatabaseOperation(
  req: AuthenticatedRequest,
  action: string,
  operation: "CREATE" | "READ" | "UPDATE" | "DELETE",
  targetId?: string,
  metadata?: Record<string, any>
): Promise<void> {
  if (req.auditLogger) {
    await req.auditLogger.logSuccess(action, operation, targetId, metadata);
  }
}

export async function auditDatabaseError(
  req: AuthenticatedRequest,
  action: string,
  operation: "CREATE" | "READ" | "UPDATE" | "DELETE",
  error: any,
  targetId?: string,
  metadata?: Record<string, any>
): Promise<void> {
  if (req.auditLogger) {
    await req.auditLogger.logFailure(action, operation, error, targetId, metadata);
  }
}