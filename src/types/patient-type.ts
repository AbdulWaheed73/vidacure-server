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
  email?: string;

  weightHistory: {
    weight: number;
    date: Date;
  }[];

  height?: number;
  bmi?: number;

  doctor?: Types.ObjectId; // ref: Doctor

  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: "active" | "canceled" | "incomplete" | "incomplete_expired" | "past_due" | "trialing" | "unpaid";
  subscriptionPlanType?: "lifestyle" | "medical";
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;

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

  createdAt: Date;
  updatedAt: Date;
};
