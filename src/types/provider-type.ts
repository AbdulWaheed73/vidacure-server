import { Types } from "mongoose";

export type ProviderType = "physician" | "hypnotherapist" | string;

export type ProviderTier = "free" | "premium";

export type ProviderT = {
  _id?: Types.ObjectId;
  name: string;
  email: string;
  providerType: ProviderType;
  specialty?: string;
  bio?: string;
  calendlyUserUri?: string;
  eventTypes: {
    free: string;
    premium: string;
  };
  isActive: boolean;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
};
