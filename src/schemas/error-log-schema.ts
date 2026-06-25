import mongoose, { Schema, Document, Types } from "mongoose";
import {
  ErrorLogT,
  ERROR_ORIGINS,
  ERROR_SOURCES,
  ERROR_LEVELS,
  ERROR_ACTORS,
  ERROR_CATEGORIES,
} from "../types/error-log-types";

// Error/crash log. Separate from AuditLog (which requires a real userId + PDL HMAC):
// failures here often happen pre-auth, so userId is optional and there is no integrity hash.
const ErrorLogContextSchema = new Schema(
  {
    route: { type: String },
    method: { type: String },
    statusCode: { type: Number },
    appVersion: { type: String },
    componentStack: { type: String },
    details: { type: String },
  },
  { _id: false }
);

const ErrorLogSchema: Schema = new Schema({
  origin: { type: String, enum: [...ERROR_ORIGINS], required: true },
  source: { type: String, enum: [...ERROR_SOURCES], required: true },
  level: { type: String, enum: [...ERROR_LEVELS], required: true },
  category: { type: String, enum: [...ERROR_CATEGORIES], required: true },
  message: { type: String, required: true },
  stack: { type: String },
  route: { type: String },
  method: { type: String },
  statusCode: { type: Number },
  actorType: { type: String, enum: [...ERROR_ACTORS], required: true },
  userId: { type: Types.ObjectId },
  ipAddress: { type: String },
  userAgent: { type: String },
  fingerprint: { type: String, required: true },
  context: { type: ErrorLogContextSchema },
  resolved: { type: Boolean, default: false },
  resolvedAt: { type: Date },
  resolvedBy: { type: Types.ObjectId },
  timestamp: { type: Date, default: Date.now },
});

// Read paths.
ErrorLogSchema.index({ timestamp: -1 });                          // chronological list
ErrorLogSchema.index({ resolved: 1, level: 1, timestamp: -1 });   // triage queue
ErrorLogSchema.index({ category: 1, timestamp: -1 });             // category filter
ErrorLogSchema.index({ fingerprint: 1, timestamp: -1 });          // grouping / summary
// 90-day TTL — error logs are operational, not legally mandated like audit logs.
ErrorLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

export default mongoose.model<ErrorLogT & Document>("ErrorLog", ErrorLogSchema);
