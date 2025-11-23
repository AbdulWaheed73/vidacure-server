import mongoose, { Schema, Document } from "mongoose";
import { AdminT } from "../types/admin-type";

const AdminSchema: Schema = new Schema(
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
      enum: ["admin", "superadmin"],
      default: "admin",
      required: true
    },
    lastLogin: { type: Date, default: Date.now },

    // Admin-specific fields
    email: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

export default mongoose.model<AdminT & Document>("Admin", AdminSchema);
