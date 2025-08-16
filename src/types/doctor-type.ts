import { Types } from "mongoose";

export type DoctorT = {
  ssn: string;
  name: string;
  email: string;
  role: "doctor";
  patients: Types.ObjectId[];
  createdAt: Date;
};
