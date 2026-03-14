import mongoose, { Schema, Document, Types } from "mongoose";

export type TreatmentJournalDocument = Document & {
  patient: Types.ObjectId;
  doctor: Types.ObjectId;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

const TreatmentJournalSchema: Schema = new Schema(
  {
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      unique: true,
      index: true,
    },
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model<TreatmentJournalDocument>(
  "TreatmentJournal",
  TreatmentJournalSchema
);
