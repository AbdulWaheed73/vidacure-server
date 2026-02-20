import mongoose, { Schema, Document } from "mongoose";
import { LabTestOrderT, GiddirSubStatus } from "../types/giddir-types";

export type LabTestOrderDocument = LabTestOrderT & Document;

const labTestResultSchema = new Schema(
  {
    observationId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    valueType: {
      type: String,
      enum: ["quantity", "string", "codeableConcept", "absent"],
      required: true,
    },
    valueQuantity: {
      value: { type: Number },
      unit: { type: String },
    },
    valueString: { type: String },
    referenceRange: {
      low: { type: Number },
      high: { type: Number },
      text: { type: String },
    },
    isOutOfRange: { type: Boolean, default: false },
    interpretation: { type: String },
    effectiveDateTime: { type: String },
    note: { type: String },
  },
  { _id: false }
);

const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const GIDDIR_SUB_STATUSES: GiddirSubStatus[] = [
  "draft",
  "created",
  "sending",
  "sent",
  "sent-failed",
  "accepted",
  "received",
  "sample-received",
  "partial-report",
  "final-report",
  "updated-final-report",
  "signed",
  "completed-updated",
  "revoked",
];

const labTestOrderSchema = new Schema(
  {
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    giddirServiceRequestId: { type: String },
    externalTrackingId: {
      type: String,
      required: true,
      unique: true,
    },
    testPackage: {
      id: { type: String, required: true },
      productCode: { type: String, required: true },
      name: { type: String, required: true },
      nameSv: { type: String, required: true },
    },
    status: {
      type: String,
      enum: GIDDIR_SUB_STATUSES,
      default: "draft",
    },
    statusHistory: [statusHistoryEntrySchema],
    results: [labTestResultSchema],
    orderedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Compound index for patient order list queries
labTestOrderSchema.index({ patient: 1, status: 1 });

// Index for webhook lookups by Giddir service request ID
labTestOrderSchema.index({ giddirServiceRequestId: 1 });

const LabTestOrder = mongoose.model<LabTestOrderDocument>(
  "LabTestOrder",
  labTestOrderSchema
);

export default LabTestOrder;
