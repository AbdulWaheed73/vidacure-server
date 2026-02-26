import mongoose, { Schema, Document } from "mongoose";
import { AdminT } from "../types/admin-type";

const AdminSchema: Schema = new Schema(
  {
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
    email: { type: String, required: true, unique: true, index: true },

    // Auth fields
    passwordHash: { type: String, required: true },

    // 2FA fields
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    backupCodes: [{ type: String }],

    // Brute force protection
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date }
  },
  { timestamps: true }
);

export default mongoose.model<AdminT & Document>("Admin", AdminSchema);
