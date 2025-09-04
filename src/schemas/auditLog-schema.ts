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
  metadata: { type: Object }
});

export default mongoose.model<AuditLogT & Document>("AuditLog", AuditLogSchema);
