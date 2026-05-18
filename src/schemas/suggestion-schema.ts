import mongoose, { Schema, Document, Types } from "mongoose";

export type SuggestionDocument = Document & {
  submittedBy: Types.ObjectId;
  submitterRole: "patient" | "doctor";
  submitterName: string;
  title: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
};

const SuggestionSchema: Schema = new Schema(
  {
    submittedBy: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    submitterRole: {
      type: String,
      enum: ["patient", "doctor"],
      required: true,
    },
    submitterName: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

SuggestionSchema.index({ createdAt: -1 });

export default mongoose.model<SuggestionDocument>("Suggestion", SuggestionSchema);
