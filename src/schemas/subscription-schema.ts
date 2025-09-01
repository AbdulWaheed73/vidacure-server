import mongoose, { Schema, Document, Types } from "mongoose";

export interface SubscriptionT extends Document {
  userId: Types.ObjectId;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  stripeProductId: string;
  status: "active" | "canceled" | "incomplete" | "incomplete_expired" | "past_due" | "trialing" | "unpaid";
  planType: "lifestyle" | "medical";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema: Schema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "Patient", required: true, index: true },
    stripeCustomerId: { type: String, required: true, index: true },
    stripeSubscriptionId: { type: String, required: true, unique: true, index: true },
    stripePriceId: { type: String, required: true },
    stripeProductId: { type: String, required: true },
    status: { 
      type: String, 
      enum: ["active", "canceled", "incomplete", "incomplete_expired", "past_due", "trialing", "unpaid"], 
      required: true,
      index: true
    },
    planType: { 
      type: String, 
      enum: ["lifestyle", "medical"], 
      required: true 
    },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date },
    trialStart: { type: Date },
    trialEnd: { type: Date },
    metadata: { type: Map, of: String }
  },
  { timestamps: true }
);

SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ stripeCustomerId: 1 });

export default mongoose.model<SubscriptionT>("Subscription", SubscriptionSchema);