import { Types } from "mongoose";

export type AdminT = {
  _id?: Types.ObjectId;
  // Common authentication fields
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: "admin" | "superadmin";
  lastLogin?: Date;

  // Admin-specific fields
  email: string;

  createdAt: Date;
  updatedAt: Date;
};