import jwt from "jsonwebtoken";
import crypto from "crypto";
import argon2 from "argon2";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import QRCode from "qrcode";
import Admin from "../schemas/admin-schema";
import { AdminT } from "../types/admin-type";

// Initialize TOTP instance with plugins
const totpInstance = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

// Environment variables
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const TTL: number = Number(process.env.TTL);
const ENCRYPTION_KEY: string = process.env.ADMIN_2FA_ENCRYPTION_KEY as string;

// Admin-specific JWT payload
export type AdminJWTPayload = {
  userId: string;
  role: "admin" | "superadmin";
  isAdmin: true;
  iat: number;
  exp: number;
};

// Pending 2FA JWT payload
export type PendingJWTPayload = {
  userId: string;
  isPending2FA: true;
  iat: number;
  exp: number;
};

// ─── Password Hashing ────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}

// ─── TOTP Secret Encryption ─────────────────────────────────

export function encryptTotpSecret(secret: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptTotpSecret(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

// ─── TOTP Generation & Verification ─────────────────────────

export async function generateTotpSecret(email: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}> {
  const secret = totpInstance.generateSecret();
  const otpauthUrl = totpInstance.toURI({
    label: email,
    issuer: "Vidacure Admin",
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrCodeDataUrl };
}

export async function verifyTotpCode(
  encryptedSecret: string,
  code: string
): Promise<boolean> {
  const secret = decryptTotpSecret(encryptedSecret);
  const result = await totpInstance.verify(code, { secret });
  return result.valid;
}

export async function verifyTotpCodeRaw(
  secret: string,
  code: string
): Promise<boolean> {
  const result = await totpInstance.verify(code, { secret });
  return result.valid;
}

// ─── Backup Codes ────────────────────────────────────────────

export async function generateBackupCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const plain: string[] = [];
  const hashed: string[] = [];

  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    plain.push(code);
    hashed.push(await argon2.hash(code, { type: argon2.argon2id }));
  }

  return { plain, hashed };
}

export async function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): Promise<{ valid: boolean; remainingCodes: string[] }> {
  for (let i = 0; i < hashedCodes.length; i++) {
    const match = await argon2.verify(hashedCodes[i], code);
    if (match) {
      const remainingCodes = [...hashedCodes];
      remainingCodes.splice(i, 1);
      return { valid: true, remainingCodes };
    }
  }
  return { valid: false, remainingCodes: hashedCodes };
}

// ─── Pending 2FA Token ──────────────────────────────────────

export function createPendingToken(adminId: string): string {
  const payload = {
    userId: adminId,
    isPending2FA: true,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyPendingToken(
  token: string
): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as PendingJWTPayload;
    if (!decoded.isPending2FA) {
      return null;
    }
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

// ─── Account Lockout ─────────────────────────────────────────

export function checkAccountLockout(
  admin: AdminT
): { locked: boolean; retryAfter?: number } {
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const retryAfter = Math.ceil(
      (admin.lockedUntil.getTime() - Date.now()) / 1000
    );
    return { locked: true, retryAfter };
  }
  return { locked: false };
}

export async function recordFailedAttempt(adminId: string): Promise<void> {
  const admin = await Admin.findById(adminId);
  if (!admin) return;

  const attempts = (admin.failedLoginAttempts || 0) + 1;
  let lockedUntil: Date | undefined;

  if (attempts >= 15) {
    lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  } else if (attempts >= 10) {
    lockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  } else if (attempts >= 5) {
    lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  }

  await Admin.findByIdAndUpdate(adminId, {
    failedLoginAttempts: attempts,
    ...(lockedUntil ? { lockedUntil } : {}),
  });
}

export async function resetFailedAttempts(adminId: string): Promise<void> {
  await Admin.findByIdAndUpdate(adminId, {
    failedLoginAttempts: 0,
    $unset: { lockedUntil: 1 },
  });
}

// ─── Full Admin JWT (unchanged) ─────────────────────────────

export function createAdminJWT(admin: AdminT): string {
  const payload: AdminJWTPayload = {
    userId: admin._id?.toString() || "temp-id",
    role: admin.role,
    isAdmin: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + Math.floor(TTL / 1000),
  };
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyAdminJWT(token: string): AdminJWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminJWTPayload;

    if (!decoded.isAdmin) {
      console.log("❌ Regular user token used for admin access - BLOCKED");
      return null;
    }

    if (decoded.role !== "admin" && decoded.role !== "superadmin") {
      console.log("❌ Invalid role in admin token:", decoded.role);
      return null;
    }

    return decoded;
  } catch (error) {
    console.log(
      "❌ Admin JWT verification failed:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return null;
  }
}

export function generateAdminCSRFToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
