import mongoose, { Schema, Document, Types } from "mongoose";
import { PendingSessionT, PendingBookingT } from "../types/pending-booking-type";

// Schema for temporary session before booking
const PendingSessionSchema: Schema = new Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    bmiData: {
      height: { type: Number, required: true },
      weight: { type: Number, required: true },
      bmi: { type: Number, required: true }
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

// TTL index - automatically delete documents after expiresAt
PendingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Schema for pending booking awaiting user account
const PendingBookingSchema: Schema = new Schema(
  {
    token: {
      type: String,
      required: true,
      index: true
    },
    calendlyEventUri: {
      type: String,
      required: true
    },
    calendlyInviteeUri: {
      type: String,
      required: true
    },
    inviteeEmail: {
      type: String,
      required: true
    },
    inviteeName: {
      type: String,
      required: true
    },
    scheduledTime: {
      type: Date,
      required: true
    },
    endTime: {
      type: Date
    },
    eventType: {
      type: String
    },
    meetingUrl: {
      type: String
    },
    cancelUrl: {
      type: String
    },
    rescheduleUrl: {
      type: String
    },
    calendlyHostName: {
      type: String
    },
    status: {
      type: String,
      enum: ["active", "canceled", "linked"],
      default: "active"
    },
    linkedUserId: {
      type: Types.ObjectId,
      ref: "Patient"
    },
    linkedAt: {
      type: Date
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    }
  },
  { timestamps: true }
);

// TTL index - automatically delete documents after expiresAt
// Only applies to non-linked bookings (linked ones should be preserved)
PendingBookingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for finding bookings by token
PendingBookingSchema.index({ token: 1, status: 1 });

export const PendingSession = mongoose.model<PendingSessionT & Document>(
  "PendingSession",
  PendingSessionSchema
);

export const PendingBooking = mongoose.model<PendingBookingT & Document>(
  "PendingBooking",
  PendingBookingSchema
);
