import { Types } from "mongoose";
import AuditLogSchema from "../schemas/auditLog-schema";
import { AuditLogT } from "../types/auditLog-type";
import { AuthenticatedRequest } from "../types/generic-types";
import type { AuditLogData } from "../types/audit-types";

export function extractIpAddress(req: AuthenticatedRequest): string {
  // Check for IP from various headers in order of preference
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const clientIp = req.headers['x-client-ip'];
  const forwarded2 = req.headers['forwarded'];
  
  // Handle x-forwarded-for which can contain multiple IPs
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const firstIp = ips.split(',')[0].trim();
    return firstIp;
  }
  
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  
  if (clientIp) {
    return Array.isArray(clientIp) ? clientIp[0] : clientIp;
  }
  
  if (forwarded2) {
    const forwardedValue = Array.isArray(forwarded2) ? forwarded2[0] : forwarded2;
    const match = forwardedValue.match(/for=([^;]+)/);
    if (match) {
      return match[1];
    }
  }
  
  // Fall back to connection remote address
  return req.connection?.remoteAddress || 
         req.socket?.remoteAddress || 
         (req as any).ip || 
         'unknown';
}

export async function logAuditEvent(data: AuditLogData): Promise<void> {
  try {
    const auditLog = new AuditLogSchema({
      userId: new Types.ObjectId(data.userId),
      role: data.role,
      action: data.action,
      operation: data.operation,
      success: data.success,
      targetId: data.targetId ? new Types.ObjectId(data.targetId) : undefined,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      timestamp: new Date(),
      metadata: data.metadata
    });

    // Save asynchronously without blocking
    await auditLog.save();
  } catch (error) {
    // Log error but don't throw to avoid disrupting main application flow
    console.error('Failed to log audit event:', error);
  }
}

export function createAuditLogger(req: AuthenticatedRequest) {
  const ipAddress = extractIpAddress(req);
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  return {
    logSuccess: async (action: string, operation: "CREATE" | "READ" | "UPDATE" | "DELETE", targetId?: string, metadata?: Record<string, any>) => {
      if (!req.user) return;
      
      await logAuditEvent({
        userId: req.user.userId,
        role: req.user.role as "patient" | "doctor" | "admin",
        action,
        operation,
        success: true,
        targetId,
        ipAddress,
        userAgent,
        metadata
      });
    },
    
    logFailure: async (action: string, operation: "CREATE" | "READ" | "UPDATE" | "DELETE", error: any, targetId?: string, metadata?: Record<string, any>) => {
      if (!req.user) return;
      
      await logAuditEvent({
        userId: req.user.userId,
        role: req.user.role as "patient" | "doctor" | "admin",
        action,
        operation,
        success: false,
        targetId,
        ipAddress,
        userAgent,
        metadata: {
          ...metadata,
          error: error?.message || String(error)
        }
      });
    }
  };
}