import { Types } from "mongoose";

export type DoctorT = {
  _id?: Types.ObjectId;
  // Common authentication fields
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: "doctor";
  lastLogin?: Date;
  
  // Doctor-specific fields
  email: string;
  patients: Types.ObjectId[];
  // hasCompletedOnboarding?: boolean;
  createdAt: Date;
  updatedAt: Date;
};
