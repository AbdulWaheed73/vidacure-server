import { Types } from "mongoose";

export type PatientT = {
  _id?: Types.ObjectId;
  // Common authentication fields
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: "patient";
  lastLogin?: Date;
  
  // Patient-specific fields
  dateOfBirth?: Date;
  gender?: "male" | "female" | "other";
  email: string;

  weightHistory: {
    weight: number;
    date: Date;
    sideEffects?: string;
    notes?: string;
  }[];

  height: number;
  bmi?: number;

  doctor?: Types.ObjectId; // ref: Doctor

  // Keep stripeSubscriptionId at root level for webhook queries
  stripeSubscriptionId?: string;

  subscription?: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
    stripeProductId: string;
    status: "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";
    planType: "lifestyle" | "medical";
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    canceledAt?: Date;
    trialStart?: Date;
    trialEnd?: Date;
  };

  questionnaire: {
    questionId: string;
    answer: string;
  }[];

  hasCompletedOnboarding?: boolean;

  prescription?: {
    doctor: Types.ObjectId; // ref: Doctor
    medicationDetails: string;
    validFrom: Date;
    validTo: Date;
    status: "active" | "expired" | "pendingRenewal";
    updatedAt: Date;
  };

  prescriptionRequests: {
    _id?: Types.ObjectId;
    status: "pending" | "approved" | "denied" | "under_review";
    currentWeight: number;
    hasSideEffects: boolean;
    sideEffectsDescription?: string;
    createdAt: Date;
    updatedAt: Date;
  }[];

  // Stream Chat related fields
  chatChannelId?: string; // Store the patient's medical channel ID

  createdAt: Date;
  updatedAt: Date;
};
