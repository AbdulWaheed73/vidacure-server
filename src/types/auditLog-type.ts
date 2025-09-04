import { Types } from "mongoose";

export type AuditLogT = {
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
};