import mongoose, { Schema, Document, Types } from "mongoose";
import { DoctorT } from "../types/doctor-type";


const DoctorSchema: Schema = new Schema(
  {
    ssn: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, default: "doctor" },
    patients: [{ type: Types.ObjectId, ref: "Patient" }]
  },
  { timestamps: true }
);

export default mongoose.model<DoctorT & Document>("Doctor", DoctorSchema);
