import mongoose, { Schema, Document, Types } from "mongoose";
import { PatientT } from "../types/patient-type";

const PatientSchema: Schema = new Schema(
  {
    // Common authentication fields
    ssnHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    encryptedSsn: { type: String, required: false },
    name: { type: String, required: true },
    given_name: { type: String, required: true },
    family_name: { type: String, required: true },
    role: { 
      type: String, 
      enum: ["patient"], 
      default: "patient",
      required: true 
    },
    lastLogin: { type: Date, default: Date.now },
    
    // Patient-specific fields
    dateOfBirth: { type: Date, required: false },
    gender: { type: String, enum: ["male", "female", "other"], required: false },
    email: { type: String, required: false, unique: true, sparse: true },

    weightHistory: [
      {
        weight: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        sideEffects: { type: String, required: false },
        notes: { type: String, required: false }
      }
    ],

    height: { type: Number, required: false },
    bmi: { type: Number },
    goalWeight: { type: Number },

    doctor: { type: Types.ObjectId, ref: "Doctor" },

    providerTierOverrides: [{
      providerId: { type: Types.ObjectId, ref: "Provider", required: true },
      tier: { type: String, enum: ["free", "premium"], required: true },
      setBy: { type: String },
      setAt: { type: Date, default: Date.now }
    }],

    providerMeetings: [{
      providerId: { type: Types.ObjectId, ref: "Provider", required: true },
      providerName: { type: String, required: true },
      providerType: { type: String, required: true },
      eventUri: { type: String, required: true },
      inviteeUri: { type: String },
      scheduledTime: { type: Date, required: true },
      endTime: { type: Date },
      status: {
        type: String,
        enum: ["scheduled", "completed", "canceled"],
        default: "scheduled"
      },
      completedAt: { type: Date },
      eventType: { type: String },
      meetingUrl: { type: String },
      createdAt: { type: Date, default: Date.now }
    }],

    subscription: {
      stripeCustomerId: { type: String },
      stripeSubscriptionId: { type: String },
      stripePriceId: { type: String },
      stripeProductId: { type: String },
      status: {
        type: String,
        enum: ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid"]
      },
      planType: {
        type: String,
        enum: ["lifestyle", "medical"]
      },
      currentPeriodStart: { type: Date },
      currentPeriodEnd: { type: Date },
      cancelAtPeriodEnd: { type: Boolean, default: false },
      canceledAt: { type: Date },
      trialStart: { type: Date },
      trialEnd: { type: Date }
    },

    questionnaire: [
      {
        questionId: { type: String, required: true },
        answer: { type: String }
      }
    ],

    hasCompletedOnboarding: { type: Boolean, default: false },

    // Calendly meeting data - grouped for easier management
    calendly: {
      // Overall meeting status for onboarding gate
      meetingStatus: {
        type: String,
        enum: ["none", "scheduled", "completed"],
        default: "none"
      },
      // Current/active meeting (latest scheduled or completed)
      scheduledMeetingTime: { type: Date },
      completedAt: { type: Date },
      eventUri: { type: String },
      inviteeUri: { type: String },
      // History of all meetings
      meetings: [{
        eventUri: { type: String, required: true },
        inviteeUri: { type: String },
        scheduledTime: { type: Date, required: true },
        endTime: { type: Date },
        status: {
          type: String,
          enum: ["scheduled", "completed", "canceled"],
          default: "scheduled"
        },
        completedAt: { type: Date },
        source: {
          type: String,
          enum: ["pre-login", "post-login"],
          default: "pre-login"
        },
        eventType: { type: String },
        meetingUrl: { type: String },
        cancelUrl: { type: String },
        rescheduleUrl: { type: String },
        calendlyHostName: { type: String },
        createdAt: { type: Date, default: Date.now }
      }]
    },

    prescription: {
      medicationDetails: { type: String },
      validFrom: { type: Date },
      validTo: { type: Date },
      status: {
        type: String,
        enum: ["active", "expired", "pendingRenewal"]
      },
      updatedAt: { type: Date }
    },

    prescriptionRequests: [
      {
        status: {
          type: String,
          enum: ["pending", "approved", "denied", "under_review"],
          default: "pending",
          required: true
        },
        currentWeight: { type: Number, required: true },
        hasSideEffects: { type: Boolean, required: true },
        sideEffectsDescription: { type: String, required: false },
        medicationName: { type: String, required: false },
        dosage: { type: String, required: false },
        usageInstructions: { type: String, required: false },
        dateIssued: { type: Date, required: false },
        validTill: { type: Date, required: false },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      }
    ],

    // Stream Chat related fields (legacy - to be deprecated)
    chatChannelId: { type: String }, // Store the patient's medical channel ID

    // Supabase Chat related fields
    supabaseConversationId: { type: String }, // Store the patient's Supabase conversation UUID

    // Giddir lab test patient ID (UUID assigned by Giddir system)
    giddirPatientId: { type: String, sparse: true, index: true },

    // GDPR / PDL data lifecycle fields
    deletionRequestedAt: { type: Date },          // When patient requested account deletion
    anonymizedAt: { type: Date },                  // When personal identifiers were stripped
    retentionExpiresAt: { type: Date },            // When clinical data can be fully purged (PDL 10-year rule)
    deletionCancelledAt: { type: Date },           // If patient cancelled deletion within grace period
  },
  { timestamps: true }
);

export default mongoose.model<PatientT & Document>("Patient", PatientSchema);
