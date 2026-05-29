import mongoose, { Schema, Document, Types } from "mongoose";
import {
  LogReviewT,
  LOG_REVIEW_OUTCOMES,
  LOG_REVIEW_STATUSES,
  LOG_REVIEW_PARAMETERS,
} from "../types/log-review-type";

const LogReviewSchema: Schema = new Schema({
  reviewedBy: { type: Types.ObjectId, ref: "Admin", required: true },
  reviewerName: { type: String, required: true },
  periodFrom: { type: Date, required: true },
  periodTo: { type: Date, required: true },
  parametersReviewed: { type: [String], enum: [...LOG_REVIEW_PARAMETERS], default: [] },
  outcome: { type: String, enum: [...LOG_REVIEW_OUTCOMES], required: true },
  notes: { type: String },
  flaggedEntries: { type: [Types.ObjectId], default: undefined },
  anomalySnapshot: { type: Object },
  status: { type: String, enum: [...LOG_REVIEW_STATUSES], default: "open" },
  resolvedBy: { type: Types.ObjectId, ref: "Admin" },
  resolvedAt: { type: Date },
  resolutionNotes: { type: String },
  createdAt: { type: Date, default: Date.now },
  integrityHash: { type: String },
});

// Compliance record — retained, NO TTL.
LogReviewSchema.index({ reviewedBy: 1, createdAt: -1 });
LogReviewSchema.index({ status: 1, createdAt: -1 });
LogReviewSchema.index({ periodFrom: 1, periodTo: 1 });

export default mongoose.model<LogReviewT & Document>("LogReview", LogReviewSchema);
