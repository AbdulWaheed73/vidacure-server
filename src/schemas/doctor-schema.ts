import mongoose, { Schema, Document, Types } from "mongoose";
import { DoctorT } from "../types/doctor-type";


const DoctorSchema: Schema = new Schema(
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
      enum: ["doctor"], 
      default: "doctor",
      required: true 
    },
    lastLogin: { type: Date, default: Date.now },
    
    // Doctor-specific fields
    email: { type: String, required: true, unique: true },
    patients: [{ type: Types.ObjectId, ref: "Patient" }],
    // hasCompletedOnboarding: { type: Boolean, default: false }

    // Calendly integration fields
    calendlyUserUri: { type: String }, // Individual doctor's Calendly user URI

    // Event types offered by this doctor - just names for Calendly API
    eventTypes: {
      free: { type: String, default: "Free Consultation" },
      standard: { type: String, default: "Standard Appointment" },
      premium: { type: String, default: "Premium Consultation" }
    },

    // Stream Chat related fields - doctors can be in multiple channels
    assignedChannels: [{ type: String }] // Array of channel IDs this doctor is assigned to
  },
  { timestamps: true }
);

export default mongoose.model<DoctorT & Document>("Doctor", DoctorSchema);
