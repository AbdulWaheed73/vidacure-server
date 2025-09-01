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
    email: { type: String, required: false, unique: true, sparse: true },

    weightHistory: [
      {
        weight: { type: Number, required: true },
        date: { type: Date, default: Date.now }
      }
    ],

    height: { type: Number, required: false },
    bmi: { type: Number },

    doctor: { type: Types.ObjectId, ref: "Doctor" },

    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    subscriptionStatus: { 
      type: String, 
      enum: ["active", "canceled", "incomplete", "incomplete_expired", "past_due", "trialing", "unpaid"], 
      default: null 
    },
    subscriptionPlanType: { 
      type: String, 
      enum: ["lifestyle", "medical"], 
      default: null 
    },
    subscriptionStartDate: { type: Date },
    subscriptionEndDate: { type: Date },

    questionnaire: [
      {
        questionId: { type: String, required: true },
        answer: { type: String }
      }
    ],

    hasCompletedOnboarding: { type: Boolean, default: false },

    prescription: {
      doctor: { type: Types.ObjectId, ref: "Doctor" },
      medicationDetails: { type: String },
      validFrom: { type: Date },
      validTo: { type: Date },
      status: {
        type: String,
        enum: ["active", "expired", "pendingRenewal"]
      },
      updatedAt: { type: Date }
    }
  },
  { timestamps: true }
);

export default mongoose.model<PatientT & Document>("Patient", PatientSchema);
