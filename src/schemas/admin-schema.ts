import mongoose, { Schema, Document } from "mongoose";
import { AdminT } from "../types/admin-type";



const AdminSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, default: "admin" }
  },
  { timestamps: true }
);

export default mongoose.model<AdminT & Document>("Admin", AdminSchema);
