import { Types } from "mongoose";

// Prescription Request Types
export type PrescriptionRequestT = {
  _id?: Types.ObjectId;
  status: PrescriptionRequestStatus;
  currentWeight: number;
  hasSideEffects: boolean;
  sideEffectsDescription?: string;
  medicationName?: string;
  dosage?: string;
  usageInstructions?: string;
  dateIssued?: Date;
  validTill?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export enum PrescriptionRequestStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DENIED = "denied",
  UNDER_REVIEW = "under_review"
}

// Main Prescription Types
export type PrescriptionT = {
  doctor?: Types.ObjectId;
  medicationName?: string;
  dosage?: string;
  usageInstructions?: string;
  medicationDetails?: string;
  validFrom?: Date;
  validTo?: Date;
  status?: PrescriptionStatus;
  updatedAt?: Date;
};

export enum PrescriptionStatus {
  ACTIVE = "active",
  EXPIRED = "expired",
  PENDING_RENEWAL = "pendingRenewal"
}

// API Request/Response Types
export type CreatePrescriptionRequestData = {
  currentWeight: number;
  hasSideEffects: boolean;
  sideEffectsDescription?: string;
};

export type UpdatePrescriptionRequestData = {
  status: PrescriptionRequestStatus;
  medicationName?: string;
  dosage?: string;
  usageInstructions?: string;
  dateIssued?: Date;
  validTill?: Date;
};
