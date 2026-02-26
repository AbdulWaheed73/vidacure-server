import mongoose, { Schema, Document } from 'mongoose';
import type { CancellationFeedbackT } from '../types/cancellation-feedback-type';

const CancellationFeedbackSchema: Schema = new Schema(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true
    },
    reason: {
      type: String,
      enum: ['too_expensive', 'no_results', 'reached_goal', 'technical_issues', 'other'],
      required: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comments: {
      type: String
    },
    planType: {
      type: String,
      enum: ['lifestyle', 'medical'],
      required: true
    },
    subscriptionDuration: {
      type: Number
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<CancellationFeedbackT & Document>('CancellationFeedback', CancellationFeedbackSchema);
