import { Types } from 'mongoose';

export type ConsentType = 'privacy_policy';

export type ConsentT = {
  _id?: Types.ObjectId;
  userId: string;
  consentType: ConsentType;
  version: string;
  accepted: boolean;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  withdrawnAt?: Date;
};

export type ConsentStatusResponse = {
  hasAcceptedLatest: boolean;
  currentVersion: string;
  userConsentVersion?: string;
  acceptedAt?: string;
};

export type RecordConsentRequest = {
  consentType: ConsentType;
  version: string;
  accepted: boolean;
};
