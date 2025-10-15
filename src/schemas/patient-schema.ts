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
    email: { type: String, required: false, unique: true },

    weightHistory: [
      {
        weight: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        sideEffects: { type: String, required: false },
        notes: { type: String, required: false }
      }
    ],

    height: { type: Number, required: true },
    bmi: { type: Number },

    doctor: { type: Types.ObjectId, ref: "Doctor" },

    // Keep stripeSubscriptionId at root level for webhook queries
    stripeSubscriptionId: { type: String },

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
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      }
    ],

    // Stream Chat related fields
    chatChannelId: { type: String } // Store the patient's medical channel ID
  },
  { timestamps: true }
);

export default mongoose.model<PatientT & Document>("Patient", PatientSchema);
