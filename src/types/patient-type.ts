import { Types } from "mongoose";

export type PatientT = {
  _id?: Types.ObjectId;
  // Common authentication fields
  ssnHash: string;
  encryptedSsn?: string;
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
  goalWeight?: number;

  doctor?: Types.ObjectId; // ref: Doctor

  providerTierOverrides?: {
    providerId: Types.ObjectId;
    tier: "free" | "premium";
    setBy?: string;
    setAt?: Date;
  }[];

  providerMeetings?: {
    providerId: Types.ObjectId;
    providerName: string;
    providerType: string;
    eventUri: string;
    inviteeUri?: string;
    scheduledTime: Date;
    endTime?: Date;
    status: "scheduled" | "completed" | "canceled";
    completedAt?: Date;
    eventType: string;
    meetingUrl?: string;
    createdAt: Date;
  }[];

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

  hypnotherapistPurchase?: {
    stripePaymentIntentId: string;
    stripeCheckoutSessionId: string;
    amount: number;
    currency: string;
    status: "pending" | "completed" | "failed";
    purchasedAt: Date;
  };

  questionnaire: {
    questionId: string;
    answer: string;
  }[];

  hasCompletedOnboarding?: boolean;

  // Calendly meeting data - grouped for easier management
  calendly?: {
    meetingStatus?: "none" | "scheduled" | "completed";
    scheduledMeetingTime?: Date;
    completedAt?: Date;
    eventUri?: string;
    inviteeUri?: string;
    // History of all meetings
    meetings?: {
      eventUri: string;
      inviteeUri?: string;
      scheduledTime: Date;
      endTime?: Date;
      status: "scheduled" | "completed" | "canceled";
      completedAt?: Date;
      source: "pre-login" | "post-login";
      eventType?: string;
      meetingUrl?: string;
      cancelUrl?: string;
      rescheduleUrl?: string;
      calendlyHostName?: string;
      createdAt: Date;
    }[];
  };

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
    medicationName?: string;
    dosage?: string;
    usageInstructions?: string;
    dateIssued?: Date;
    validTill?: Date;
    createdAt: Date;
    updatedAt: Date;
  }[];

  // Giddir lab test patient ID (UUID assigned by Giddir system)
  giddirPatientId?: string;

  // GDPR / PDL data lifecycle fields
  deletionRequestedAt?: Date;
  anonymizedAt?: Date;
  retentionExpiresAt?: Date;
  deletionCancelledAt?: Date;

  createdAt: Date;
  updatedAt: Date;
};
