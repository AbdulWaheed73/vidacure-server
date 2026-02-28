import { Types } from "mongoose";
import crypto from "crypto";
import AuditLogSchema from "../schemas/auditLog-schema";
import { AuditLogT } from "../types/auditLog-type";
import { AuthenticatedRequest } from "../types/generic-types";
import type { AuditLogData } from "../types/audit-types";

const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || '';

/**
 * Generate an integrity hash for an audit log entry (tamper detection)
 */
function generateIntegrityHash(data: AuditLogData, timestamp: Date): string {
  if (!AUDIT_HMAC_KEY) return '';
  const payload = JSON.stringify({
    userId: data.userId,
    action: data.action,
    operation: data.operation,
    success: data.success,
    targetId: data.targetId,
    timestamp: timestamp.toISOString(),
  });
  return crypto.createHmac('sha256', AUDIT_HMAC_KEY).update(payload).digest('hex');
}

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
  const timestamp = new Date();
  try {
    const integrityHash = generateIntegrityHash(data, timestamp);

    const auditLog = new AuditLogSchema({
      userId: new Types.ObjectId(data.userId),
      role: data.role,
      action: data.action,
      operation: data.operation,
      success: data.success,
      targetId: data.targetId ? new Types.ObjectId(data.targetId) : undefined,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      timestamp,
      metadata: data.metadata,
      ...(integrityHash && { integrityHash }),
    });

    await auditLog.save();
  } catch (error) {
    // Fallback: write to stderr so it's captured by log aggregation
    // PDL requires audit events to not be silently lost
    console.error('CRITICAL: Failed to log audit event:', {
      action: data.action,
      userId: data.userId,
      targetId: data.targetId,
      timestamp: timestamp.toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
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