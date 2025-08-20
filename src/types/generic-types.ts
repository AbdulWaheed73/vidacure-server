import { JwtPayload } from "jsonwebtoken";
import { ObjectId } from "mongodb";
import { Request, Response, NextFunction } from "express";

// Criipto OIDC related types
export interface CriiptoUserClaims extends JwtPayload {
  sub?: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  ssn?: string;
}

// Application JWT types
export interface AppUserClaims extends JwtPayload {
  userId: string;
  role: string;
}

// Request with authenticated user
export interface AuthenticatedRequest extends Request {
  user?: AppUserClaims;
}

// Base user interface
export interface BaseUser {
  _id?: ObjectId;
  ssnHash: string;
  name: string;
  given_name: string;
  family_name: string;
  role: 'patient' | 'doctor' | 'superadmin';
  status: 'active' | 'inactive' | 'pending';
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
}

// Audit log interface
export interface AuditLog {
  timestamp: Date;
  action: string;
  userId?: string;
  details: any;
  ipAddress?: string;
  userAgent?: string;
}

// CSRF token interface
export interface CSRFToken {
  userId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}
