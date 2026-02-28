import mongoose, { Schema, Document, Types } from "mongoose";
import { AuditLogT } from "../types/auditLog-type";



const AuditLogSchema: Schema = new Schema({
  userId: { type: Types.ObjectId, required: true },
  role: { type: String, enum: ["patient", "doctor", "admin"], required: true },
  action: { type: String, required: true },
  operation: { type: String, enum: ["CREATE", "READ", "UPDATE", "DELETE"], required: true },
  success: { type: Boolean, required: true },
  targetId: { type: Types.ObjectId },
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now },
  metadata: { type: Object },
  integrityHash: { type: String },
});

// PDL-compliant indexes for log extracts and reviews
AuditLogSchema.index({ targetId: 1, timestamp: -1 }); // Patient log extracts (loggutdrag)
AuditLogSchema.index({ userId: 1, timestamp: -1 });    // User access review
AuditLogSchema.index({ timestamp: -1 });                // Chronological review
AuditLogSchema.index({ action: 1, success: 1, timestamp: -1 }); // Anomaly detection

export default mongoose.model<AuditLogT & Document>("AuditLog", AuditLogSchema);
