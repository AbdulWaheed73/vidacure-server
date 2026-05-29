import { Types } from "mongoose";

// Single source of truth: runtime arrays feed both the union types below and the
// Mongoose schema enums (TS unions don't exist at runtime).
export const LOG_REVIEW_OUTCOMES = ["clean", "flagged", "escalated"] as const;
export const LOG_REVIEW_STATUSES = ["open", "resolved"] as const;
export const LOG_REVIEW_PARAMETERS = [
  "high_volume",
  "failed_clusters",
  "after_hours",
  "single_patient",
  "protected_identity",
  "cross_unit",
  "break_glass",
] as const;

export type LogReviewOutcome = (typeof LOG_REVIEW_OUTCOMES)[number];
export type LogReviewStatus = (typeof LOG_REVIEW_STATUSES)[number];
export type LogReviewParameter = (typeof LOG_REVIEW_PARAMETERS)[number];

export type LogReviewT = {
  reviewedBy: Types.ObjectId;
  reviewerName: string;
  periodFrom: Date;
  periodTo: Date;
  parametersReviewed: LogReviewParameter[];
  outcome: LogReviewOutcome;
  notes?: string;
  flaggedEntries?: Types.ObjectId[];
  anomalySnapshot?: Record<string, any>;
  status: LogReviewStatus;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolutionNotes?: string;
  createdAt: Date;
  integrityHash?: string;
};
