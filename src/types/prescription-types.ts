import { Types } from "mongoose";

// A single medication the patient reports currently taking (self-reported),
// captured at prescription-request time so the doctor can see what was actually
// taken vs. what was previously prescribed.
export type CurrentMedication = {
  name: string;
  dosage?: string;
};

// Doctor-prescribed medications share the same shape as patient-reported ones.
export type PrescribedMedication = CurrentMedication;

// Prescription Request Types
export type PrescriptionRequestT = {
  _id?: Types.ObjectId;
  status: PrescriptionRequestStatus;
  currentWeight: number;
  hasSideEffects: boolean;
  sideEffectsDescription?: string;
  currentMedications?: CurrentMedication[];
  prescribedMedications?: PrescribedMedication[];
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
  currentMedications?: CurrentMedication[];
};

export type UpdatePrescriptionRequestData = {
  status: PrescriptionRequestStatus;
  prescribedMedications?: PrescribedMedication[];
  medicationName?: string;
  dosage?: string;
  usageInstructions?: string;
  dateIssued?: Date;
  validTill?: Date;
  rejectionNote?: string;
};
