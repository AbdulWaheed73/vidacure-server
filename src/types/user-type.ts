import { Document } from "mongoose";

export interface UserT extends Document {
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: "patient" | "doctor" | "superadmin";
  status: "active" | "inactive" | "pending";
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}


