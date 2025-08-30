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
export type AuthenticatedRequest = Request & {
  user?: AppUserClaims;
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

// Audit log type
export type AuditLog = {
  timestamp: Date;
  action: string;
  userId?: string;
  details: any;
  ipAddress?: string;
  userAgent?: string;
}

// CSRF token type
export type CSRFToken = {
  userId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}
