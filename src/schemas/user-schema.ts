import mongoose, { Schema, Document } from "mongoose";
import { UserT } from "../types/user-type";

const UserSchema: Schema = new Schema(
  {
    ssnHash: { 
      type: String, 
      required: true, 
      unique: true,
      index: true // Add index for faster lookups
    },
    name: { type: String, required: true },
    given_name: { type: String, required: true },
    family_name: { type: String, required: true },
    role: { 
      type: String, 
      enum: ["patient", "doctor", "superadmin"], 
      default: "patient",
      required: true 
    },
    status: { 
      type: String, 
      enum: ["active", "inactive", "pending"], 
      default: "active",
      required: true 
    },
    lastLogin: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Add compound index for better query performance
UserSchema.index({ ssnHash: 1, status: 1 });

export default mongoose.model<UserT & Document>("User", UserSchema);


