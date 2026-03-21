import { Types } from "mongoose";

export type AuditLogData = {
  userId: string;
  role: "patient" | "doctor" | "admin";
  action: string;
  operation: "CREATE" | "READ" | "UPDATE" | "DELETE";
  success: boolean;
  targetId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
};

export type BufferedAuditEntry = {
  userId: Types.ObjectId;
  role: "patient" | "doctor" | "admin";
  action: string;
  operation: "CREATE" | "READ" | "UPDATE" | "DELETE";
  success: boolean;
  targetId?: Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  integrityHash?: string;
};