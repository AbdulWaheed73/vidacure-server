import { Types } from "mongoose";

export type AdminT = {
  _id?: Types.ObjectId;
  name: string;
  given_name: string;
  family_name: string;
  role: "admin" | "superadmin";
  lastLogin?: Date;
  email: string;

  // Auth fields
  passwordHash: string;

  // 2FA fields
  totpSecret?: string; // AES-256-GCM encrypted
  totpEnabled: boolean;
  backupCodes?: string[]; // Argon2 hashed

  // Brute force protection
  failedLoginAttempts: number;
  lockedUntil?: Date;

  createdAt: Date;
  updatedAt: Date;
};
