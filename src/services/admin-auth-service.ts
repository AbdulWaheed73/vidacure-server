import jwt from "jsonwebtoken";
import crypto from "crypto";
import Admin from "../schemas/admin-schema";
import { AdminT } from "../types/admin-type";
import { CriiptoUserClaims } from "../types/generic-types";

// Environment variables
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const SSN_HASH_SECRET: string = process.env.SSN_HASH_SECRET as string;
const TTL: number = Number(process.env.TTL); // Token TTL

// Admin-specific JWT payload
export type AdminJWTPayload = {
  userId: string;
  role: "admin" | "superadmin";
  isAdmin: true; // Flag to identify admin tokens
  iat: number;
  exp: number;
};

/**
 * Hash SSN for admin lookup
 */
export function hashSSN(ssn: string): string {
  return crypto.createHmac('sha256', SSN_HASH_SECRET)
    .update(ssn)
    .digest('hex');
}

/**
 * Validate Swedish SSN format
 */
export function isValidSwedishSSN(ssn: string): boolean {
  return /^\d{12}$/.test(ssn);
}

/**
 * Find admin by SSN - ONLY checks Admin collection
 * Does NOT check Patient or Doctor collections
 * Does NOT create new users
 */
export async function findAdminBySSN(criiptoToken: CriiptoUserClaims): Promise<AdminT | null> {
  const { ssn, name } = criiptoToken;

  if (!ssn || !isValidSwedishSSN(ssn)) {
    throw new Error('Invalid or missing SSN from IdP');
  }

  const ssnHash = hashSSN(ssn);

  try {
    // ONLY check Admin collection
    const admin = await Admin.findOne({ ssnHash });

    if (!admin) {
      console.log("❌ Admin not found for SSN hash:", ssnHash);
      console.log("🔐 User attempted admin login:", name);
      return null;
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    console.log("🔐 Admin authenticated:", {
      userId: admin._id?.toString(),
      name: admin.name,
      role: admin.role,
      lastLogin: admin.lastLogin
    });

    return admin;

  } catch (error) {
    console.error("❌ Error in findAdminBySSN:", error);
    throw new Error(`Failed to authenticate admin: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create admin-specific JWT token
 * Contains isAdmin flag to differentiate from regular user tokens
 */
export function createAdminJWT(admin: AdminT): string {
  const payload: AdminJWTPayload = {
    userId: admin._id?.toString() || 'temp-id',
    role: admin.role,
    isAdmin: true, // Critical flag
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + Math.floor(TTL / 1000)
  };

  return jwt.sign(payload, JWT_SECRET);
}

/**
 * Verify admin JWT token
 * Ensures token is admin token (has isAdmin flag)
 */
export function verifyAdminJWT(token: string): AdminJWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminJWTPayload;

    // CRITICAL: Check if this is an admin token
    if (!decoded.isAdmin) {
      console.log('❌ Regular user token used for admin access - BLOCKED');
      return null;
    }

    // Check if role is admin or superadmin
    if (decoded.role !== 'admin' && decoded.role !== 'superadmin') {
      console.log('❌ Invalid role in admin token:', decoded.role);
      return null;
    }

    return decoded;

  } catch (error) {
    console.log('❌ Admin JWT verification failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Generate CSRF token for admin session
 */
export function generateAdminCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
