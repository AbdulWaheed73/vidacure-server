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