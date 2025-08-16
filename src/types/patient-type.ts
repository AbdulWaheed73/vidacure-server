import { Types } from "mongoose";

export type PatientT = {
  ssn: string;
  name: string;
  dateOfBirth: Date;
  gender: "male" | "female" | "other";
  email: string;

  weightHistory: {
    weight: number;
    date: Date;
  }[];

  height: number;
  bmi: number;

  doctor: Types.ObjectId; // ref: Doctor

  stripeCustomerId?: string;
  stripeSubscriptionId?: string;

  questionnaire: {
    questionId: string;
    answer: string;
  }[];

  prescription?: {
    doctor: Types.ObjectId; // ref: Doctor
    medicationDetails: string;
    validFrom: Date;
    validTo: Date;
    status: "active" | "expired" | "pendingRenewal";
    updatedAt: Date;
  };

  createdAt: Date;
  updatedAt: Date;
};
