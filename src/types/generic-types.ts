import { JwtPayload } from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { Request } from "express";

// Criipto OIDC related types
export type CriiptoUserClaims = JwtPayload & {
  sub?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  ssn?: string;
}

// Application JWT types
export type AppUserClaims = JwtPayload & {
  userId: string;
  role: string;
}

// Request with authenticated user
export interface AuthenticatedRequest extends Request {
  user?: AppUserClaims;
  auditLogger?: {
    logSuccess: (action: string, operation: "CREATE" | "READ" | "UPDATE" | "DELETE", targetId?: string, metadata?: Record<string, any>) => Promise<void>;
    logFailure: (action: string, operation: "CREATE" | "READ" | "UPDATE" | "DELETE", error: any, targetId?: string, metadata?: Record<string, any>) => Promise<void>;
  };
}

// Base user type
export type BaseUser = {
  _id?: ObjectId;
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: 'patient' | 'doctor';
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
}


// CSRF token type
export type CSRFToken = {
  userId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}
