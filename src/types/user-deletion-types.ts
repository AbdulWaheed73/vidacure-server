import { Types } from 'mongoose';

// Service deletion result types
export type ServiceDeletionResult = {
  success: boolean;
  error?: string;
};

export type StripeDeletionResult = ServiceDeletionResult & {
  customerId?: string;
};

export type StreamDeletionResult = ServiceDeletionResult & {
  channelIds?: string[];
};

export type CalendlyDeletionResult = ServiceDeletionResult & {
  notificationCreated: boolean;
  email?: string;
};

export type MongoDBDeletionResult = ServiceDeletionResult;

// Complete deletion results
export type DeletionResults = {
  stripe: StripeDeletionResult;
  stream: StreamDeletionResult;
  calendly: CalendlyDeletionResult;
  mongodb: MongoDBDeletionResult;
};

// Deletion status
export type DeletionStatus = 'pending' | 'in_progress' | 'completed' | 'partial_failure' | 'failed';

// User type for deletion
export type UserTypeForDeletion = 'patient' | 'doctor';

// Deletion metadata
export type DeletionMetadata = {
  stripeCustomerId?: string;
  patientCount?: number;
  reassignedDoctorId?: string;
  calendlyUserUri?: string;
  [key: string]: any;
};

// Admin deletion request
export type AdminDeletionRequest = {
  userType: UserTypeForDeletion;
  reassignDoctorId?: string;
};

// Deletion log document type
export type DeletionLogT = {
  _id?: Types.ObjectId;
  userId: string;
  userType: UserTypeForDeletion;
  userEmail: string;
  userName: string;
  ssnHash: string;
  requestedBy: 'self' | string; // 'self' or admin user ID
  requestedAt: Date;
  completedAt?: Date;
  status: DeletionStatus;
  deletionResults: DeletionResults;
  metadata: DeletionMetadata;
  confirmationId: string;
  createdAt?: Date;
  updatedAt?: Date;
};

// Deletion response
export type DeletionResponse = {
  success: boolean;
  message: string;
  deletionId: string;
  results: DeletionResults;
  confirmationId: string;
};

// Deletion list query
export type DeletionListQuery = {
  page?: number;
  limit?: number;
  status?: DeletionStatus;
};

// Deletion list response
export type DeletionListItem = {
  deletionId: string;
  userId: string;
  userType: UserTypeForDeletion;
  userEmail: string;
  requestedBy: 'self' | string;
  requestedAt: Date;
  completedAt?: Date;
  status: DeletionStatus;
};

export type DeletionListResponse = {
  deletions: DeletionListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};
