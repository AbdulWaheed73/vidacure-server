import { Types } from 'mongoose';

export type CancellationReason = 'too_expensive' | 'no_results' | 'reached_goal' | 'technical_issues' | 'other';

export type CancellationFeedbackT = {
  _id?: Types.ObjectId;
  patientId: Types.ObjectId;
  reason: CancellationReason;
  rating?: number;
  comments?: string;
  planType: 'lifestyle' | 'medical';
  subscriptionDuration?: number;
  createdAt: Date;
};
