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
  rejectionNote?: string;
  createdAt: Date;
  updatedAt: Date;
};

export enum PrescriptionRequestStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DENIED = "denied",
  UNDER_REVIEW = "under_review"
}

// A patient's prescription request enriched with that patient's identity,
// as returned to doctors.
export type DoctorPrescriptionRequestItem = PrescriptionRequestT & {
  patient: { id: Types.ObjectId; name: string };
};

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
  rejectionNote?: string;
};
