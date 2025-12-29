import { Types } from "mongoose";

// Temporary session created when user passes BMI check (before login)
export type PendingSessionT = {
  _id?: Types.ObjectId;
  token: string; // UUID token for linking
  bmiData: {
    height: number;
    weight: number;
    bmi: number;
  };
  createdAt: Date;
  expiresAt: Date; // TTL: 24 hours
};

// Booking record created when Calendly webhook fires (before user logs in)
export type PendingBookingT = {
  _id?: Types.ObjectId;
  token: string; // Links to PendingSession
  calendlyEventUri: string;
  calendlyInviteeUri: string;
  inviteeEmail: string;
  inviteeName: string;
  scheduledTime: Date;
  status: "active" | "canceled" | "linked";
  linkedUserId?: Types.ObjectId; // Set when linked to a patient
  linkedAt?: Date;
  createdAt: Date;
  expiresAt: Date; // TTL: 30 days or until linked
};

// Request body for creating pending session
export type CreatePendingSessionRequest = {
  height: number;
  weight: number;
  bmi: number;
};

// Response from creating pending session
export type CreatePendingSessionResponse = {
  success: boolean;
  token: string;
  expiresAt: Date;
};

// Request body for linking booking to user
export type LinkBookingRequest = {
  token: string;
};

// Response from linking booking
export type LinkBookingResponse = {
  success: boolean;
  message: string;
  scheduledMeetingTime?: Date;
};
