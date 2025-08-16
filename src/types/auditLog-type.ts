import { Types } from "mongoose";

export type AuditLogT = {
  userId: Types.ObjectId;
  role: "patient" | "doctor" | "admin";
  action: string;
  targetId?: Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
};