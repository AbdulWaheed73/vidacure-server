import mongoose, { Schema, Document, Types } from "mongoose";
import { PatientT } from "../types/patient-type";

const PatientSchema: Schema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true, unique: true },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: ["male", "female", "other"], required: true },
    email: { type: String, required: true, unique: true },

    weightHistory: [
      {
        weight: { type: Number, required: true },
        date: { type: Date, default: Date.now }
      }
    ],

    height: { type: Number, required: true },
    bmi: { type: Number },

    doctor: { type: Types.ObjectId, ref: "Doctor" },

    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },

    questionnaire: [
      {
        questionId: { type: String, required: true },
        answer: { type: String }
      }
    ],

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
